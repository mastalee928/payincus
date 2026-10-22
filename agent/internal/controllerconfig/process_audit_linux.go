package controllerconfig

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"syscall"
)

func readProcessStat(path string) (ProcessSnapshot, error) {
	file, err := os.Open(path)
	if err != nil {
		return ProcessSnapshot{}, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		return ProcessSnapshot{}, failure("CONTROLLER_PROCESS_AUDIT_INVALID")
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return ProcessSnapshot{}, failure("CONTROLLER_PROCESS_AUDIT_INVALID")
	}
	raw, err := io.ReadAll(io.LimitReader(file, 4097))
	if err != nil || len(raw) > 4096 {
		return ProcessSnapshot{}, failure("CONTROLLER_PROCESS_AUDIT_INVALID")
	}
	row, err := parseProcessStat(string(raw))
	row.UID = stat.Uid
	return row, err
}

// ReadLocalProcessAudit inventories the actual /proc filesystem with two
// passes. Permission/format failures cannot be interpreted as no sessions.
func ReadLocalProcessAudit(ctx context.Context) (ProcessAudit, error) {
	file, err := os.Open("/proc")
	if err != nil {
		return ProcessAudit{}, failure("CONTROLLER_PROCESS_AUDIT_IO")
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.IsDir() {
		return ProcessAudit{}, failure("CONTROLLER_PROCESS_AUDIT_IO")
	}
	var filesystem syscall.Statfs_t
	if syscall.Fstatfs(int(file.Fd()), &filesystem) != nil || filesystem.Type != 0x9fa0 {
		return ProcessAudit{}, failure("CONTROLLER_PROCESS_AUDIT_IO")
	}
	rows := []ProcessSnapshot{}
	stable := true
	for {
		names, err := file.Readdirnames(256)
		if err != nil && err != io.EOF {
			return ProcessAudit{}, failure("CONTROLLER_PROCESS_AUDIT_IO")
		}
		for _, name := range names {
			if ctx.Err() != nil {
				return ProcessAudit{}, ctx.Err()
			}
			pid, parseErr := strconv.Atoi(name)
			if parseErr != nil || pid < 1 || strconv.Itoa(pid) != name {
				continue
			}
			row, readErr := readProcessStat(filepath.Join("/proc", name, "stat"))
			if os.IsNotExist(readErr) {
				stable = false
				continue
			}
			if readErr != nil || row.PID != pid {
				return ProcessAudit{}, failure("CONTROLLER_PROCESS_AUDIT_IO")
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
		current, err := readProcessStat(filepath.Join("/proc", strconv.Itoa(row.PID), "stat"))
		if os.IsNotExist(err) {
			stable = false
			continue
		}
		if err != nil {
			return ProcessAudit{}, failure("CONTROLLER_PROCESS_AUDIT_IO")
		}
		if current.PID != row.PID || current.ParentPID != row.ParentPID || current.StartTicks != row.StartTicks || current.Name != row.Name || current.UID != row.UID {
			stable = false
		}
	}
	result, err := inspectProcessSnapshots(rows)
	result.StableSnapshot = result.StableSnapshot && stable
	return result, err
}
