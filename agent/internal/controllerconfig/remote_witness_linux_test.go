package controllerconfig

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// Explicit test adapter: the Unix socket carries end-to-end mTLS over a
// preauthenticated SSH bridge to a separate physical witness. It proves the
// authority/runtime protocol, not production WireGuard routing or host rollout.
type runtimeWitnessClient struct {
	client     *http.Client
	authority  string
	witnessID  string
	nodeID     string
	keys       map[string]string
	serverTime time.Time
}

func newRuntimeWitnessClient(ctx context.Context, t *testing.T, config PrepareConfig, candidate []byte, trust Context, node, holder ed25519.PublicKey) *runtimeWitnessClient {
	t.Helper()
	dir := os.Getenv("INCUDAL_MIGRATION_REMOTE_WITNESS_DIR")
	if !filepath.IsAbs(dir) || filepath.Clean(dir) != dir {
		t.Fatal("protected remote witness fixture directory required")
	}
	info, err := os.Lstat(dir)
	if err != nil || !info.IsDir() || info.Mode().Perm() != 0700 {
		t.Fatal("remote witness fixture directory permissions")
	}
	public, _ := json.Marshal(map[string]any{"platformId": config.PlatformID, "nodeId": config.NodeID, "controllerId": config.ControllerID,
		"candidate": string(candidate), "candidateKeys": trust.TrustedKeys, "nodePublicKey": base64.StdEncoding.EncodeToString(node),
		"holderPublicKey": base64.StdEncoding.EncodeToString(holder)})
	if os.WriteFile(filepath.Join(dir, "fixture.public.json"), public, 0600) != nil {
		t.Fatal("remote witness fixture publication")
	}
	var bootstrap struct {
		WitnessID string            `json:"witnessId"`
		Keys      map[string]string `json:"witnessKeys"`
		Authority string            `json:"authority"`
		CA        string            `json:"ca"`
		Cert      string            `json:"clientCert"`
		Key       string            `json:"clientKey"`
	}
	ready := filepath.Join(dir, "bootstrap.private.json")
	for {
		raw, e := os.ReadFile(ready)
		if e == nil {
			info, e := os.Lstat(ready)
			if e != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || json.Unmarshal(raw, &bootstrap) != nil {
				t.Fatal("protected remote witness bootstrap invalid")
			}
			break
		}
		if !os.IsNotExist(e) || ctx.Err() != nil {
			t.Fatal("remote witness bootstrap unavailable")
		}
		time.Sleep(100 * time.Millisecond)
	}
	if bootstrap.Authority != "witness.example.test:19443" || !uuidPattern.MatchString(bootstrap.WitnessID) || len(bootstrap.Keys) != 1 {
		t.Fatal("remote witness identity invalid")
	}
	for id, public := range bootstrap.Keys {
		raw, e := decodeBase64(public, 32)
		if e != nil || SigningKeyID(raw) != id {
			t.Fatal("remote witness trust key invalid")
		}
	}
	certificate, err := tls.X509KeyPair([]byte(bootstrap.Cert), []byte(bootstrap.Key))
	if err != nil {
		t.Fatal("remote witness client certificate invalid")
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM([]byte(bootstrap.CA)) {
		t.Fatal("remote witness certificate authority invalid")
	}
	transport := &http.Transport{Proxy: nil, TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS13, RootCAs: roots, Certificates: []tls.Certificate{certificate}, ServerName: "witness.example.test"},
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{Timeout: 3 * time.Second}).DialContext(ctx, "unix", filepath.Join(dir, "witness.sock"))
		}}
	t.Cleanup(transport.CloseIdleConnections)
	return &runtimeWitnessClient{client: &http.Client{Transport: transport, Timeout: 5 * time.Second,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }},
		authority: bootstrap.Authority, witnessID: bootstrap.WitnessID, nodeID: config.NodeID, keys: bootstrap.Keys}
}

