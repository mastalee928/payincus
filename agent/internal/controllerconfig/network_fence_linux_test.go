package controllerconfig

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

func networkFenceFixture(t *testing.T) ([]byte, []byte, Context, string, map[string]string) {
	return networkFenceFixtureAt(t, time.Now().UnixMilli())
}

func networkFenceFixtureAt(t *testing.T, now int64) ([]byte, []byte, Context, string, map[string]string) {
	t.Helper()
	config, trust, root, _, _ := discoveryFixture(t)
	config.IssuedAt, config.ExpiresAt, trust.Now = now, now+60000, now
	candidate := signedCandidate(t, config, root)
	checked, err := VerifyPrepareConfig(candidate, trust)
	if err != nil {
		t.Fatal(err)
	}
	trust.Previous = &checked.Observed
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	witness := "77777777-7777-4777-8777-777777777777"
	permit := PreparePermit{1, "host-fence-prepare", witness, config.PlatformID, config.NodeID, config.ControllerID, config.RequestID, config.Epoch, config.Sequence, checked.Observed.PayloadSHA256, base64.RawURLEncoding.EncodeToString(make([]byte, 24)), trust.Now, trust.Now + 60000}
	raw, err := canonical(permit)
	if err != nil {
		t.Fatal(err)
	}
	id := SigningKeyID(public)
	payload := base64.StdEncoding.EncodeToString(raw)
	encoded, err := canonical(envelope{1, id, payload, base64.StdEncoding.EncodeToString(ed25519.Sign(private, []byte(preparePermitPrefix+id+"\n"+payload)))})
	if err != nil {
		t.Fatal(err)
	}
	return candidate, encoded, trust, witness, map[string]string{id: base64.StdEncoding.EncodeToString(public)}
}

