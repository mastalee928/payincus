//go:build linux

package provisioning

import (
	"fmt"
	"os"
	"syscall"
	"unsafe"
)

const resourceMountArgument = "--incudal-resource-mount"

func resourceFile(name string) bool {
	switch name {
	case "meminfo", "cpuinfo", "stat", "uptime", "swaps", "loadavg":
		return true
	}
	return false
}

// cloneResourceMount creates a detached, read-only LXCFS mount in the host.
// It can then be attached in the original guest mount namespace, where a
// traditional cross-namespace bind fails with EINVAL on Alpine kernels.
func cloneResourceMount(source string) (*os.File, error) {
	path, err := syscall.BytePtrFromString(source)
	if err != nil {
		return nil, err
	}
	cwd := -100                                                                                                      // AT_FDCWD
	fd, _, errno := syscall.Syscall6(428, uintptr(cwd), uintptr(unsafe.Pointer(path)), 1|syscall.O_CLOEXEC, 0, 0, 0) // open_tree, OPEN_TREE_CLONE
	if errno != 0 {
		return nil, fmt.Errorf("resource mount clone: %w", errno)
	}
	tree := os.NewFile(fd, "resource-mount")
	empty, _ := syscall.BytePtrFromString("")
	attr := [4]uint64{syscall.MS_RDONLY | syscall.MS_NOSUID | syscall.MS_NODEV | syscall.MS_NOEXEC, 0, 0, 0}
	_, _, errno = syscall.Syscall6(442, fd, uintptr(unsafe.Pointer(empty)), 0x1000, uintptr(unsafe.Pointer(&attr)), unsafe.Sizeof(attr), 0) // mount_setattr, AT_EMPTY_PATH
	if errno != 0 {
		tree.Close()
		return nil, fmt.Errorf("resource mount read-only: %w", errno)
	}
	return tree, nil
}

// ResourceMountHelper handles only the inherited detached mount and procfs
// directory. Namespace entry and all customer identity checks happen in the
// parent. No guest path, shell command, or downloaded executable is accepted.
func ResourceMountHelper() (bool, error) {
	if len(os.Args) < 2 || os.Args[1] != resourceMountArgument {
		return false, nil
	}
	if len(os.Args) != 3 || !resourceFile(os.Args[2]) || os.Geteuid() != 0 {
		return true, fmt.Errorf("resource mount helper arguments invalid")
	}
	var target, source syscall.Statfs_t
	if syscall.Fstatfs(3, &target) != nil || target.Type != 0x9fa0 || syscall.Fstatfs(5, &source) != nil || source.Type != 0x65735546 || source.Flags&syscall.MS_RDONLY == 0 {
		return true, fmt.Errorf("resource mount helper descriptors invalid")
	}
	name, _ := syscall.BytePtrFromString(os.Args[2])
	empty, _ := syscall.BytePtrFromString("")
	_, _, errno := syscall.Syscall6(429, 5, uintptr(unsafe.Pointer(empty)), 3, uintptr(unsafe.Pointer(name)), 4, 0) // move_mount, MOVE_MOUNT_F_EMPTY_PATH
	if errno != 0 {
		return true, fmt.Errorf("resource mount attach: %w", errno)
	}
	return true, nil
}
