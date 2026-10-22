package controllerconfig

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"os"
	"testing"
)

func TestSharedNodeFenceReceipts(t *testing.T) {
	raw, err := os.ReadFile("testdata/fence-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures struct {
		PublicKey string
		Now       int64
		Binding   FenceBinding
		Cases     []struct {
			Name, Encoded string
			Accept        bool
			Now           int64
			Binding       *FenceBinding
		}
	}
	if err = json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatal(err)
	}
	for _, item := range fixtures.Cases {
		t.Run(item.Name, func(t *testing.T) {
			now, b := fixtures.Now, fixtures.Binding
			if item.Now != 0 {
				now = item.Now
			}
			if item.Binding != nil {
				b = *item.Binding
			}
			_, err := VerifyFenceReceipt([]byte(item.Encoded), b, fixtures.PublicKey, now)
			if (err == nil) != item.Accept {
				t.Fatalf("accept=%v err=%v", item.Accept, err)
			}
		})
	}
}
func TestGoFenceReceiptSigning(t *testing.T) {
	pub, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	r := FenceReceipt{1, "host-fence-receipt", "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444", "9007199254740993", "1", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", base64.RawURLEncoding.EncodeToString(make([]byte, 24)), "55555555-5555-4555-8555-555555555555", 100000, 130000, true, true, 0, 0, 0}
	encoded, err := SignFenceReceipt(r, key)
	if err != nil {
		t.Fatal(err)
	}
	b := FenceBinding{r.PlatformID, r.NodeID, r.ControllerID, r.RequestID, r.Epoch, r.Sequence, r.CandidateSHA256, r.Challenge}
	result, err := VerifyFenceReceipt(encoded, b, base64.StdEncoding.EncodeToString(pub), 100000)
	if err != nil || result != r {
		t.Fatalf("roundtrip: %v", err)
	}
	r.ActiveIncusOperations = 1
	if _, err = SignFenceReceipt(r, key); err == nil {
		t.Fatal("signed active operation")
	}
}