func protectedFenceTestDirectory(t *testing.T) string {
	t.Helper()
	if os.Geteuid() != 0 {
		t.Skip("root-owned preparation state required")
	}
	// /tmp is intentionally rejected by the execution boundary. The caller of
	// this test must run it from a protected home, including the opt-in netns run.
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	dir, err := os.MkdirTemp(home, ".incudal-fence-test-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	return dir
}

func TestNetworkFenceReloadsAndLocksPersistedWatermark(t *testing.T) {
	dir := protectedFenceTestDirectory(t)
	candidate, permit, trust, witness, keys := networkFenceFixture(t)
	if _, _, err := lockNetworkFenceState(dir); err == nil {
		t.Fatal("missing persisted watermark accepted")
	}
	if _, err := ObservePrepareConfig(dir, candidate, trust); err != nil {
		t.Fatal(err)
	}
	state, release, err := lockNetworkFenceState(dir)
	if err != nil {
		t.Fatal(err)
	}
	if state != *trust.Previous {
		t.Fatal("persisted watermark was not reloaded")
	}
	if _, _, err = lockNetworkFenceState(dir); err == nil {
		t.Fatal("second preparation acquired same state")
	}
	observe, err := openStateFile(filepath.Join(dir, "observe.lock"), syscall.O_RDWR)
	if err != nil {
		t.Fatal(err)
	}
	if syscall.Flock(int(observe.Fd()), syscall.LOCK_EX|syscall.LOCK_NB) == nil {
		t.Fatal("higher candidate observation can race preparation")
	}
	observe.Close()
	release()
	higher := *trust.Previous
	higher.Epoch = "3"
	raw, _ := canonical(higher)
	if err = os.WriteFile(filepath.Join(dir, "observed.json"), raw, 0600); err != nil {
		t.Fatal(err)
	}
	// Caller still supplies epoch 2. The public boundary must reload epoch 3
	// and refuse before invoking nft, even when runtime nft is unavailable.
	err = ApplyManagementPreparationFence(context.Background(), candidate, permit, trust, witness, keys, ManagementFencePorts{2200, 8443}, dir)
	if err == nil || !strings.Contains(err.Error(), "CONTROLLER_CONFIG_ROLLBACK") {
		t.Fatalf("stale caller state accepted: %v", err)
	}
	if err = os.Chmod(filepath.Join(dir, "observed.json"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, _, err = lockNetworkFenceState(dir); err == nil {
		t.Fatal("unsafe watermark accepted")
	}
}

func TestNetworkFencePreparationTransaction(t *testing.T) {
	if validateNetworkFenceRuntime() != nil {
		t.Skip("trusted root nft runtime required; no real rules are modified")
	}
	candidate, permit, trust, witness, keys := networkFenceFixture(t)
	owned := managementFenceTableFixture
	var calls []string
	command := func(ctx context.Context, args []string, input string) (string, error) {
		call := strings.Join(args, " ")
		calls = append(calls, call)
		if call == "-j list tables" {
			return `{"nftables":[]}`, nil
		}
		if call == "-j list table inet incudal_controller_fence" {
			return owned, nil
		}
		if !strings.HasPrefix(input, "create table inet incudal_controller_fence\n") {
			t.Fatal("mutation lacks exclusive table creation")
		}
		return "", nil
	}
	if err := applyManagementPreparationFence(context.Background(), candidate, permit, trust, witness, keys, ManagementFencePorts{2200, 8443}, command); err != nil {
		t.Fatal(err)
	}
	if strings.Join(calls, "|") != "-j list tables|--check -f -|-f -|-j list table inet incudal_controller_fence" {
		t.Fatal("mutation did not check then verify its actual result")
	}
	calls = nil
	if err := applyManagementPreparationFence(context.Background(), candidate, append(permit, '\n'), trust, witness, keys, ManagementFencePorts{2200, 8443}, command); err == nil || len(calls) != 0 {
		t.Fatal("invalid authority invoked nft")
	}
	conflict := func(ctx context.Context, args []string, input string) (string, error) {
		call := strings.Join(args, " ")
		if input != "" {
			t.Fatal("unowned table was mutated")
		}
		if call == "-j list tables" {
			return `{"nftables":[{"table":{"family":"inet","name":"incudal_controller_fence"}}]}`, nil
		}
		return strings.Replace(owned, "payincus-controller-prepare-v1", "unowned", 1), nil
	}
	if err := applyManagementPreparationFence(context.Background(), candidate, permit, trust, witness, keys, ManagementFencePorts{2200, 8443}, conflict); err == nil {
		t.Fatal("unowned table accepted")
	}
	// A valid historical verification time cannot authorize a mutation now.
	stale, stalePermit, staleTrust, staleWitness, staleKeys := networkFenceFixtureAt(t, time.Now().UnixMilli()-120000)
	calls = nil
	if err := applyManagementPreparationFence(context.Background(), stale, stalePermit, staleTrust, staleWitness, staleKeys, ManagementFencePorts{2200, 8443}, command); err == nil || strings.Join(calls, "|") != "-j list tables|--check -f -" {
		t.Fatal("expired request reached mutation")
	}
}

// Opt-in helper for the Python network-namespace integration. It uses actual
// signed fixtures, disk state and the production nft command. Ordinary go test
// never mutates a network namespace.
func TestManagementFenceIsolatedExecution(t *testing.T) {
	if os.Getenv("INCUDAL_MANAGEMENT_FENCE_EXEC_TEST") != "1" {
		t.Skip("explicit isolated network namespace required")
	}
	parent := os.Getenv("INCUDAL_MANAGEMENT_FENCE_PARENT_NETNS")
	current, err := os.Readlink("/proc/self/ns/net")
	if err != nil || parent == "" || parent == current {
		t.Fatal("refusing parent network namespace")
	}
	dir := protectedFenceTestDirectory(t)
	candidate, permit, trust, witness, keys := networkFenceFixture(t)
	if _, err = ObservePrepareConfig(dir, candidate, trust); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		err = ApplyManagementPreparationFence(context.Background(), candidate, permit, trust, witness, keys, ManagementFencePorts{2200, 8443}, dir)
		if err != nil {
			t.Fatal(err)
		}
	}
	// A simulated boot loses the runtime controller table, not customer tables.
	// Restore only the persisted, authenticated deny instruction.
	if _, err = fixedNftCommand(context.Background(), []string{"delete", "table", "inet", "incudal_controller_fence"}, ""); err != nil {
		t.Fatal(err)
	}
	if err = RestoreManagementPreparationFence(context.Background(), trust, witness, keys, ManagementFencePorts{2200, 8443}, dir); err != nil {
		t.Fatal(err)
	}
	if err = RestoreManagementPreparationFence(context.Background(), trust, witness, keys, ManagementFencePorts{22, 8443}, dir); err == nil {
		t.Fatal("startup ports widened")
	}
}
