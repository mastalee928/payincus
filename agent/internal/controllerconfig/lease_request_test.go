package controllerconfig

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestGateRequiresPossessionExactBodyAndSingleUseProof(t *testing.T) {
	witnessPub, witnessKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	holderPub, holderKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	keyID := SigningKeyID(witnessPub)
	b := LeaseBinding{WitnessID: "77777777-7777-4777-8777-777777777777", PlatformID: "11111111-1111-4111-8111-111111111111", NodeID: "22222222-2222-4222-8222-222222222222", ControllerID: "33333333-3333-4333-8333-333333333333", RequestID: "44444444-4444-4444-8444-444444444444", Epoch: "2", Sequence: "1", CandidateSHA256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", LeaseID: "55555555-5555-4555-8555-555555555555", BootID: "88888888-8888-4888-8888-888888888888", GateID: "99999999-9999-4999-8999-999999999999", HolderKeyID: SigningKeyID(holderPub)}
	now := time.Now()
	p := WriteLease{1, "controller-write-lease", b.WitnessID, b.PlatformID, b.NodeID, b.ControllerID, b.RequestID, b.Epoch, b.Sequence, b.CandidateSHA256, b.LeaseID, "1", b.BootID, b.GateID, b.HolderKeyID, now.UnixMilli(), now.UnixMilli() + 30000, []string{"inspect", "instance-power"}}
	raw, _ := canonical(p)
	payload := base64.StdEncoding.EncodeToString(raw)
	encoded, _ := canonical(envelope{1, keyID, payload, base64.StdEncoding.EncodeToString(ed25519.Sign(witnessKey, []byte(writeLeasePrefix+keyID+"\n"+payload)))})
	g, err := NewLeaseGate(b, map[string]string{keyID: base64.StdEncoding.EncodeToString(witnessPub)})
	if err != nil {
		t.Fatal(err)
	}
	g.now = func() time.Time { return now }
	if err = g.Accept(encoded); err != nil {
		t.Fatal(err)
	}
	body := []byte(`{"instance":"test","action":"stop"}`)
	proof := LeaseRequest{LeaseBodySHA256(encoded), "instance-power", LeaseBodySHA256(body), strconv.FormatInt(now.UnixMilli(), 10), base64.RawURLEncoding.EncodeToString(make([]byte, 24)), ""}
	message := leaseRequestPrefix + proof.LeaseSHA256 + "\n" + proof.Permission + "\n" + proof.BodySHA256 + "\n" + proof.Timestamp + "\n" + proof.Nonce
	proof.Signature = base64.StdEncoding.EncodeToString(ed25519.Sign(holderKey, []byte(message)))
	public := base64.StdEncoding.EncodeToString(holderPub)
	if g.AuthorizeRequest(proof, public, "instance-power", []byte(`{"instance":"other","action":"stop"}`)) == nil {
		t.Fatal("altered body authorized")
	}
	if len(g.requests) != 0 {
		t.Fatal("invalid proof consumed nonce")
	}
	var count atomic.Int32
	var work sync.WaitGroup
	for i := 0; i < 8; i++ {
		work.Add(1)
		go func() {
			defer work.Done()
			if g.AuthorizeRequest(proof, public, "instance-power", body) == nil {
				count.Add(1)
			}
		}()
	}
	work.Wait()
	if count.Load() != 1 {
		t.Fatal("request replay executed more than once")
	}
	if g.AuthorizeRequest(proof, public, "inspect", body) == nil {
		t.Fatal("changed scope authorized")
	}
	now = now.Add(11 * time.Second)
	if g.AuthorizeRequest(proof, public, "instance-power", body) == nil {
		t.Fatal("stale proof authorized after nonce retention")
	}
}
