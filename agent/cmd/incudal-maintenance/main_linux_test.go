package main

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"incudal-agent/internal/controllerconfig"
)

func TestProtectedMaintenanceCommandPersistsOnlyTrustedCandidates(t *testing.T) {
	dir := t.TempDir()
	isolatedFence := os.Getenv("INCUDAL_MANAGEMENT_FENCE_EXEC_TEST") == "1"
	if isolatedFence {
		parent := os.Getenv("INCUDAL_MANAGEMENT_FENCE_PARENT_NETNS")
		current, err := os.Readlink("/proc/self/ns/net")
		if err != nil || parent == "" || parent == current || os.Geteuid() != 0 {
			t.Fatal("refusing management preparation outside isolated namespace")
		}
		home, err := os.UserHomeDir()
		if err != nil {
			t.Fatal(err)
		}
		dir, err = os.MkdirTemp(home, ".incudal-maintenance-test-")
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { os.RemoveAll(dir) })
	}
	os.Chmod(dir, 0700)
	observedDir := filepath.Join(dir, "observed")
	if err := os.Mkdir(observedDir, 0700); err != nil {
		t.Fatal(err)
	}
	socket := filepath.Join(dir, "unix.socket")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	os.Chmod(socket, 0600)
	var calls atomic.Int32
	var failAfter atomic.Int32
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		count := calls.Add(1)
		if failAfter.Load() > 0 && count >= failAfter.Load() {
			w.WriteHeader(503)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"type": "sync", "status_code": 200, "metadata": map[string]any{}})
	})}
	go server.Serve(listener)
	defer server.Close()
	rootPub, rootKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	witnessPub, witnessKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	platform, node, witness := "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "77777777-7777-4777-8777-777777777777"
	enrolled := enrollment{SchemaVersion: 1, PlatformID: platform, NodeID: node, WitnessID: witness,
		CandidateKeys: map[string]string{controllerconfig.SigningKeyID(rootPub): base64.StdEncoding.EncodeToString(rootPub)},
		WitnessKeys:   map[string]string{controllerconfig.SigningKeyID(witnessPub): base64.StdEncoding.EncodeToString(witnessPub)},
		IncusSocket:   socket, ObservedStateDirectory: observedDir}
	configPath := filepath.Join(dir, "enrollment.json")
	encodedConfig, _ := json.Marshal(enrolled)
	if err = os.WriteFile(configPath, encodedConfig, 0600); err != nil {
		t.Fatal(err)
	}
	signEnvelope := func(raw []byte, key ed25519.PrivateKey, prefix string) string {
		id := controllerconfig.SigningKeyID(key.Public().(ed25519.PublicKey))
		payload := base64.StdEncoding.EncodeToString(raw)
		encoded, _ := json.Marshal(struct {
			SchemaVersion int    `json:"schemaVersion"`
			KeyID         string `json:"keyId"`
			Payload       string `json:"payload"`
			Signature     string `json:"signature"`
		}{1, id, payload, base64.StdEncoding.EncodeToString(ed25519.Sign(key, []byte(prefix+id+"\n"+payload)))})
		return string(encoded)
	}
	requestFor := func(epoch string) input {
		now := time.Now().UnixMilli()
		config := controllerconfig.PrepareConfig{SchemaVersion: 1, Purpose: "controller-prepare", PlatformID: platform, NodeID: node, ControllerID: "33333333-3333-4333-8333-333333333333", RequestID: "44444444-4444-4444-8444-444444444444", Epoch: epoch, Sequence: "1", IssuedAt: now, ExpiresAt: now + 60000, PanelBaseURL: "https://panel.example.com", Gateway: controllerconfig.Gateway{GatewayID: "55555555-5555-4555-8555-555555555555", EndpointHost: "gateway.example.com", EndpointPort: 51820, PublicKey: base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{7}, 32)), NodeAddress: "10.253.240.2", ControlAddress: "10.253.240.1"}}
		raw, _ := json.Marshal(config)
		candidate := signEnvelope(raw, rootKey, "payincus/controller-prepare/v1\n")
		verified, err := controllerconfig.VerifyPrepareConfig([]byte(candidate), controllerconfig.Context{PlatformID: platform, NodeID: node, TrustedKeys: enrolled.CandidateKeys, Now: now})
		if err != nil {
			t.Fatal(err)
		}
		permit := controllerconfig.PreparePermit{SchemaVersion: 1, Purpose: "host-fence-prepare", WitnessID: witness, PlatformID: platform, NodeID: node, ControllerID: config.ControllerID, RequestID: config.RequestID, Epoch: epoch, Sequence: "1", CandidateSHA256: verified.Observed.PayloadSHA256, Challenge: base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{8}, 24)), IssuedAt: now, ExpiresAt: now + 60000}
		raw, _ = json.Marshal(permit)
		return input{candidate, signEnvelope(raw, witnessKey, "payincus/host-fence-prepare/v1\n")}
	}
	invoke := func(in input) (MaintenanceOutput, error) {
		raw, _ := json.Marshal(in)
		var out bytes.Buffer
		err := run([]string{"--inspect", "--enrollment", configPath}, strings.NewReader(string(raw)), &out)
		var result MaintenanceOutput
		if err == nil {
			if decodeErr := json.Unmarshal(out.Bytes(), &result); decodeErr != nil {
				t.Fatal(decodeErr)
			}
		} else if out.Len() != 0 {
			t.Fatal("failure leaked partial successful output")
		}
		return result, err
	}
	first := requestFor("9007199254740993")
	wrong := first
	wrong.PreparePermit += "\n"
	if _, err = invoke(wrong); err == nil {
		t.Fatal("invalid permit accepted")
	}
	if _, err = os.Stat(filepath.Join(observedDir, "observed.json")); !os.IsNotExist(err) {
		t.Fatal("invalid permit created state")
	}
	plan, err := invoke(first)
	if err != nil || plan.CanWrite || plan.ReadyForFencing || !plan.PreparationPermitted {
		t.Fatalf("first plan: %+v %v", plan, err)
	}
	if _, err = invoke(first); err != nil {
		t.Fatalf("repeat: %v", err)
	}
	if _, err = invoke(requestFor("9007199254740994")); err != nil {
		t.Fatal(err)
	}
	after, _ := os.ReadFile(filepath.Join(observedDir, "observed.json"))
	if _, err = invoke(first); err == nil {
		t.Fatal("older candidate accepted after higher disk watermark")
	}
	current, _ := os.ReadFile(filepath.Join(observedDir, "observed.json"))
	if !bytes.Equal(current, after) {
		t.Fatal("old request changed watermark")
	}
	if err = os.Chmod(configPath, 0644); err != nil {
		t.Fatal(err)
	}
	if _, err = invoke(first); err == nil {
		t.Fatal("unsafe enrollment accepted")
	}
	if !isolatedFence {
		return
	}
	if err = os.Chmod(configPath, 0600); err != nil {
		t.Fatal(err)
	}
	prepareInput := requestFor("9007199254740995")
	prepareRaw, _ := json.Marshal(prepareInput)
	var prepared bytes.Buffer
	prepareArgs := []string{"--prepare-fence", "--enrollment", configPath}
	if err = run(prepareArgs, bytes.NewReader(prepareRaw), &prepared); err == nil || prepared.Len() != 0 {
		t.Fatal("preparation without enrolled management ports accepted")
	}
	stateAfterMissingPorts, _ := os.ReadFile(filepath.Join(observedDir, "observed.json"))
	if !bytes.Equal(stateAfterMissingPorts, current) {
		t.Fatal("missing local ports changed watermark")
	}
	enrolled.ManagementPorts = &controllerconfig.ManagementFencePorts{SSH: 2200, Incus: 8443}
	encodedConfig, _ = json.Marshal(enrolled)
	if err = os.WriteFile(configPath, encodedConfig, 0600); err != nil {
		t.Fatal(err)
	}
	if err = run(prepareArgs, bytes.NewReader(prepareRaw), &prepared); err != nil {
		t.Fatal(err)
	}
	var result controllerconfig.MaintenancePlan
	if json.Unmarshal(prepared.Bytes(), &result) != nil || !result.NetworkFenceApplied || result.CanWrite || result.ReadyForFencing || len(result.Blockers) != 2 {
		t.Fatal("preparation misreported write authority or physical audits")
	}
	prepared.Reset()
	if err = run([]string{"--restore-fence", "--enrollment", configPath}, strings.NewReader(""), &prepared); err != nil {
		t.Fatal(err)
	}
	var restored struct {
		NetworkFenceApplied bool
		CanWrite            bool
	}
	if json.Unmarshal(prepared.Bytes(), &restored) != nil || !restored.NetworkFenceApplied || restored.CanWrite {
		t.Fatal("startup restore reported writes")
	}
	testMaintenanceServiceLifecycle(t, dir, configPath, prepareRaw, enrolled)
	prepared.Reset()
	// On repeat, the pre-read passes but the post-fence local read fails.
	// The command must not output the previously successful plan.
	failAfter.Store(calls.Load() + 2)
	if err = run(prepareArgs, bytes.NewReader(prepareRaw), &prepared); err == nil || prepared.Len() != 0 {
		t.Fatal("failed post-fence Incus read returned success")
	}
}

type MaintenanceOutput struct {
	CanWrite             bool `json:"canWrite"`
	ReadyForFencing      bool `json:"readyForFencing"`
	PreparationPermitted bool `json:"preparationPermitted"`
}
