package controllerconfig

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

var managedInstanceName = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$`)

// HostOperation is a closed protocol, not an Incus URL/body proxy. Power
// commands target only an existing default-project instance, never deletion,
// creation, arbitrary exec, force-stop or migration.
type HostOperation struct {
	SchemaVersion int    `json:"schemaVersion"`
	Operation     string `json:"operation"`
	Instance      string `json:"instance,omitempty"`
	Action        string `json:"action,omitempty"`
}
type HostOperationResult struct {
	Accepted              bool   `json:"accepted"`
	ActiveIncusOperations int    `json:"activeIncusOperations,omitempty"`
	OperationID           string `json:"operationId,omitempty"`
}
type HostOperationExecutor struct {
	mutex      sync.Mutex
	gate       *LeaseGate
	socketPath string
}

// Construct only after local credential/process auditing, protected identity
// loading and startup fencing. No network listener is started by this module.
func NewHostOperationExecutor(gate *LeaseGate, socketPath string) (*HostOperationExecutor, error) {
	if gate == nil || validateIncusQuiescenceSocket(socketPath) != nil {
		return nil, failure("CONTROLLER_HOST_OPERATION_INVALID")
	}
	return &HostOperationExecutor{gate: gate, socketPath: socketPath}, nil
}

func parseHostOperation(raw []byte) (HostOperation, string, error) {
	var op HostOperation
	fail := func() (HostOperation, string, error) {
		return HostOperation{}, "", failure("CONTROLLER_HOST_OPERATION_INVALID")
	}
	if len(raw) > 4096 || ValidateProtocolJSON(raw, 4096) != nil {
		return fail()
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&op) != nil || op.SchemaVersion != 1 {
		return fail()
	}
	if _, err := decoder.Token(); err != io.EOF {
		return fail()
	}
	switch op.Operation {
	case "inspect-operations":
		if op.Instance != "" || op.Action != "" {
			return fail()
		}
		return op, "inspect", nil
	case "instance-power":
		if !managedInstanceName.MatchString(op.Instance) || (op.Action != "start" && op.Action != "stop" && op.Action != "restart") {
			return fail()
		}
		return op, "instance-power", nil
	default:
		return fail()
	}
}

func (e *HostOperationExecutor) Execute(ctx context.Context, raw []byte, proof LeaseRequest, holderPublicKey string) (HostOperationResult, error) {
	return e.ExecuteAudited(ctx, raw, proof, holderPublicKey, nil)
}

// The runtime's local fence audit runs only after the holder proves possession
// for this exact body; invalid requests cannot use it as an Incus read oracle.
func (e *HostOperationExecutor) ExecuteAudited(ctx context.Context, raw []byte, proof LeaseRequest, holderPublicKey string, audit func(context.Context) error) (HostOperationResult, error) {
	empty := HostOperationResult{}
	op, permission, err := parseHostOperation(raw)
	if err != nil {
		return empty, err
	}
	e.mutex.Lock()
	defer e.mutex.Unlock()
	if err = e.gate.AuthorizeRequest(proof, holderPublicKey, permission, raw); err != nil {
		return empty, err
	}
	key, _ := decodeBase64(holderPublicKey, 32)
	ctx, release, err := e.gate.executionContext(ctx, SigningKeyID(key), permission)
	if err != nil {
		return empty, err
	}
	defer release()
	if audit != nil {
		if err = audit(ctx); err != nil {
			return empty, err
		}
	}
	operations, err := ReadIncusQuiescence(ctx, e.socketPath)
	if err != nil {
		return empty, err
	}
	if op.Operation == "inspect-operations" {
		return HostOperationResult{Accepted: true, ActiveIncusOperations: len(operations.ActiveOperationIDs)}, nil
	}
	if len(operations.ActiveOperationIDs) > 0 {
		return empty, failure("CONTROLLER_HOST_OPERATION_BUSY")
	}
	// Recheck deadline after local reads. The authenticated nonce is already
	// consumed, so a retry is a new request and never repeats an accepted job.
	if err = e.gate.authorize(SigningKeyID(key), permission); err != nil {
		return empty, err
	}
	response, err := e.incus(ctx, "GET", "/1.0/instances/"+url.PathEscape(op.Instance), nil)
	if err != nil {
		return empty, err
	}
	var instance struct {
		Type       string `json:"type"`
		StatusCode int    `json:"status_code"`
		Metadata   struct {
			Name string `json:"name"`
			Type string `json:"type"`
		} `json:"metadata"`
	}
	if json.Unmarshal(response, &instance) != nil || instance.Type != "sync" || instance.StatusCode != 200 || instance.Metadata.Name != op.Instance || (instance.Metadata.Type != "container" && instance.Metadata.Type != "virtual-machine") {
		return empty, failure("CONTROLLER_HOST_OPERATION_IDENTITY")
	}
	if err = e.gate.authorize(SigningKeyID(key), permission); err != nil {
		return empty, err
	}
	body, _ := json.Marshal(struct {
		Action  string `json:"action"`
		Timeout int    `json:"timeout"`
		Force   bool   `json:"force"`
	}{op.Action, 60, false})
	response, err = e.incus(ctx, "PUT", "/1.0/instances/"+url.PathEscape(op.Instance)+"/state", body)
	if err != nil {
		return empty, err
	}
	var accepted struct {
		Type       string `json:"type"`
		StatusCode int    `json:"status_code"`
		Operation  string `json:"operation"`
	}
	if json.Unmarshal(response, &accepted) != nil || accepted.Type != "async" || accepted.StatusCode != 100 || !strings.HasPrefix(accepted.Operation, "/1.0/operations/") {
		return empty, failure("CONTROLLER_HOST_OPERATION_RESPONSE")
	}
	id := strings.TrimPrefix(accepted.Operation, "/1.0/operations/")
	if !uuidPattern.MatchString(id) {
		return empty, failure("CONTROLLER_HOST_OPERATION_RESPONSE")
	}
	return HostOperationResult{Accepted: true, OperationID: id}, nil
}

func (e *HostOperationExecutor) incus(ctx context.Context, method, path string, body []byte) ([]byte, error) {
	if validateIncusQuiescenceSocket(e.socketPath) != nil {
		return nil, failure("CONTROLLER_HOST_OPERATION_SOCKET")
	}
	transport := &http.Transport{Proxy: nil, DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{Timeout: 3 * time.Second}).DialContext(ctx, "unix", e.socketPath)
	}}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 5 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	request, err := http.NewRequestWithContext(ctx, method, "http://unix"+path, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := client.Do(request)
	if err != nil {
		return nil, failure("CONTROLLER_HOST_OPERATION_IO")
	}
	defer response.Body.Close()
	if response.StatusCode != 200 && response.StatusCode != 202 {
		return nil, failure("CONTROLLER_HOST_OPERATION_RESPONSE")
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, 1048577))
	if err != nil || ValidateProtocolJSON(raw, 1048576) != nil {
		return nil, failure("CONTROLLER_HOST_OPERATION_RESPONSE")
	}
	return raw, nil
}
