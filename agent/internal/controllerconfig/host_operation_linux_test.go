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

func TestHostExecutorAuthenticatesBeforeIncusAndPreservesFixedPowerPayload(t *testing.T) {
	witnessPub, witnessKey, _ := ed25519.GenerateKey(rand.Reader)
	holderPub, holderKey, _ := ed25519.GenerateKey(rand.Reader)
	b := LeaseBinding{WitnessID: "77777777-7777-4777-8777-777777777777", PlatformID: "11111111-1111-4111-8111-111111111111", NodeID: "22222222-2222-4222-8222-222222222222", ControllerID: "33333333-3333-4333-8333-333333333333", RequestID: "44444444-4444-4444-8444-444444444444", Epoch: "2", Sequence: "1", CandidateSHA256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", LeaseID: "55555555-5555-4555-8555-555555555555", BootID: "88888888-8888-4888-8888-888888888888", GateID: "99999999-9999-4999-8999-999999999999", HolderKeyID: SigningKeyID(holderPub)}
	now := time.Now()
	p := WriteLease{1, "controller-write-lease", b.WitnessID, b.PlatformID, b.NodeID, b.ControllerID, b.RequestID, b.Epoch, b.Sequence, b.CandidateSHA256, b.LeaseID, "1", b.BootID, b.GateID, b.HolderKeyID, now.UnixMilli(), now.UnixMilli() + 30000, []string{"inspect", "instance-power"}}
	raw, _ := canonical(p)
	payload := base64.StdEncoding.EncodeToString(raw)
	keyID := SigningKeyID(witnessPub)
	encoded, _ := canonical(envelope{1, keyID, payload, base64.StdEncoding.EncodeToString(ed25519.Sign(witnessKey, []byte(writeLeasePrefix+keyID+"\n"+payload)))})
	g, err := NewLeaseGate(b, map[string]string{keyID: base64.StdEncoding.EncodeToString(witnessPub)})
	if err != nil {
		t.Fatal(err)
	}
	g.now = func() time.Time { return now }
	if err = g.Accept(encoded); err != nil {
		t.Fatal(err)
	}
	public := base64.StdEncoding.EncodeToString(holderPub)
	proofFor := func(body []byte) LeaseRequest {
		buf := make([]byte, 24)
		if _, err := rand.Read(buf); err != nil {
			t.Fatal(err)
		}
		proof := LeaseRequest{LeaseBodySHA256(encoded), "instance-power", LeaseBodySHA256(body), strconv.FormatInt(now.UnixMilli(), 10), base64.RawURLEncoding.EncodeToString(buf), ""}
		message := leaseRequestPrefix + proof.LeaseSHA256 + "\n" + proof.Permission + "\n" + proof.BodySHA256 + "\n" + proof.Timestamp + "\n" + proof.Nonce
		proof.Signature = base64.StdEncoding.EncodeToString(ed25519.Sign(holderKey, []byte(message)))
		return proof
	}
	dir := t.TempDir()
	os.Chmod(dir, 0700)
	socket := filepath.Join(dir, "unix.socket")
	listen, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	os.Chmod(socket, 0600)
	var calls, writes atomic.Int32
	var busy atomic.Bool
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.Query().Get("project") != "" || r.Header.Get("Authorization") != "" {
			t.Error("unexpected remote credential or project")
		}
		switch {
		case r.Method == "GET" && r.URL.Path == "/1.0/operations":
			metadata := map[string]any{}
			if busy.Load() {
				metadata["running"] = []any{map[string]any{"id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "status": "Running", "status_code": 103}}
			}
			json.NewEncoder(w).Encode(map[string]any{"type": "sync", "status_code": 200, "metadata": metadata})
		case r.Method == "GET" && r.URL.Path == "/1.0/instances/test-instance":
			json.NewEncoder(w).Encode(map[string]any{"type": "sync", "status_code": 200, "metadata": map[string]any{"name": "test-instance", "type": "container"}})
		case r.Method == "PUT" && r.URL.Path == "/1.0/instances/test-instance/state":
			var body map[string]any
			json.NewDecoder(r.Body).Decode(&body)
			if len(body) != 3 || body["action"] != "stop" || body["force"] != false || body["timeout"] != float64(60) {
				t.Error("unsafe power body")
			}
			writes.Add(1)
			w.WriteHeader(202)
			json.NewEncoder(w).Encode(map[string]any{"type": "async", "status_code": 100, "operation": "/1.0/operations/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"})
		default:
			t.Error("unexpected Incus action")
			w.WriteHeader(400)
		}
	})}
	go server.Serve(listen)
	defer server.Close()
	executor, err := NewHostOperationExecutor(g, socket)
	if err != nil {
		t.Fatal(err)
	}
	body := []byte(`{"schemaVersion":1,"operation":"instance-power","instance":"test-instance","action":"stop"}`)
	proof := proofFor(body)
	if _, err = executor.Execute(context.Background(), body, LeaseRequest{}, public); err == nil || calls.Load() != 0 {
		t.Fatal("invalid proof reached daemon")
	}
	busy.Store(true)
	if _, err = executor.Execute(context.Background(), body, proof, public); err == nil || writes.Load() != 0 {
		t.Fatal("busy daemon mutated")
	}
	busy.Store(false)
	proof = proofFor(body)
	result, err := executor.Execute(context.Background(), body, proof, public)
	if err != nil || !result.Accepted || result.OperationID == "" || writes.Load() != 1 {
		t.Fatalf("result=%+v err=%v", result, err)
	}
	if _, err = executor.Execute(context.Background(), body, proof, public); err == nil || writes.Load() != 1 {
		t.Fatal("accepted operation repeated")
	}
	g.Revoke()
	if _, err = executor.Execute(context.Background(), body, proofFor(body), public); err == nil || writes.Load() != 1 {
		t.Fatal("revoked gate mutated")
	}
}

