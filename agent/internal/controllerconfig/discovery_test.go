package controllerconfig

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func discoveryFixture(t *testing.T) (PrepareConfig, Context, ed25519.PrivateKey, ed25519.PublicKey, ed25519.PrivateKey) {
	t.Helper()
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	nodePublic, nodePrivate, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UnixMilli()
	config := PrepareConfig{SchemaVersion: 1, Purpose: "controller-prepare", PlatformID: "11111111-1111-4111-8111-111111111111", NodeID: "22222222-2222-4222-8222-222222222222", ControllerID: "33333333-3333-4333-8333-333333333333", RequestID: "44444444-4444-4444-8444-444444444444", Epoch: "2", Sequence: "1", IssuedAt: now, ExpiresAt: now + 60000, PanelBaseURL: "https://panel.example.com", Gateway: Gateway{GatewayID: "55555555-5555-4555-8555-555555555555", EndpointHost: "gateway.example.com", EndpointPort: 51820, PublicKey: base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{7}, 32)), NodeAddress: "10.253.240.2", ControlAddress: "10.253.240.1"}}
	trust := Context{PlatformID: config.PlatformID, NodeID: config.NodeID, Now: now, TrustedKeys: map[string]string{SigningKeyID(public): base64.StdEncoding.EncodeToString(public)}}
	return config, trust, private, nodePublic, nodePrivate
}

func signedCandidate(t *testing.T, config PrepareConfig, private ed25519.PrivateKey) []byte {
	t.Helper()
	raw, err := canonical(config)
	if err != nil {
		t.Fatal(err)
	}
	keyID := SigningKeyID(private.Public().(ed25519.PublicKey))
	payload := base64.StdEncoding.EncodeToString(raw)
	signature := base64.StdEncoding.EncodeToString(ed25519.Sign(private, []byte(signingPrefix+keyID+"\n"+payload)))
	result, err := canonical(envelope{1, keyID, payload, signature})
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func testReader(server *httptest.Server, key ed25519.PrivateKey) DiscoveryReader {
	roots := x509.NewCertPool()
	roots.AddCert(server.Certificate())
	return DiscoveryReader{Endpoint: server.URL + "/v1/controller-config", NodeKey: key, Transport: &http.Transport{TLSClientConfig: &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS12}}, Timeout: time.Second}
}

func TestDiscoveryAuthenticatesNodeAndReadsVerifiedCandidate(t *testing.T) {
	config, trust, private, nodePublic, nodePrivate := discoveryFixture(t)
	seen := map[string]bool{}
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" || r.URL.Path != "/v1/controller-config" || r.Header.Get("X-Payincus-Platform-ID") != config.PlatformID || r.Header.Get("X-Payincus-Node-ID") != config.NodeID {
			t.Error("unexpected request identity")
		}
		timestamp, nonce := r.Header.Get("X-Payincus-Timestamp"), r.Header.Get("X-Payincus-Nonce")
		if seen[nonce] {
			t.Error("nonce reused")
		}
		seen[nonce] = true
		signature, err := base64.StdEncoding.DecodeString(r.Header.Get("X-Payincus-Signature"))
		if err != nil {
			t.Error(err)
		}
		message := requestPrefix + strings.Join([]string{r.Method, r.Host, r.URL.Path, config.PlatformID, config.NodeID, timestamp, nonce}, "\n")
		if !ed25519.Verify(nodePublic, []byte(message), signature) {
			t.Error("node request proof invalid")
		}
		if r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" {
			t.Error("unexpected credentials")
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write(signedCandidate(t, config, private))
	}))
	defer server.Close()
	reader := testReader(server, nodePrivate)
	defer reader.Transport.CloseIdleConnections()
	first, err := reader.Read(context.Background(), trust)
	if err != nil {
		t.Fatal(err)
	}
	if first.CanWrite {
		t.Fatal("candidate grants write permission")
	}
	trust.Previous = &first.Observed
	repeated, err := reader.Read(context.Background(), trust)
	if err != nil || !repeated.Duplicate {
		t.Fatalf("repeat: %v", err)
	}
}

