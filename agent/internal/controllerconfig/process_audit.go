package controllerconfig

import (
	"strconv"
	"strings"
)

// ProcessSnapshot intentionally excludes command lines and environment, which
// can carry credentials. Parent/start identities prevent PID reuse being
// mistaken for a stable observation. It is evidence, never authorization.
type ProcessSnapshot struct {
	PID        int
	ParentPID  int
	UID        uint32
	Name       string
	StartTicks uint64
}
type ProcessAudit struct {
	SSHSessionProcesses      int  `json:"sshSessionProcesses"`
	SSHListenerProcesses     int  `json:"sshListenerProcesses"`
	ObservedProcesses        int  `json:"observedProcesses"`
	StableSnapshot           bool `json:"stableSnapshot"`
	LocalWriterAuditComplete bool `json:"localWriterAuditComplete"`
}

func parseProcessStat(raw string) (ProcessSnapshot, error) {
	fail := func() (ProcessSnapshot, error) { return ProcessSnapshot{}, failure("CONTROLLER_PROCESS_AUDIT_INVALID") }
	start, end := strings.Index(raw, " ("), strings.LastIndex(raw, ") ")
	if start < 1 || end < start || len(raw) > 4096 {
		return fail()
	}
	pid, err := strconv.Atoi(raw[:start])
	if err != nil || pid < 1 {
		return fail()
	}
	name := raw[start+2 : end]
	if len(name) < 1 || len(name) > 256 || strings.ContainsAny(name, "\x00\r\n") {
		return fail()
	}
	fields := strings.Fields(raw[end+2:])
	if len(fields) < 20 || len(fields[0]) != 1 {
		return fail()
	}
	ppid, err := strconv.Atoi(fields[1])
	if err != nil || ppid < 0 {
		return fail()
	}
	ticks, err := strconv.ParseUint(fields[19], 10, 64)
	if err != nil {
		return fail()
	}
	return ProcessSnapshot{PID: pid, ParentPID: ppid, Name: name, StartTicks: ticks}, nil
}

func inspectProcessSnapshots(rows []ProcessSnapshot) (ProcessAudit, error) {
	result := ProcessAudit{ObservedProcesses: len(rows), StableSnapshot: true}
	if len(rows) > 32768 {
		return result, failure("CONTROLLER_PROCESS_AUDIT_CAPACITY")
	}
	byPID := make(map[int]ProcessSnapshot, len(rows))
	for _, row := range rows {
		if row.PID < 1 || row.ParentPID < 0 || row.Name == "" {
			return result, failure("CONTROLLER_PROCESS_AUDIT_INVALID")
		}
		if _, exists := byPID[row.PID]; exists {
			return result, failure("CONTROLLER_PROCESS_AUDIT_INVALID")
		}
		byPID[row.PID] = row
	}
	for _, row := range rows {
		seen := map[int]bool{}
		current := row
		session := false
		for hops := 0; current.ParentPID > 0; hops++ {
			if hops >= 1024 || seen[current.PID] {
				return result, failure("CONTROLLER_PROCESS_AUDIT_INVALID")
			}
			seen[current.PID] = true
			parent, exists := byPID[current.ParentPID]
			if !exists {
				result.StableSnapshot = false
				break
			}
			if current.Name == "sshd" || strings.HasPrefix(current.Name, "sshd-") {
				if parent.Name == "sshd" || strings.HasPrefix(parent.Name, "sshd-") {
					session = true
				}
			}
			current = parent
		}
		if session {
			result.SSHSessionProcesses++
		} else if row.Name == "sshd" || strings.HasPrefix(row.Name, "sshd-") {
			result.SSHListenerProcesses++
		}
	}
	// Parent chains cannot prove that a daemonized script stopped, and unrelated
	// root jobs need a dedicated managed-writer journal. Keep this explicitly
	// incomplete instead of inferring safety from an absence of SSH sessions.
	return result, nil
}
