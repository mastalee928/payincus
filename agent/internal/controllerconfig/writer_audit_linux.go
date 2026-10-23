package controllerconfig

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"syscall"
)

var forbiddenWriterExecutable = regexp.MustCompile(`^(?:[a-z0-9_-]*sh|busybox|python[0-9.]*|node|perl|ruby|php[0-9.]*|cron|crond|atd|sudo|su|doas|sshd|sshd-session|sshd-auth|systemd-run|incus|lxc|curl|wget|nc|ncat|socat)$`)

func writerFileHash(ctx context.Context, path string, max int64) (string, error) {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return "", failure("CONTROLLER_WRITER_AUDIT_INVALID")
	}
	for current := path; current != filepath.Dir(current); current = filepath.Dir(current) {
		info, err := os.Lstat(current)
		if err != nil || info.Mode()&os.ModeSymlink != 0 {
			return "", failure("CONTROLLER_WRITER_AUDIT_PERMISSION")
		}
		stat, ok := info.Sys().(*syscall.Stat_t)
		if !ok || stat.Uid != 0 || info.Mode().Perm()&0022 != 0 {
			return "", failure("CONTROLLER_WRITER_AUDIT_PERMISSION")
		}
	}
	fd, err := syscall.Open(path, syscall.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK|syscall.O_CLOEXEC, 0)
	if err != nil {
		return "", err
	}
	file := os.NewFile(uintptr(fd), path)
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > max {
		return "", failure("CONTROLLER_WRITER_AUDIT_INVALID")
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || stat.Uid != 0 || stat.Nlink != 1 || info.Mode().Perm()&0022 != 0 {
		return "", failure("CONTROLLER_WRITER_AUDIT_PERMISSION")
	}
	hash := sha256.New()
	buffer := make([]byte, 32768)
	var used int64
	for {
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		n, err := file.Read(buffer)
		used += int64(n)
		if used > max {
			return "", failure("CONTROLLER_WRITER_AUDIT_CAPACITY")
		}
		hash.Write(buffer[:n])
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", err
		}
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func validateWriterPolicy(policy WriterAuditPolicy) error {
	if policy.SchemaVersion != 1 || len(policy.Executables) == 0 || len(policy.Executables) > 64 || len(policy.ConfigurationFiles) == 0 || len(policy.ConfigurationFiles) > 256 || len(policy.SchedulerDirectories) == 0 || len(policy.SchedulerDirectories) > 16 {
		return failure("CONTROLLER_WRITER_AUDIT_POLICY")
	}
	for path, hash := range policy.Executables {
		if !filepath.IsAbs(path) || filepath.Clean(path) != path || forbiddenWriterExecutable.MatchString(filepath.Base(path)) || !hashPattern.MatchString(hash) {
			return failure("CONTROLLER_WRITER_AUDIT_POLICY")
		}
	}
	for path, hash := range policy.ConfigurationFiles {
		if !filepath.IsAbs(path) || filepath.Clean(path) != path || !hashPattern.MatchString(hash) {
			return failure("CONTROLLER_WRITER_AUDIT_POLICY")
		}
	}
	// All legacy root job sources must be represented. Missing files are an
	// installation decision, never inferred as empty when permission fails.
	required := map[string]bool{"/etc/cron.d": false, "/var/spool/cron": false, "/etc/systemd/system": false, "/usr/lib/systemd/system": false, "/run/systemd/system": false}
	for _, path := range policy.SchedulerDirectories {
		if _, ok := required[path]; !ok {
			return failure("CONTROLLER_WRITER_AUDIT_POLICY")
		}
		required[path] = true
	}
	if policy.SchedulerTreeHashes != nil {
		if len(policy.SchedulerTreeHashes) != len(policy.SchedulerDirectories) {
			return failure("CONTROLLER_WRITER_AUDIT_POLICY")
		}
		for _, path := range policy.SchedulerDirectories {
			if !hashPattern.MatchString(policy.SchedulerTreeHashes[path]) {
				return failure("CONTROLLER_WRITER_AUDIT_POLICY")
			}
		}
	}
	for _, present := range required {
		if !present {
			return failure("CONTROLLER_WRITER_AUDIT_POLICY")
		}
	}
	for _, path := range []string{"/etc/crontab", "/etc/anacrontab", "/etc/ssh/sshd_config"} {
		if _, exists := policy.ConfigurationFiles[path]; !exists {
			return failure("CONTROLLER_WRITER_AUDIT_POLICY")
		}
	}
	return nil
}

func writerProcessAuthority(path string) (bool, error) {
	return writerProcessAuthorityGroups(path, nil)
}
func writerProcessAuthorityGroups(path string, managementGroups map[uint64]bool) (bool, error) {
	raw, err := os.ReadFile(path)
	if err != nil || len(raw) > 16384 {
		return false, failure("CONTROLLER_WRITER_AUDIT_PROCESS")
	}
	seenUID, seenCaps := false, false
	privileged := false
	for _, line := range strings.Split(string(raw), "\n") {
		if strings.HasPrefix(line, "Uid:") {
			fields := strings.Fields(line)
			if len(fields) != 5 {
				return false, failure("CONTROLLER_WRITER_AUDIT_PROCESS")
			}
			for _, value := range fields[1:] {
				uid, err := strconv.ParseUint(value, 10, 32)
				if err != nil {
					return false, failure("CONTROLLER_WRITER_AUDIT_PROCESS")
				}
				if uid == 0 {
					privileged = true
				}
			}
			seenUID = true
		}
		if strings.HasPrefix(line, "CapPrm:") {
			fields := strings.Fields(line)
			if len(fields) != 2 {
				return false, failure("CONTROLLER_WRITER_AUDIT_PROCESS")
			}
			caps, err := strconv.ParseUint(fields[1], 16, 64)
			if err != nil {
				return false, failure("CONTROLLER_WRITER_AUDIT_PROCESS")
			}
			if caps != 0 {
				privileged = true
			}
			seenCaps = true
		}
		if strings.HasPrefix(line, "Gid:") || strings.HasPrefix(line, "Groups:") {
			fields := strings.Fields(line)
			if strings.HasPrefix(line, "Gid:") && len(fields) != 5 {
				return false, failure("CONTROLLER_WRITER_AUDIT_PROCESS")
			}
			for _, value := range fields[1:] {
				group, err := strconv.ParseUint(value, 10, 32)
				if err != nil {
					return false, failure("CONTROLLER_WRITER_AUDIT_PROCESS")
				}
				if managementGroups[group] {
					privileged = true
				}
			}
		}
	}
	if !seenUID || !seenCaps {
		return false, failure("CONTROLLER_WRITER_AUDIT_PROCESS")
	}
	return privileged, nil
}

func localIncusManagementGroups() (map[uint64]bool, error) {
	raw, err := os.ReadFile("/etc/group")
	if err != nil || len(raw) > 1048576 {
		return nil, failure("CONTROLLER_WRITER_AUDIT_GROUPS")
	}
	groups := map[uint64]bool{}
	for _, line := range strings.Split(string(raw), "\n") {
		fields := strings.Split(line, ":")
		if len(fields) != 4 {
			continue
		}
		if fields[0] == "incus" || fields[0] == "incus-admin" || fields[0] == "lxd" {
			gid, err := strconv.ParseUint(fields[2], 10, 32)
			if err != nil {
				return nil, failure("CONTROLLER_WRITER_AUDIT_GROUPS")
			}
			groups[gid] = true
		}
	}
	return groups, nil
}

func writerProcessIDs() ([]string, error) {
	file, err := os.Open("/proc")
	if err != nil {
		return nil, err
	}
	defer file.Close()
	ids := []string{}
	for {
		names, err := file.Readdirnames(256)
		if err != nil && err != io.EOF {
			return nil, err
		}
		for _, name := range names {
			pid, e := strconv.Atoi(name)
			if e == nil && pid > 0 && strconv.Itoa(pid) == name {
				ids = append(ids, name)
				if len(ids) > 32768 {
					return nil, failure("CONTROLLER_WRITER_AUDIT_CAPACITY")
				}
			}
		}
		if err == io.EOF {
			break
		}
	}
	sort.Strings(ids)
	return ids, nil
}

// Strict read-only audit: no unknown privileged process, active shell/SSH,
// Incus Unix-socket holder, or unreviewed local schedule can be treated as safe.
// This is deliberately evaluated from current OS facts, not request flags.
func ReadLocalWriterAudit(ctx context.Context, policy WriterAuditPolicy) (LocalWriterAudit, error) {
	result := LocalWriterAudit{StableSnapshot: true, ConfigurationIntact: true}
	if os.Geteuid() != 0 || validateWriterPolicy(policy) != nil {
		return result, failure("CONTROLLER_WRITER_AUDIT_POLICY")
	}
	// /proc/net/unix identifies local privileged API channels without reading
	// process command lines, environment, secrets or executable output.
	unix, err := os.ReadFile("/proc/net/unix")
	if err != nil || len(unix) > 1048576 {
		return result, failure("CONTROLLER_WRITER_AUDIT_IO")
	}
	inodes := map[string]bool{}
	for _, line := range strings.Split(string(unix), "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 8 && (strings.Contains(fields[7], "/incus/") || strings.Contains(fields[7], "/lxd/")) {
			inodes["socket:["+fields[6]+"]"] = true
		}
	}
	netlink, err := os.ReadFile("/proc/net/netlink")
	if err != nil || len(netlink) > 1048576 {
		return result, failure("CONTROLLER_WRITER_AUDIT_IO")
	}
	netlinkInodes := map[string]bool{}
	for _, line := range strings.Split(string(netlink), "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 10 && fields[0] != "sk" {
			if _, err := strconv.ParseUint(fields[len(fields)-1], 10, 64); err == nil {
				netlinkInodes["socket:["+fields[len(fields)-1]+"]"] = true
			}
		}
	}
	managementGroups, err := localIncusManagementGroups()
	if err != nil {
		return result, err
	}
	proc, err := os.Open("/proc")
	if err != nil {
		return result, err
	}
	defer proc.Close()
	var fs syscall.Statfs_t
	if syscall.Fstatfs(int(proc.Fd()), &fs) != nil || fs.Type != 0x9fa0 {
		return result, failure("CONTROLLER_WRITER_AUDIT_IO")
	}
	names, err := writerProcessIDs()
	if err != nil {
		return result, err
	}
	cache := map[string]string{}
	for _, name := range names {
		pid, e := strconv.Atoi(name)
		if e != nil || pid < 1 || strconv.Itoa(pid) != name {
			continue
		}
		if ctx.Err() != nil {
			return result, ctx.Err()
		}
		base := filepath.Join("/proc", name)
		row, err := readProcessStat(filepath.Join(base, "stat"))
		if os.IsNotExist(err) {
			result.StableSnapshot = false
			continue
		}
		if err != nil {
			return result, err
		}
		result.ProcessesChecked++
		privileged, err := writerProcessAuthorityGroups(filepath.Join(base, "status"), managementGroups)
		if os.IsNotExist(err) {
			result.StableSnapshot = false
			continue
		}
		if err != nil {
			return result, err
		}
		observedExecutable := ""
		trustedDaemon := false
		if privileged && pid != os.Getpid() {
			observedExecutable, _ = os.Readlink(filepath.Join(base, "exe"))
			if expected, known := policy.Executables[observedExecutable]; known && !forbiddenWriterExecutable.MatchString(filepath.Base(observedExecutable)) {
				actual := cache[observedExecutable]
				if actual == "" {
					actual, err = writerFileHash(ctx, observedExecutable, 67108864)
					if err != nil {
						return result, err
					}
					cache[observedExecutable] = actual
				}
				trustedDaemon = actual == expected
			}
		}
		fds, err := os.ReadDir(filepath.Join(base, "fd"))
		if os.IsNotExist(err) {
			result.StableSnapshot = false
			continue
		}
		if err != nil || len(fds) > 8192 {
			return result, failure("CONTROLLER_WRITER_AUDIT_FD")
		}
		if pid != os.Getpid() {
			for _, fd := range fds {
				link, err := os.Readlink(filepath.Join(base, "fd", fd.Name()))
				if os.IsNotExist(err) {
					result.StableSnapshot = false
					continue
				}
				if err != nil {
					return result, err
				}
				if pid != os.Getpid() && !trustedDaemon {
					if inodes[link] {
						result.IncusSocketHolders++
					}
					if strings.Contains(link, "bpf-map") || strings.Contains(link, "bpf-prog") || netlinkInodes[link] {
						result.PrivilegedDescriptorHolders++
					}
				}
			}
		}
		if privileged && pid != os.Getpid() {
			exe, err := os.Readlink(filepath.Join(base, "exe"))
			observedExecutable = exe
			if err != nil {
				// Kernel threads have no executable and must have ppid 2 (or be
				// the actual kernel thread parent). Userspace zombies do not pass.
				if row.ParentPID != 2 && !(row.PID == 2 && row.ParentPID == 0) {
					result.UnknownPrivilegedProcesses++
				}
			} else {
				expected, ok := policy.Executables[exe]
				if !ok || forbiddenWriterExecutable.MatchString(filepath.Base(exe)) {
					result.UnknownPrivilegedProcesses++
				} else {
					actual := cache[exe]
					if actual == "" {
						actual, err = writerFileHash(ctx, exe, 67108864)
						if err != nil {
							return result, err
						}
						cache[exe] = actual
					}
					if actual != expected {
						result.UnknownPrivilegedProcesses++
					}
				}
			}
		}
		after, err := readProcessStat(filepath.Join(base, "stat"))
		if os.IsNotExist(err) {
			result.StableSnapshot = false
			continue
		}
		if err != nil {
			return result, err
		}
		if after != row {
			result.StableSnapshot = false
		}
		currentPrivilege, err := writerProcessAuthorityGroups(filepath.Join(base, "status"), managementGroups)
		if err != nil {
			return result, err
		}
		if currentPrivilege != privileged {
			result.StableSnapshot = false
		}
		// A process can exec without changing PID, parent or start ticks. Re-read
		// the executable link too, so identity cannot change during the audit.
		if privileged && pid != os.Getpid() {
			currentExe, exeErr := os.Readlink(filepath.Join(base, "exe"))
			if currentExe != observedExecutable || (exeErr != nil && observedExecutable != "") {
				result.StableSnapshot = false
			}
			if exeErr == nil {
				if _, known := policy.Executables[currentExe]; !known || forbiddenWriterExecutable.MatchString(filepath.Base(currentExe)) {
					result.StableSnapshot = false
				}
			}
		}
	}
	afterIDs, err := writerProcessIDs()
	if err != nil {
		return result, err
	}
	if strings.Join(names, ",") != strings.Join(afterIDs, ",") {
		result.StableSnapshot = false
	}
	for path, expected := range policy.ConfigurationFiles {
		actual, err := writerFileHash(ctx, path, 1048576)
		if err != nil {
			return result, err
		}
		if actual != expected {
			result.ConfigurationIntact = false
		}
	}
	for _, directory := range policy.SchedulerDirectories {
		if policy.SchedulerTreeHashes != nil {
			actual, err := WriterSchedulerTreeHash(ctx, directory)
			if err != nil {
				return result, err
			}
			if actual != policy.SchedulerTreeHashes[directory] {
				result.ScheduledWriterEntries++
			}
			continue
		}
		info, err := os.Lstat(directory)
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return result, failure("CONTROLLER_WRITER_AUDIT_SCHEDULERS")
		}
		entries, err := os.ReadDir(directory)
		if err != nil || len(entries) > 512 {
			return result, failure("CONTROLLER_WRITER_AUDIT_SCHEDULERS")
		}
		for _, entry := range entries {
			path := filepath.Join(directory, entry.Name())
			if entry.IsDir() {
				// Enabled services/timers in nested .wants/.requires directories
				// require a reviewed service manifest, not a shallow directory scan.
				result.ScheduledWriterEntries++
				continue
			}
			if _, ok := policy.ConfigurationFiles[path]; !ok {
				result.ScheduledWriterEntries++
			}
		}
	}
	result.Complete = result.StableSnapshot && result.ConfigurationIntact && result.UnknownPrivilegedProcesses == 0 && result.IncusSocketHolders == 0 && result.ScheduledWriterEntries == 0 && result.PrivilegedDescriptorHolders == 0
	result.ManagedWriterIsolationVerified = result.Complete && policy.SchedulerTreeHashes != nil
	return result, nil
}