func (c *runtimeWitnessClient) send(ctx context.Context, t *testing.T, endpoint string, value any, expected int) []byte {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal("remote witness request encoding")
	}
	r, err := http.NewRequestWithContext(ctx, "POST", "https://"+c.authority+endpoint, bytes.NewReader(raw))
	if err != nil {
		t.Fatal("remote witness request")
	}
	r.Header.Set("Content-Type", "application/json")
	response, err := c.client.Do(r)
	if err != nil {
		t.Fatal("remote witness authenticated transport failed")
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 20001))
	if err != nil || len(body) > 20000 || response.StatusCode != expected {
		t.Fatalf("remote witness endpoint=%s status=%d expected=%d", endpoint, response.StatusCode, expected)
	}
	c.serverTime, err = http.ParseTime(response.Header.Get("Date"))
	if err != nil {
		t.Fatal("remote witness authenticated time unavailable")
	}
	return body
}

func (c *runtimeWitnessClient) prepare(ctx context.Context, t *testing.T, candidate []byte) []byte {
	t.Helper()
	body := c.send(ctx, t, "/v1/witness/prepare", map[string]string{"nodeId": c.nodeID, "candidate": string(candidate)}, 200)
	var response struct {
		Permit string `json:"preparePermit"`
	}
	if json.Unmarshal(body, &response) != nil || response.Permit == "" {
		t.Fatal("remote witness preparation response")
	}
	return []byte(response.Permit)
}

func (c *runtimeWitnessClient) activateAndLease(ctx context.Context, t *testing.T, node string, preparation RuntimePreparation, holderID string) []byte {
	t.Helper()
	c.send(ctx, t, "/v1/witness/activate", map[string]string{"nodeId": node, "receipt": preparation.Receipt}, 200)
	// Gate proof verification grants no future issue time. A host may be a few
	// seconds ahead of the witness even though its receipt is within the allowed
	// clock tolerance. Wait for the authenticated witness clock to reach the
	// original signed instant; never adjust clocks or extend the proof deadline.
	var proofEnvelope fenceEnvelope
	var proof GateProof
	if decodeStrict([]byte(preparation.GateProof), &proofEnvelope) != nil {
		t.Fatal("remote witness gate proof envelope")
	}
	proofRaw, _ := base64.StdEncoding.Strict().DecodeString(proofEnvelope.Payload)
	if decodeStrict(proofRaw, &proof) != nil {
		t.Fatal("remote witness gate proof")
	}
	if delta := proof.IssuedAt - c.serverTime.UnixMilli(); delta > 0 {
		if delta > 6000 {
			t.Fatal("remote witness clock gap exceeds receipt tolerance")
		}
		t.Logf("waiting %dms for authenticated witness time; signed expiry unchanged", delta)
		timer := time.NewTimer(time.Duration(delta) * time.Millisecond)
		defer timer.Stop()
		select {
		case <-ctx.Done():
			t.Fatal("remote witness clock wait cancelled")
		case <-timer.C:
		}
	}
	body := c.send(ctx, t, "/v1/witness/lease", map[string]any{"nodeId": node, "receipt": preparation.Receipt,
		"gateProof": preparation.GateProof, "gateId": preparation.GateID, "holderKeyId": holderID, "permissions": []string{"inspect"}}, 200)
	var response struct {
		Lease string `json:"lease"`
	}
	if json.Unmarshal(body, &response) != nil || response.Lease == "" {
		t.Fatal("remote witness lease response")
	}
	return []byte(response.Lease)
}

func (c *runtimeWitnessClient) assertInvalidScope(ctx context.Context, t *testing.T, node string, preparation RuntimePreparation, holderID string) {
	t.Helper()
	c.send(ctx, t, "/v1/witness/lease", map[string]any{"nodeId": node, "receipt": preparation.Receipt,
		"gateProof": preparation.GateProof, "gateId": preparation.GateID, "holderKeyId": holderID, "permissions": []string{"inspect", "instance-power"}}, 409)
}
