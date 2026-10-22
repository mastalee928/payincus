package controllerconfig

import (
	"encoding/json"
	"os"
	"testing"
)

func TestManagementChannelsSharedVectors(t *testing.T) {
	var fixtures struct {
		PlatformID string `json:"platformId"`
		NodeID     string `json:"nodeId"`
		Now        int64  `json:"now"`
		PublicKey  string `json:"publicKey"`
		KeyID      string `json:"keyId"`
		Cases      []struct {
			Name     string         `json:"name"`
			Encoded  string         `json:"encoded"`
			Accept   bool           `json:"accept"`
			Now      int64          `json:"now"`
			NodeID   string         `json:"nodeId"`
			Previous *ObservedState `json:"previous"`
		} `json:"cases"`
	}
	raw, err := os.ReadFile("testdata/channel-vectors.json")
	if err != nil || json.Unmarshal(raw, &fixtures) != nil {
		t.Fatal("fixtures unavailable")
	}
	for _, item := range fixtures.Cases {
		t.Run(item.Name, func(t *testing.T) {
			trust := Context{PlatformID: fixtures.PlatformID, NodeID: fixtures.NodeID, Now: fixtures.Now, TrustedKeys: map[string]string{fixtures.KeyID: fixtures.PublicKey}, Previous: item.Previous}
			if item.Now > 0 {
				trust.Now = item.Now
			}
			if item.NodeID != "" {
				trust.NodeID = item.NodeID
			}
			_, err := VerifyManagementChannels([]byte(item.Encoded), trust)
			if (err == nil) != item.Accept {
				t.Fatalf("accept=%v error=%v", item.Accept, err)
			}
		})
	}
}
