package controllerconfig

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"testing"
)

func TestGateProofSigningRequiresBoundIdentity(t *testing.T) {
	public, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	p := GateProof{1, "controller-gate-proof", "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444", "2", "1", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "55555555-5555-4555-8555-555555555555", "66666666-6666-4666-8666-666666666666", SigningKeyID(public), 100000, 130000}
	encoded, err := SignGateProof(p, key)
	if err != nil {
		t.Fatal(err)
	}
	var env fenceEnvelope
	if decodeStrict(encoded, &env) != nil {
		t.Fatal("envelope")
	}
	signature, err := decodeBase64(env.Signature, 64)
	if err != nil || !ed25519.Verify(public, []byte(gateProofPrefix+env.Payload), signature) {
		t.Fatal("signature")
	}
	raw, err := base64.StdEncoding.Strict().DecodeString(env.Payload)
	if err != nil {
		t.Fatal(err)
	}
	var parsed GateProof
	if decodeStrict(raw, &parsed) != nil || parsed != p {
		t.Fatal("payload")
	}
	p.GateID = "invalid"
	if _, err = SignGateProof(p, key); err == nil {
		t.Fatal("unbound gate signed")
	}
}
