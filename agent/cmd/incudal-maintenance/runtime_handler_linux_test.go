package main

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"incudal-agent/internal/controllerconfig"
)

func TestRuntimeHTTPSRejectsWrongCertificateAndCannotAttestUnisolatedHost(t *testing.T) {
	rootPub, rootKey, _ := ed25519.GenerateKey(rand.Reader)
	witnessPub, witnessKey, _ := ed25519.GenerateKey(rand.Reader)
	_, nodeKey, _ := ed25519.GenerateKey(rand.Reader)
	holderPub, _, _ := ed25519.GenerateKey(rand.Reader)
	platform, node, controller, witness := "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333", "77777777-7777-4777-8777-777777777777"
	trust := controllerconfig.Context{PlatformID: platform, NodeID: node, TrustedKeys: map[string]string{controllerconfig.SigningKeyID(rootPub): base64.StdEncoding.EncodeToString(rootPub)}, Now: time.Now().UnixMilli()}
	keys := map[string]string{controllerconfig.SigningKeyID(witnessPub): base64.StdEncoding.EncodeToString(witnessPub)}
	runtime, err := controllerconfig.NewMaintenanceRuntime(trust, witness, keys, nodeKey, "/does/not/open", func(context.Context) (controllerconfig.RuntimeFenceFacts, error) {
		return controllerconfig.RuntimeFenceFacts{NetworkBlocked: true, Processes: controllerconfig.ProcessAudit{StableSnapshot: true}}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	sign := func(value any, key ed25519.PrivateKey, prefix string) string {
		raw, _ := json.Marshal(value)
		payload := base64.StdEncoding.EncodeToString(raw)
		id := controllerconfig.SigningKeyID(key.Public().(ed25519.PublicKey))
		out, _ := json.Marshal(struct {
			SchemaVersion int    `json:"schemaVersion"`
			KeyID         string `json:"keyId"`
			Payload       string `json:"payload"`
			Signature     string `json:"signature"`
		}{1, id, payload, base64.StdEncoding.EncodeToString(ed25519.Sign(key, []byte(prefix+id+"\n"+payload)))})
		return string(out)
	}
	now := time.Now().UnixMilli()
	config := controllerconfig.PrepareConfig{SchemaVersion: 1, Purpose: "controller-prepare", PlatformID: platform, NodeID: node, ControllerID: controller, RequestID: "44444444-4444-4444-8444-444444444444", Epoch: "2", Sequence: "1", IssuedAt: now, ExpiresAt: now + 60000, PanelBaseURL: "https://panel.example.com",
		Gateway: controllerconfig.Gateway{GatewayID: "55555555-5555-4555-8555-555555555555", EndpointHost: "gateway.example.com", EndpointPort: 51820, PublicKey: base64.StdEncoding.EncodeToString(make([]byte, 32)), NodeAddress: "10.250.1.2", ControlAddress: "10.250.1.1"}}
	config.Gateway.PublicKey = base64.StdEncoding.EncodeToString([]byte(strings.Repeat("a", 32)))
	candidate := sign(config, rootKey, "payincus/controller-prepare/v1\n")
	checked, err := controllerconfig.VerifyPrepareConfig([]byte(candidate), trust)
	if err != nil {
		t.Fatal(err)
	}
	permit := sign(controllerconfig.PreparePermit{SchemaVersion: 1, Purpose: "host-fence-prepare", WitnessID: witness, PlatformID: platform, NodeID: node, ControllerID: controller, RequestID: config.RequestID, Epoch: "2", Sequence: "1", CandidateSHA256: checked.Observed.PayloadSHA256, Challenge: base64.RawURLEncoding.EncodeToString(make([]byte, 24)), IssuedAt: now, ExpiresAt: now + 60000}, witnessKey, "payincus/host-fence-prepare/v1\n")
	_, _, _, certificate := maintenanceTestCertificates(t)
	leaf, err := x509.ParseCertificate(certificate.Certificate[0])
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(leaf.Raw)
	public := base64.StdEncoding.EncodeToString(holderPub)
	handler := newBoundMaintenanceHandler("unused", run, runtime, map[string]maintenanceClientIdentity{fmt.Sprintf("%x", digest): {controller, public}})
	request := func(path string, body any, cert *x509.Certificate) *httptest.ResponseRecorder {
		raw, _ := json.Marshal(body)
		r := httptest.NewRequest("POST", "https://localhost"+path, strings.NewReader(string(raw)))
		r.Header.Set("Content-Type", "application/json")
		r.TLS = &tls.ConnectionState{VerifiedChains: [][]*x509.Certificate{{cert}}, PeerCertificates: []*x509.Certificate{cert}}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	body := map[string]string{"candidate": candidate, "preparePermit": permit, "holderPublicKey": public}
	other := *leaf
	other.Raw = []byte("different certificate")
	if request("/v1/attest", body, &other).Code != 401 {
		t.Fatal("other trusted certificate accepted")
	}
	result := request("/v1/attest", body, leaf)
	var preparation controllerconfig.RuntimePreparation
	if result.Code != 200 || json.Unmarshal(result.Body.Bytes(), &preparation) != nil || preparation.Receipt != "" || preparation.GateProof != "" || preparation.CanWrite || len(preparation.Blockers) < 2 {
		t.Fatal("unisolated host signed receipt")
	}
	if request("/v1/lease", map[string]string{"lease": "invalid"}, leaf).Code != 409 {
		t.Fatal("invalid lease accepted")
	}
	if request("/v1/operations", map[string]any{"body": "{}", "proof": controllerconfig.LeaseRequest{}, "holderPublicKey": public}, leaf).Code != 409 {
		t.Fatal("write endpoint opened without local isolation")
	}
	if request("/v1/attest", map[string]string{"candidate": candidate, "preparePermit": permit, "holderPublicKey": base64.StdEncoding.EncodeToString(rootPub)}, leaf).Code != 401 {
		t.Fatal("wrong holder accepted")
	}
}
