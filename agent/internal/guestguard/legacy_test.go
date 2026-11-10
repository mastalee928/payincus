package guestguard

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestLegacyRepliesAreNarrowAndIdempotent(t *testing.T) {
	rules := map[string]string{"iptables": "-N INCUDAL_OCI_IN\n-N INCUDAL_OCI_FWD\n", "ip6tables": "-N UNRELATED\n"}
	writes := 0
	run := func(_ context.Context, name, input string, args ...string) (string, error) {
		if len(args) == 3 && args[2] == "-S" {
			return rules[name], nil
		}
		if name != "iptables" || args[2] != "-I" || args[4] != "1" || strings.Join(args[5:], " ") != "-i incusbr0 -m conntrack --ctdir REPLY -j ACCEPT" {
			t.Fatal("unexpected mutation", name, args)
		}
		writes++
		rules[name] += "-A " + args[3] + " " + strings.Join(args[5:], " ") + "\n"
		return "", nil
	}
	p := Policy{Bridges: []string{"incusbr0"}}
	for i := 0; i < 2; i++ {
		if err := repairLegacyReplies(context.Background(), run, p); err != nil {
			t.Fatal(err)
		}
	}
	if writes != 2 {
		t.Fatal("legacy changes not idempotent", writes)
	}
	fail := func(context.Context, string, string, ...string) (string, error) { return "", errors.New("unavailable") }
	if err := repairLegacyReplies(context.Background(), fail, p); err == nil {
		t.Fatal("unknown rules marked ready")
	}
}
