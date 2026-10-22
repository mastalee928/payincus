package controllerconfig

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestGatewayTransportIsolatedExecution(t *testing.T) {
	if os.Getenv("INCUDAL_CHANNELS_NETNS_TEST") != "1" {
		t.Skip("explicit isolated network required")
	}
	current, err := os.Readlink("/proc/self/ns/net")
	if err != nil || current == os.Getenv("INCUDAL_CHANNELS_PARENT_NETNS") || os.Getenv("INCUDAL_CHANNELS_PARENT_NETNS") == "" || os.Geteuid() != 0 {
		t.Fatal("refusing non-isolated gateway test")
	}
	home, _ := os.UserHomeDir()
	dir, err := os.MkdirTemp(home, ".incudal-gateway-test-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	key, err := channelCommand(ctx, "/usr/bin/wg", []string{"genkey"}, "")
	if err != nil {
		t.Fatal(err)
	}
	key = strings.TrimSpace(key)
	keyPath := filepath.Join(dir, "wg.key")
	if os.WriteFile(keyPath, []byte(key+"\n"), 0600) != nil {
		t.Fatal("key write")
	}
	peerKey, err := channelCommand(ctx, "/usr/bin/wg", []string{"genkey"}, "")
	if err != nil {
		t.Fatal(err)
	}
	peerPublic, err := channelCommand(ctx, "/usr/bin/wg", []string{"pubkey"}, strings.TrimSpace(peerKey)+"\n")
	if err != nil {
		t.Fatal(err)
	}
	rootPub, rootKey, _ := ed25519.GenerateKey(rand.Reader)
	now := time.Now().UnixMilli()
	config := GatewayTransport{1, "gateway-transport", "11111111-1111-4111-8111-111111111111", "77777777-7777-4777-8777-777777777777", "2", "1", now, now + 60000, "a", "10.249.81.1", 51981, 1380,
		[]GatewayTransportPeer{{"22222222-2222-4222-8222-222222222222", strings.TrimSpace(peerPublic), "10.249.81.2", true}}}
	sign := func(config GatewayTransport) []byte {
		raw, _ := canonical(config)
		payload := base64.StdEncoding.EncodeToString(raw)
		id := SigningKeyID(rootPub)
		out, _ := canonical(envelope{1, id, payload, base64.StdEncoding.EncodeToString(ed25519.Sign(rootKey, []byte(gatewayTransportPrefix+id+"\n"+payload)))})
		return out
	}
	trust := Context{PlatformID: config.PlatformID, NodeID: config.GatewayID, TrustedKeys: map[string]string{SigningKeyID(rootPub): base64.StdEncoding.EncodeToString(rootPub)}}
	encoded := sign(config)
	if ApplyGatewayTransport(ctx, []byte("invalid"), trust, dir, keyPath, false) == nil {
		t.Fatal("wrong signature applied")
	}
	if _, err = channelCommand(ctx, "/usr/sbin/ip", []string{"route", "add", "10.249.81.0/24", "dev", "lo"}, ""); err != nil {
		t.Fatal(err)
	}
	if ApplyGatewayTransport(ctx, encoded, trust, dir, keyPath, false) == nil {
		t.Fatal("route conflict overwritten")
	}
	if _, err = os.Stat(filepath.Join(dir, "gateway-transport.json")); !os.IsNotExist(err) {
		t.Fatal("route conflict wrote state")
	}
	channelCommand(ctx, "/usr/sbin/ip", []string{"route", "del", "10.249.81.0/24", "dev", "lo"}, "")
	if err = ApplyGatewayTransport(ctx, encoded, trust, dir, keyPath, false); err != nil {
		t.Fatal(err)
	}
	if err = ApplyGatewayTransport(ctx, encoded, trust, dir, keyPath, false); err != nil {
		t.Fatal("duplicate: ", err)
	}
	if _, err = channelCommand(ctx, "/usr/sbin/ip", []string{"link", "set", "dev", "incudal-gw-a", "down"}, ""); err != nil {
		t.Fatal(err)
	}
	if err = ApplyGatewayTransport(ctx, nil, trust, dir, keyPath, true); err != nil {
		t.Fatal("restore: ", err)
	}
	route, err := channelCommand(ctx, "/usr/sbin/ip", []string{"route", "get", "10.249.81.2"}, "")
	if err != nil || !strings.Contains(route, "dev incudal-gw-a") {
		t.Fatal("restore did not recover peer route")
	}
	config.Sequence = "2"
	config.Peers[0].Enabled = false
	// Simulate interruption after the tombstone was durable but before kernel
	// removal. Its still-live enrolled peer must be removed by idempotent retry.
	if err = saveGatewayFile(dir, "gateway-transport.json", sign(config), false); err != nil {
		t.Fatal(err)
	}
	if err = ApplyGatewayTransport(ctx, sign(config), trust, dir, keyPath, false); err != nil {
		t.Fatal("revoke: ", err)
	}
	actual, err := channelCommand(ctx, "/usr/bin/wg", []string{"show", "incudal-gw-a", "peers"}, "")
	if err != nil || strings.TrimSpace(actual) != "" {
		t.Fatal("revoked peer retained")
	}
	config.Sequence = "3"
	config.Peers[0].Enabled = true
	if ApplyGatewayTransport(ctx, sign(config), trust, dir, keyPath, false) == nil {
		t.Fatal("tombstone resurrected")
	}
	if ApplyGatewayTransport(ctx, encoded, trust, dir, keyPath, false) == nil {
		t.Fatal("old snapshot reapplied")
	}
	config.Peers = []GatewayTransportPeer{}
	if ApplyGatewayTransport(ctx, sign(config), trust, dir, keyPath, false) == nil {
		t.Fatal("tombstone omitted")
	}
	t.Log("actual gateway peer/route restore after link down, signature/conflict, permanent tombstone and old snapshot rejection passed")
}
