package dedicatedipv6

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

const ociMetadataURL = "http://169.254.169.254/opc/v2/vnics"
const ociUplinkStatePath = "/var/lib/incudal-agent/oci-ipv6.json"
const ociInputTable = "incudal_oci_ipv6_input"
const ociRouteMetric = "42760"

var ociInterfaceName = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,14}$`)
var ociHTTPClient = &http.Client{
	Timeout: 3 * time.Second,
	Transport: &http.Transport{
		// IMDS must stay on the host. Never forward its Authorization header to
		// an environment proxy or follow a redirect to another destination.
		Proxy:                 nil,
		DialContext:           (&net.Dialer{Timeout: time.Second}).DialContext,
		ResponseHeaderTimeout: 2 * time.Second,
	},
	CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse },
}

type ociVNIC struct {
	ID        string    `json:"vnicId"`
	MAC       string    `json:"macAddr"`
	Addresses *[]string `json:"ipv6Addresses"`
	Gateway   string    `json:"ipv6VirtualRouterIp"`
}

type ociUplink struct {
	Name      string   `json:"name"`
	MAC       string   `json:"mac"`
	Addresses []string `json:"addresses"`
	Gateway   string   `json:"gateway"`
}

type ociUplinkState struct {
	Version int         `json:"version"`
	Uplinks []ociUplink `json:"uplinks"`
}

func readOCIVNICs(ctx context.Context, client *http.Client) ([]ociVNIC, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, ociMetadataURL, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Bearer Oracle")
	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("read OCI IPv6 allocation: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound || response.StatusCode == http.StatusUnauthorized {
		return nil, nil // Non-OCI hosts keep their existing network configuration.
	}
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("OCI IPv6 metadata status %d", response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 1024*1024+1))
	if err != nil {
		return nil, err
	}
	if len(body) > 1024*1024 {
		return nil, fmt.Errorf("OCI IPv6 metadata too large")
	}
	var vnics []ociVNIC
	if err := json.Unmarshal(body, &vnics); err != nil {
		return nil, fmt.Errorf("invalid OCI VNIC metadata")
	}
	if len(vnics) > 256 {
		return nil, fmt.Errorf("too many OCI VNICs")
	}
	return vnics, nil
}

func normalizeOCIMAC(raw string) (string, error) {
	mac, err := net.ParseMAC(raw)
	if err != nil || len(mac) != 6 {
		return "", fmt.Errorf("invalid OCI VNIC MAC")
	}
	return mac.String(), nil
}

func normalizeOCIAddresses(raw []string) ([]string, error) {
	seen := map[string]bool{}
	addresses := []string{}
	for _, value := range raw {
		address, ok := publicAddress(value)
		if !ok {
			return nil, fmt.Errorf("invalid OCI public IPv6 allocation")
		}
		if !seen[address.String()] {
			addresses = append(addresses, address.String())
			seen[address.String()] = true
		}
	}
	sort.Strings(addresses)
	return addresses, nil
}

// Match the cloud VNIC to a physical kernel interface, never a bridge, guest,
// guessed /64, or a cloud VNIC that is not attached to this operating system.
func planOCIUplinks(vnics []ociVNIC, physical []net.Interface) ([]ociUplink, error) {
	byMAC := map[string]net.Interface{}
	for _, nic := range physical {
		if !ociInterfaceName.MatchString(nic.Name) || len(nic.HardwareAddr) != 6 {
			continue
		}
		if _, duplicate := byMAC[nic.HardwareAddr.String()]; duplicate {
			return nil, fmt.Errorf("ambiguous physical MAC")
		}
		byMAC[nic.HardwareAddr.String()] = nic
	}
	plans := []ociUplink{}
	seen := map[string]bool{}
	for _, vnic := range vnics {
		if !strings.HasPrefix(vnic.ID, "ocid1.vnic.") {
			return nil, fmt.Errorf("invalid OCI VNIC identity")
		}
		mac, err := normalizeOCIMAC(vnic.MAC)
		if err != nil {
			return nil, err
		}
		nic, attached := byMAC[mac]
		if !attached || vnic.Addresses == nil {
			continue
		}
		if seen[mac] {
			return nil, fmt.Errorf("duplicate OCI VNIC")
		}
		seen[mac] = true
		if len(*vnic.Addresses) > 256 {
			return nil, fmt.Errorf("too many OCI IPv6 addresses")
		}
		addresses, err := normalizeOCIAddresses(*vnic.Addresses)
		if err != nil {
			return nil, err
		}
		gateway := ""
		if len(addresses) != 0 {
			parsed, err := netip.ParseAddr(vnic.Gateway)
			if err != nil || parsed.Zone() != "" || !parsed.Is6() || !parsed.IsLinkLocalUnicast() {
				return nil, fmt.Errorf("invalid OCI IPv6 router")
			}
			gateway = parsed.String()
		}
		plans = append(plans, ociUplink{Name: nic.Name, MAC: mac, Addresses: addresses, Gateway: gateway})
	}
	return plans, nil
}

func loadOCIUplinkState(path string) (ociUplinkState, error) {
	state := ociUplinkState{Version: 1}
	file, err := os.Open(path)
	if os.IsNotExist(err) {
		return state, nil
	}
	if err != nil {
		return state, err
	}
	defer file.Close()
	body, err := io.ReadAll(io.LimitReader(file, 1024*1024+1))
	if err != nil {
		return state, err
	}
	if len(body) > 1024*1024 || json.Unmarshal(body, &state) != nil || state.Version != 1 || len(state.Uplinks) > 256 {
		return state, fmt.Errorf("invalid managed OCI IPv6 state")
	}
	seen := map[string]bool{}
	for _, uplink := range state.Uplinks {
		mac, err := normalizeOCIMAC(uplink.MAC)
		if err != nil || mac != uplink.MAC || !ociInterfaceName.MatchString(uplink.Name) || seen[mac] {
			return state, fmt.Errorf("invalid managed OCI IPv6 interface")
		}
		seen[mac] = true
		if len(uplink.Addresses) > 512 {
			return state, fmt.Errorf("managed OCI IPv6 journal too large")
		}
		if _, err := normalizeOCIAddresses(uplink.Addresses); err != nil {
			return state, err
		}
	}
	return state, nil
}

func saveOCIUplinkState(path string, state ociUplinkState) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	body, err := json.Marshal(state)
	if err != nil {
		return err
	}
	file, err := os.CreateTemp(filepath.Dir(path), ".oci-ipv6-")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if _, err := file.Write(body); err != nil {
		file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(file.Name(), path)
}

func ociInputRules(uplinks []ociUplink) string {
	lines := []string{"table ip6 " + ociInputTable + " {", " chain input { type filter hook input priority -15; policy accept;"}
	for _, uplink := range uplinks {
		for _, address := range uplink.Addresses {
			match := fmt.Sprintf(" iifname %q ip6 daddr %s ", uplink.Name, address)
			// Forwarded packets take FORWARD, not INPUT. These rules keep host
			// SSH/services private before an instance is ready and after deletion.
			lines = append(lines, match+"ct state established,related return", match+"meta l4proto ipv6-icmp return", match+"reject with icmpv6 type admin-prohibited")
		}
	}
	return strings.Join(append(lines, " }", "}"), "\n") + "\n"
}

func protectOCIUplinks(ctx context.Context, uplinks []ociUplink) error {
	rules := ociInputRules(uplinks)
	if exec.CommandContext(ctx, "nft", "list", "table", "ip6", ociInputTable).Run() == nil {
		rules = "delete table ip6 " + ociInputTable + "\n" + rules
	}
	command := exec.CommandContext(ctx, "nft", "-f", "-")
	command.Stdin = strings.NewReader(rules)
	if err := command.Run(); err != nil {
		return fmt.Errorf("protect OCI IPv6 host services: %w", err)
	}
	return nil
}

func runOCIIP(ctx context.Context, args ...string) error {
	if err := exec.CommandContext(ctx, "ip", args...).Run(); err != nil {
		return fmt.Errorf("configure OCI IPv6 interface: %w", err)
	}
	return nil
}

func interfaceOCIAddresses(name string) (map[string]int, error) {
	nic, err := net.InterfaceByName(name)
	if err != nil {
		return nil, err
	}
	values, err := nic.Addrs()
	if err != nil {
		return nil, err
	}
	addresses := map[string]int{}
	for _, value := range values {
		prefix, err := netip.ParsePrefix(value.String())
		if err == nil {
			addresses[prefix.Addr().String()] = prefix.Bits()
		}
	}
	return addresses, nil
}

func applyOCIUplinks(ctx context.Context, plans []ociUplink, path string) error {
	previous, err := loadOCIUplinkState(path)
	if err != nil {
		return err
	}
	byMAC := map[string]ociUplink{}
	for _, uplink := range previous.Uplinks {
		byMAC[uplink.MAC] = uplink
	}
	staged := map[string]ociUplink{}
	for mac, uplink := range byMAC {
		staged[mac] = uplink
	}
	for _, plan := range plans {
		if !ociInterfaceName.MatchString(plan.Name) {
			return fmt.Errorf("invalid OCI interface name")
		}
		if _, err := normalizeOCIAddresses(plan.Addresses); err != nil {
			return err
		}
		nic, err := net.InterfaceByName(plan.Name)
		if err != nil || nic.HardwareAddr.String() != plan.MAC {
			return fmt.Errorf("OCI physical interface changed")
		}
		addresses := append(append([]string{}, byMAC[plan.MAC].Addresses...), plan.Addresses...)
		// The retry journal can contain the old and new set while an address
		// change is in progress. Each authoritative set is capped at 256.
		seen := map[string]bool{}
		combined := []string{}
		for _, address := range addresses {
			if !seen[address] {
				combined = append(combined, address)
				seen[address] = true
			}
		}
		if len(combined) > 512 {
			return fmt.Errorf("OCI IPv6 change exceeds managed address limit")
		}
		copy := plan
		copy.Addresses = combined
		staged[plan.MAC] = copy
	}
	stateOf := func(rows map[string]ociUplink) ociUplinkState {
		state := ociUplinkState{Version: 1, Uplinks: []ociUplink{}}
		for _, row := range rows {
			state.Uplinks = append(state.Uplinks, row)
		}
		sort.Slice(state.Uplinks, func(i, j int) bool { return state.Uplinks[i].MAC < state.Uplinks[j].MAC })
		return state
	}
	// Protect first; persist ownership before mutations so interrupted work is
	// retried. An unavailable/missing metadata field never reaches this stage.
	if err := protectOCIUplinks(ctx, stateOf(staged).Uplinks); err != nil {
		return err
	}
	if err := saveOCIUplinkState(path, stateOf(staged)); err != nil {
		return err
	}
	for _, plan := range plans {
		if err := ctx.Err(); err != nil {
			return err
		}
		if len(plan.Addresses) != 0 {
			if err := os.WriteFile("/proc/sys/net/ipv6/conf/"+plan.Name+"/disable_ipv6", []byte("0\n"), 0); err != nil {
				return err
			}
			if err := runOCIIP(ctx, "-6", "route", "replace", "default", "via", plan.Gateway, "dev", plan.Name, "proto", "186", "metric", ociRouteMetric); err != nil {
				return err
			}
		}
		current, err := interfaceOCIAddresses(plan.Name)
		if err != nil {
			return err
		}
		desired := map[string]bool{}
		for _, address := range plan.Addresses {
			desired[address] = true
			if _, exists := current[address]; !exists {
				if err := runOCIIP(ctx, "-6", "addr", "add", address+"/128", "dev", plan.Name); err != nil {
					return err
				}
			}
		}
		for _, address := range byMAC[plan.MAC].Addresses {
			if prefix, exists := current[address]; exists && !desired[address] {
				if err := runOCIIP(ctx, "-6", "addr", "del", address+"/"+strconv.Itoa(prefix), "dev", plan.Name); err != nil {
					return err
				}
			}
		}
		if len(plan.Addresses) == 0 {
			if err := runOCIIP(ctx, "-6", "route", "flush", "exact", "::/0", "dev", plan.Name, "proto", "186", "metric", ociRouteMetric); err != nil {
				return err
			}
		}
		staged[plan.MAC] = plan
	}
	return saveOCIUplinkState(path, stateOf(staged))
}

func reconcileOCIUplinks(ctx context.Context, physicalNames []string) error {
	// Only the managed OCI installation opts in. Unlisted manual addresses and
	// routed subnets are never adopted, inferred, or removed.
	if _, err := net.InterfaceByName("incudal-mgmt"); err != nil {
		return nil
	}
	vnics, err := readOCIVNICs(ctx, ociHTTPClient)
	if err != nil {
		return err
	}
	physical := []net.Interface{}
	for _, name := range physicalNames {
		nic, err := net.InterfaceByName(name)
		if err != nil {
			return err
		}
		physical = append(physical, *nic)
	}
	plans, err := planOCIUplinks(vnics, physical)
	if err != nil || len(plans) == 0 {
		return err
	}
	return applyOCIUplinks(ctx, plans, ociUplinkStatePath)
}
