package guestguard

import (
	"context"
	"fmt"
	"strings"
)

// Older OCI setup rejects even replies to the host's own guest connections.
// Narrowly repair our chains; never alter unrelated firewall policy. nft still
// filters metadata and guest-initiated management access before these chains.
func repairLegacyReplies(ctx context.Context, run runner, p Policy) error {
	for _, tool := range []string{"iptables", "ip6tables"} {
		rules, err := run(ctx, tool, "", "-w", "2", "-S")
		if err != nil {
			return err
		}
		for _, chain := range []string{"INCUDAL_OCI_IN", "INCUDAL_OCI_FWD"} {
			if !strings.Contains("\n"+rules, "\n-N "+chain+"\n") {
				continue
			}
			for _, bridge := range p.Bridges {
				expected := fmt.Sprintf("-A %s -i %s -m conntrack --ctdir REPLY -j ACCEPT", chain, bridge)
				if strings.Contains("\n"+rules+"\n", "\n"+expected+"\n") {
					continue
				}
				if _, err := run(ctx, tool, "", "-w", "2", "-I", chain, "1", "-i", bridge, "-m", "conntrack", "--ctdir", "REPLY", "-j", "ACCEPT"); err != nil {
					return err
				}
			}
		}
	}
	return nil
}
