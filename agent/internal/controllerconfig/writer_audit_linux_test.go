package controllerconfig

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
)

func TestWriterPolicyRejectsInterpreterExceptionsAndIncompleteSchedulers(t *testing.T) {
	good := WriterAuditPolicy{SchemaVersion: 1, Executables: map[string]string{"/usr/lib/systemd/systemd": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
		ConfigurationFiles:   map[string]string{"/etc/crontab": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "/etc/anacrontab": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "/etc/ssh/sshd_config": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
		SchedulerDirectories: []string{"/etc/cron.d", "/var/spool/cron", "/etc/systemd/system", "/usr/lib/systemd/system", "/run/systemd/system"}}
	if validateWriterPolicy(good) != nil {
		t.Fatal("baseline policy rejected")
	}
	for _, name := range []string{"sh", "bash", "dash", "busybox", "node", "python3", "sshd", "cron", "systemd-run", "socat"} {
		changed := good
		changed.Executables = map[string]string{"/usr/bin/" + name: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}
		if validateWriterPolicy(changed) == nil {
			t.Fatalf("writer exception accepted: %s", name)
		}
	}
	changed := good
	changed.SchedulerDirectories = []string{"/etc/cron.d"}
	if validateWriterPolicy(changed) == nil {
		t.Fatal("missing scheduler source accepted")
	}
	changed = good
	changed.ConfigurationFiles = map[string]string{}
	if validateWriterPolicy(changed) == nil {
		t.Fatal("empty configuration manifest accepted")
	}
}

func TestWriterFileHashAndProcessCapabilities(t *testing.T) {
	dir := t.TempDir()
	if os.Geteuid() == 0 {
		home, err := os.UserHomeDir()
		if err != nil {
			t.Fatal(err)
		}
		dir, err = os.MkdirTemp(home, ".incudal-writer-hash-test-")
		if err != nil {
			t.Fatal(err)
		}
		defer os.RemoveAll(dir)
	}
	file := filepath.Join(dir, "sealed.conf")
	if os.WriteFile(file, []byte("sealed"), 0600) != nil {
		t.Fatal("write")
	}
	if os.Geteuid() == 0 {
		hash, err := writerFileHash(context.Background(), file, 64)
		sum := sha256.Sum256([]byte("sealed"))
		if err != nil || hash != hex.EncodeToString(sum[:]) {
			t.Fatal("sealed file hash mismatch", err)
		}
		if _, err = writerFileHash(context.Background(), file, 3); err == nil {
			t.Fatal("size limit bypassed")
		}
		os.Chmod(file, 0666)
		if _, err = writerFileHash(context.Background(), file, 64); err == nil {
			t.Fatal("writable file trusted")
		}
		os.Chmod(file, 0600)
		linked := filepath.Join(dir, "link")
		os.Symlink(file, linked)
		if _, err = writerFileHash(context.Background(), linked, 64); err == nil {
			t.Fatal("linked config trusted")
		}
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		if _, err = writerFileHash(ctx, file, 64); err == nil {
			t.Fatal("cancellation ignored")
		}
	}
	status := filepath.Join(dir, "status")
	for _, test := range []struct {
		Text       string
		Privileged bool
		Valid      bool
	}{
		{"Uid:\t1000\t1000\t1000\t1000\nCapPrm:\t0000000000000000\n", false, true},
		{"Uid:\t1000\t0\t1000\t1000\nCapPrm:\t0000000000000000\n", true, true},
		{"Uid:\t1000\t1000\t1000\t1000\nCapPrm:\t0000000000000001\n", true, true},
		{"Uid:\t0\t0\t0\t0\n", false, false},
		{"Uid:\t0\t0\t0\t0\nCapPrm:\tINVALID\n", false, false},
	} {
		os.WriteFile(status, []byte(test.Text), 0600)
		result, err := writerProcessAuthority(status)
		if (err == nil) != test.Valid || (err == nil && result != test.Privileged) {
			t.Fatal("process authority parsed incorrectly")
		}
	}
	os.WriteFile(status, []byte("Uid:\t1000\t1000\t1000\t1000\nGid:\t1000\t1000\t1000\t1000\nGroups:\t1000 1234\nCapPrm:\t0000000000000000\n"), 0600)
	groupAuthority, err := writerProcessAuthorityGroups(status, map[uint64]bool{1234: true})
	if err != nil || !groupAuthority {
		t.Fatal("non-root Incus management group bypassed inventory")
	}
}

func TestWriterAuditReadsActualProcAndRefusesUnknownLocalWriters(t *testing.T) {
	if os.Geteuid() != 0 {
		t.Skip("root read-only audit")
	}
	policy := WriterAuditPolicy{1, map[string]string{"/usr/lib/systemd/systemd": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
		map[string]string{"/etc/crontab": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "/etc/anacrontab": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "/etc/ssh/sshd_config": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
		[]string{"/etc/cron.d", "/var/spool/cron", "/etc/systemd/system", "/usr/lib/systemd/system", "/run/systemd/system"}}
	result, err := ReadLocalWriterAudit(context.Background(), policy)
	if result.Complete {
		t.Fatal("unreviewed live host declared complete")
	}
	if result.ProcessesChecked < 1 || result.UnknownPrivilegedProcesses < 1 {
		t.Fatal("unknown real privileged processes not collected before configuration failure")
	}
	if err == nil && result.UnknownPrivilegedProcesses == 0 && result.ConfigurationIntact && result.ScheduledWriterEntries == 0 {
		t.Fatal("live root/schedules not inspected")
	}
	ids, err := writerProcessIDs()
	if err != nil || len(ids) == 0 {
		t.Fatal("actual process IDs not inventoried")
	}
	self, err := writerProcessAuthority("/proc/self/status")
	if err != nil || !self {
		t.Fatal("actual root process authority not read")
	}
}
