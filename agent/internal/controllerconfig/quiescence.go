package controllerconfig

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

// IncusQuiescence reads actual local daemon operations. An empty result alone
// cannot authorize writes: socket/credentials/process fencing remains required.
type IncusQuiescence struct{ ActiveOperationIDs []string }
type incusOperation struct {
	ID         string `json:"id"`
	Status     string `json:"status"`
	StatusCode int    `json:"status_code"`
}

var operationStatuses = map[string]int{"operation created": 100, "pending": 105, "running": 103, "cancelling": 104, "success": 200, "failure": 400, "cancelled": 401}

func duplicateJSONKeys(raw []byte) bool {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	depth, tokens := 0, 0
	var value func() error
	value = func() error {
		depth++
		tokens++
		defer func() { depth-- }()
		if depth > 32 || tokens > 32768 {
			return invalid()
		}
		token, err := decoder.Token()
		if err != nil {
			return err
		}
		delimiter, ok := token.(json.Delim)
		if !ok {
			return nil
		}
		switch delimiter {
		case '{':
			keys := map[string]bool{}
			for decoder.More() {
				k, e := decoder.Token()
				if e != nil {
					return e
				}
				key, ok := k.(string)
				if !ok || keys[key] {
					return invalid()
				}
				keys[key] = true
				if e = value(); e != nil {
					return e
				}
			}
		case '[':
			for decoder.More() {
				if e := value(); e != nil {
					return e
				}
			}
		default:
			return invalid()
		}
		_, err = decoder.Token()
		return err
	}
	if value() != nil {
		return true
	}
	_, err := decoder.Token()
	return err != io.EOF
}

// ValidateProtocolJSON bounds nesting/tokens and rejects duplicate keys before
// decoding command input or protected enrollment. It does not authenticate it.
func ValidateProtocolJSON(raw []byte, limit int) error {
	if limit < 1 || limit > 1048576 || len(raw) > limit || !utf8.Valid(raw) || duplicateJSONKeys(raw) {
		return invalid()
	}
	return nil
}
func ParseIncusQuiescence(raw []byte) (IncusQuiescence, error) {
	result := IncusQuiescence{ActiveOperationIDs: []string{}}
	fail := func() (IncusQuiescence, error) { return IncusQuiescence{}, failure("CONTROLLER_QUIESCENCE_INVALID") }
	if len(raw) > 1048576 || !utf8.Valid(raw) || duplicateJSONKeys(raw) {
		return fail()
	}
	var response struct {
		Type       string          `json:"type"`
		StatusCode int             `json:"status_code"`
		Metadata   json.RawMessage `json:"metadata"`
	}
	if json.Unmarshal(raw, &response) != nil || response.Type != "sync" || response.StatusCode != 200 || len(response.Metadata) == 0 || response.Metadata[0] != '{' {
		return fail()
	}
	var groups map[string]json.RawMessage
	if json.Unmarshal(response.Metadata, &groups) != nil || groups == nil || len(groups) > len(operationStatuses) {
		return fail()
	}
	seen := map[string]bool{}
	count := 0
	for group, encoded := range groups {
		code, known := operationStatuses[group]
		if !known || len(encoded) == 0 || encoded[0] != '[' {
			return fail()
		}
		var entries []json.RawMessage
		if json.Unmarshal(encoded, &entries) != nil {
			return fail()
		}
		count += len(entries)
		if count > 1024 {
			return fail()
		}
		for _, entry := range entries {
			var op incusOperation
			if len(entry) == 0 || entry[0] != '{' || json.Unmarshal(entry, &op) != nil || !uuidPattern.MatchString(op.ID) || seen[op.ID] || strings.ToLower(op.Status) != group || op.StatusCode != code {
				return fail()
			}
			seen[op.ID] = true
			if code < 200 {
				result.ActiveOperationIDs = append(result.ActiveOperationIDs, op.ID)
			}
		}
	}
	sort.Strings(result.ActiveOperationIDs)
	return result, nil
}
func ReadIncusQuiescence(ctx context.Context, socketPath string) (IncusQuiescence, error) {
	if !filepath.IsAbs(socketPath) || filepath.Clean(socketPath) != socketPath {
		return IncusQuiescence{}, failure("CONTROLLER_QUIESCENCE_SOCKET_INVALID")
	}
	if err := validateIncusQuiescenceSocket(socketPath); err != nil {
		return IncusQuiescence{}, err
	}
	transport := &http.Transport{Proxy: nil, DialContext: func(ctx context.Context, _ string, _ string) (net.Conn, error) {
		return (&net.Dialer{Timeout: 3 * time.Second}).DialContext(ctx, "unix", socketPath)
	}}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 5 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	request, err := http.NewRequestWithContext(ctx, "GET", "http://unix/1.0/operations?recursion=1&all-projects=true", nil)
	if err != nil {
		return IncusQuiescence{}, failure("CONTROLLER_QUIESCENCE_REQUEST_FAILED")
	}
	response, err := client.Do(request)
	if err != nil {
		return IncusQuiescence{}, failure("CONTROLLER_QUIESCENCE_REQUEST_FAILED")
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return IncusQuiescence{}, failure("CONTROLLER_QUIESCENCE_RESPONSE_REJECTED")
	}
	if response.ContentLength > 1048576 {
		return IncusQuiescence{}, failure("CONTROLLER_QUIESCENCE_INVALID")
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, 1048577))
	if err != nil {
		return IncusQuiescence{}, failure("CONTROLLER_QUIESCENCE_REQUEST_FAILED")
	}
	return ParseIncusQuiescence(raw)
}
