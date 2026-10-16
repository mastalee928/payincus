package main

import (
	"context"
	"flag"
	"log"
	"os"
	"os/signal"
	"sync/atomic"
	"syscall"
	"time"

	"incudal-agent/internal/config"
	"incudal-agent/internal/dedicatedipv6"
	"incudal-agent/internal/ingress"
	"incudal-agent/internal/panel"
	"incudal-agent/internal/report"
	"incudal-agent/internal/upgrade"
)

var version = "dev"
var lastPortProtocolStatus *ingress.Status

func main() {
	configPath := flag.String("config", "/etc/incudal-agent/config.yaml", "agent config file")
	once := flag.Bool("once", false, "send one heartbeat and exit")
	restoreIngress := flag.Bool("restore-port-protocol", false, "restore saved ingress policy")
	syncIPv6 := flag.Bool("sync-dedicated-ipv6", false, "reconcile managed dedicated IPv6 networking")
	flag.Parse()
	if *syncIPv6 {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		if err := dedicatedipv6.Reconcile(ctx); err != nil {
			log.Fatal(err)
		}
		return
	}
	if *restoreIngress {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		if err := ingress.Restore(ctx); err != nil {
			log.Fatal(err)
		}
		if err := dedicatedipv6.Restore(ctx); err != nil {
			log.Fatal(err)
		}
		return
	}

	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Fatalf("load config: %v", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := ingress.Restore(ctx); err != nil {
		log.Printf("restore ingress: %v", err)
	}
	if err := dedicatedipv6.Restore(ctx); err != nil {
		log.Printf("restore dedicated IPv6: %v", err)
	}
	// IPv6 recovery must work even while the panel or heartbeat is unavailable.
	go reconcileIPv6(ctx)
	client := panel.New(cfg)
	if *once {
		if _, err := sendHeartbeat(ctx, client, cfg.HeartbeatIntervalSeconds); err != nil {
			log.Fatalf("heartbeat: %v", err)
		}
		return
	}

	log.Printf("incudal-agent started: panel=%s interval=%s", cfg.PanelURL, cfg.HeartbeatInterval)
	upgradeRunner := upgrade.DefaultRunner(cfg)
	var upgradeInProgress atomic.Bool
	heartbeatLogState := newHeartbeatLogState()
	if result, err := sendHeartbeat(ctx, client, cfg.HeartbeatIntervalSeconds); err != nil {
		heartbeatLogState.logFailure(err)
	} else {
		heartbeatLogState.logSuccess(result)
		scheduleAgentUpgrade(ctx, upgradeRunner, result, &upgradeInProgress)
	}

	ticker := time.NewTicker(cfg.HeartbeatInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			log.Printf("incudal-agent stopped")
			return
		case <-ticker.C:
			if result, err := sendHeartbeat(ctx, client, cfg.HeartbeatIntervalSeconds); err != nil {
				heartbeatLogState.logFailure(err)
			} else {
				heartbeatLogState.logSuccess(result)
				scheduleAgentUpgrade(ctx, upgradeRunner, result, &upgradeInProgress)
			}
		}
	}
}

func reconcileIPv6(ctx context.Context) {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for {
		applyCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
		err := dedicatedipv6.Reconcile(applyCtx)
		cancel()
		if err != nil && ctx.Err() == nil {
			log.Printf("dedicated IPv6 reconciliation: %v", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func sendHeartbeat(ctx context.Context, client *panel.Client, heartbeatIntervalSeconds int) (panel.HeartbeatResult, error) {
	payload := report.HeartbeatPayload(version, heartbeatIntervalSeconds)
	if lastPortProtocolStatus != nil {
		payload["portProtocolStatus"] = *lastPortProtocolStatus
	}
	result, err := client.Heartbeat(ctx, payload)
	if err != nil {
		return result, err
	}
	if result.PortProtocol != nil {
		applyCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
		status := ingress.Apply(applyCtx, *result.PortProtocol)
		cancel()
		lastPortProtocolStatus = &status
		if !status.Applied {
			log.Printf("apply ingress: %s", status.Error)
		}
	}
	return result, nil
}

type heartbeatLogState struct {
	successCount   int64
	failureCount   int64
	lastSuccessLog time.Time
	lastFailureLog time.Time
}

func newHeartbeatLogState() *heartbeatLogState {
	return &heartbeatLogState{}
}

func (state *heartbeatLogState) logSuccess(result panel.HeartbeatResult) {
	state.successCount++
	upgradeAvailable := result.Upgrade != nil && result.Upgrade.Available
	now := time.Now()
	if state.successCount == 1 || upgradeAvailable || now.Sub(state.lastSuccessLog) >= 10*time.Minute {
		log.Printf("heartbeat ok: status=%d latencyMs=%d upgrade=%t count=%d", result.StatusCode, result.LatencyMs, upgradeAvailable, state.successCount)
		state.lastSuccessLog = now
	}
}

func (state *heartbeatLogState) logFailure(err error) {
	state.failureCount++
	now := time.Now()
	if state.failureCount == 1 || now.Sub(state.lastFailureLog) >= time.Minute {
		log.Printf("heartbeat failed: %v count=%d", err, state.failureCount)
		state.lastFailureLog = now
	}
}

func scheduleAgentUpgrade(ctx context.Context, runner *upgrade.Runner, result panel.HeartbeatResult, upgradeInProgress *atomic.Bool) {
	if result.Upgrade == nil || !result.Upgrade.Available || !upgrade.ShouldUpgrade(version, result.Upgrade.Version) {
		return
	}
	if !upgradeInProgress.CompareAndSwap(false, true) {
		log.Printf("agent upgrade already scheduled: version=%s", result.Upgrade.Version)
		return
	}

	instruction := *result.Upgrade
	log.Printf("agent upgrade scheduled: version=%s", instruction.Version)
	go func() {
		defer upgradeInProgress.Store(false)

		if delay := upgrade.RandomJitter(5 * time.Minute); delay > 0 {
			timer := time.NewTimer(delay)
			select {
			case <-ctx.Done():
				timer.Stop()
				return
			case <-timer.C:
			}
		}

		upgradeCtx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()
		if err := runner.Apply(upgradeCtx, instruction, version); err != nil {
			log.Printf("agent upgrade failed: version=%s error=%v", instruction.Version, err)
			return
		}
		log.Printf("agent upgrade applied: version=%s", instruction.Version)
	}()
}
