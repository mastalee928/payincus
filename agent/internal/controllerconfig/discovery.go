package controllerconfig

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const requestPrefix = "payincus/controller-config-read/v1\n"

// DiscoveryReader performs one authenticated read against a locally enrolled
// HTTPS endpoint. The caller supplies pinned trust and handles scheduling; no
// endpoint from a downloaded candidate is used to discover further candidates.
type DiscoveryReader struct {
	Endpoint  string
	NodeKey   ed25519.PrivateKey
	Transport *http.Transport
	Timeout   time.Duration
}

func (reader DiscoveryReader) Read(ctx context.Context, trust Context) (Result, error) {
	payload, err := reader.readEnvelope(ctx, trust, "/v1/controller-config")
	if err != nil {
		return Result{}, err
	}
	trust.Now = time.Now().UnixMilli()
	return VerifyPrepareConfig(payload, trust)
}

func (reader DiscoveryReader) ReadChannels(ctx context.Context, trust Context) ([]byte, ChannelsResult, error) {
	payload, err := reader.readEnvelope(ctx, trust, "/v1/management-channels")
	if err != nil {
		return nil, ChannelsResult{}, err
	}
	trust.Now = time.Now().UnixMilli()
	result, err := VerifyManagementChannels(payload, trust)
	return payload, result, err
}

func (reader DiscoveryReader) readEnvelope(ctx context.Context, trust Context, path string) ([]byte, error) {
	var empty []byte
	endpoint, err := url.Parse(reader.Endpoint)
	if err != nil || len(reader.Endpoint) > 512 || endpoint.Scheme != "https" || endpoint.User != nil || endpoint.Host == "" || strings.HasSuffix(endpoint.Host, ":") || endpoint.Opaque != "" || endpoint.RawQuery != "" || endpoint.ForceQuery || endpoint.Fragment != "" || endpoint.RawFragment != "" || endpoint.RawPath != "" || endpoint.Path != path || endpoint.String() != reader.Endpoint {
		return empty, failure("CONTROLLER_DISCOVERY_ENDPOINT_INVALID")
	}
	if len(reader.NodeKey) != ed25519.PrivateKeySize || !uuidPattern.MatchString(trust.PlatformID) || !uuidPattern.MatchString(trust.NodeID) {
		return empty, failure("CONTROLLER_DISCOVERY_IDENTITY_INVALID")
	}
	// Operators enroll the independent discovery address locally. Loopback and
	// private networks can be intentional; redirects and public/private fallback
	// are never inferred from remote content. TLS verification is mandatory.
	transport := reader.Transport
	if transport == nil {
		transport = http.DefaultTransport.(*http.Transport).Clone()
		defer transport.CloseIdleConnections()
	}
	if transport.TLSClientConfig != nil && transport.TLSClientConfig.InsecureSkipVerify {
		return empty, failure("CONTROLLER_DISCOVERY_TLS_INVALID")
	}
	timeout := reader.Timeout
	if timeout == 0 {
		timeout = 10 * time.Second
	}
	if timeout <= 0 || timeout > 30*time.Second {
		return empty, failure("CONTROLLER_DISCOVERY_TIMEOUT_INVALID")
	}
	readCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	var nonceBytes [24]byte
	if _, err = rand.Read(nonceBytes[:]); err != nil {
		return empty, failure("CONTROLLER_DISCOVERY_RANDOM_FAILED")
	}
	nonce := base64.RawURLEncoding.EncodeToString(nonceBytes[:])
	timestamp := strconv.FormatInt(time.Now().UnixMilli(), 10)
	// Exact host and path are signed, preventing forwarding node credentials to
	// another origin. Requests carry the node's proof, never OSS/admin credentials.
	signed := requestPrefix + strings.Join([]string{"GET", endpoint.Host, endpoint.Path, trust.PlatformID, trust.NodeID, timestamp, nonce}, "\n")
	signature := base64.StdEncoding.EncodeToString(ed25519.Sign(reader.NodeKey, []byte(signed)))
	request, err := http.NewRequestWithContext(readCtx, http.MethodGet, reader.Endpoint, nil)
	if err != nil {
		return empty, failure("CONTROLLER_DISCOVERY_ENDPOINT_INVALID")
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Cache-Control", "no-cache")
	request.Header.Set("X-Payincus-Platform-ID", trust.PlatformID)
	request.Header.Set("X-Payincus-Node-ID", trust.NodeID)
	request.Header.Set("X-Payincus-Timestamp", timestamp)
	request.Header.Set("X-Payincus-Nonce", nonce)
	request.Header.Set("X-Payincus-Signature", signature)
	client := http.Client{Transport: transport, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(request)
	if err != nil {
		return empty, failure("CONTROLLER_DISCOVERY_REQUEST_FAILED")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return empty, failure("CONTROLLER_DISCOVERY_RESPONSE_REJECTED")
	}
	if response.Header.Get("Content-Type") != "application/json" {
		return empty, failure("CONTROLLER_DISCOVERY_CONTENT_INVALID")
	}
	if response.ContentLength > MaxEnvelopeBytes {
		return empty, failure("CONTROLLER_DISCOVERY_TOO_LARGE")
	}
	payload, err := io.ReadAll(io.LimitReader(response.Body, MaxEnvelopeBytes+1))
	if err != nil {
		return empty, failure("CONTROLLER_DISCOVERY_REQUEST_FAILED")
	}
	if len(payload) > MaxEnvelopeBytes {
		return empty, failure("CONTROLLER_DISCOVERY_TOO_LARGE")
	}
	// Use receive time, not pre-request time, so a delayed response cannot bypass expiry.
	return payload, nil
}
