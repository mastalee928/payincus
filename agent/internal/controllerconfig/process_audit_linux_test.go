package controllerconfig

import (
	"context"
	"testing"
	"time"
)

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
