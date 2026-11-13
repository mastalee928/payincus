//go:build linux

package provisioning

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"embed"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

//go:embed compat/README.txt
var compatibilityFiles embed.FS

type compatManifest struct {
	Purpose, IncusVersion, SourceSha256, Architecture, SHA256 string
	Size                                                      int64
}
type compatGuest struct {
	Name, Status string
	Config       map[string]string
}
type compatJournal struct {
	Version                 int
	OldHash, NewHash        string
	PID                     int
	ProcessStart            string
	RequestID, HostIdentity string
	Phase                   string
	Guests                  []compatGuest
}

const compatJournalPath = "/var/lib/incudal-agent/incus-compat.json"
const compatBackupPath = "/usr/sbin/incusd.incudal-before-sysinfo"

func validCompatPermit(p *CompatPermit) bool {
	if p == nil {
		return false
	}
	at, e := time.Parse(time.RFC3339Nano, p.ExpiresAt)
	if e != nil || !at.After(time.Now()) || !at.Before(time.Now().Add(5*time.Minute)) || !guestUUID.MatchString(p.RequestID) || len(p.HostIdentity) != 64 || len(p.Guests) > 1 {
		return false
	}
	for _, g := range p.Guests {
		if !guestName.MatchString(g.Name) || !guestUUID.MatchString(g.UUID) || (g.State != "Running" && g.State != "Stopped") {
			return false
		}
	}
	return true
}
func compatPermitGuests(p *CompatPermit, rows []compatGuest) bool {
	if len(p.Guests) != len(rows) {
		return false
	}
	for _, g := range p.Guests {
		found := false
		for _, r := range rows {
			if r.Name == g.Name && r.Config["volatile.uuid"] == g.UUID && r.Status == g.State {
				found = true
			}
		}
		if !found {
			return false
		}
	}
	return true
}
func incusCompatibilityStatus(ctx context.Context) (string, string, string) {
	r, e := releaseFile()
	if e != nil || !strings.Contains(r, "ID=alpine") && !strings.Contains(r, "ID=\"alpine\"") {
		return "", "", ""
	}
	var j compatJournal
	if b, e := os.ReadFile(compatJournalPath); e == nil && json.Unmarshal(b, &j) == nil {
		if j.Phase == "reloading" || j.Phase == "prepared" {
			return "pending", j.RequestID, j.NewHash
		}
	}
	data, e := compatibilityBinary()
	if e != nil {
		return "", "", ""
	}
	b, e := os.ReadFile("/usr/sbin/incusd")
	if e != nil {
		return "", "", ""
	}
	if compatHash(b) == compatHash(data) {
		if j.Phase == "verified" {
			return "verified", j.RequestID, compatHash(data)
		}
		return "needed", j.RequestID, compatHash(data)
	}
	raw, e := run(ctx, "incus", "query", "/1.0")
	if e != nil {
		return "", "", ""
	}
	var server struct {
		Environment struct {
			ServerVersion string `json:"server_version"`
		}
	}
	if json.Unmarshal(raw, &server) != nil || server.Environment.ServerVersion != "7.0.1" {
		return "", "", ""
	}
	return "needed", j.RequestID, compatHash(data)
}

