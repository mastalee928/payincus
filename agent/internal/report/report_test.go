package report

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestCPUStatDoesNotDoubleCountGuestTime(t *testing.T) {
	before, ok := parseCPUStatLine("cpu  100 50 25 100 10 5 5 5 80 20")
	if !ok || before.total != 300 || before.idle != 110 {
		t.Fatalf("bad initial CPU accounting: %#v %t", before, ok)
	}
	after, ok := parseCPUStatLine("cpu  150 70 45 110 15 10 10 10 130 40")
	if !ok || after.total != 420 || after.idle != 125 {
		t.Fatalf("guest CPU time was counted twice: %#v %t", after, ok)
	}
	used := roundPercent(float64((after.total-before.total)-(after.idle-before.idle)) / float64(after.total-before.total) * 100)
	if used != 87.5 {
		t.Fatalf("incorrect CPU percent after guest correction: %.1f", used)
	}
	for _, bad := range []string{"cpu", "cpu 1 2 3", "cpu 1 two 3 4", "cpu0 1 2 3 4", "cpu 18446744073709551615 1 1 1"} {
		if _, ok := parseCPUStatLine(bad); ok {
			t.Fatalf("accepted invalid /proc/stat sample %q", bad)
		}
	}
	basic, ok := parseCPUStatLine("cpu 10 20 30 40")
	if !ok || basic.total != 100 || basic.idle != 40 {
		t.Fatalf("old 4-field Linux sample rejected: %#v %t", basic, ok)
	}
}

func TestCPUUsageRejectsCounterRegression(t *testing.T) {
	for _, sample := range []struct{ before, after cpuStat }{
		{cpuStat{idle: 100, total: 200}, cpuStat{idle: 110, total: 190}},
		{cpuStat{idle: 100, total: 200}, cpuStat{idle: 90, total: 220}},
		{cpuStat{idle: 100, total: 200}, cpuStat{idle: 100, total: 200}},
		{cpuStat{idle: 100, total: 200}, cpuStat{idle: 150, total: 220}},
	} {
		if got := cpuUsagePercent(sample.before, sample.after); got != -1 {
			t.Fatalf("invalid CPU observation produced usage %v: %+v", got, sample)
		}
	}
	if got := cpuUsagePercent(cpuStat{idle: 100, total: 200}, cpuStat{idle: 110, total: 240}); got != 75 {
		t.Fatalf("valid CPU observation rejected: %v", got)
	}
}

func TestIncusDetectionRequiresUnixSocket(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "incus.socket")
	prior := incusSocketCandidates
	incusSocketCandidates = []string{path}
	defer func() { incusSocketCandidates = prior }()
	if err := os.WriteFile(path, []byte("not a socket"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, ok := detectIncusSocket(); ok {
		t.Fatal("ordinary file was accepted as Incus socket")
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	if got, ok := detectIncusSocket(); !ok || got != path {
		t.Fatalf("real Unix socket was not detected: %q %t", got, ok)
	}
}

func TestIncusCollectionHonorsCancellationAndTotalDeadline(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "incus.socket")
	listener, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	prior := incusSocketCandidates
	incusSocketCandidates = []string{path}
	defer func() { incusSocketCandidates = prior; listener.Close() }()
	const total = 40
	var stateRequests atomic.Int32
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/1.0/instances" {
			items := make([]map[string]any, total)
			for i := range items {
				items[i] = map[string]any{"name": fmt.Sprintf("vm-%d", i), "status": "Running", "status_code": 103}
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"type": "sync", "metadata": items})
			return
		}
		if strings.HasSuffix(r.URL.Path, "/state") {
			stateRequests.Add(1)
			select {
			case <-r.Context().Done():
			case <-time.After(time.Second):
				_, _ = io.WriteString(w, `{"type":"sync","metadata":{"status":"Running","network":{}}}`)
			}
		}
	})}
	defer server.Close()
	go func() { _ = server.Serve(listener) }()
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Millisecond)
	defer cancel()
	started := time.Now()
	report := collectIncusInstanceReport(ctx)
	if time.Since(started) > 700*time.Millisecond {
		t.Fatal("collection ignored the shared deadline")
	}
	if report["available"] != false || report["truncated"] != true || !strings.Contains(fmt.Sprint(report["error"]), "deadline") {
		t.Fatalf("partial collection was reported as complete: %#v", report)
	}
	if stateRequests.Load() > incusStateConcurrency+2 {
		t.Fatalf("workers continued requesting after cancellation: %d", stateRequests.Load())
	}
	canceled, stop := context.WithCancel(context.Background())
	stop()
	if result := HeartbeatPayload(canceled, "fixture", 60)["instances"].(map[string]any); result["available"] != false {
		t.Fatalf("shutdown context did not reach collection: %#v", result)
	}
}

