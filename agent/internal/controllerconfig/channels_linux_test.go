package controllerconfig

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Opt-in actual WireGuard test. Refuses the real host namespace before using
// any kernel network command. Gateways and customer probes live in the harness.
func TestManagementChannelsIsolatedExecution(t *testing.T) {
	if os.Getenv("INCUDAL_CHANNELS_NETNS_TEST") != "1" {
		t.Skip("explicit isolated WireGuard harness required")
	}
	current, err := os.Readlink("/proc/self/ns/net")
	if err != nil || current == os.Getenv("INCUDAL_CHANNELS_PARENT_NETNS") || os.Getenv("INCUDAL_CHANNELS_PARENT_NETNS") == "" || os.Geteuid() != 0 {
		t.Fatal("isolated root network required")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	dir, err := os.MkdirTemp(home, ".incudal-channels-test-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	local := []ChannelLocalIdentity{}
	for _, slot := range []string{"a", "b"} {
		key, err := exec.Command("/usr/bin/wg", "genkey").Output()
		if err != nil {
			t.Fatal(err)
		}
		path := filepath.Join(dir, slot+".key")
		if os.WriteFile(path, key, 0600) != nil {
			t.Fatal("key write")
		}
		local = append(local, ChannelLocalIdentity{slot, path})
		pub, err := channelCommand(ctx, "/usr/bin/wg", []string{"pubkey"}, string(key))
		if err != nil {
			t.Fatal(err)
		}
		// Test outputs carry public transport identities only.
		if os.WriteFile(os.Getenv("INCUDAL_CHANNELS_PUBLIC_DIRECTORY")+"/"+slot+".pub", []byte(pub), 0600) != nil {
			t.Fatal("public identity write")
		}
	}
	rootPub, rootKey, _ := ed25519.GenerateKey(rand.Reader)
	platform, node := "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"
	now := time.Now().UnixMilli()
	config := ManagementChannels{1, "host-management-channels", platform, node, "2", "1", now, now + 60000, []ManagementChannel{
		{"a", "33333333-3333-4333-8333-333333333333", "8.1.1.1", 51820, os.Getenv("INCUDAL_CHANNELS_GATEWAY_A_KEY"), "10.250.1.2", "10.250.1.1", 1380},
		{"b", "44444444-4444-4444-8444-444444444444", "8.1.2.1", 51821, os.Getenv("INCUDAL_CHANNELS_GATEWAY_B_KEY"), "10.250.2.2", "10.250.2.1", 1380}}}
	sign := func(value ManagementChannels) []byte {
		raw, _ := canonical(value)
		payload := base64.StdEncoding.EncodeToString(raw)
		id := SigningKeyID(rootPub)
		out, _ := canonical(envelope{1, id, payload, base64.StdEncoding.EncodeToString(ed25519.Sign(rootKey, []byte(channelsPrefix+id+"\n"+payload)))})
		return out
	}
	trust := Context{PlatformID: platform, NodeID: node, Now: now, TrustedKeys: map[string]string{SigningKeyID(rootPub): base64.StdEncoding.EncodeToString(rootPub)}}
	encoded := sign(config)
	bad := append([]byte{}, encoded...)
	bad[len(bad)-3] = '!'
	if _, err = ApplyManagementChannels(ctx, bad, trust, dir, local); err == nil {
		t.Fatal("bad signature applied")
	}
	if _, err = os.Stat(filepath.Join(dir, "channels.json")); !os.IsNotExist(err) {
		t.Fatal("bad signature persisted")
	}
	// A pre-existing route covering either management address refuses before
	// persisting or changing any link, including the other slot.
	if _, err = channelCommand(ctx, "/usr/sbin/ip", []string{"route", "add", "10.250.2.0/24", "dev", "lo"}, ""); err != nil {
		t.Fatal(err)
	}
	if _, err = ApplyManagementChannels(ctx, encoded, trust, dir, local); err == nil {
		t.Fatal("conflicting route overwritten")
	}
	if _, err = os.Stat(filepath.Join(dir, "channels.json")); !os.IsNotExist(err) {
		t.Fatal("route conflict persisted config")
	}
	if _, err = channelCommand(ctx, "/usr/sbin/ip", []string{"route", "del", "10.250.2.0/24", "dev", "lo"}, ""); err != nil {
		t.Fatal(err)
	}
	result, err := ApplyManagementChannels(ctx, encoded, trust, dir, local)
	if err != nil || len(result) != 2 {
		t.Fatalf("apply failed: %v", err)
	}
	if _, err = ApplyManagementChannels(ctx, encoded, trust, dir, local); err != nil {
		t.Fatalf("idempotency failed: %v", err)
	}
	if os.WriteFile(os.Getenv("INCUDAL_CHANNELS_PUBLIC_DIRECTORY")+"/ready", []byte("ready"), 0600) != nil {
		t.Fatal("ready signal")
	}
	// Harness installs the reciprocal gateway peers when the public files exist.
	for _, channel := range config.Channels {
		passed := false
		for i := 0; i < 20; i++ {
			command := exec.CommandContext(ctx, "/usr/bin/ping", "-n", "-c", "1", "-W", "1", "-I", "incudal-ha-"+channel.Slot, channel.ControlAddress)
			if command.Run() == nil {
				passed = true
				break
			}
			time.Sleep(50 * time.Millisecond)
		}
		if !passed {
			t.Fatal("actual WireGuard gateway handshake failed: " + channel.Slot)
		}
	}
	if _, err = channelCommand(ctx, "/usr/sbin/ip", []string{"link", "set", "dev", "underlay-a", "down"}, ""); err != nil {
		t.Fatal(err)
	}
	if exec.CommandContext(ctx, "/usr/bin/ping", "-n", "-c", "1", "-W", "1", "-I", "incudal-ha-a", "10.250.1.1").Run() == nil {
		t.Fatal("A fault did not isolate A")
	}
	if exec.CommandContext(ctx, "/usr/bin/ping", "-n", "-c", "1", "-W", "2", "-I", "incudal-ha-b", "10.250.2.1").Run() != nil {
		t.Fatal("A fault also stopped B")
	}
	// Advance generation through B without requiring A handshake/receipt.
	config.Sequence = "2"
	updated := sign(config)
	if _, err = ApplyManagementChannels(ctx, updated, trust, dir, local); err != nil {
		t.Fatalf("independent B update: %v", err)
	}
	if _, err = ApplyManagementChannels(ctx, encoded, trust, dir, local); err == nil {
		t.Fatal("old signed generation replayed")
	}
	// Remove a runtime interface to simulate lost kernel state, then restore
	// from the authenticated highest on-disk configuration while A is offline.
	if _, err = channelCommand(ctx, "/usr/sbin/ip", []string{"link", "del", "incudal-ha-b"}, ""); err != nil {
		t.Fatal(err)
	}
	if _, err = RestoreManagementChannels(ctx, trust, dir, local); err != nil {
		t.Fatalf("startup channel restore: %v", err)
	}
	if exec.CommandContext(ctx, "/usr/bin/ping", "-n", "-c", "1", "-W", "2", "-I", "incudal-ha-b", "10.250.2.1").Run() != nil {
		t.Fatal("restored B did not reconnect")
	}
	if binary := os.Getenv("INCUDAL_CHANNELS_COMMAND_BINARY"); binary != "" {
		encodedPath := filepath.Join(dir, "signed-config.json")
		if os.WriteFile(encodedPath, updated, 0600) != nil {
			t.Fatal("config write")
		}
		configPath := filepath.Join(dir, "service-config.json")
		raw, _ := json.Marshal(struct {
			SchemaVersion       int                    `json:"schemaVersion"`
			PlatformID          string                 `json:"platformId"`
			NodeID              string                 `json:"nodeId"`
			TrustedKeys         map[string]string      `json:"trustedKeys"`
			StateDirectory      string                 `json:"stateDirectory"`
			SignedConfiguration string                 `json:"signedConfiguration"`
			LocalIdentities     []ChannelLocalIdentity `json:"localIdentities"`
		}{1, platform, node, trust.TrustedKeys, dir, encodedPath, local})
		if os.WriteFile(configPath, raw, 0600) != nil {
			t.Fatal("service config write")
		}
		for _, mode := range []string{"--apply", "--restore"} {
			output, err := exec.CommandContext(ctx, binary, mode, configPath).Output()
			if err != nil {
				t.Fatalf("actual command %s: %v", mode, err)
			}
			var result struct {
				CanWrite bool                 `json:"canWrite"`
				Channels []ChannelApplyResult `json:"channels"`
			}
			if json.Unmarshal(output, &result) != nil || result.CanWrite || len(result.Channels) != 2 {
				t.Fatal("command claimed write authority")
			}
		}
		service := exec.CommandContext(ctx, binary, "--serve", configPath)
		output, err := service.StdoutPipe()
		if err != nil || service.Start() != nil {
			t.Fatal("service start")
		}
		defer service.Process.Kill()
		var startup struct {
			CanWrite bool `json:"canWrite"`
		}
		if json.NewDecoder(output).Decode(&startup) != nil || startup.CanWrite {
			t.Fatal("service did not restore first")
		}
		if exec.CommandContext(ctx, binary, "--serve", configPath).Run() == nil {
			t.Fatal("duplicate service started")
		}
		service.Process.Signal(os.Interrupt)
		if service.Wait() != nil {
			t.Fatal("service did not exit gracefully")
		}
	}
	// Offline startup may restore expired, locally persisted transport authority;
	// the exact same expired signed object cannot be accepted as a new update.
	config.IssuedAt = time.Now().Add(-2 * time.Minute).UnixMilli()
	config.ExpiresAt = config.IssuedAt + 60000
	expired := sign(config)
	if saveChannelRecord(dir, expired) != nil {
		t.Fatal("historical fixture write")
	}
	if _, err = ApplyManagementChannels(ctx, expired, trust, dir, local); err == nil {
		t.Fatal("expired remote update accepted")
	}
	if _, err = RestoreManagementChannels(ctx, trust, dir, local); err != nil {
		t.Fatalf("expired local transport restore: %v", err)
	}
	saved, err := os.ReadFile(filepath.Join(dir, "channels.json"))
	if err != nil {
		t.Fatal(err)
	}
	if os.Remove(filepath.Join(dir, "channels.json")) != nil {
		t.Fatal("remove test state")
	}
	if _, err = ApplyManagementChannels(ctx, encoded, trust, dir, local); err == nil {
		t.Fatal("missing high watermark reset initialized identity")
	}
	if os.WriteFile(filepath.Join(dir, "channels.json"), saved, 0600) != nil {
		t.Fatal("restore fixture")
	}
	config.IssuedAt = time.Now().UnixMilli()
	config.ExpiresAt = config.IssuedAt + 60000
	config.Sequence = "3"
	config.Channels = config.Channels[:1]
	if _, err = ApplyManagementChannels(ctx, sign(config), trust, dir, local); err == nil {
		t.Fatal("omitted B implicitly retired")
	}
	routes, err := channelCommand(ctx, "/usr/sbin/ip", []string{"-4", "route", "show"}, "")
	if err != nil || strings.Contains(routes, "default dev incudal-ha") {
		t.Fatal("management altered default route")
	}
	t.Log("real WireGuard A/B handshakes, conflicts/signatures, A loss/B survival, generation replay, runtime loss restore, offline expiry and independent command/service passed")
}