func compatibilityBinary() ([]byte, error) {
	m, e := compatibilityFiles.ReadFile("compat/manifest-" + runtime.GOARCH + ".json")
	if e != nil {
		return nil, e
	}
	var manifest compatManifest
	arch := "x86_64"
	machine := uint16(62)
	if runtime.GOARCH == "arm64" {
		arch = "aarch64"
		machine = 183
	}
	if json.Unmarshal(m, &manifest) != nil || manifest.Purpose != "alpine-incus-sysinfo-compat" || manifest.IncusVersion != "7.0.1" || manifest.Architecture != arch || manifest.SourceSha256 != "5e415fa1684f0945d45ca780af6662f143b857681e18d29038725cde70c26ee6" || manifest.Size <= 0 || manifest.Size > 96*1024*1024 {
		return nil, fmt.Errorf("compatibility manifest invalid")
	}
	b, e := compatibilityFiles.ReadFile("compat/incusd-" + runtime.GOARCH + ".gz")
	if e != nil {
		return nil, e
	}
	reader, e := gzip.NewReader(bytes.NewReader(b))
	if e != nil {
		return nil, e
	}
	defer reader.Close()
	data, e := io.ReadAll(io.LimitReader(reader, manifest.Size+1))
	if e != nil {
		return nil, e
	}
	hash := sha256.Sum256(data)
	if int64(len(data)) != manifest.Size || len(data) < 20 || string(data[:4]) != "\x7fELF" || binary.LittleEndian.Uint16(data[18:20]) != machine || hex.EncodeToString(hash[:]) != manifest.SHA256 {
		return nil, fmt.Errorf("compatibility artifact invalid")
	}
	return data, nil
}
func compatHash(b []byte) string { s := sha256.Sum256(b); return hex.EncodeToString(s[:]) }
func saveCompatJournal(v compatJournal) error {
	b, e := json.Marshal(v)
	if e != nil {
		return e
	}
	f, e := os.CreateTemp(filepath.Dir(compatJournalPath), ".incus-compat-*")
	if e != nil {
		return e
	}
	defer os.Remove(f.Name())
	if e = f.Chmod(0600); e == nil {
		_, e = f.Write(b)
	}
	if e == nil {
		e = f.Sync()
	}
	f.Close()
	if e != nil {
		return e
	}
	return os.Rename(f.Name(), compatJournalPath)
}
func compatGuests(ctx context.Context) ([]compatGuest, error) {
	b, e := run(ctx, "incus", "list", "--format=json")
	if e != nil {
		return nil, e
	}
	var rows []compatGuest
	if json.Unmarshal(b, &rows) != nil {
		return nil, fmt.Errorf("compatibility guest list invalid")
	}
	for _, r := range rows {
		if !guestName.MatchString(r.Name) || !guestUUID.MatchString(r.Config["volatile.uuid"]) || r.Status != "Running" && r.Status != "Stopped" {
			return nil, fmt.Errorf("compatibility guest state waiting")
		}
	}
	return rows, nil
}
func sameCompatGuests(a, b []compatGuest) bool {
	if len(a) != len(b) {
		return false
	}
	for _, x := range a {
		found := false
		for _, y := range b {
			if x.Name == y.Name && x.Status == y.Status && x.Config["volatile.uuid"] == y.Config["volatile.uuid"] {
				found = true
			}
		}
		if !found {
			return false
		}
	}
	return true
}

// A newer expiry stop/delete may finish during a daemon reload. It cannot
// authorize a new guest or turn an originally stopped guest into Running.
func compatibleCurrentGuests(before, after []compatGuest) bool {
	for _, y := range after {
		found := false
		for _, x := range before {
			if x.Name == y.Name && x.Config["volatile.uuid"] == y.Config["volatile.uuid"] && (x.Status == y.Status || x.Status == "Running" && y.Status == "Stopped") {
				found = true
			}
		}
		if !found {
			return false
		}
	}
	return true
}
func replaceCompatBinary(data []byte) error {
	f, e := os.CreateTemp("/usr/sbin", ".incudal-incusd-*")
	if e != nil {
		return e
	}
	defer os.Remove(f.Name())
	if e = f.Chmod(0755); e == nil {
		_, e = f.Write(data)
	}
	if e == nil {
		e = f.Sync()
	}
	f.Close()
	if e != nil {
		return e
	}
	return os.Rename(f.Name(), "/usr/sbin/incusd")
}
func waitCompatDaemonExit(ctx context.Context, pid int, expectedStart string) error {
	for n := 0; n < 90; n++ {
		currentStart, readErr := compatProcessStart(pid)
		if readErr != nil || currentStart != expectedStart || syscall.Kill(pid, 0) != nil {
			return nil
		}
		if b, e := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid)); e == nil {
			at := strings.LastIndex(string(b), ") ")
			if at >= 0 && strings.HasPrefix(string(b)[at+2:], "Z ") {
				return nil
			}
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Second):
		}
	}
	return fmt.Errorf("compatibility graceful daemon exit waiting")
}

