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
	"sync/atomic"
	"testing"
)

func TestMaintenancePlanRequiresWitnessBeforeLocalRead(t *testing.T) {
	config, trust, root, _, _ := discoveryFixture(t)
	candidate := signedCandidate(t, config, root)
	checked, err := VerifyPrepareConfig(candidate, trust)
	if err != nil {
		t.Fatal(err)
	}
	witnessPub, witnessKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	witnessID := "77777777-7777-4777-8777-777777777777"
	permit := PreparePermit{1, "host-fence-prepare", witnessID, config.PlatformID, config.NodeID, config.ControllerID, config.RequestID, config.Epoch, config.Sequence, checked.Observed.PayloadSHA256, base64.RawURLEncoding.EncodeToString(make([]byte, 24)), trust.Now, trust.Now + 60000}
	signPermit := func(p PreparePermit) []byte {
		raw, _ := canonical(p)
		payload := base64.StdEncoding.EncodeToString(raw)
		id := SigningKeyID(witnessPub)
		signature := base64.StdEncoding.EncodeToString(ed25519.Sign(witnessKey, []byte(preparePermitPrefix+id+"\n"+payload)))
		encoded, _ := canonical(envelope{1, id, payload, signature})
		return encoded
	}
	dir := t.TempDir()
	os.Chmod(dir, 0700)
	socket := filepath.Join(dir, "unix.socket")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	os.Chmod(socket, 0600)
	var calls atomic.Int32
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		json.NewEncoder(w).Encode(map[string]any{"type": "sync", "status_code": 200, "metadata": map[string]any{}})
	})}
	go server.Serve(listener)
	defer server.Close()
	witnessKeys := map[string]string{SigningKeyID(witnessPub): base64.StdEncoding.EncodeToString(witnessPub)}
	plan, err := InspectMaintenancePreparation(context.Background(), candidate, signPermit(permit), trust, witnessID, witnessKeys, socket)
	if err != nil || plan.CanWrite || plan.ReadyForFencing || !plan.PreparationPermitted || calls.Load() != 1 {
		t.Fatalf("plan: %+v %v", plan, err)
	}
	if len(plan.Blockers) != 3 {
		t.Fatal("unimplemented physical checks omitted")
	}
	if plan.ProcessAudit == nil || plan.ProcessAudit.ObservedProcesses < 1 || plan.ProcessAudit.LocalWriterAuditComplete {
		t.Fatal("local process facts missing or overstated")
	}
	wrong := permit
	wrong.CandidateSHA256 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	if _, err = InspectMaintenancePreparation(context.Background(), candidate, signPermit(wrong), trust, witnessID, witnessKeys, socket); err == nil {
		t.Fatal("wrong candidate accepted")
	}
	if _, err = InspectMaintenancePreparation(context.Background(), candidate, signPermit(permit), trust, witnessID, map[string]string{}, socket); err == nil {
		t.Fatal("untrusted witness accepted")
	}
	if calls.Load() != 1 {
		t.Fatal("invalid authority accessed local daemon")
	}
}
