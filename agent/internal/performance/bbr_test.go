package performance

import (
	"context"
	"fmt"
	"strings"
	"testing"
)

func TestHostRepairAndSalesFallback(t *testing.T) {
	for _, scenario := range []string{"normal", "unsupported", "stale-index", "qdisc-failed", "config-conflict", "module-config-conflict", "apply-failed", "readback-failed", "tools-pending"} {
		t.Run(scenario, func(t *testing.T) {
			repaired, live := false, false
			e := &Engine{persist: func(string, string) error {
				if scenario == "config-conflict" {
					return fmt.Errorf("preserved")
				}
				return nil
			},
				modules: func() error {
					if scenario == "module-config-conflict" {
						return fmt.Errorf("busy")
					}
					return nil
				},
				tools: func(context.Context) error {
					if scenario == "tools-pending" {
						return fmt.Errorf("missing")
					}
					return nil
				}}
			e.run = func(_ context.Context, name string, args ...string) ([]byte, error) {
				switch name {
				case "modprobe":
					return nil, nil
				case "depmod":
					repaired = true
					return nil, nil
				case "sysctl":
					text := strings.Join(args, " ")
					if strings.Contains(text, "available") {
						if scenario == "unsupported" || scenario == "stale-index" && !repaired {
							return []byte("reno cubic"), nil
						}
						return []byte("reno cubic bbr"), nil
					}
					if args[0] == "-w" {
						if strings.Contains(text, "qdisc") && scenario == "qdisc-failed" {
							return nil, fmt.Errorf("no fq")
						}
						if strings.Contains(text, "congestion") {
							if scenario == "apply-failed" {
								return nil, fmt.Errorf("busy")
							}
							live = true
						}
						return nil, nil
					}
					if live && scenario != "readback-failed" {
						return []byte("bbr"), nil
					}
					return []byte("cubic"), nil
				default:
					t.Errorf("customer or unexpected command: %s", name)
					return nil, fmt.Errorf("wrong command")
				}
			}
			s := e.Reconcile(context.Background())
			if scenario == "unsupported" {
				if s.State != "unsupported" || live {
					t.Fatal(s)
				}
				return
			}
			if scenario == "apply-failed" || scenario == "readback-failed" {
				if s.HostApplied || s.State != "pending" {
					t.Fatal(s)
				}
				return
			}
			if !s.HostApplied {
				t.Fatal(s)
			}
			if scenario == "config-conflict" || scenario == "module-config-conflict" {
				if s.Persistent || s.State != "pending" {
					t.Fatal(s)
				}
			} else if s.State != "applied" {
				t.Fatal(s)
			}
			if scenario == "stale-index" && !repaired {
				t.Fatal("module index not repaired")
			}
			if scenario == "qdisc-failed" && len(s.Warnings) == 0 {
				t.Fatal(s)
			}
		})
	}
}

func TestPoolScopeNewAndLegacy(t *testing.T) {
	e := &Engine{managed: func() bool { return false }, run: func(context.Context, string, ...string) ([]byte, error) {
		t.Error("non-pool ran commands")
		return nil, fmt.Errorf("unexpected")
	}}
	if s := e.Reconcile(context.Background()); s.State != "not-pool" {
		t.Fatal(s)
	}
	e.SetPoolHost(true)
	if !e.poolEnabled() {
		t.Fatal("legacy pool host not enabled")
	}
	e.managed = func() bool { return true }
	e.SetPoolHost(false)
	if e.poolEnabled() {
		t.Fatal("explicit non-pool did not override old marker")
	}
	e.poolHost = nil
	if !e.poolEnabled() {
		t.Fatal("new onboarding host not enabled")
	}
}

func TestFixedToolsAndConfigRepair(t *testing.T) {
	for _, osID := range []string{"alpine", "debian", "ubuntu"} {
		name, args, err := toolPackages("ID="+osID, []string{"modprobe", "depmod"})
		if err != nil {
			t.Fatal(err)
		}
		text := strings.Join(args, " ")
		if !strings.Contains(text, "kmod") || strings.Contains(text, "procps") || strings.Count(text, "kmod") != 1 {
			t.Fatal(args)
		}
		if name == "apt-get" && (!strings.Contains(text, "--no-upgrade") || !strings.Contains(text, "--no-remove")) {
			t.Fatal(args)
		}
		if strings.Contains(text, "linux-image") || strings.Contains(text, "nsenter") {
			t.Fatal("customer/kernel dependency introduced")
		}
	}
	if _, _, err := toolPackages("ID=unknown", []string{"modprobe"}); err == nil {
		t.Fatal("unknown OS installed")
	}
	old := "# Incudal managed TCP BBR\n# administrator addition\nnet.ipv4.tcp_keepalive_time=123\nnet.ipv4.tcp_congestion_control=cubic\n"
	desired := "# Incudal managed TCP BBR\nnet.ipv4.tcp_congestion_control=bbr\n"
	next := appendRequired(old, desired)
	if next != old+"net.ipv4.tcp_congestion_control=bbr\n" || appendRequired(next, desired) != next {
		t.Fatal(next)
	}
}
