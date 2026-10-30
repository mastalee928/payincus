package controllerconfig

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

type failedProcessStatReader struct{ err error }

func (reader failedProcessStatReader) Read([]byte) (int, error) { return 0, reader.err }

func TestProcessStatReadErrorsPreserveCause(t *testing.T) {
	for _, cause := range []error{syscall.ESRCH, syscall.EIO, syscall.EACCES} {
		_, err := readProcessStatContents(failedProcessStatReader{cause}, 0)
		if !errors.Is(err, cause) {
			t.Fatalf("stat read error changed: %v", err)
		}
		if disappearedProcess(err) != (cause == syscall.ESRCH) {
			t.Fatalf("read error misclassified as process exit: %v", err)
		}
	}
}

func TestProcessAuditActualExitDuringStatRead(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	child := exec.CommandContext(ctx, "sleep", "30")
	if err := child.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = child.Process.Kill(); _ = child.Wait() }()
	path := filepath.Join("/proc", fmt.Sprint(child.Process.Pid), "stat")
	file, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	if err := child.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	_ = child.Wait()
	_, err = readProcessStatContents(file, uint32(os.Geteuid()))
	if !disappearedProcess(err) {
		t.Fatalf("exited process read did not preserve exit cause: %v", err)
	}
}

func TestReadProcessStatBoundaries(t *testing.T) {
	path := filepath.Join(t.TempDir(), "stat")
	fields := make([]string, 20)
	for i := range fields {
		fields[i] = "0"
	}
	fields[0], fields[1], fields[19] = "S", "1", "42"
	if err := os.WriteFile(path, []byte("123 (worker (name)) "+strings.Join(fields, " ")), 0600); err != nil {
		t.Fatal(err)
	}
	row, err := readProcessStat(path)
	if err != nil || row.PID != 123 || row.ParentPID != 1 || row.StartTicks != 42 || row.Name != "worker (name)" || row.UID != uint32(os.Geteuid()) {
		t.Fatalf("stat identity changed: %+v %v", row, err)
	}
	for _, raw := range []string{"invalid", strings.Repeat("x", 4097)} {
		if err := os.WriteFile(path, []byte(raw), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := readProcessStat(path); ErrorCode(err) != "CONTROLLER_PROCESS_AUDIT_INVALID" {
			t.Fatalf("invalid stat accepted: %v", err)
		}
	}
	if _, err := readProcessStat(filepath.Dir(path)); ErrorCode(err) != "CONTROLLER_PROCESS_AUDIT_INVALID" {
		t.Fatalf("directory stat accepted: %v", err)
	}
	if _, err := readProcessStat(path + "-missing"); !disappearedProcess(err) {
		t.Fatalf("missing stat error lost: %v", err)
	}
}

func TestProcessAuditExitRacesStayIncomplete(t *testing.T) {
	for _, pass := range []string{"first", "recheck"} {
		for _, cause := range []error{os.ErrNotExist, syscall.ESRCH} {
			t.Run(pass+cause.Error(), func(t *testing.T) {
				reads := 0
				result, err := inspectLocalProcessAudit(context.Background(), func(int) ([]string, error) {
					return []string{"1", "2", "net", "01"}, io.EOF
				}, func(path string) (ProcessSnapshot, error) {
					if path == "/proc/1/stat" {
						return ProcessSnapshot{PID: 1, Name: "init", StartTicks: 1}, nil
					}
					reads++
					if pass == "first" || reads == 2 {
						return ProcessSnapshot{}, &os.PathError{Op: "read", Path: path, Err: cause}
					}
					return ProcessSnapshot{PID: 2, ParentPID: 1, Name: "worker", StartTicks: 2}, nil
				})
				if err != nil || result.StableSnapshot || result.LocalWriterAuditComplete || result.ObservedProcesses < 1 {
					t.Fatalf("exit race became clean evidence: %+v %v", result, err)
				}
			})
		}
	}
}

func TestProcessAuditFailuresStayClosedAndRedacted(t *testing.T) {
	for _, phase := range []string{"list", "first", "recheck"} {
		for _, cause := range []error{syscall.EACCES, syscall.EPERM, syscall.EIO, failure("CONTROLLER_PROCESS_AUDIT_INVALID")} {
			t.Run(phase+cause.Error(), func(t *testing.T) {
				reads := 0
				_, err := inspectLocalProcessAudit(context.Background(), func(int) ([]string, error) {
					if phase == "list" {
						return nil, &os.PathError{Op: "read", Path: "private-fixture-path", Err: cause}
					}
					return []string{"1"}, io.EOF
				}, func(string) (ProcessSnapshot, error) {
					reads++
					if phase == "first" || reads == 2 {
						return ProcessSnapshot{}, &os.PathError{Op: "read", Path: "private-fixture-path", Err: cause}
					}
					return ProcessSnapshot{PID: 1, Name: "init", StartTicks: 1}, nil
				})
				expectedPhase := map[string]string{"list": "list-processes", "first": "first-stat", "recheck": "recheck-stat"}[phase]
				expectedReason := "io"
				if cause == syscall.EACCES || cause == syscall.EPERM {
					expectedReason = "permission"
				}
				if ErrorCode(cause) == "CONTROLLER_PROCESS_AUDIT_INVALID" {
					expectedReason = "invalid-stat"
				}
				if ErrorCode(err) != "CONTROLLER_PROCESS_AUDIT_IO" || err.Error() != "CONTROLLER_PROCESS_AUDIT_IO: phase="+expectedPhase+" reason="+expectedReason {
					t.Fatalf("invalid or unredacted diagnostic: %v", err)
				}
			})
		}
	}
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := inspectLocalProcessAudit(cancelled, func(int) ([]string, error) { t.Fatal("cancelled audit listed processes"); return nil, io.EOF }, func(string) (ProcessSnapshot, error) {
		t.Fatal("cancelled audit read a process")
		return ProcessSnapshot{}, nil
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation changed: %v", err)
	}
}

func TestProcessAuditIdentityChangesStayIncomplete(t *testing.T) {
	baseline := ProcessSnapshot{PID: 1, Name: "init", StartTicks: 1}
	for _, changed := range []ProcessSnapshot{
		{PID: 2, Name: "init", StartTicks: 1},
		{PID: 1, ParentPID: 2, Name: "init", StartTicks: 1},
		{PID: 1, Name: "changed", StartTicks: 1},
		{PID: 1, Name: "init", StartTicks: 2},
		{PID: 1, UID: 1, Name: "init", StartTicks: 1},
	} {
		reads := 0
		result, err := inspectLocalProcessAudit(context.Background(), func(int) ([]string, error) { return []string{"1"}, io.EOF }, func(string) (ProcessSnapshot, error) {
			reads++
			if reads == 1 {
				return baseline, nil
			}
			return changed, nil
		})
		if err != nil || result.StableSnapshot || result.LocalWriterAuditComplete {
			t.Fatalf("changed identity became clean: %+v %v", result, err)
		}
	}
	_, err := inspectLocalProcessAudit(context.Background(), func(int) ([]string, error) { return []string{"1"}, io.EOF }, func(string) (ProcessSnapshot, error) { return ProcessSnapshot{PID: 2}, nil })
	if ErrorCode(err) != "CONTROLLER_PROCESS_AUDIT_IO" || !strings.Contains(err.Error(), "phase=first-stat reason=invalid-stat") {
		t.Fatalf("PID mismatch diagnostic changed: %v", err)
	}
}

func TestReadActualProcAuditAndCancellation(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	result, err := ReadLocalProcessAudit(ctx)
	if err != nil || result.ObservedProcesses < 1 || result.LocalWriterAuditComplete {
		t.Fatalf("actual audit=%+v err=%v", result, err)
	}
	cancelled, stop := context.WithCancel(context.Background())
	stop()
	if _, err = ReadLocalProcessAudit(cancelled); err == nil {
		t.Fatal("cancelled audit accepted")
	}
}
