//go:build linux

package guestguard

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"incudal-agent/internal/provisioning"
)

// Used only by the disposable CI Incus pool delivery test. The Node fixture
// consumes actual host firewall/tool execution receipts, not invented success.
func TestNativePoolDeliveryGuard(t *testing.T) {
	if os.Getenv("INCUDAL_POOL_DELIVERY_GUARD") != "disposable" {
		t.Skip("disposable Incus runner only")
	}
	report := os.Getenv("INCUDAL_POOL_GUARD_REPORT")
	stop := os.Getenv("INCUDAL_POOL_GUARD_STOP")
	if report == "" || stop == "" || !filepath.IsAbs(report) || filepath.Dir(report) != filepath.Dir(stop) {
		t.Fatal("private report directory required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Minute)
	defer cancel()
	tools := provisioning.New()
	tools.SetPoolHost(true)
	go tools.Run(ctx)
	guard := New()
	for ctx.Err() == nil {
		if _, err := os.Stat(stop); err == nil {
			return
		}
		err := guard.Sync(ctx, "http://192.0.2.20")
		data, marshalErr := json.Marshal(map[string]any{"guestProtectionStatus": guard.Status(), "hostProvisioningStatus": tools.Status()})
		if marshalErr != nil {
			t.Fatal(marshalErr)
		}
		if err == nil {
			if err = atomicWrite(report, data); err != nil {
				t.Fatal(err)
			}
		}
		select {
		case <-ctx.Done():
		case <-time.After(5 * time.Second):
		}
	}
	t.Fatal("native pool delivery guard deadline expired")
}
