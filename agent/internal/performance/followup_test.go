package performance

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"
)

func TestHostLoopRepairsAndKeepsHeartbeatAvailable(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	entered, release, done := make(chan struct{}), make(chan struct{}), make(chan struct{})
	checks := 0
	e := &Engine{persist: func(string, string) error { return nil }, run: func(ctx context.Context, name string, args ...string) ([]byte, error) {
		if name == "modprobe" || name == "depmod" {
			return nil, nil
		}
		if name != "sysctl" {
			t.Errorf("customer command %s", name)
			return nil, fmt.Errorf("wrong tool")
		}
		if strings.Contains(strings.Join(args, " "), "available") {
			checks++
			if checks == 1 {
				return nil, fmt.Errorf("temporarily unavailable")
			}
			close(entered)
			select {
			case <-release:
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}
		if args[0] == "-n" && !strings.Contains(strings.Join(args, " "), "available") {
			cancel()
		}
		return []byte("bbr"), nil
	}}
	go func() { e.runLoop(ctx, time.Millisecond); close(done) }()
	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		t.Fatal("failed host never retried")
	}
	read := make(chan Status, 1)
	go func() { read <- e.Status() }()
	select {
	case s := <-read:
		if s.Error != "BBR_CAPABILITY_UNAVAILABLE" {
			t.Fatal(s)
		}
	case <-time.After(time.Second):
		t.Fatal("heartbeat blocked")
	}
	close(release)
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("cancel ignored")
	}
	if !e.Status().HostApplied || checks != 2 {
		t.Fatal(e.Status())
	}
}

func TestHostOnlyStartupWiring(t *testing.T) {
	source, err := os.ReadFile("../../cmd/incudal-agent/main.go")
	if os.IsNotExist(err) {
		t.Skip("source checkout required")
	}
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(source), "go tcpPerformance.Run(ctx)") || !strings.Contains(string(source), "tcpPerformance.SetPoolHost") {
		t.Fatal("pool follow-up missing")
	}
	source, err = os.ReadFile("bbr.go")
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"nsenter", "namespaceCommand", "reconcileGuest", "incus", "netRun"} {
		if strings.Contains(string(source), forbidden) {
			t.Fatal("customer BBR path remains: " + forbidden)
		}
	}
}