func TestDiscoveryRejectsRedirectWithoutForwardingIdentity(t *testing.T) {
	_, trust, _, _, key := discoveryFixture(t)
	leaked := false
	target := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { leaked = true }))
	defer target.Close()
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL+"/v1/controller-config", http.StatusTemporaryRedirect)
	}))
	defer server.Close()
	reader := testReader(server, key)
	defer reader.Transport.CloseIdleConnections()
	if _, err := reader.Read(context.Background(), trust); ErrorCode(err) != "CONTROLLER_DISCOVERY_RESPONSE_REJECTED" {
		t.Fatalf("redirect: %v", err)
	}
	if leaked {
		t.Fatal("node proof forwarded")
	}
}

func TestDiscoveryResponseAndTLSBoundaries(t *testing.T) {
	config, trust, private, _, key := discoveryFixture(t)
	for _, kind := range []string{"untrusted-tls", "disabled-tls", "access-page", "malformed-json", "oversized-length", "oversized-stream", "expired-config", "wrong-signature", "timeout", "canceled"} {
		t.Run(kind, func(t *testing.T) {
			server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if kind == "timeout" {
					select {
					case <-r.Context().Done():
						return
					case <-time.After(time.Second):
						return
					}
				}
				if kind == "access-page" {
					w.Header().Set("Content-Type", "text/html")
					w.Write([]byte("login"))
					return
				}
				w.Header().Set("Content-Type", "application/json")
				switch kind {
				case "malformed-json":
					w.Write([]byte("{}"))
				case "oversized-length":
					w.Header().Set("Content-Length", "12289")
					w.WriteHeader(200)
				case "oversized-stream":
					w.WriteHeader(200)
					w.(http.Flusher).Flush()
					w.Write(bytes.Repeat([]byte{' '}, MaxEnvelopeBytes+1))
				case "expired-config":
					expired := config
					expired.ExpiresAt = time.Now().UnixMilli() - 1
					expired.IssuedAt = expired.ExpiresAt - 10000
					w.Write(signedCandidate(t, expired, private))
				case "wrong-signature":
					_, other, _ := ed25519.GenerateKey(rand.Reader)
					w.Write(signedCandidate(t, config, other))
				default:
					w.Write(signedCandidate(t, config, private))
				}
			}))
			defer server.Close()
			reader := testReader(server, key)
			defer reader.Transport.CloseIdleConnections()
			if kind == "untrusted-tls" {
				reader.Transport.TLSClientConfig.RootCAs = nil
			}
			if kind == "disabled-tls" {
				reader.Transport.TLSClientConfig.InsecureSkipVerify = true
			}
			if kind == "timeout" {
				reader.Timeout = 20 * time.Millisecond
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if kind == "canceled" {
				cancel()
			}
			if _, err := reader.Read(ctx, trust); err == nil {
				t.Fatal("unsafe response accepted")
			}
		})
	}
}

func TestDiscoveryRejectsUnenrolledEndpointShape(t *testing.T) {
	_, trust, _, _, key := discoveryFixture(t)
	for _, endpoint := range []string{"http://example.com/v1/controller-config", "https://user:pass@example.com/v1/controller-config", "https://example.com/other", "https://example.com/v1/controller-config?x=1", "https://example.com/v1/controller-config#x", "https://example.com:/v1/controller-config", "https://example.com/v1/%63ontroller-config"} {
		reader := DiscoveryReader{Endpoint: endpoint, NodeKey: key}
		if _, err := reader.Read(context.Background(), trust); ErrorCode(err) != "CONTROLLER_DISCOVERY_ENDPOINT_INVALID" {
			t.Fatalf("endpoint accepted: %s %v", endpoint, err)
		}
	}
}
