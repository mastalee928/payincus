package guestguard

import "fmt"

type Network struct {
	Name    string            `json:"name"`
	Type    string            `json:"type"`
	Managed bool              `json:"managed"`
	Config  map[string]string `json:"config"`
}
type Instance struct {
	Project         string                       `json:"project"`
	ExpandedDevices map[string]map[string]string `json:"expanded_devices"`
}

func customerBridges(networks []Network, instances []Instance) ([]string, error) {
	managed := map[string]bool{}
	names := []string{}
	for _, n := range networks {
		if n.Managed && n.Type == "bridge" {
			if n.Config["bridge.external_interfaces"] != "" || n.Config["bridge.mode"] == "fan" || n.Config["bridge.driver"] != "" && n.Config["bridge.driver"] != "native" {
				return nil, fmt.Errorf("unsupported customer bridge topology")
			}
			managed[n.Name] = true
			names = append(names, n.Name)
		}
	}
	for _, i := range instances {
		for _, nic := range i.ExpandedDevices {
			if nic["type"] != "nic" {
				continue
			}
			name := nic["network"]
			if name == "" {
				name = nic["parent"]
			}
			if !managed[name] || i.Project != "" && i.Project != "default" || nic["nictype"] != "" && nic["nictype"] != "bridged" || nic["vlan"] != "" || nic["vlan.tagged"] != "" {
				return nil, fmt.Errorf("unsupported customer NIC topology")
			}
		}
	}
	if !managed["incusbr0"] {
		return nil, fmt.Errorf("managed customer bridge unavailable")
	}
	return names, nil
}
