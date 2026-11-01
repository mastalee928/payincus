package abuse

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

var errUnsupported = errors.New("unsupported customer network")

type network struct {
	Name    string            `json:"name"`
	Type    string            `json:"type"`
	Managed bool              `json:"managed"`
	Config  map[string]string `json:"config"`
}
type instance struct {
	Project         string                       `json:"project"`
	ExpandedDevices map[string]map[string]string `json:"expanded_devices"`
}

func discoverNetworks(networks []network, instances []instance) ([]string, bool, error) {
	managed := map[string]network{}
	var bridges []string
	ipv6 := false
	for _, n := range networks {
		if n.Managed && n.Type == "bridge" {
			if n.Config["bridge.external_interfaces"] != "" || n.Config["bridge.mode"] == "fan" ||
				(n.Config["bridge.driver"] != "" && n.Config["bridge.driver"] != "native") {
				return nil, false, fmt.Errorf("%w: external, fan or non-native bridge", errUnsupported)
			}
			managed[n.Name] = n
			bridges = append(bridges, n.Name)
			if address := n.Config["ipv6.address"]; address != "" && address != "none" {
				ipv6 = true
			}
		}
	}
	for _, inst := range instances {
		for _, nic := range inst.ExpandedDevices {
			if nic["type"] != "nic" {
				continue
			}
			if nic["nictype"] != "" && nic["nictype"] != "bridged" {
				return nil, false, fmt.Errorf("%w: NIC is not bridged", errUnsupported)
			}
			name := nic["network"]
			if name == "" {
				name = nic["parent"]
			}
			if _, ok := managed[name]; !ok || (nic["network"] != "" && inst.Project != "" && inst.Project != "default") {
				return nil, false, fmt.Errorf("%w: NIC bridge ownership is unverified", errUnsupported)
			}
			if nic["vlan"] != "" || nic["vlan.tagged"] != "" {
				return nil, false, fmt.Errorf("%w: VLAN egress requires separate coverage", errUnsupported)
			}
			for key, value := range nic {
				if strings.HasPrefix(key, "ipv6.") && value != "" && value != "none" && value != "false" {
					ipv6 = true
				}
			}
		}
	}
	names, err := normalizedBridges(bridges)
	if err != nil || len(names) == 0 {
		return nil, false, fmt.Errorf("%w: no valid managed bridge", errUnsupported)
	}
	return names, ipv6, nil
}

func (e *Engine) discover(ctx context.Context) ([]string, bool, error) {
	if _, err := e.lookPath("incus"); err != nil {
		return nil, false, err
	}
	data, err := e.run(ctx, "incus", "", "network", "list", "--format=json")
	if err != nil {
		return nil, false, err
	}
	var networks []network
	if err = json.Unmarshal([]byte(data), &networks); err != nil {
		return nil, false, err
	}
	data, err = e.run(ctx, "incus", "", "list", "--all-projects", "--format=json")
	if err != nil {
		return nil, false, err
	}
	var instances []instance
	if err = json.Unmarshal([]byte(data), &instances); err != nil {
		return nil, false, err
	}
	return discoverNetworks(networks, instances)
}
