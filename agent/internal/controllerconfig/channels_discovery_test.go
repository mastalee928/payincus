package controllerconfig

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestChannelsDiscoveryUsesExactSignedPath(t *testing.T) {
	config, trust, private, nodePublic, nodeKey := discoveryFixture(t)
	channels := ManagementChannels{1, "host-management-channels", config.PlatformID, config.NodeID, "2", "1", config.IssuedAt, config.ExpiresAt,
		[]ManagementChannel{{"a", config.Gateway.GatewayID, config.Gateway.EndpointHost, config.Gateway.EndpointPort, config.Gateway.PublicKey, config.Gateway.NodeAddress, config.Gateway.ControlAddress, 1380}}}
	raw, _ := canonical(channels)
	payload := base64.StdEncoding.EncodeToString(raw)
	id := SigningKeyID(private.Public().(ed25519.PublicKey))
	encoded, _ := canonical(envelope{1, id, payload, base64.StdEncoding.EncodeToString(ed25519.Sign(private, []byte(channelsPrefix+id+"\n"+payload)))})
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/management-channels" {
			t.Error("wrong endpoint")
		}
		sig, _ := base64.StdEncoding.DecodeString(r.Header.Get("X-Payincus-Signature"))
		message := requestPrefix + strings.Join([]string{"GET", r.Host, r.URL.Path, r.Header.Get("X-Payincus-Platform-ID"), r.Header.Get("X-Payincus-Node-ID"), r.Header.Get("X-Payincus-Timestamp"), r.Header.Get("X-Payincus-Nonce")}, "\n")
		if !ed25519.Verify(nodePublic, []byte(message), sig) {
			t.Error("wrong node/path proof")
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write(encoded)
	}))
	defer server.Close()
	reader := testReader(server, nodeKey)
	reader.Endpoint = server.URL + "/v1/management-channels"
	defer reader.Transport.CloseIdleConnections()
	bytes, result, err := reader.ReadChannels(context.Background(), trust)
	if err != nil || string(bytes) != string(encoded) || len(result.Config.Channels) != 1 {
		t.Fatalf("read: %v", err)
	}
	if _, err = reader.Read(context.Background(), trust); err == nil {
		t.Fatal("candidate path substituted for channels")
	}
	trust.Previous = &result.Observed
	if _, result, err = reader.ReadChannels(context.Background(), trust); err != nil || !result.Duplicate {
		t.Fatal("duplicate generation lost")
	}
	trust.NodeID = "99999999-9999-4999-8999-999999999999"
	if _, _, err = reader.ReadChannels(context.Background(), trust); err == nil {
		t.Fatal("cross-node signed channels accepted")
	}
}
