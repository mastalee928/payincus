package controllerconfig

import (
	"encoding/json"
	"os"
	"testing"
)

func TestNodeSignedSharedVectors(t *testing.T) {
	raw, err := os.ReadFile("testdata/node-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures struct {
		PublicKey  string `json:"publicKey"`
		KeyID      string `json:"keyId"`
		PlatformID string `json:"platformId"`
		NodeID     string `json:"nodeId"`
		Now        int64  `json:"now"`
		Cases      []struct {
			Name       string         `json:"name"`
			Encoded    string         `json:"encoded"`
			Accept     bool           `json:"accept"`
			Previous   *ObservedState `json:"previous"`
			Now        int64          `json:"now"`
			PlatformID string         `json:"platformId"`
			NodeID     string         `json:"nodeId"`
			Duplicate  bool           `json:"duplicate"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatal(err)
	}
	if len(fixtures.Cases) < 60 {
		t.Fatal("shared regression vectors missing")
	}
	for _, item := range fixtures.Cases {
		t.Run(item.Name, func(t *testing.T) {
			ctx := Context{PlatformID: fixtures.PlatformID, NodeID: fixtures.NodeID, Now: fixtures.Now, TrustedKeys: map[string]string{fixtures.KeyID: fixtures.PublicKey}, Previous: item.Previous}
			if item.Now != 0 {
				ctx.Now = item.Now
			}
			if item.PlatformID != "" {
				ctx.PlatformID = item.PlatformID
			}
			if item.NodeID != "" {
				ctx.NodeID = item.NodeID
			}
			result, err := VerifyPrepareConfig([]byte(item.Encoded), ctx)
			if item.Accept {
				if err != nil {
					t.Fatal(err)
				}
				if result.CanWrite {
					t.Fatal("candidate grants write permission")
				}
				if result.Duplicate != item.Duplicate {
					t.Fatal("duplicate mismatch")
				}
			} else if err == nil {
				t.Fatal("invalid candidate accepted")
			}
		})
	}
}
