package controllerconfig

import (
	"encoding/json"
	"os"
	"testing"
)

func TestSharedWitnessPreparePermits(t *testing.T) {
	raw, err := os.ReadFile("testdata/permit-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		PublicKey, KeyID, WitnessID string
		Now                         int64
		Binding                     FenceBinding
		Cases                       []struct {
			Name, Encoded, WitnessID string
			Accept                   bool
			Now                      int64
			Binding                  *FenceBinding
		}
	}
	if err = json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	for _, item := range fixture.Cases {
		t.Run(item.Name, func(t *testing.T) {
			b, now, witness := fixture.Binding, fixture.Now, fixture.WitnessID
			if item.Binding != nil {
				b = *item.Binding
			}
			if item.Now != 0 {
				now = item.Now
			}
			if item.WitnessID != "" {
				witness = item.WitnessID
			}
			_, err := VerifyPreparePermit([]byte(item.Encoded), PreparePermitTrust{b, witness, map[string]string{fixture.KeyID: fixture.PublicKey}, now})
			if (err == nil) != item.Accept {
				t.Fatalf("accept=%v err=%v", item.Accept, err)
			}
		})
	}
}
