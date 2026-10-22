package controllerconfig

import (
	"strings"
	"testing"
)

func TestProcessAuditCountsSSHDescendantsWithoutClaimingNoLocalWriters(t *testing.T) {
	rows := []ProcessSnapshot{{PID: 1, Name: "init", StartTicks: 1}, {PID: 2, ParentPID: 1, Name: "sshd", StartTicks: 2}, {PID: 3, ParentPID: 2, Name: "sshd-session", StartTicks: 3}, {PID: 4, ParentPID: 3, Name: "bash", StartTicks: 4}, {PID: 5, ParentPID: 4, Name: "python3", StartTicks: 5}, {PID: 6, ParentPID: 1, Name: "detached-job", StartTicks: 6}}
	result, err := inspectProcessSnapshots(rows)
	if err != nil || result.SSHSessionProcesses != 3 || result.SSHListenerProcesses != 1 || !result.StableSnapshot || result.LocalWriterAuditComplete {
		t.Fatalf("audit=%+v err=%v", result, err)
	}
	rows[5].ParentPID = 99
	result, err = inspectProcessSnapshots(rows)
	if err != nil || result.StableSnapshot {
		t.Fatal("missing parent treated as complete snapshot")
	}
	rows[5].ParentPID = 6
	if _, err = inspectProcessSnapshots(rows); err == nil {
		t.Fatal("parent cycle accepted")
	}
}

func TestProcessStatHandlesParenthesesWithoutReadingSecrets(t *testing.T) {
	fields := make([]string, 21)
	for i := range fields {
		fields[i] = "0"
	}
	fields[0], fields[1], fields[19] = "S", "1", "42"
	row, err := parseProcessStat("123 (odd (name)) " + strings.Join(fields, " "))
	if err != nil || row.PID != 123 || row.ParentPID != 1 || row.Name != "odd (name)" || row.StartTicks != 42 {
		t.Fatalf("%+v %v", row, err)
	}
	for _, raw := range []string{"invalid", "1 (sshd) S 1", "0 (sshd) S 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1"} {
		if _, err := parseProcessStat(raw); err == nil {
			t.Fatal("invalid process accepted")
		}
	}
}
