//go:build linux

package provisioning

import "testing"

func TestBoundedCommandOutputNeverSilentlyTruncatesJSON(t *testing.T) {
	var out limitedBuffer
	data := make([]byte, 300000)
	out.Write(data)
	if out.overflow || len(out.data) != len(data) {
		t.Fatal("normal generated cloud-init configuration truncated")
	}
	out.Write(make([]byte, 1048576))
	if !out.overflow || len(out.data) != 1048576 {
		t.Fatal("excessive output must be flagged and bounded")
	}
}

func TestRepairPlanProtectsExistingPackages(t *testing.T) {
	for _, v := range []string{"(1/1) Upgrading incus (7.0.2-r0)", "(1/1) Downgrading openssh (9.1-r0)", "(1/1) Purging linux-lts (6.0-r0)"} {
		if safePlan(v, true) == nil {
			t.Fatal("unsafe apk plan accepted", v)
		}
	}
	for _, v := range []string{"Inst openssh-server [9.0] (9.1 Debian:stable)", "Remv incus [7.0]"} {
		if safePlan(v, false) == nil {
			t.Fatal("unsafe apt plan accepted", v)
		}
	}
	if safePlan("(1/2) Installing apparmor-utils (4.1.7-r1)\n(2/2) Installing libapparmor (4.1.7-r1)", true) != nil {
		t.Fatal("same-branch tool plan rejected")
	}
	if safePlan("Inst apparmor [3.0] (3.0 Debian:stable)", false) != nil {
		t.Fatal("tool repair rejected")
	}
	if safePlan("Inst libpopt0 (1.19 Debian:stable [arm64])", false) != nil {
		t.Fatal("new dependency architecture was mistaken for an installed version")
	}
}
