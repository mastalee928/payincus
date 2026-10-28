package upgrade

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"incudal-agent/internal/config"
	"incudal-agent/internal/panel"
)

const (
	defaultServiceName      = "incudal-agent"
	defaultMaxDownloadBytes = 64 * 1024 * 1024
	serviceManagerTimeout   = 10 * time.Second
)

var ErrUpgradeInProgress = errors.New("agent upgrade already in progress")
var openRCServiceNamePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]*$`)
var systemdServiceNamePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.@-]*$`)

type RestartFunc func(ctx context.Context, serviceName string) error

type Runner struct {
	BinaryPath       string
	BackupPath       string
	LockPath         string
	ServiceName      string
	AllowedBaseURL   string
	HTTPClient       *http.Client
	Restart          RestartFunc
	MaxDownloadBytes int64
}

func DefaultRunner(cfg config.Config) *Runner {
	binaryPath, err := os.Executable()
	if err != nil || binaryPath == "" {
		binaryPath = "/usr/local/bin/incudal-agent"
	}

	return &Runner{
		BinaryPath:       binaryPath,
		BackupPath:       binaryPath + ".bak",
		LockPath:         defaultLockPath(),
		ServiceName:      defaultServiceName,
		AllowedBaseURL:   cfg.PanelURL,
		HTTPClient:       &http.Client{Timeout: cfg.RequestTimeout},
		Restart:          restartService,
		MaxDownloadBytes: defaultMaxDownloadBytes,
	}
}

func RandomJitter(max time.Duration) time.Duration {
	if max <= 0 {
		return 0
	}
	limit := big.NewInt(int64(max))
	value, err := rand.Int(rand.Reader, limit)
	if err != nil {
		return 0
	}
	return time.Duration(value.Int64())
}

func (runner *Runner) Apply(ctx context.Context, instruction panel.UpgradeInstruction, currentVersion string) error {
	if !instruction.Available {
		return nil
	}
	if instruction.Version == "" {
		return errors.New("upgrade version is required")
	}
	if !ShouldUpgrade(currentVersion, instruction.Version) {
		return nil
	}
	if instruction.URL == "" {
		return errors.New("upgrade URL is required")
	}
	if instruction.SHA256 == "" {
		return errors.New("upgrade sha256 is required")
	}
	if err := runner.validateUpgradeURL(instruction.URL); err != nil {
		return err
	}

	unlock, err := acquireLock(runner.lockPath())
	if err != nil {
		return err
	}
	defer unlock()

	packageBytes, err := runner.download(ctx, instruction.URL)
	if err != nil {
		return err
	}
	if err := verifySHA256(packageBytes, instruction.SHA256); err != nil {
		return err
	}

	binaryBytes := packageBytes
	if instruction.Gzip {
		binaryBytes, err = gunzip(packageBytes, runner.sizeLimit())
		if err != nil {
			return err
		}
	}

	tempPath, err := runner.writeTempBinary(binaryBytes)
	if err != nil {
		return err
	}
	if err := runner.replaceBinary(tempPath); err != nil {
		_ = os.Remove(tempPath)
		return err
	}

	if err := runner.restart(ctx); err != nil {
		return fmt.Errorf("restart agent after upgrade: %w", err)
	}
	return nil
}

func (runner *Runner) validateUpgradeURL(rawURL string) error {
	upgradeURL, err := url.Parse(rawURL)
	if err != nil || upgradeURL.Scheme == "" || upgradeURL.Host == "" {
		return fmt.Errorf("upgrade URL is invalid: %s", rawURL)
	}
	if upgradeURL.Scheme != "http" && upgradeURL.Scheme != "https" {
		return fmt.Errorf("upgrade URL scheme is not allowed: %s", upgradeURL.Scheme)
	}

	baseURL, err := url.Parse(strings.TrimRight(runner.AllowedBaseURL, "/"))
	if err != nil || baseURL.Scheme == "" || baseURL.Host == "" {
		return fmt.Errorf("panel URL is invalid: %s", runner.AllowedBaseURL)
	}
	if !strings.EqualFold(upgradeURL.Scheme, baseURL.Scheme) || !strings.EqualFold(upgradeURL.Host, baseURL.Host) {
		return errors.New("upgrade URL is outside panel origin")
	}
	return nil
}