func compatProcessStart(pid int) (string, error) {
	b, e := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid))
	if e != nil {
		return "", e
	}
	s := string(b)
	at := strings.LastIndex(s, ") ")
	if at < 0 {
		return "", fmt.Errorf("compatibility process stat invalid")
	}
	f := strings.Fields(s[at+2:])
	if len(f) < 20 {
		return "", fmt.Errorf("compatibility process stat invalid")
	}
	return f[19], nil
}
func startCompatDaemon(ctx context.Context) error {
	// A prior attempt may have started the daemon before its receipt was saved.
	// Reuse that process rather than launching a second backend for Incus.
	if _, e := run(ctx, "incus", "query", "/1.0"); e == nil {
		return nil
	}
	// The old OpenRC runlevel marker survives a SIGTERM daemon reload.
	// Clear only its stale marker after the exact original PID has exited.
	if _, e := run(ctx, "rc-service", "incusd", "zap"); e != nil {
		return e
	}
	if _, e := run(ctx, "rc-service", "incusd", "start"); e != nil {
		return e
	}
	_, e := run(ctx, "incus", "admin", "waitready", "--timeout=60")
	return e
}
func prepareIncusCompatibility(ctx context.Context, permit *CompatPermit) error {
	if !validCompatPermit(permit) {
		return fmt.Errorf("compatibility permit expired")
	}
	release, e := releaseFile()
	if e != nil {
		return e
	}
	if !strings.Contains(release, "ID=alpine") && !strings.Contains(release, "ID=\"alpine\"") {
		return nil
	}
	unlock, e := lock()
	if e != nil {
		return e
	}
	defer unlock()
	var journal compatJournal
	if b, readErr := os.ReadFile(compatJournalPath); readErr == nil {
		if json.Unmarshal(b, &journal) != nil || journal.Version != 1 || len(journal.OldHash) != 64 || len(journal.NewHash) != 64 || journal.PID < 2 || journal.ProcessStart == "" || !strings.Contains("|prepared|reloading|verified|rolled-back|", "|"+journal.Phase+"|") {
			return fmt.Errorf("compatibility journal invalid")
		}
	} else if !os.IsNotExist(readErr) {
		return readErr
	}
	if journal.Phase != "" && (journal.RequestID != permit.RequestID || journal.HostIdentity != permit.HostIdentity) {
		return fmt.Errorf("compatibility journal authority changed")
	}
	if journal.Phase == "prepared" {
		old, e := os.ReadFile(compatBackupPath)
		if e != nil || compatHash(old) != journal.OldHash {
			return fmt.Errorf("compatibility prepared rollback invalid")
		}
		if e = replaceCompatBinary(old); e != nil {
			return e
		}
		journal.Phase = "rolled-back"
		return saveCompatJournal(journal)
	}
	if journal.Phase == "reloading" {
		if start, e := compatProcessStart(journal.PID); e == nil && start == journal.ProcessStart {
			if e = syscall.Kill(journal.PID, syscall.SIGTERM); e != nil {
				return e
			}
		}
		if e = waitCompatDaemonExit(ctx, journal.PID, journal.ProcessStart); e != nil {
			return e
		}
		installed, e := os.ReadFile("/usr/sbin/incusd")
		if e != nil || compatHash(installed) != journal.NewHash {
			return fmt.Errorf("compatibility reloading binary changed")
		}
		if e = startCompatDaemon(ctx); e != nil {
			return rollbackIncusCompatibility(ctx, journal)
		}
		rows, e := compatGuests(ctx)
		if e != nil || !compatibleCurrentGuests(journal.Guests, rows) {
			return fmt.Errorf("compatibility guest baseline not confirmed")
		}
		journal.Phase = "verified"
		return saveCompatJournal(journal)
	}
	if journal.Phase == "verified" {
		b, e := os.ReadFile("/usr/sbin/incusd")
		if e != nil {
			return e
		}
		if compatHash(b) == journal.NewHash {
			return nil
		}
		return fmt.Errorf("compatibility installed daemon drifted")
	}
	info, e := run(ctx, "incus", "query", "/1.0")
	if e != nil {
		return e
	}
	var server struct {
		Environment struct {
			ServerVersion string `json:"server_version"`
		}
	}
	if json.Unmarshal(info, &server) != nil {
		return fmt.Errorf("compatibility server read invalid")
	}
	if server.Environment.ServerVersion != "7.0.1" {
		return nil
	}
	data, e := compatibilityBinary()
	if e != nil {
		return e
	}
	installed, e := os.ReadFile("/usr/sbin/incusd")
	if e != nil {
		return e
	}
	if compatHash(installed) == compatHash(data) {
		rows, e := compatGuests(ctx)
		if e != nil {
			return e
		}
		pidData, e := os.ReadFile("/run/incus/incusd.pid")
		if e != nil {
			return e
		}
		pid, e := strconv.Atoi(strings.TrimSpace(string(pidData)))
		if e != nil {
			return e
		}
		start, e := compatProcessStart(pid)
		if e != nil {
			return e
		}
		return saveCompatJournal(compatJournal{Version: 1, OldHash: compatHash(installed), NewHash: compatHash(data), PID: pid, ProcessStart: start, RequestID: permit.RequestID, HostIdentity: permit.HostIdentity, Phase: "verified", Guests: rows})
	}
	operations, e := run(ctx, "incus", "query", "/1.0/operations?recursion=1")
	if e != nil {
		return e
	}
	var ops map[string][]json.RawMessage
	if json.Unmarshal(operations, &ops) != nil || len(ops["running"])+len(ops["pending"]) > 0 {
		return fmt.Errorf("compatibility waits for active operations")
	}
	guests, e := compatGuests(ctx)
	if e != nil {
		return e
	}
	if !compatPermitGuests(permit, guests) || !validCompatPermit(permit) {
		return fmt.Errorf("compatibility current guest authority changed")
	}
	pidData, e := os.ReadFile("/run/incus/incusd.pid")
	if e != nil {
		return e
	}
	pid, e := strconv.Atoi(strings.TrimSpace(string(pidData)))
	if e != nil || pid < 2 {
		return fmt.Errorf("compatibility daemon identity missing")
	}
	exe, e := filepath.EvalSymlinks(fmt.Sprintf("/proc/%d/exe", pid))
	if e != nil || exe != "/usr/sbin/incusd" {
		return fmt.Errorf("compatibility daemon changed")
	}
	if s, e := os.Lstat("/usr/sbin/incusd"); e != nil || !s.Mode().IsRegular() || s.Mode()&0022 != 0 || s.Sys().(*syscall.Stat_t).Uid != 0 {
		return fmt.Errorf("compatibility original binary unsafe")
	}
	temp, e := os.CreateTemp("/usr/sbin", ".incus-compat-library-check-*")
	if e != nil {
		return e
	}
	_, e = temp.Write(data)
	temp.Close()
	if e != nil {
		os.Remove(temp.Name())
		return e
	}
	_, e = run(ctx, "ldd", temp.Name())
	os.Remove(temp.Name())
	if e != nil {
		return fmt.Errorf("compatibility libraries unavailable")
	}
	if journal.Phase == "rolled-back" {
		b, e := os.ReadFile(compatBackupPath)
		if e != nil || compatHash(b) != journal.OldHash || compatHash(installed) != journal.OldHash {
			return fmt.Errorf("compatibility original rollback changed")
		}
		if e = os.Remove(compatBackupPath); e != nil {
			return e
		}
	}
	f, e := os.OpenFile(compatBackupPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0700)
	if e != nil {
		return e
	}
	_, e = f.Write(installed)
	if e == nil {
		e = f.Sync()
	}
	f.Close()
	if e != nil {
		return e
	}
	start, e := compatProcessStart(pid)
	if e != nil {
		return e
	}
	journal = compatJournal{Version: 1, OldHash: compatHash(installed), NewHash: compatHash(data), PID: pid, ProcessStart: start, RequestID: permit.RequestID, HostIdentity: permit.HostIdentity, Phase: "prepared", Guests: guests}
	if e = saveCompatJournal(journal); e != nil {
		return e
	}
	if e = replaceCompatBinary(data); e != nil {
		return e
	}
	journal.Phase = "reloading"
	if e = saveCompatJournal(journal); e != nil {
		return e
	}
	if current, e := compatProcessStart(pid); e != nil || current != start {
		return fmt.Errorf("compatibility daemon process changed")
	}
	if !validCompatPermit(permit) {
		return fmt.Errorf("compatibility permit expired before reload")
	}
	if e = syscall.Kill(pid, syscall.SIGTERM); e != nil {
		return e
	}
	if e = waitCompatDaemonExit(ctx, pid, start); e != nil {
		return e
	}
	if e = startCompatDaemon(ctx); e != nil {
		return rollbackIncusCompatibility(ctx, journal)
	}
	rows, e := compatGuests(ctx)
	if e != nil || !compatibleCurrentGuests(guests, rows) {
		return fmt.Errorf("compatibility guest baseline not confirmed")
	}
	journal.Phase = "verified"
	return saveCompatJournal(journal)
}
func rollbackIncusCompatibility(ctx context.Context, journal compatJournal) error {
	b, e := os.ReadFile(compatBackupPath)
	if e != nil || compatHash(b) != journal.OldHash {
		return fmt.Errorf("compatibility rollback identity invalid")
	}
	if e = replaceCompatBinary(b); e != nil {
		return e
	}
	if e = startCompatDaemon(ctx); e != nil {
		return e
	}
	rows, e := compatGuests(ctx)
	if e != nil || !compatibleCurrentGuests(journal.Guests, rows) {
		return fmt.Errorf("compatibility rollback baseline pending")
	}
	journal.Phase = "rolled-back"
	if e = saveCompatJournal(journal); e != nil {
		return e
	}
	return fmt.Errorf("compatibility rolled back; retry pending")
}