func TestIncusPartialStateFailureIsMarkedIncomplete(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "incus.socket")
	listener, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	prior := incusSocketCandidates
	incusSocketCandidates = []string{path}
	defer func() { incusSocketCandidates = prior; listener.Close() }()
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/1.0/instances" {
			_, _ = io.WriteString(w, `{"type":"sync","metadata":[{"name":"vm-1","status":"Running","status_code":103}]}`)
			return
		}
		w.WriteHeader(http.StatusServiceUnavailable)
	})}
	defer server.Close()
	go func() { _ = server.Serve(listener) }()
	report := collectIncusInstanceReport(context.Background())
	if report["available"] != true || report["truncated"] != true || report["error"] == nil {
		t.Fatalf("partial state report appeared complete: %#v", report)
	}
	items := report["items"].([]any)
	if len(items) != 1 || items[0].(map[string]any)["name"] != "vm-1" || items[0].(map[string]any)["error"] == nil {
		t.Fatalf("state failure lost its instance identity: %#v", items)
	}
}

func TestHeartbeatPayloadIncludesHostMetrics(t *testing.T) {
	payload := HeartbeatPayload(context.Background(), "test-version", 30)

	capabilities, ok := payload["capabilities"].([]any)
	if !ok {
		t.Fatalf("capabilities missing or invalid: %#v", payload["capabilities"])
	}
	if !containsCapability(capabilities, "host-metrics") {
		t.Fatalf("host-metrics capability missing: %#v", capabilities)
	}
	if !containsCapability(capabilities, "instance-status") {
		t.Fatalf("instance-status capability missing: %#v", capabilities)
	}
	if !containsCapability(capabilities, "traffic-counters") {
		t.Fatalf("traffic-counters capability missing: %#v", capabilities)
	}

	instances, ok := payload["instances"].(map[string]any)
	if !ok {
		t.Fatalf("instances report missing or invalid: %#v", payload["instances"])
	}
	for _, key := range []string{"available", "reportedAt", "total", "items"} {
		if _, ok := instances[key]; !ok {
			t.Fatalf("instances key %s missing: %#v", key, instances)
		}
	}

	runtimeInfo, ok := payload["runtime"].(map[string]any)
	if !ok {
		t.Fatalf("runtime missing or invalid: %#v", payload["runtime"])
	}
	for _, key := range []string{"goos", "goarch"} {
		if _, ok := runtimeInfo[key]; !ok {
			t.Fatalf("runtime key %s missing: %#v", key, runtimeInfo)
		}
	}

	resources, ok := payload["resources"].(map[string]any)
	if !ok {
		t.Fatalf("resources missing or invalid: %#v", payload["resources"])
	}
	for _, key := range []string{
		"cpuTotal",
		"swapTotalMb",
		"swapUsedMb",
		"swapUsagePercent",
		"diskTotalBytes",
		"diskUsedBytes",
		"diskUsagePercent",
	} {
		if _, ok := resources[key]; !ok {
			t.Fatalf("resource key %s missing: %#v", key, resources)
		}
	}
	if runtime.GOOS == "linux" {
		for _, key := range []string{
			"cpuUsagePercent",
			"memoryTotalMb",
			"memoryUsedMb",
			"memoryUsagePercent",
			"processCount",
		} {
			if _, ok := resources[key]; !ok {
				t.Fatalf("linux resource key %s missing: %#v", key, resources)
			}
		}
	}

	metrics, ok := payload["metrics"].(map[string]any)
	if !ok {
		t.Fatalf("metrics missing or invalid: %#v", payload["metrics"])
	}
	for _, key := range []string{"reportedAt", "heartbeatIntervalSeconds"} {
		if _, ok := metrics[key]; !ok {
			t.Fatalf("metric key %s missing: %#v", key, metrics)
		}
	}
	if runtime.GOOS == "linux" {
		for _, key := range []string{"uptimeSeconds", "load1", "load5", "load15"} {
			if _, ok := metrics[key]; !ok {
				t.Fatalf("linux metric key %s missing: %#v", key, metrics)
			}
		}
	}
	if metrics["heartbeatIntervalSeconds"] != 30 {
		t.Fatalf("heartbeat interval mismatch: %#v", metrics["heartbeatIntervalSeconds"])
	}
}

