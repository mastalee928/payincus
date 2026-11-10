// Package guestguard isolates customer networks from host/cloud management.
// Rules live outside the guest and never filter host OUTPUT or flush other tables.
package guestguard

import (
	"fmt"
	"net/netip"
	"regexp"
	"sort"
	"strings"
)

const Table = "incudal_guest_guard"
const ReadyKey = "user.payincus.guest-guard"

var interfaceName = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,14}$`)

type Policy struct {
	Bridges    []string `json:"bridges"`
	Management []string `json:"management"`
}

func normalize(p Policy) (Policy, error) {
	if len(p.Bridges) > 256 || len(p.Management) > 256 {
		return p, fmt.Errorf("guest protection inventory exceeds limit")
	}
	names, addresses := map[string]bool{}, map[string]bool{}
	for _, name := range p.Bridges {
		if !interfaceName.MatchString(name) || name == "lo" || name == "incudal-mgmt" {
			return p, fmt.Errorf("invalid customer bridge")
		}
		names[name] = true
	}
	if len(names) == 0 {
		return p, fmt.Errorf("no customer bridge")
	}
	for _, value := range p.Management {
		a, err := netip.ParseAddr(value)
		a = a.Unmap()
		if err != nil || a.Zone() != "" || a.IsUnspecified() || a.IsMulticast() || a.IsLoopback() || a.IsLinkLocalUnicast() {
			return p, fmt.Errorf("invalid management address")
		}
		addresses[a.Unmap().String()] = true
	}
	if len(names) > 128 || len(addresses) > 128 {
		return p, fmt.Errorf("guest protection inventory exceeds limit")
	}
	p = Policy{}
	for name := range names {
		p.Bridges = append(p.Bridges, name)
	}
	for address := range addresses {
		p.Management = append(p.Management, address)
	}
	sort.Strings(p.Bridges)
	sort.Strings(p.Management)
	return p, nil
}

func Rules(policy Policy) (string, error) {
	p, err := normalize(policy)
	if err != nil {
		return "", err
	}
	lines := []string{"table inet " + Table + " {"}
	// Priority -110 is after conntrack but before DNAT. Otherwise a local DNAT
	// alias could launder metadata traffic into a permitted destination.
	lines = append(lines, " chain before_nat { type filter hook prerouting priority -110; policy accept;")
	for _, b := range p.Bridges {
		lines = append(lines, fmt.Sprintf(" iifname %q ct direction original ip daddr 169.254.0.0/16 counter drop", b))
	}
	lines = append(lines, " }", " chain input { type filter hook input priority -25; policy accept;")
	for _, b := range p.Bridges {
		lines = append(lines, fmt.Sprintf(" iifname %q ct direction reply return", b),
			fmt.Sprintf(" iifname %q udp dport { 53, 67, 547 } return", b), fmt.Sprintf(" iifname %q tcp dport 53 return", b),
			fmt.Sprintf(" iifname %q ip6 hoplimit 255 icmpv6 type { nd-neighbor-solicit, nd-neighbor-advert, nd-router-solicit } return", b),
			fmt.Sprintf(" iifname %q counter drop", b))
	}
	lines = append(lines, " }", " chain forward { type filter hook forward priority -25; policy accept;")
	for _, b := range p.Bridges {
		// No established/related exemption: also closes existing metadata sessions.
		lines = append(lines, fmt.Sprintf(" iifname %q ip daddr 169.254.0.0/16 counter drop", b),
			fmt.Sprintf(" iifname %q ct direction original ip daddr { 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8, 0.0.0.0/8 } counter drop", b),
			fmt.Sprintf(" iifname %q ct direction original ip6 daddr { fc00::/7, fe80::/10, ::1/128 } counter drop", b),
			fmt.Sprintf(" iifname %q ct direction original oifname \"incudal-mgmt\" counter drop", b))
		for _, a := range p.Management {
			family := "ip"
			if netip.MustParseAddr(a).Is6() {
				family = "ip6"
			}
			// Public web services may share the control IP; keep the customer portal
			// and HTTPS downloads. All other customer-initiated management probes drop.
			// Replies to the control plane's SNATed validation must remain possible.
			lines = append(lines, fmt.Sprintf(" iifname %q ct direction original %s daddr %s meta l4proto != tcp counter drop", b, family, a),
				fmt.Sprintf(" iifname %q ct direction original %s daddr %s tcp dport != { 80, 443 } counter drop", b, family, a))
		}
	}
	lines = append(lines, " }", " chain validation_source { type nat hook postrouting priority 90; policy accept;")
	for _, b := range p.Bridges {
		for _, a := range p.Management {
			family := "ip"
			if netip.MustParseAddr(a).Is6() {
				family = "ip6"
			}
			// Only inbound DNAT connections from known management addresses. Normal
			// customer connections retain their real remote source; public validation
			// still crosses the external address, firewall and full-address forward.
			lines = append(lines, fmt.Sprintf(" iifname != %q oifname %q ct direction original ct status dnat %s saddr %s masquerade", b, b, family, a))
		}
	}
	return strings.Join(append(lines, " }", "}"), "\n") + "\n", nil
}
