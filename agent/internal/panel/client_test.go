package panel

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"incudal-agent/internal/abuse"
	"incudal-agent/internal/config"
)

func TestHeartbeatAbusePolicyContract(t *testing.T) {
	for _, tc := range []struct {
		name, response string
		expected       bool
	}{
		{"configured", `{"abusePolicy":{"revision":2,"blockBt":true,"blockMining":false,"retryNonce":4}}`, true},
		{"never configured", `{"abusePolicy":null}`, false},
		{"old server", `{"ok":true}`, false},
		{"partial must not disable", `{"abusePolicy":{"revision":3,"blockBt":false}}`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "POST" || r.URL.Path != heartbeatPath || r.Header.Get("x-incudal-signature") == "" {
					t.Error("unsigned heartbeat")
				}
				var body map[string]any
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
				}
				status, ok := body["abusePolicyStatus"].(map[string]any)
				if !ok || status["revision"] != float64(2) || status["retryNonce"] != float64(4) || status["applied"] != true {
					t.Error("status lost on wire", body)
				}
				w.Header().Set("Content-Type", "application/json")
				w.Write([]byte(tc.response))
			}))
			defer server.Close()
			client := New(config.Config{PanelURL: server.URL, AgentID: "local-test", AgentSecret: "local-test-fixture", RequestTimeout: time.Second})
			payload := map[string]any{"abusePolicyStatus": abuse.Status{Instruction: abuse.Instruction{Revision: 2, BlockBT: true, RetryNonce: 4}, Applied: true, CheckedAt: time.Now().UTC().Format(time.RFC3339)}}
			result, err := client.Heartbeat(context.Background(), payload)
			if err != nil || (result.AbusePolicy != nil) != tc.expected {
				t.Fatal(result.AbusePolicy, err)
			}
			if tc.expected && (result.AbusePolicy.Revision != 2 || !result.AbusePolicy.BlockBT || result.AbusePolicy.RetryNonce != 4) {
				t.Fatal(result.AbusePolicy)
			}
		})
	}
}