// Hash a reviewed scheduler tree, including relative paths and link targets.
// A hash is useful only after its contents were reviewed against the migration
// plan; this helper never installs or trusts a new baseline automatically.
func WriterSchedulerTreeHash(ctx context.Context, directory string) (string, error) {
	if !filepath.IsAbs(directory) || filepath.Clean(directory) != directory {
		return "", failure("CONTROLLER_WRITER_AUDIT_PERMISSION")
	}
	for current := directory; ; current = filepath.Dir(current) {
		info, err := os.Lstat(current)
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return "", failure("CONTROLLER_WRITER_AUDIT_PERMISSION")
		}
		stat, ok := info.Sys().(*syscall.Stat_t)
		if !ok || stat.Uid != 0 || info.Mode().Perm()&0022 != 0 {
			return "", failure("CONTROLLER_WRITER_AUDIT_PERMISSION")
		}
		if current == filepath.Dir(current) {
			break
		}
	}
	hash := sha256.New()
	count, total := 0, int64(0)
	err := filepath.WalkDir(directory, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		count++
		if count > 4096 {
			return failure("CONTROLLER_WRITER_AUDIT_CAPACITY")
		}
		relative, err := filepath.Rel(directory, path)
		if err != nil {
			return err
		}
		info, err := os.Lstat(path)
		if err != nil {
			return err
		}
		stat, ok := info.Sys().(*syscall.Stat_t)
		if !ok || stat.Uid != 0 || (info.Mode()&os.ModeSymlink == 0 && info.Mode().Perm()&0022 != 0) {
			return failure("CONTROLLER_WRITER_AUDIT_PERMISSION")
		}
		hash.Write([]byte(relative + "\x00" + info.Mode().String() + "\x00"))
		if info.IsDir() {
			return nil
		}
		if info.Mode()&os.ModeSymlink != 0 {
			target, err := filepath.EvalSymlinks(path)
			if err != nil {
				return err
			}
			hash.Write([]byte(target + "\x00"))
			if target == "/dev/null" {
				return nil
			}
			// systemd aliases may point at another trusted regular unit.
			digest, err := writerFileHash(ctx, target, 1048576)
			if err != nil {
				return err
			}
			hash.Write([]byte(digest))
			return nil
		}
		if !info.Mode().IsRegular() {
			return failure("CONTROLLER_WRITER_AUDIT_PERMISSION")
		}
		total += info.Size()
		if total > 16*1024*1024 {
			return failure("CONTROLLER_WRITER_AUDIT_CAPACITY")
		}
		digest, err := writerFileHash(ctx, path, 1048576)
		if err != nil {
			return err
		}
		hash.Write([]byte(digest))
		return nil
	})
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}
