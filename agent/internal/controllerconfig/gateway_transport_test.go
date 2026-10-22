package controllerconfig

import (
	"encoding/json"
	"os"
	"testing"
)

func TestGatewayTransportSharedVectors(t *testing.T) {
	var f struct {
		PlatformID string `json:"platformId"`
		GatewayID  string `json:"gatewayId"`
		Now        int64  `json:"now"`
		PublicKey  string `json:"publicKey"`
		KeyID      string `json:"keyId"`
		Cases      []struct {
			Name      string         `json:"name"`
			Encoded   string         `json:"encoded"`
			Accept    bool           `json:"accept"`
			GatewayID string         `json:"gatewayId"`
			Now       int64          `json:"now"`
			Previous  *ObservedState `json:"previous"`
		} `json:"cases"`
	}
	raw, err := os.ReadFile("testdata/gateway-vectors.json")
	if err != nil || json.Unmarshal(raw, &f) != nil {
		t.Fatal("fixtures unavailable")
	}
	for _, item := range f.Cases {
		t.Run(item.Name, func(t *testing.T) {
			trust := Context{PlatformID: f.PlatformID, NodeID: f.GatewayID, Now: f.Now, TrustedKeys: map[string]string{f.KeyID: f.PublicKey}, Previous: item.Previous}
			if item.Now > 0 {
				trust.Now = item.Now
			}
			if item.GatewayID != "" {
				trust.NodeID = item.GatewayID
			}
			_, _, err := VerifyGatewayTransport([]byte(item.Encoded), trust)
			if (err == nil) != item.Accept {
				t.Fatalf("accept=%v err=%v", item.Accept, err)
			}
		})
	}
}
