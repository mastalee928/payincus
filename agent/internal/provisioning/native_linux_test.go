//go:build linux

package provisioning

import (
	"context"
	"os"
	"testing"
	"time"
)

// Only run in a disposable container selected explicitly by the CI workflow.
func TestNativeRepairAndDrift(t *testing.T) {
	if os.Getenv("INCUDAL_PROVISIONING_NATIVE_TEST") != "disposable" {
		t.Skip("disposable Linux only")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	if err := repair(ctx); err != nil {
		t.Fatal("automatic package preparation", err)
	}
	if err := check(ctx); err != nil {
		t.Fatal("executable readiness", err)
	}
	p, err := systemTool("aa-exec")
	if err != nil {
		t.Fatal(err)
	}
	// A package can remain installed while its binary was lost. It must be
	// repaired automatically, not report ready or loop forever on apk add.
	if err = os.Remove(p); err != nil {
		t.Fatal(err)
	}
	if err = check(ctx); err == nil {
		t.Fatal("missing aa-exec accepted")
	}
	if err = repair(ctx); err != nil {
		t.Fatal("automatic drift repair", err)
	}
	if err = check(ctx); err != nil {
		t.Fatal("drift repair readiness", err)
	}
	if err = repair(ctx); err != nil {
		t.Fatal("idempotent preparation", err)
	}
}