func (runner *Runner) download(ctx context.Context, rawURL string) ([]byte, error) {
	client := runner.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return nil, fmt.Errorf("download upgrade failed: status=%d body=%s", response.StatusCode, string(body))
	}

	limit := runner.sizeLimit()
	return readBoundedUpgradePayload(response.Body, limit, "package")
}

func (runner *Runner) writeTempBinary(binaryBytes []byte) (string, error) {
	binaryPath := runner.binaryPath()
	tempFile, err := os.CreateTemp(filepath.Dir(binaryPath), ".incudal-agent-upgrade-*")
	if err != nil {
		return "", err
	}
	tempPath := tempFile.Name()
	defer tempFile.Close()

	if _, err := tempFile.Write(binaryBytes); err != nil {
		_ = os.Remove(tempPath)
		return "", err
	}
	if err := tempFile.Chmod(0755); err != nil {
		_ = os.Remove(tempPath)
		return "", err
	}
	return tempPath, nil
}

func (runner *Runner) replaceBinary(tempPath string) error {
	binaryPath := runner.binaryPath()
	backupPath := runner.backupPath()

	if _, err := os.Stat(binaryPath); err == nil {
		_ = os.Remove(backupPath)
		if err := copyFile(binaryPath, backupPath); err != nil {
			return fmt.Errorf("backup current agent: %w", err)
		}
	}

	if err := os.Rename(tempPath, binaryPath); err != nil {
		return fmt.Errorf("replace agent binary: %w", err)
	}
	return nil
}

func (runner *Runner) rollback() error {
	backupPath := runner.backupPath()
	if _, err := os.Stat(backupPath); err != nil {
		return err
	}
	return os.Rename(backupPath, runner.binaryPath())
}

func (runner *Runner) restart(ctx context.Context) error {
	if runner.Restart == nil {
		return nil
	}
	serviceName := runner.ServiceName
	if serviceName == "" {
		serviceName = defaultServiceName
	}
	return runner.Restart(ctx, serviceName)
}

func (runner *Runner) binaryPath() string {
	if runner.BinaryPath != "" {
		return runner.BinaryPath
	}
	return "/usr/local/bin/incudal-agent"
}

func (runner *Runner) backupPath() string {
	if runner.BackupPath != "" {
		return runner.BackupPath
	}
	return runner.binaryPath() + ".bak"
}

func (runner *Runner) lockPath() string {
	if runner.LockPath != "" {
		return runner.LockPath
	}
	return defaultLockPath()
}

func defaultLockPath() string {
	if info, err := os.Stat("/run"); err == nil && info.IsDir() {
		return "/run/incudal-agent-upgrade.lock"
	}
	return filepath.Join(os.TempDir(), "incudal-agent-upgrade.lock")
}

func (runner *Runner) sizeLimit() int64 {
	if runner.MaxDownloadBytes <= 0 {
		return defaultMaxDownloadBytes
	}
	return runner.MaxDownloadBytes
}

func verifySHA256(payload []byte, expected string) error {
	sum := sha256.Sum256(payload)
	actual := hex.EncodeToString(sum[:])
	if !strings.EqualFold(actual, expected) {
		return fmt.Errorf("upgrade sha256 mismatch: expected=%s actual=%s", expected, actual)
	}
	return nil
}

