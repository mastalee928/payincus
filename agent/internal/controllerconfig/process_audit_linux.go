package controllerconfig

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"syscall"
)

func disappearedProcess(err error) bool {
	// procfs can return ESRCH while a task exits after its stat file is opened.
	// This is incomplete evidence, just like ENOENT, never a clean snapshot.
	return os.IsNotExist(err) || errors.Is(err, syscall.ESRCH)
}

func processAuditIO(phase string, err error) error {
	reason := "io"
	switch {
	case err == nil:
		reason = "invalid-filesystem"
	case errors.Is(err, syscall.EACCES), errors.Is(err, syscall.EPERM):
		reason = "permission"
	case disappearedProcess(err):
		reason = "process-exited"
	case ErrorCode(err) == "CONTROLLER_PROCESS_AUDIT_INVALID":
		reason = "invalid-stat"
	}
	// Preserve the API error code. Only fixed phase/reason labels enter logs;
	// raw OS errors can contain process names or other untrusted path content.
	return fmt.Errorf("%w: phase=%s reason=%s", failure("CONTROLLER_PROCESS_AUDIT_IO"), phase, reason)
}

func readProcessStat(path string) (ProcessSnapshot, error) {
	file, err := os.Open(path)
	if err != nil {
		return ProcessSnapshot{}, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return ProcessSnapshot{}, err
	}
	if !info.Mode().IsRegular() {
		return ProcessSnapshot{}, failure("CONTROLLER_PROCESS_AUDIT_INVALID")
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return ProcessSnapshot{}, failure("CONTROLLER_PROCESS_AUDIT_INVALID")
	}
	return readProcessStatContents(file, stat.Uid)
}

func readProcessStatContents(reader io.Reader, uid uint32) (ProcessSnapshot, error) {
	raw, err := io.ReadAll(io.LimitReader(reader, 4097))
	if err != nil {
		return ProcessSnapshot{}, err
	}
	if len(raw) > 4096 {
		return ProcessSnapshot{}, failure("CONTROLLER_PROCESS_AUDIT_INVALID")
	}
	row, err := parseProcessStat(string(raw))
	row.UID = uid
	return row, err
}

// ReadLocalProcessAudit inventories the actual /proc filesystem with two
// passes. Permission/format failures cannot be interpreted as no sessions.
func ReadLocalProcessAudit(ctx context.Context) (ProcessAudit, error) {
	if err := ctx.Err(); err != nil {
		return ProcessAudit{}, err
	}
	file, err := os.Open("/proc")
	if err != nil {
		return ProcessAudit{}, processAuditIO("open-proc", err)
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.IsDir() {
		return ProcessAudit{}, processAuditIO("stat-proc", err)
	}
	var filesystem syscall.Statfs_t
	if err := syscall.Fstatfs(int(file.Fd()), &filesystem); err != nil {
		return ProcessAudit{}, processAuditIO("verify-proc-filesystem", err)
	}
	if filesystem.Type != 0x9fa0 {
		return ProcessAudit{}, processAuditIO("verify-proc-filesystem", nil)
	}
	return inspectLocalProcessAudit(ctx, file.Readdirnames, readProcessStat)
}

func inspectLocalProcessAudit(ctx context.Context, readNames func(int) ([]string, error), readStat func(string) (ProcessSnapshot, error)) (ProcessAudit, error) {
	rows := []ProcessSnapshot{}
	stable := true
	for {
		if err := ctx.Err(); err != nil {
			return ProcessAudit{}, err
		}
		names, err := readNames(256)
		if err != nil && err != io.EOF {
			return ProcessAudit{}, processAuditIO("list-processes", err)
		}
		for _, name := range names {
			if ctx.Err() != nil {
				return ProcessAudit{}, ctx.Err()
			}
			pid, parseErr := strconv.Atoi(name)
			if parseErr != nil || pid < 1 || strconv.Itoa(pid) != name {
				continue
			}
			row, readErr := readStat(filepath.Join("/proc", name, "stat"))
			if disappearedProcess(readErr) {
				stable = false
				continue
			}
			if readErr != nil {
				return ProcessAudit{}, processAuditIO("first-stat", readErr)
			}
			if row.PID != pid {
				return ProcessAudit{}, processAuditIO("first-stat", failure("CONTROLLER_PROCESS_AUDIT_INVALID"))
			}
			rows = append(rows, row)
			if len(rows) > 32768 {
				return ProcessAudit{}, failure("CONTROLLER_PROCESS_AUDIT_CAPACITY")
			}
		}
		if err == io.EOF {
			break
		}
	}
	for _, row := range rows {
		if ctx.Err() != nil {
			return ProcessAudit{}, ctx.Err()
		}
		current, err := readStat(filepath.Join("/proc", strconv.Itoa(row.PID), "stat"))
		if disappearedProcess(err) {
			stable = false
			continue
		}
		if err != nil {
			return ProcessAudit{}, processAuditIO("recheck-stat", err)
		}
		if current.PID != row.PID || current.ParentPID != row.ParentPID || current.StartTicks != row.StartTicks || current.Name != row.Name || current.UID != row.UID {
			stable = false
		}
	}
	result, err := inspectProcessSnapshots(rows)
	result.StableSnapshot = result.StableSnapshot && stable
	return result, err
}
