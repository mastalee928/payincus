package controllerconfig

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

// Explicit three-namespace integration. The isolated Go process performs the
// mount setup itself, so no privileged Python/shell parent is hidden by a mock.
func TestMigrationAuditIsolatedHost(t *testing.T) {
	if os.Getenv("INCUDAL_MIGRATION_AUDIT_TEST") != "1" {
		t.Skip("explicit Linux root namespace harness required")
	}
	if os.Getenv("INCUDAL_MIGRATION_AUDIT_CHILD") != "1" {
		binary, err := os.Executable()
		if err != nil {
			t.Fatal(err)
		}
		env := append(os.Environ(), "INCUDAL_MIGRATION_AUDIT_CHILD=1")
		for _, ns := range []string{"net", "mnt", "pid"} {
			value, err := os.Readlink("/proc/self/ns/" + ns)
			if err != nil {
				t.Fatal(err)
			}
			env = append(env, "INCUDAL_MIGRATION_PARENT_"+ns+"="+value)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 55*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, "/usr/bin/unshare", "--mount", "--net", "--pid", "--fork", "--mount-proc", binary, "-test.run=^TestMigrationAuditIsolatedHost$", "-test.v")
		cmd.Env = env
		output, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("isolated audit: %v\n%s", err, output)
		}
		t.Log(string(output))
		return
	}
	if os.Geteuid() != 0 {
		t.Fatal("root required")
	}
	for _, ns := range []string{"net", "mnt", "pid"} {
		value, err := os.Readlink("/proc/self/ns/" + ns)
		if err != nil || value == os.Getenv("INCUDAL_MIGRATION_PARENT_"+ns) || os.Getenv("INCUDAL_MIGRATION_PARENT_"+ns) == "" {
			t.Fatal("refusing non-isolated mount")
		}
	}
	if syscall.Mount("", "/", "", syscall.MS_REC|syscall.MS_PRIVATE, "") != nil {
		t.Fatal("private mounts")
	}
	for _, target := range []string{"/etc", "/run"} {
		if err := syscall.Mount("tmpfs", target, "tmpfs", 0, "mode=0755"); err != nil {
			t.Fatal(err)
		}
	}
	home, _ := os.UserHomeDir()
	dir, err := os.MkdirTemp(home, ".incudal-migration-audit-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
	defer cancel()
	if _, err = channelCommand(ctx, "/usr/sbin/ip", []string{"link", "set", "lo", "up"}, ""); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/etc/ssh/sshd_config.d", "/etc/cron.d", "/etc/systemd/system", "/run/sshd", "/run/systemd/system", "/var/spool/cron"} {
		if path == "/var/spool/cron" {
			continue
		}
		if os.MkdirAll(path, 0755) != nil {
			t.Fatal("isolated directory")
		}
	}
	// Hide the existing cron spool and vendor units inside the mount namespace.
	for _, target := range []string{"/var/spool/cron", "/usr/lib/systemd/system"} {
		if _, err = os.Stat(target); err != nil {
			t.Fatal("required mount target unavailable", target)
		}
		if err = syscall.Mount("tmpfs", target, "tmpfs", 0, "mode=0755"); err != nil {
			t.Fatal(err)
		}
	}
	files := map[string]string{"/etc/passwd": "root:x:0:0:root:/root:/bin/sh\nsshd:x:109:65534:sshd:/run/sshd:/usr/sbin/nologin\n", "/etc/group": "root:x:0:\nnogroup:x:65534:\n", "/etc/nsswitch.conf": "passwd: files\ngroup: files\nshadow: files\n", "/etc/crontab": "# no legacy scheduled writers\n", "/etc/anacrontab": "# disabled\n",
		"/etc/ssh/sshd_config": "HostKey /etc/ssh/host_key\nPubkeyAuthentication no\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nGSSAPIAuthentication no\nHostbasedAuthentication no\nPermitRootLogin no\nUsePAM no\n"}
	for path, text := range files {
		if os.WriteFile(path, []byte(text), 0600) != nil {
			t.Fatal("isolated config")
		}
	}
	if _, err = channelCommand(ctx, "/usr/bin/ssh-keygen", []string{"-q", "-t", "ed25519", "-N", "", "-f", "/etc/ssh/host_key"}, ""); err != nil {
		t.Fatal(err)
	}
	socket := filepath.Join(dir, "unix.socket")
	realIncus := os.Getenv("INCUDAL_MIGRATION_REAL_INCUS_ROOT")
	var realDaemon string
	if realIncus == "" {
		listener, err := net.Listen("unix", socket)
		if err != nil {
			t.Fatal(err)
		}
		os.Chmod(socket, 0600)
		server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			json.NewEncoder(w).Encode(map[string]any{"type": "sync", "status_code": 200, "metadata": map[string]any{}})
		})}
		go server.Serve(listener)
		defer server.Close()
	} else {
		if !filepath.IsAbs(realIncus) || filepath.Clean(realIncus) != realIncus {
			t.Fatal("protected extracted Incus root required")
		}
		// Confine daemon mounts/sysctls to this test. This extracted daemon never
		// contacts the system Incus or uses any customer instance state.
		if err = syscall.Mount("/sys", "/sys", "", syscall.MS_BIND, ""); err != nil {
			t.Fatal(err)
		}
		if err = syscall.Mount("", "/sys", "", syscall.MS_REMOUNT|syscall.MS_BIND|syscall.MS_RDONLY, ""); err != nil {
			t.Fatal(err)
		}
		if err = syscall.Mount("tmpfs", "/sys/kernel/security", "tmpfs", 0, "mode=0700"); err != nil {
			t.Fatal(err)
		}
		state := filepath.Join(dir, "incus")
		if err = os.Mkdir(state, 0700); err != nil {
			t.Fatal(err)
		}
		socket = filepath.Join(state, "unix.socket")
		realDaemon = filepath.Join(realIncus, "rootfs/usr/libexec/incus/incusd")
		log, err := os.OpenFile(filepath.Join(dir, "incus.log"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err != nil {
			t.Fatal(err)
		}
		defer log.Close()
		cmd := exec.CommandContext(ctx, realDaemon, "--verbose")
		cmd.Env = append(os.Environ(), "INCUS_DIR="+state, "LD_LIBRARY_PATH="+filepath.Join(realIncus, "rootfs/usr/lib/aarch64-linux-gnu"), "PATH="+filepath.Join(realIncus, "rootfs/usr/bin")+":"+filepath.Join(realIncus, "rootfs/usr/sbin")+":/usr/sbin:/usr/bin:/sbin:/bin")
		cmd.Stdout = log
		cmd.Stderr = log
		if err = cmd.Start(); err != nil {
			t.Fatal(err)
		}
		defer func() { cmd.Process.Signal(syscall.SIGTERM); cmd.Wait() }()
		ready := false
		for attempt := 0; attempt < 60; attempt++ {
			if _, err = os.Stat(socket); err == nil {
				os.Chmod(socket, 0600)
				if _, err = ReadIncusQuiescence(ctx, socket); err == nil {
					ready = true
					break
				}
			}
			time.Sleep(100 * time.Millisecond)
		}
		if !ready {
			t.Fatal("isolated real Incus did not initialize")
		}
	}
	policy := WriterAuditPolicy{SchemaVersion: 1, Executables: map[string]string{}, ConfigurationFiles: map[string]string{}, SchedulerDirectories: []string{"/etc/cron.d", "/var/spool/cron", "/etc/systemd/system", "/usr/lib/systemd/system", "/run/systemd/system"}, SchedulerTreeHashes: map[string]string{}}
	policy.Executables["/usr/bin/false"], err = writerFileHash(ctx, "/usr/bin/false", 1048576)
	if err != nil {
		t.Fatal(err)
	}
	if realDaemon != "" {
		policy.Executables[realDaemon], err = writerFileHash(ctx, realDaemon, 67108864)
		if err != nil {
			t.Fatal(err)
		}
	}
	for _, path := range []string{"/etc/crontab", "/etc/anacrontab", "/etc/ssh/sshd_config"} {
		policy.ConfigurationFiles[path], err = writerFileHash(ctx, path, 1048576)
		if err != nil {
			t.Fatal(err)
		}
	}
	for _, path := range policy.SchedulerDirectories {
		policy.SchedulerTreeHashes[path], err = WriterSchedulerTreeHash(ctx, path)
		if err != nil {
			t.Fatal(err)
		}
	}
	credentials, err := ReadLocalCredentialAudit(ctx, socket)
	if err != nil || !credentials.Complete {
		diagnostic, _ := exec.CommandContext(ctx, "/usr/sbin/sshd", "-T").CombinedOutput()
		t.Log(string(diagnostic))
		t.Fatalf("actual disabled SSH/socket audit: %+v %v", credentials, err)
	}
	writers, err := ReadLocalWriterAudit(ctx, policy)
	if err != nil || !writers.Complete || !writers.ManagedWriterIsolationVerified {
		t.Fatalf("actual isolated writer audit: %+v %v", writers, err)
	}
	processes, err := ReadLocalProcessAudit(ctx)
	if err != nil || !processes.StableSnapshot || processes.SSHSessionProcesses != 0 {
		t.Fatalf("process audit: %+v %v", processes, err)
	}
	// The runtime collector is composed from actual OS/API facts, rather than
	// setting audit-complete flags in a test fixture.
	config, trust, root, _, node := discoveryFixture(t)
	candidate := signedCandidate(t, config, root)
	checked, err := VerifyPrepareConfig(candidate, trust)
	if err != nil {
		t.Fatal(err)
	}
	witnessPub, witness, _ := ed25519.GenerateKey(rand.Reader)
	holderPub, holderKey, _ := ed25519.GenerateKey(rand.Reader)
	witnessID := "77777777-7777-4777-8777-777777777777"
	keys := map[string]string{SigningKeyID(witnessPub): base64.StdEncoding.EncodeToString(witnessPub)}
	permit := PreparePermit{1, "host-fence-prepare", witnessID, config.PlatformID, config.NodeID, config.ControllerID, config.RequestID, config.Epoch, config.Sequence, checked.Observed.PayloadSHA256, base64.RawURLEncoding.EncodeToString(make([]byte, 24)), trust.Now, trust.Now + 60000}
	raw, _ := canonical(permit)
	payload := base64.StdEncoding.EncodeToString(raw)
	id := SigningKeyID(witnessPub)
	encoded, _ := canonical(envelope{1, id, payload, base64.StdEncoding.EncodeToString(ed25519.Sign(witness, []byte(preparePermitPrefix+id+"\n"+payload)))})
	state := filepath.Join(dir, "state")
	os.Mkdir(state, 0700)
	if _, err = ObservePrepareConfig(state, candidate, trust); err != nil {
		t.Fatal(err)
	}
	ports := ManagementFencePorts{2200, 8443}
	if err = ApplyManagementPreparationFence(ctx, candidate, encoded, trust, witnessID, keys, ports, state); err != nil {
		t.Fatal(err)
	}
	collector := func(ctx context.Context) (RuntimeFenceFacts, error) {
		observed, err := InspectManagementFence(ctx, ports, state)
		if err != nil {
			return RuntimeFenceFacts{}, err
		}
		cred, err := ReadLocalCredentialAudit(ctx, socket)
		if err != nil {
			return RuntimeFenceFacts{}, err
		}
		writer, err := ReadLocalWriterAudit(ctx, policy)
		if err != nil {
			return RuntimeFenceFacts{}, err
		}
		process, err := ReadLocalProcessAudit(ctx)
		if err != nil {
			return RuntimeFenceFacts{}, err
		}
		operations, err := ReadIncusQuiescence(ctx, socket)
		if err != nil {
			return RuntimeFenceFacts{}, err
		}
		return RuntimeFenceFacts{NetworkBlocked: true, LegacyCredentialsBlocked: cred.Complete, Processes: process, Writers: writer, ActiveIncusOperations: len(operations.ActiveOperationIDs), Observed: &observed}, nil
	}
	runtime, err := NewMaintenanceRuntime(trust, witnessID, keys, node, socket, collector)
	if err != nil {
		t.Fatal(err)
	}
	result, err := runtime.Prepare(ctx, candidate, encoded, base64.StdEncoding.EncodeToString(holderPub))
	if err != nil || result.Receipt == "" || result.GateProof == "" || result.CanWrite || len(result.Blockers) != 0 {
		t.Fatalf("actual audit attestation: %+v %v", result, err)
	}
	// Test transport/runtime against the actual daemon. The witness signature
	// here is a local test identity; remote authority issuance is a separate test.
	var receiptEnv fenceEnvelope
	var receipt FenceReceipt
	if decodeStrict([]byte(result.Receipt), &receiptEnv) != nil {
		t.Fatal("receipt")
	}
	receiptRaw, _ := base64.StdEncoding.DecodeString(receiptEnv.Payload)
	if decodeStrict(receiptRaw, &receipt) != nil {
		t.Fatal("receipt")
	}
	lease := WriteLease{1, "controller-write-lease", witnessID, config.PlatformID, config.NodeID, config.ControllerID, config.RequestID, config.Epoch, config.Sequence, receipt.CandidateSHA256,
		"55555555-5555-4555-8555-555555555555", "1", result.BootID, result.GateID, SigningKeyID(holderPub), time.Now().UnixMilli(), time.Now().UnixMilli() + 3000, []string{"inspect"}}
	leaseRaw, _ := canonical(lease)
	leasePayload := base64.StdEncoding.EncodeToString(leaseRaw)
	leaseEncoded, _ := canonical(envelope{1, id, leasePayload, base64.StdEncoding.EncodeToString(ed25519.Sign(witness, []byte(writeLeasePrefix+id+"\n"+leasePayload)))})
	if err = runtime.AcceptLease(ctx, leaseEncoded); err != nil {
		t.Fatal("actual lease audit: ", err)
	}
	body := []byte(`{"schemaVersion":1,"operation":"inspect-operations"}`)
	proof := LeaseRequest{LeaseBodySHA256(leaseEncoded), "inspect", LeaseBodySHA256(body), strconv.FormatInt(time.Now().UnixMilli(), 10), base64.RawURLEncoding.EncodeToString(make([]byte, 24)), ""}
	proof.Signature = base64.StdEncoding.EncodeToString(ed25519.Sign(holderKey, []byte(leaseRequestPrefix+strings.Join([]string{proof.LeaseSHA256, proof.Permission, proof.BodySHA256, proof.Timestamp, proof.Nonce}, "\n"))))
	executed, err := runtime.Execute(ctx, body, proof, base64.StdEncoding.EncodeToString(holderPub))
	if err != nil || !executed.Accepted {
		t.Fatal("actual runtime inspect: ", err)
	}
	if _, err = runtime.Execute(ctx, body, proof, base64.StdEncoding.EncodeToString(holderPub)); err == nil {
		t.Fatal("actual runtime request replay accepted")
	}
	for time.Now().UnixMilli() <= lease.ExpiresAt {
		time.Sleep(50 * time.Millisecond)
	}
	proof.Timestamp = strconv.FormatInt(time.Now().UnixMilli(), 10)
	proof.Nonce = base64.RawURLEncoding.EncodeToString([]byte(strings.Repeat("x", 24)))
	proof.Signature = base64.StdEncoding.EncodeToString(ed25519.Sign(holderKey, []byte(leaseRequestPrefix+strings.Join([]string{proof.LeaseSHA256, proof.Permission, proof.BodySHA256, proof.Timestamp, proof.Nonce}, "\n"))))
	if _, err = runtime.Execute(ctx, body, proof, base64.StdEncoding.EncodeToString(holderPub)); err == nil {
		t.Fatal("actual expired lease left daemon access")
	}
	// A changed scheduler tree must immediately block a fresh attestation.
	os.WriteFile("/etc/cron.d/legacy-job", []byte("* * * * * root /usr/bin/true\n"), 0600)
	blocked, err := runtime.Prepare(ctx, candidate, encoded, base64.StdEncoding.EncodeToString(holderPub))
	if err != nil || blocked.Receipt != "" || len(blocked.Blockers) == 0 {
		t.Fatal("changed scheduler did not block", err)
	}
	t.Logf("actual isolated SSH/socket/procfs/scheduler/nft receipt and lease inspection/replay/expiry; real Incus=%v; scheduler change blocks activation", realDaemon != "")
}