func gunzip(payload []byte, limit int64) ([]byte, error) {
	reader, err := gzip.NewReader(bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	return readBoundedUpgradePayload(reader, limit, "binary")
}

func readBoundedUpgradePayload(reader io.Reader, limit int64, kind string) ([]byte, error) {
	if limit <= 0 {
		return nil, errors.New("upgrade size limit must be positive")
	}
	// Read at most the limit, then probe one byte separately to avoid limit+1
	// overflow and to enforce a total limit across concatenated gzip members.
	body, err := io.ReadAll(io.LimitReader(reader, limit))
	if err != nil {
		return nil, err
	}
	var extra [1]byte
	if n, err := io.ReadFull(reader, extra[:]); n != 0 {
		return nil, fmt.Errorf("upgrade %s exceeds %d bytes", kind, limit)
	} else if err != nil && err != io.EOF {
		return nil, err
	}
	return body, nil
}

func copyFile(source string, target string) error {
	sourceFile, err := os.Open(source)
	if err != nil {
		return err
	}
	defer sourceFile.Close()

	info, err := sourceFile.Stat()
	if err != nil {
		return err
	}
	mode := info.Mode().Perm()
	if mode == 0 {
		mode = 0755
	}

	targetFile, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	defer targetFile.Close()

	if _, err := io.Copy(targetFile, sourceFile); err != nil {
		return err
	}
	return targetFile.Chmod(mode)
}

func restartService(ctx context.Context, serviceName string) error {
	if _, err := exec.LookPath("systemctl"); err == nil {
		return restartSystemdService(ctx, serviceName)
	}
	return restartOpenRCService(ctx, serviceName)
}

func restartOpenRCService(ctx context.Context, serviceName string) error {
	if !openRCServiceNamePattern.MatchString(serviceName) {
		return fmt.Errorf("invalid OpenRC service name: %s", serviceName)
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	rcServicePath, err := exec.LookPath("rc-service")
	if err != nil {
		return fmt.Errorf("no supported service manager: %w", err)
	}
	setsidPath, err := exec.LookPath("setsid")
	if err != nil {
		return fmt.Errorf("schedule OpenRC restart: %w", err)
	}
	// OpenRC must restart us from a separate session after Apply has released
	// its lock. It must survive cancellation of the completed upgrade context.
	command := exec.Command(setsidPath, "/bin/sh", "-c", `sleep 2; exec "$1" "$2" restart`, "incudal-agent-restart", rcServicePath, serviceName)
	if err := command.Start(); err != nil {
		return err
	}
	go func() { _ = command.Wait() }()
	return nil
}

func restartSystemdService(ctx context.Context, serviceName string) error {
	return restartSystemdServiceWithin(ctx, serviceName, serviceManagerTimeout)
}

func restartSystemdServiceWithin(ctx context.Context, serviceName string, timeout time.Duration) error {
	if !systemdServiceNamePattern.MatchString(serviceName) {
		return fmt.Errorf("invalid systemd service name: %s", serviceName)
	}

	if err := ctx.Err(); err != nil {
		return err
	}
	scheduleCtx, cancelSchedule := context.WithTimeout(ctx, timeout)
	err := scheduleSystemdRestart(scheduleCtx, serviceName)
	cancelSchedule()
	if err == nil {
		return nil
	}
	if err := ctx.Err(); err != nil {
		return err
	}

	systemctlPath, err := exec.LookPath("systemctl")
	if err != nil {
		return err
	}

	// Wait only for systemd to accept the job, not for our service to restart.
	// The manager owns the queued job after this bounded command exits; Apply's
	// deferred cancellation cannot kill an un-waited background systemctl process.
	restartCtx, cancelRestart := context.WithTimeout(context.Background(), timeout)
	defer cancelRestart()
	command := exec.CommandContext(restartCtx, systemctlPath, "--no-block", "restart", serviceName)
	if err := command.Run(); err != nil {
		if restartCtx.Err() != nil {
			return restartCtx.Err()
		}
		return err
	}
	return nil
}

func scheduleSystemdRestart(ctx context.Context, serviceName string) error {
	systemdRunPath, err := exec.LookPath("systemd-run")
	if err != nil {
		return err
	}
	systemctlPath, err := exec.LookPath("systemctl")
	if err != nil {
		return err
	}

	unitName := fmt.Sprintf("incudal-agent-restart-%d", os.Getpid())
	args := []string{
		"--unit", unitName,
		"--description", "Restart Incudal Agent after self-upgrade",
		"--on-active=2s",
		"--collect",
		systemctlPath, "restart", serviceName,
	}

	command := exec.CommandContext(ctx, systemdRunPath, args...)
	output, err := command.CombinedOutput()
	if err == nil {
		return nil
	}

	// 老版本 systemd 可能不支持 --collect，降级重试一次。
	if strings.Contains(string(output), "unrecognized option '--collect'") ||
		strings.Contains(string(output), "Unknown option --collect") {
		args = []string{
			"--unit", unitName,
			"--description", "Restart Incudal Agent after self-upgrade",
			"--on-active=2s",
			systemctlPath, "restart", serviceName,
		}
		command = exec.CommandContext(ctx, systemdRunPath, args...)
		output, err = command.CombinedOutput()
	}
	if err != nil {
		trimmedOutput := strings.TrimSpace(string(output))
		if trimmedOutput == "" {
			return err
		}
		return fmt.Errorf("%w: %s", err, trimmedOutput)
	}
	return nil
}
