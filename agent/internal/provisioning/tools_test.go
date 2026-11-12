package provisioning

import (
	"testing"
)

func TestDistributionPackages(t *testing.T) {
	for _, release := range []string{"ID=alpine\nVERSION_ID=3.22.2", "ID=\"alpine\"\nVERSION_ID=3.24.3", "ID=debian", "ID=ubuntu"} {
		p, err := packagesFor(release)
		if err != nil || len(p) != 6 {
			t.Fatalf("missing tools: %v", err)
		}
		if p[0] != "apparmor" && p[0] != "apparmor-utils" {
			t.Fatal(p)
		}
	}
	if _, err := packagesFor("ID=unknown"); err == nil {
		t.Fatal("unsupported distribution accepted")
	}
}
