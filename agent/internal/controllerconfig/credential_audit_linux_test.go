package controllerconfig

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSSHEffectiveAuthenticationMustDisableEveryMethod(t *testing.T) {
	base := "pubkeyauthentication no\npasswordauthentication no\nkbdinteractiveauthentication no\ngssapiauthentication no\nhostbasedauthentication no\npermitrootlogin no\nusepam no\n"
	valid, err := sshAuthenticationDisabled(base + "hostkey /etc/ssh/a\nhostkey /etc/ssh/b\nacceptenv LANG\nacceptenv LC_*\n")
	if err != nil || !valid {
		t.Fatal("normal repeated non-auth settings rejected")
	}
	for _, field := range []string{"pubkeyauthentication", "passwordauthentication", "kbdinteractiveauthentication", "gssapiauthentication", "hostbasedauthentication", "permitrootlogin", "usepam"} {
		valid, err = sshAuthenticationDisabled(strings.Replace(base, field+" no", field+" yes", 1))
		if err != nil || valid {
			t.Fatal("authentication bypass accepted: " + field)
		}
	}
	if valid, err = sshAuthenticationDisabled(base + "passwordauthentication no\n"); err == nil || valid {
		t.Fatal("duplicate security directive accepted")
	}
	if valid, err = sshAuthenticationDisabled(strings.Replace(base, "usepam no\n", "", 1)); err != nil || valid {
		t.Fatal("missing auth configuration treated as disabled")
	}
}

func TestReviewedSchedulerTreeHashRejectsChangesAndWritableFiles(t *testing.T) {
	if os.Geteuid() != 0 {
		t.Skip("protected root filesystem test")
	}
	home, _ := os.UserHomeDir()
	dir, err := os.MkdirTemp(home, ".incudal-scheduler-tree-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)
	file := filepath.Join(dir, "daemon.service")
	if os.WriteFile(file, []byte("[Service]\nExecStart=/usr/bin/false\n"), 0644) != nil {
		t.Fatal("file")
	}
	first, err := WriterSchedulerTreeHash(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	if os.Symlink(file, filepath.Join(dir, "alias.service")) != nil {
		t.Fatal("alias")
	}
	second, err := WriterSchedulerTreeHash(context.Background(), dir)
	if err != nil || second == first {
		t.Fatal("alias not bound in manifest")
	}
	os.WriteFile(file, []byte("[Service]\nExecStart=/usr/bin/true\n"), 0644)
	third, err := WriterSchedulerTreeHash(context.Background(), dir)
	if err != nil || third == second {
		t.Fatal("configuration change not detected")
	}
	os.Chmod(file, 0666)
	if _, err = WriterSchedulerTreeHash(context.Background(), dir); err == nil {
		t.Fatal("writable scheduled job accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err = WriterSchedulerTreeHash(ctx, dir); err == nil {
		t.Fatal("cancel ignored")
	}
}
