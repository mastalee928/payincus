package controllerconfig

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"
)

func TestLeaseGateExpiryIdentityScopeAndReplay(t *testing.T) {
	raw, err := os.ReadFile("testdata/lease-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var f struct {
		PublicKey, KeyID string
		Binding          LeaseBinding
		Now              int64
		Cases            []struct{ Encoded string }
	}
	if json.Unmarshal(raw, &f) != nil {
		t.Fatal("fixtures")
	}
	g, err := NewLeaseGate(f.Binding, map[string]string{f.KeyID: f.PublicKey})
	if err != nil {
		t.Fatal(err)
	}
	// time.Now carries Go's monotonic component. The wall base matches the
	// historical fixture while retaining elapsed monotonic time for deadlines.
	base := time.Now()
	wallOffset := time.Duration(f.Now-base.UnixMilli()) * time.Millisecond
	elapsed := time.Duration(0)
	g.now = func() time.Time { return base.Add(wallOffset + elapsed) }
	if g.authorize(f.Binding.HolderKeyID, "inspect") == nil {
		t.Fatal("empty gate authorized")
	}
	if err = g.Accept([]byte(f.Cases[0].Encoded)); err != nil {
		t.Fatal(err)
	}
	if err = g.authorize(f.Binding.HolderKeyID, "instance-power"); err != nil {
		t.Fatal(err)
	}
	for _, item := range []struct{ holder, permission string }{{"key_" + "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "inspect"}, {f.Binding.HolderKeyID, "shell"}} {
		if g.authorize(item.holder, item.permission) == nil {
			t.Fatal("wrong holder/scope authorized")
		}
	}
	deadline := g.deadline
	requestCtx, release, err := g.executionContext(context.Background(), f.Binding.HolderKeyID, "inspect")
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	elapsed = 10 * time.Second
	if err = g.Accept([]byte(f.Cases[0].Encoded)); err != nil || !g.deadline.Equal(deadline) {
		t.Fatal("duplicate extended deadline")
	}
	g.Revoke()
	select {
	case <-requestCtx.Done():
	default:
		t.Fatal("revocation left inflight request alive")
	}
	if g.Accept([]byte(f.Cases[0].Encoded)) == nil || g.authorize(f.Binding.HolderKeyID, "inspect") == nil {
		t.Fatal("revoked lease replayed")
	}
	// A new service gate identity cannot inherit the previous service's lease.
	f.Binding.GateID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
	newGate, err := NewLeaseGate(f.Binding, map[string]string{f.KeyID: f.PublicKey})
	if err != nil {
		t.Fatal(err)
	}
	newGate.now = g.now
	if newGate.Accept([]byte(f.Cases[0].Encoded)) == nil {
		t.Fatal("lease survived gate restart")
	}
	f.Binding.GateID = g.binding.GateID
	expiring, err := NewLeaseGate(f.Binding, map[string]string{f.KeyID: f.PublicKey})
	if err != nil {
		t.Fatal(err)
	}
	elapsed = 0
	expiring.now = g.now
	if err = expiring.Accept([]byte(f.Cases[0].Encoded)); err != nil {
		t.Fatal(err)
	}
	elapsed = 30 * time.Second
	if expiring.authorize(f.Binding.HolderKeyID, "inspect") == nil {
		t.Fatal("expired lease authorized")
	}
}
