package controllerconfig

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"sync/atomic"
	"testing"
	"time"
)

func TestMaintenanceRuntimeBindsLocalFactsAndLeaseIncarnation(t *testing.T) {
	config, trust, root, _, node := discoveryFixture(t)
	witnessPub, witness, _ := ed25519.GenerateKey(rand.Reader)
	holderPub, holder, _ := ed25519.GenerateKey(rand.Reader)
	witnessID := "77777777-7777-4777-8777-777777777777"
	witnessKeys := map[string]string{SigningKeyID(witnessPub): base64.StdEncoding.EncodeToString(witnessPub)}
	dir := t.TempDir()
	os.Chmod(dir, 0700)
	socket := filepath.Join(dir, "unix.socket")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	os.Chmod(socket, 0600)
	var reads atomic.Int32
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		reads.Add(1)
		json.NewEncoder(w).Encode(map[string]any{"type": "sync", "status_code": 200, "metadata": map[string]any{}})
	})}
	go server.Serve(listener)
	defer server.Close()
	ready := true
	collector := func(context.Context) (RuntimeFenceFacts, error) {
		return RuntimeFenceFacts{NetworkBlocked: ready, LegacyCredentialsBlocked: ready, Processes: ProcessAudit{StableSnapshot: true}, Writers: LocalWriterAudit{Complete: ready, ManagedWriterIsolationVerified: ready}}, nil
	}
	runtime, err := NewMaintenanceRuntime(trust, witnessID, witnessKeys, node, socket, collector)
	if err != nil {
		t.Fatal(err)
	}
	signEnvelope := func(payload any, key ed25519.PrivateKey, prefix string) []byte {
		raw, _ := canonical(payload)
		text := base64.StdEncoding.EncodeToString(raw)
		id := SigningKeyID(key.Public().(ed25519.PublicKey))
		out, _ := canonical(envelope{1, id, text, base64.StdEncoding.EncodeToString(ed25519.Sign(key, []byte(prefix+id+"\n"+text)))})
		return out
	}
	prepare := func(epoch string) ([]byte, []byte) {
		config.Epoch = epoch
		config.IssuedAt = time.Now().UnixMilli()
		config.ExpiresAt = config.IssuedAt + 60000
		candidate := signedCandidate(t, config, root)
		checked, err := VerifyPrepareConfig(candidate, Context{PlatformID: trust.PlatformID, NodeID: trust.NodeID, Now: config.IssuedAt, TrustedKeys: trust.TrustedKeys})
		if err != nil {
			t.Fatal(err)
		}
		permit := PreparePermit{1, "host-fence-prepare", witnessID, config.PlatformID, config.NodeID, config.ControllerID, config.RequestID, epoch, "1", checked.Observed.PayloadSHA256, base64.RawURLEncoding.EncodeToString(make([]byte, 24)), config.IssuedAt, config.IssuedAt + 60000}
		return candidate, signEnvelope(permit, witness, preparePermitPrefix)
	}
	candidate, permit := prepare("2")
	public := base64.StdEncoding.EncodeToString(holderPub)
	ready = false
	blocked, err := runtime.Prepare(context.Background(), candidate, permit, public)
	if err != nil || blocked.Receipt != "" || blocked.GateProof != "" || len(blocked.Blockers) < 3 {
		t.Fatal("unready local facts minted receipt", err)
	}
	ready = true
	if _, err = runtime.PrepareAuthorized(context.Background(), candidate, permit, "99999999-9999-4999-8999-999999999999", public); err == nil {
		t.Fatal("wrong authenticated controller accepted")
	}
	prepared, err := runtime.Prepare(context.Background(), candidate, permit, public)
	if err != nil || prepared.Receipt == "" || prepared.CanWrite {
		t.Fatal("preparation result", err)
	}
	var env fenceEnvelope
	var receipt FenceReceipt
	decodeStrict([]byte(prepared.Receipt), &env)
	raw, _ := base64.StdEncoding.DecodeString(env.Payload)
	decodeStrict(raw, &receipt)
	if _, err = VerifyFenceReceipt([]byte(prepared.Receipt), FenceBinding{config.PlatformID, config.NodeID, config.ControllerID, config.RequestID, "2", "1", receipt.CandidateSHA256, receipt.Challenge}, base64.StdEncoding.EncodeToString(node.Public().(ed25519.PublicKey)), time.Now().UnixMilli()); err != nil {
		t.Fatal(err)
	}
	leaseID := "55555555-5555-4555-8555-555555555555"
	lease := WriteLease{1, "controller-write-lease", witnessID, config.PlatformID, config.NodeID, config.ControllerID, config.RequestID, "2", "1", receipt.CandidateSHA256, leaseID, "1", prepared.BootID, prepared.GateID, SigningKeyID(holderPub), time.Now().UnixMilli(), time.Now().UnixMilli() + 20000, []string{"inspect"}}
	encoded := signEnvelope(lease, witness, writeLeasePrefix)
	if err = runtime.AcceptLease(context.Background(), encoded); err != nil {
		t.Fatal("lease accepted", err)
	}
	body := []byte(`{"schemaVersion":1,"operation":"inspect-operations"}`)
	proof := LeaseRequest{LeaseBodySHA256(encoded), "inspect", LeaseBodySHA256(body), fmtRuntimeTime(), base64.RawURLEncoding.EncodeToString(make([]byte, 24)), ""}
	proof.Signature = base64.StdEncoding.EncodeToString(ed25519.Sign(holder, []byte(leaseRequestPrefix+proof.LeaseSHA256+"\n"+proof.Permission+"\n"+proof.BodySHA256+"\n"+proof.Timestamp+"\n"+proof.Nonce)))
	if _, err = runtime.Execute(context.Background(), body, LeaseRequest{}, public); err == nil || reads.Load() != 0 {
		t.Fatal("invalid proof accessed daemon")
	}
	result, err := runtime.Execute(context.Background(), body, proof, public)
	if err != nil || !result.Accepted || reads.Load() != 1 {
		t.Fatal("inspection", err)
	}
	if _, err = runtime.Execute(context.Background(), body, proof, public); err == nil || reads.Load() != 1 {
		t.Fatal("request replayed")
	}
	// A changed durable watermark denies even a fresh, otherwise valid proof.
	oldCollector := runtime.collector
	runtime.collector = func(ctx context.Context) (RuntimeFenceFacts, error) {
		facts, err := oldCollector(ctx)
		facts.Observed = &ObservedState{1, trust.PlatformID, trust.NodeID, "3", "1", receipt.CandidateSHA256}
		return facts, err
	}
	changed := proof
	changed.Nonce = base64.RawURLEncoding.EncodeToString(make([]byte, 24))
	changed.Nonce = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB"
	changed.Signature = base64.StdEncoding.EncodeToString(ed25519.Sign(holder, []byte(leaseRequestPrefix+changed.LeaseSHA256+"\n"+changed.Permission+"\n"+changed.BodySHA256+"\n"+changed.Timestamp+"\n"+changed.Nonce)))
	if _, err = runtime.Execute(context.Background(), body, changed, public); err == nil || reads.Load() != 1 {
		t.Fatal("durable higher watermark left writer active")
	}
	runtime.collector = oldCollector
	restarted, err := NewMaintenanceRuntime(trust, witnessID, witnessKeys, node, socket, collector)
	if err != nil {
		t.Fatal(err)
	}
	restarted.Prepare(context.Background(), candidate, permit, public)
	if restarted.gateID == runtime.gateID || restarted.AcceptLease(context.Background(), encoded) == nil {
		t.Fatal("old lease survived process restart")
	}
	// A valid higher preparation that fails local audit must still revoke old
	// authorized work. Invalid signatures must not change the current incarnation.
	newCandidate, newPermit := prepare("3")
	ready = false
	if _, err = runtime.Prepare(context.Background(), newCandidate, newPermit, public); err != nil {
		t.Fatal(err)
	}
	if runtime.AcceptLease(context.Background(), encoded) == nil || runtime.executor != nil {
		t.Fatal("old writer remained after blocked higher epoch")
	}
	if _, err = runtime.Prepare(context.Background(), candidate, permit, public); err == nil {
		t.Fatal("epoch rollback accepted")
	}
	if _, err = runtime.Prepare(context.Background(), newCandidate, append(newPermit, ' '), public); err == nil {
		t.Fatal("invalid signed authority accepted")
	}
}

func fmtRuntimeTime() string { return strconv.FormatInt(time.Now().UnixMilli(), 10) }
