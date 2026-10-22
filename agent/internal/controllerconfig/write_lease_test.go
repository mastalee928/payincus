package controllerconfig

import (
	"encoding/json"
	"os"
	"testing"
)

func TestWriteLeaseSharedVectors(t *testing.T) {
	raw, err := os.ReadFile("testdata/lease-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures struct {
		PublicKey, KeyID string
		Binding          LeaseBinding
		Now              int64
		RequestBody      string
		RequestProof     LeaseRequest
		Requests         []struct {
			Name   string
			Proof  LeaseRequest
			Accept bool
			Now    int64
		}
		Cases []struct {
			Name, Encoded string
			Accept        bool
			Now           int64
			Binding       *LeaseBinding
		}
	}
	if json.Unmarshal(raw, &fixtures) != nil || len(fixtures.Cases) < 30 {
		t.Fatal("missing lease fixtures")
	}
	for _, item := range fixtures.Cases {
		t.Run(item.Name, func(t *testing.T) {
			trust := LeaseTrust{fixtures.Binding, map[string]string{fixtures.KeyID: fixtures.PublicKey}, fixtures.Now}
			if item.Binding != nil {
				trust.Binding = *item.Binding
			}
			if item.Now != 0 {
				trust.Now = item.Now
			}
			_, err := VerifyWriteLease([]byte(item.Encoded), trust)
			if item.Accept != (err == nil) {
				t.Fatalf("lease accept=%v error=%v", item.Accept, err)
			}
		})
	}
	if len(fixtures.Requests) < 8 {
		t.Fatal("holder proof fixtures missing")
	}
	for _, item := range fixtures.Requests {
		t.Run(item.Name, func(t *testing.T) {
			now := fixtures.Now
			if item.Now != 0 {
				now = item.Now
			}
			err := VerifyLeaseRequest(item.Proof, fixtures.PublicKey, fixtures.RequestProof.LeaseSHA256, "instance-power", LeaseBodySHA256([]byte(fixtures.RequestBody)), now)
			if item.Accept != (err == nil) {
				t.Fatalf("proof accept=%v error=%v", item.Accept, err)
			}
		})
	}
}
