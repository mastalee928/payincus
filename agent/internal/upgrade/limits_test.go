package upgrade

import (
	"bytes"
	"context"
	"errors"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"incudal-agent/internal/panel"
)

func TestSystemdRestartRejectsUnsafeServiceAndCanceledRequest(t *testing.T) {
	for _, service := range []string{"../agent", "agent;bad", "-bad", ""} {
		if err := restartSystemdService(context.Background(), service); err == nil || !strings.Contains(err.Error(), "invalid") {
			t.Fatalf("unsafe systemd service accepted: %q %v", service, err)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := restartSystemdService(ctx, "incudal-agent"); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled restart did not fail before service manager lookup: %v", err)
	}
}

func TestGunzipEnforcesExpandedSizeAndIntegrity(t *testing.T) {
	const limit = 1024
	for _, size := range []int{limit - 1, limit, limit + 1} {
		payload := bytes.Repeat([]byte("a"), size)
		got, err := gunzip(gzipBytes(t, payload), limit)
		if size > limit {
			if err == nil || !strings.Contains(err.Error(), "binary exceeds") {
				t.Fatalf("expanded payload above limit accepted: %v", err)
			}
		} else if err != nil || !bytes.Equal(got, payload) {
			t.Fatalf("payload at/below limit rejected: size=%d err=%v", size, err)
		}
	}
	concatenated := append(gzipBytes(t, bytes.Repeat([]byte("b"), 700)), gzipBytes(t, bytes.Repeat([]byte("c"), 700))...)
	if _, err := gunzip(concatenated, limit); err == nil {
		t.Fatal("concatenated gzip members bypassed the total expanded limit")
	}
	valid := gzipBytes(t, []byte("checked payload"))
	corrupt := append([]byte(nil), valid...)
	corrupt[len(corrupt)-1] ^= 0xff
	for _, bad := range [][]byte{corrupt, valid[:len(valid)-4]} {
		if _, err := gunzip(bad, limit); err == nil {
			t.Fatal("gzip corruption or truncation was accepted")
		}
	}
	if _, err := gunzip(valid, 0); err == nil {
		t.Fatal("zero limit accepted")
	}
	if got, err := readBoundedUpgradePayload(strings.NewReader("x"), math.MaxInt64, "package"); err != nil || string(got) != "x" {
		t.Fatalf("large limit overflowed: %q %v", got, err)
	}
}

func TestApplyRejectsCompressedAndExpandedOversizeBeforeMutation(t *testing.T) {
	for _, compressed := range []bool{false, true} {
		t.Run(map[bool]string{false: "download", true: "expanded"}[compressed], func(t *testing.T) {
			dir := t.TempDir()
			binaryPath := filepath.Join(dir, "agent")
			backupPath := binaryPath + ".bak"
			if err := os.WriteFile(binaryPath, []byte("old-binary"), 0755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(backupPath, []byte("previous-backup"), 0755); err != nil {
				t.Fatal(err)
			}
			payload := bytes.Repeat([]byte("a"), 8192)
			if compressed {
				payload = gzipBytes(t, payload)
			}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(payload) }))
			defer server.Close()
			restarted := false
			runner := Runner{BinaryPath: binaryPath, BackupPath: backupPath, LockPath: filepath.Join(dir, "upgrade.lock"),
				AllowedBaseURL: server.URL, HTTPClient: server.Client(), MaxDownloadBytes: 1024,
				Restart: func(context.Context, string) error { restarted = true; return nil }}
			err := runner.Apply(context.Background(), panel.UpgradeInstruction{Available: true, Version: "v1.0.4",
				URL: server.URL + "/agent", SHA256: sha256Hex(payload), Gzip: compressed}, "v1.0.3")
			if err == nil || !strings.Contains(err.Error(), "exceeds") {
				t.Fatalf("expected bounded-size failure: %v", err)
			}
			if restarted {
				t.Fatal("oversized upgrade scheduled a restart")
			}
			for path, expected := range map[string]string{binaryPath: "old-binary", backupPath: "previous-backup"} {
				got, readErr := os.ReadFile(path)
				if readErr != nil || string(got) != expected {
					t.Fatalf("modified %s: %q %v", filepath.Base(path), got, readErr)
				}
			}
			files, err := filepath.Glob(filepath.Join(dir, ".incudal-agent-upgrade-*"))
			if err != nil || len(files) != 0 {
				t.Fatalf("temporary executable left behind: %v %v", files, err)
			}
			unlock, err := acquireLock(runner.LockPath)
			if err != nil {
				t.Fatalf("failed upgrade retained its lock: %v", err)
			}
			unlock()
		})
	}
}
