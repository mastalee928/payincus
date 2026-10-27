package controllerconfig

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"testing"
	"time"
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

func TestGatewayTransportCapacity(t *testing.T) {
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UnixMilli()
	config := GatewayTransport{1, "gateway-transport", "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "2", "1", now, now + 600000, "a", "10.250.1.1", 51820, 1380, nil}
	for i := 0; i < MaxGatewayTransportPeers; i++ {
		digest := sha256.Sum256([]byte(fmt.Sprintf("capacity-peer-%d", i)))
		config.Peers = append(config.Peers, GatewayTransportPeer{fmt.Sprintf("%08x-3333-4333-8333-333333333333", i+1), base64.StdEncoding.EncodeToString(digest[:]), fmt.Sprintf("10.252.%d.%d", (i+2)/256, (i+2)%256), i%7 != 0})
	}
	id := SigningKeyID(public)
	trust := Context{PlatformID: config.PlatformID, NodeID: config.GatewayID, Now: now, TrustedKeys: map[string]string{id: base64.StdEncoding.EncodeToString(public)}}
	encode := func(row GatewayTransport) []byte {
		raw, e := canonical(row)
		if e != nil {
			t.Fatal(e)
		}
		payload := base64.StdEncoding.EncodeToString(raw)
		encoded, e := canonical(envelope{1, id, payload, base64.StdEncoding.EncodeToString(ed25519.Sign(private, []byte(gatewayTransportPrefix+id+"\n"+payload)))})
		if e != nil {
			t.Fatal(e)
		}
		return encoded
	}
	for _, count := range []int{1000, MaxGatewayTransportPeers} {
		row := config
		row.Peers = config.Peers[:count]
		encoded := encode(row)
		if len(encoded) <= 65536 || len(encoded) > MaxGatewayTransportBytes {
			t.Fatal("catalog size does not exercise capacity")
		}
		checked, _, e := VerifyGatewayTransport(encoded, trust)
		if e != nil || len(checked.Peers) != count {
			t.Fatalf("count=%d err=%v", count, e)
		}
	}
	config.Peers = append(config.Peers, GatewayTransportPeer{"ffffffff-3333-4333-8333-333333333333", base64.StdEncoding.EncodeToString(public), "10.254.0.1", true})
	if _, _, e := VerifyGatewayTransport(encode(config), trust); e == nil {
		t.Fatal("over-capacity accepted")
	}
	if _, _, e := VerifyGatewayTransport(make([]byte, MaxGatewayTransportBytes+1), trust); e == nil {
		t.Fatal("oversized envelope accepted")
	}
}