func TestHeartbeatPayloadClampsHeartbeatInterval(t *testing.T) {
	tests := []struct {
		name     string
		input    int
		expected int
	}{
		{name: "zero falls back", input: 0, expected: 60},
		{name: "too low clamps to min", input: 1, expected: 30},
		{name: "too high clamps to max", input: 7200, expected: 3600},
		{name: "valid stays unchanged", input: 60, expected: 60},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			payload := HeartbeatPayload(context.Background(), "test-version", tt.input)
			metrics, ok := payload["metrics"].(map[string]any)
			if !ok {
				t.Fatalf("metrics missing or invalid: %#v", payload["metrics"])
			}
			if metrics["heartbeatIntervalSeconds"] != tt.expected {
				t.Fatalf("heartbeat interval mismatch: got=%#v want=%d", metrics["heartbeatIntervalSeconds"], tt.expected)
			}
		})
	}
}

func TestRunningIncusStatusDetection(t *testing.T) {
	tests := []struct {
		name       string
		status     string
		statusCode int
		expected   bool
	}{
		{name: "running string", status: "Running", statusCode: 0, expected: true},
		{name: "running status code", status: "", statusCode: 103, expected: true},
		{name: "stopped", status: "Stopped", statusCode: 102, expected: false},
		{name: "empty", status: "", statusCode: 0, expected: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isRunningIncusStatus(tt.status, tt.statusCode); got != tt.expected {
				t.Fatalf("running status mismatch: got=%t want=%t", got, tt.expected)
			}
		})
	}
}

func TestTrafficCountersFromIncusStateUsesBillableInterfaces(t *testing.T) {
	state := incusInstanceState{
		Network: map[string]incusNetworkDevice{
			"lo": {
				Counters: incusNetworkCounters{
					BytesReceived: "999",
					BytesSent:     "999",
				},
			},
			"eth0": {
				Counters: incusNetworkCounters{
					BytesReceived: "100",
					BytesSent:     "200",
				},
			},
			"docker0": {
				Counters: incusNetworkCounters{
					BytesReceived: "300",
					BytesSent:     "400",
				},
			},
		},
	}

	counters := getTrafficCountersFromIncusState("vm-test", state)
	if counters.rx != 100 || counters.tx != 200 {
		t.Fatalf("traffic counters mismatch: got=%+v", counters)
	}
}

func TestTrafficCountersFromIncusStateFallsBackToExternalInterfaces(t *testing.T) {
	state := incusInstanceState{
		Network: map[string]incusNetworkDevice{
			"lo": {
				Counters: incusNetworkCounters{
					BytesReceived: "999",
					BytesSent:     "999",
				},
			},
			"enp5s0": {
				Counters: incusNetworkCounters{
					BytesReceived: "123",
					BytesSent:     "456",
				},
			},
		},
	}

	counters := getTrafficCountersFromIncusState("vm-test", state)
	if counters.rx != 123 || counters.tx != 456 {
		t.Fatalf("traffic counters mismatch: got=%+v", counters)
	}
}

func containsCapability(capabilities []any, expected string) bool {
	for _, capability := range capabilities {
		if capability == expected {
			return true
		}
	}
	return false
}