// Opt-in real Incus read probe. It obtains the socket from the isolated Incus
// harness, signs a restricted inspect lease and holder request and calls the
// actual fixed executor. No instance power action is submitted by this test.
func TestHostExecutorRealIncusInspect(t *testing.T) {
	socket := os.Getenv("INCUDAL_HOST_EXECUTOR_REAL_SOCKET")
	if socket == "" {
		t.Skip("explicit isolated Incus socket required")
	}
	for _, ns := range []string{"net", "mnt", "pid"} {
		parent := os.Getenv("INCUDAL_PARENT_" + map[string]string{"net": "NET", "mnt": "MNT", "pid": "PID"}[ns])
		current, err := os.Readlink("/proc/self/ns/" + ns)
		if err != nil || parent == "" || parent == current {
			t.Fatal("isolated namespaces required")
		}
	}
	witnessPub, witnessKey, _ := ed25519.GenerateKey(rand.Reader)
	holderPub, holderKey, _ := ed25519.GenerateKey(rand.Reader)
	b := LeaseBinding{WitnessID: "77777777-7777-4777-8777-777777777777", PlatformID: "11111111-1111-4111-8111-111111111111", NodeID: "22222222-2222-4222-8222-222222222222", ControllerID: "33333333-3333-4333-8333-333333333333", RequestID: "44444444-4444-4444-8444-444444444444", Epoch: "2", Sequence: "1", CandidateSHA256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", LeaseID: "55555555-5555-4555-8555-555555555555", BootID: "88888888-8888-4888-8888-888888888888", GateID: "99999999-9999-4999-8999-999999999999", HolderKeyID: SigningKeyID(holderPub)}
	now := time.Now()
	p := WriteLease{1, "controller-write-lease", b.WitnessID, b.PlatformID, b.NodeID, b.ControllerID, b.RequestID, b.Epoch, b.Sequence, b.CandidateSHA256, b.LeaseID, "1", b.BootID, b.GateID, b.HolderKeyID, now.UnixMilli(), now.UnixMilli() + 30000, []string{"inspect"}}
	raw, _ := canonical(p)
	payload := base64.StdEncoding.EncodeToString(raw)
	id := SigningKeyID(witnessPub)
	encoded, _ := canonical(envelope{1, id, payload, base64.StdEncoding.EncodeToString(ed25519.Sign(witnessKey, []byte(writeLeasePrefix+id+"\n"+payload)))})
	g, err := NewLeaseGate(b, map[string]string{id: base64.StdEncoding.EncodeToString(witnessPub)})
	if err != nil {
		t.Fatal(err)
	}
	if err = g.Accept(encoded); err != nil {
		t.Fatal(err)
	}
	body := []byte(`{"schemaVersion":1,"operation":"inspect-operations"}`)
	proof := LeaseRequest{LeaseBodySHA256(encoded), "inspect", LeaseBodySHA256(body), strconv.FormatInt(time.Now().UnixMilli(), 10), base64.RawURLEncoding.EncodeToString(make([]byte, 24)), ""}
	proof.Signature = base64.StdEncoding.EncodeToString(ed25519.Sign(holderKey, []byte(leaseRequestPrefix+proof.LeaseSHA256+"\n"+proof.Permission+"\n"+proof.BodySHA256+"\n"+proof.Timestamp+"\n"+proof.Nonce)))
	executor, err := NewHostOperationExecutor(g, socket)
	if err != nil {
		t.Fatal(err)
	}
	result, err := executor.Execute(context.Background(), body, proof, base64.StdEncoding.EncodeToString(holderPub))
	if err != nil || !result.Accepted || (result.ActiveIncusOperations > 0) != (os.Getenv("INCUDAL_HOST_EXECUTOR_EXPECT_ACTIVE") == "1") {
		t.Fatalf("real result=%+v err=%v", result, err)
	}
}
