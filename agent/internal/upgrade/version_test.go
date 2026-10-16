package upgrade

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"incudal-agent/internal/panel"
)

func TestVersionPrecedence(t *testing.T) {
	cases := []struct {
		current, target string
		wanted          bool
	}{
		{"v1.0.3-ipv6.1", "v1.0.2", false},
		{"v1.0.3-ipv6.1", "v1.0.3", true},
		{"v1.0.3", "v1.0.3-ipv6.2", false},
		{"v1.0.9", "v1.0.10", true},
		{"v2.0.0", "v1.99.99", false},
		{"1.0.3", "v1.0.3", false},
		{"v1.0.3+build.1", "v1.0.3+build.2", false},
		{"v1.0.3-alpha.9", "v1.0.3-alpha.10", true},
		{"v1.0.3-alpha.1", "v1.0.3-alpha.beta", true},
		{"v1.0.3-beta", "v1.0.3-beta.1", true},
		{"v1.0.3-rc.1", "v1.0.3-beta.11", false},
		{"v9007199254740993.0.0", "v9007199254740992.0.0", false},
		{"dev", "v1.0.3", true}, {"dev", "dev", false},
		{"", "v1.0.3", true}, {"v1.0.3", "", false},
	}
	for _, tc := range cases {
		if got := ShouldUpgrade(tc.current, tc.target); got != tc.wanted {
			t.Errorf("%s -> %s: got %t, wanted %t", tc.current, tc.target, got, tc.wanted)
		}
	}
}

func TestApplyDoesNotReplaceNewerBinary(t *testing.T) {
	path := filepath.Join(t.TempDir(), "incudal-agent")
	if err := os.WriteFile(path, []byte("current-ipv6-build"), 0755); err != nil {
		t.Fatal(err)
	}
	runner := Runner{BinaryPath: path, Restart: func(context.Context, string) error {
		t.Fatal("downgrade must never restart the agent")
		return nil
	}}
	// No download URL is deliberately supplied: a stale manifest must be ignored
	// before downloading, locking, replacing the binary, or restarting services.
	if err := runner.Apply(context.Background(), panel.UpgradeInstruction{Available: true, Version: "v1.0.2"}, "v1.0.3-ipv6.1"); err != nil {
		t.Fatal(err)
	}
	actual, err := os.ReadFile(path)
	if err != nil || string(actual) != "current-ipv6-build" {
		t.Fatalf("current binary changed: %v", err)
	}
}
