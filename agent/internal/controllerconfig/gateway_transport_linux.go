package controllerconfig

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// ApplyGatewayTransport reconciles one fixed gateway interface, peer allowlist
// and peer host routes. No forwarding/customer/NAT rules or arbitrary commands
// are accepted. Tombstones and peer identities survive historical restores.
func ApplyGatewayTransport(ctx context.Context, encoded []byte, trust Context, directory, keyPath string, restore bool) error {
	if os.Geteuid() != 0 || safeChannelDirectory(directory) != nil {
		return failure("GATEWAY_TRANSPORT_PERMISSION")
	}
	lock, err := openStateFile(filepath.Join(directory, "gateway.lock"), syscall.O_CREAT|syscall.O_RDWR)
	if err != nil {
		return err
	}
	defer lock.Close()
	if syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB) != nil {
		return failure("GATEWAY_TRANSPORT_BUSY")
	}
	defer syscall.Flock(int(lock.Fd()), syscall.LOCK_UN)
	statePath := filepath.Join(directory, "gateway-transport.json")
	prior, err := channelReadFile(statePath, MaxGatewayTransportBytes)
	var old *GatewayTransport
	if err == nil {
		var env envelope
		var payload GatewayTransport
		if decodeStrict(prior, &env) != nil {
			return failure("GATEWAY_TRANSPORT_STATE")
		}
		raw, e := base64.StdEncoding.Strict().DecodeString(env.Payload)
		if e != nil || decodeStrict(raw, &payload) != nil {
			return failure("GATEWAY_TRANSPORT_STATE")
		}
		historical := trust
		historical.Now = payload.IssuedAt
		historical.Previous = nil
		checked, observed, e := VerifyGatewayTransport(prior, historical)
		if e != nil {
			return e
		}
		old = &checked
		trust.Previous = &observed
	} else if !os.IsNotExist(err) {
		return err
	} else if _, err := channelReadFile(filepath.Join(directory, "gateway-identity.json"), 4096); !os.IsNotExist(err) {
		return failure("GATEWAY_TRANSPORT_STATE")
	}
	trust.Now = time.Now().UnixMilli()
	if restore {
		if old == nil {
			return failure("GATEWAY_TRANSPORT_STATE")
		}
		encoded = prior
		trust.Now = old.IssuedAt
	}
	config, _, err := VerifyGatewayTransport(encoded, trust)
	if err != nil {
		return err
	}
	if old != nil {
		if old.Slot != config.Slot || old.Address != config.Address || old.ListenPort != config.ListenPort {
			return failure("GATEWAY_TRANSPORT_REPLACEMENT_REQUIRED")
		}
		for _, peer := range old.Peers {
			found := false
			for _, next := range config.Peers {
				if next.NodeID == peer.NodeID {
					found = true
					if next.PublicKey != peer.PublicKey || next.Address != peer.Address || (!peer.Enabled && next.Enabled) {
						return failure("GATEWAY_TRANSPORT_PEER_CONFLICT")
					}
				}
			}
			if !found {
				return failure("GATEWAY_TRANSPORT_TOMBSTONE_REQUIRED")
			}
		}
	}
	keyRaw, err := channelReadFile(keyPath, 64)
	if err != nil {
		return err
	}
	key := strings.TrimSuffix(string(keyRaw), "\n")
	if _, err = decodeBase64(key, 32); err != nil {
		return err
	}
	pub, err := gatewayCommand(ctx, "/usr/bin/wg", []string{"pubkey"}, key+"\n")
	if err != nil {
		return err
	}
	pub = strings.TrimSpace(pub)
	manifest, err := canonical(struct {
		PlatformID string `json:"platformId"`
		GatewayID  string `json:"gatewayId"`
		PublicKey  string `json:"publicKey"`
	}{config.PlatformID, config.GatewayID, pub})
	if err != nil {
		return err
	}
	marker, markerErr := channelReadFile(filepath.Join(directory, "gateway-identity.json"), 4096)
	if markerErr == nil && string(marker) != string(manifest) {
		return failure("GATEWAY_TRANSPORT_IDENTITY")
	}
	if markerErr != nil && !os.IsNotExist(markerErr) {
		return markerErr
	}
	name := "incudal-gw-" + config.Slot
	alias := "payincus-gateway/v1/" + config.PlatformID + "/" + config.GatewayID
	all, err := gatewayCommand(ctx, "/usr/sbin/ip", []string{"-j", "link", "show"}, "")
	if err != nil {
		return err
	}
	var links []struct {
		Name  string `json:"ifname"`
		Alias string `json:"ifalias"`
	}
	if json.Unmarshal([]byte(all), &links) != nil {
		return failure("GATEWAY_TRANSPORT_LINK")
	}
	found := false
	for _, link := range links {
		if link.Name == name {
			found = true
			if link.Alias != alias {
				return failure("GATEWAY_TRANSPORT_LINK_CONFLICT")
			}
		}
	}
	if found {
		actual, err := gatewayCommand(ctx, "/usr/bin/wg", []string{"show", name, "public-key"}, "")
		if err != nil || strings.TrimSpace(actual) != pub {
			return failure("GATEWAY_TRANSPORT_LINK_CONFLICT")
		}
		// Preserve only exact previously enrolled peers. Unknown local peers
		// cannot be silently removed by a downloaded replacement allowlist.
		actual, err = gatewayCommand(ctx, "/usr/bin/wg", []string{"show", name, "peers"}, "")
		if err != nil {
			return err
		}
		for _, value := range strings.Fields(actual) {
			known := false
			if old != nil {
				for _, peer := range old.Peers {
					if peer.PublicKey == value {
						known = true
					}
				}
			}
			if !known {
				return failure("GATEWAY_TRANSPORT_FOREIGN_PEER")
			}
		}
	}
	addresses := map[string]bool{config.Address: true}
	for _, peer := range config.Peers {
		addresses[peer.Address] = true
	}
	all, err = gatewayCommand(ctx, "/usr/sbin/ip", []string{"-j", "-4", "address", "show"}, "")
	if err != nil {
		return err
	}
	var interfaceAddresses []struct {
		Name   string `json:"ifname"`
		Values []struct {
			Local  string `json:"local"`
			Prefix int    `json:"prefixlen"`
		} `json:"addr_info"`
	}
	if json.Unmarshal([]byte(all), &interfaceAddresses) != nil {
		return failure("GATEWAY_TRANSPORT_LINK")
	}
	for _, link := range interfaceAddresses {
		for _, address := range link.Values {
			if addresses[address.Local] && (link.Name != name || address.Local != config.Address || address.Prefix != 32) {
				return failure("GATEWAY_TRANSPORT_ADDRESS_CONFLICT")
			}
			if link.Name == name && address.Local != config.Address {
				return failure("GATEWAY_TRANSPORT_ADDRESS_CONFLICT")
			}
		}
	}
	all, err = gatewayCommand(ctx, "/usr/sbin/ip", []string{"-j", "-4", "route", "show", "table", "all"}, "")
	if err != nil {
		return err
	}
	var routes []struct {
		Destination string `json:"dst"`
		Device      string `json:"dev"`
		Gateway     string `json:"gateway"`
	}
	if json.Unmarshal([]byte(all), &routes) != nil {
		return failure("GATEWAY_TRANSPORT_ROUTE")
	}
	for _, route := range routes {
		if route.Destination == "default" || route.Destination == "" {
			continue
		}
		cidr := route.Destination
		if !strings.Contains(cidr, "/") {
			cidr += "/32"
		}
		_, network, e := net.ParseCIDR(cidr)
		if e != nil {
			return e
		}
		for address := range addresses {
			if network.Contains(net.ParseIP(address)) && (route.Device != name || route.Gateway != "" || (route.Destination != address && route.Destination != address+"/32")) {
				return failure("GATEWAY_TRANSPORT_ROUTE_CONFLICT")
			}
		}
	}
	if os.IsNotExist(markerErr) {
		if err = saveGatewayFile(directory, "gateway-identity.json", manifest, true); err != nil {
			return err
		}
	}
	if err = saveGatewayFile(directory, "gateway-transport.json", encoded, false); err != nil {
		return err
	}
	if !restore && time.Now().UnixMilli() >= config.ExpiresAt {
		return failure("GATEWAY_TRANSPORT_EXPIRED")
	}
	if !found {
		if _, err = gatewayCommand(ctx, "/usr/sbin/ip", []string{"link", "add", name, "type", "wireguard"}, ""); err != nil {
			return err
		}
		if _, err = gatewayCommand(ctx, "/usr/sbin/ip", []string{"link", "set", "dev", name, "alias", alias}, ""); err != nil {
			return err
		}
	}
	var wireguard strings.Builder
	fmt.Fprintf(&wireguard, "[Interface]\nPrivateKey = %s\nListenPort = %d\n", key, config.ListenPort)
	for _, peer := range config.Peers {
		if peer.Enabled {
			fmt.Fprintf(&wireguard, "[Peer]\nPublicKey = %s\nAllowedIPs = %s/32\n", peer.PublicKey, peer.Address)
		}
	}
	if _, err = gatewayCommand(ctx, "/usr/bin/wg", []string{"syncconf", name, "/dev/stdin"}, wireguard.String()); err != nil {
		return err
	}
	for _, args := range [][]string{{"address", "replace", config.Address + "/32", "dev", name}, {"link", "set", "dev", name, "mtu", strconv.Itoa(config.MTU), "up"}} {
		if _, err = gatewayCommand(ctx, "/usr/sbin/ip", args, ""); err != nil {
			return err
		}
	}
	for _, peer := range config.Peers {
		if peer.Enabled {
			if _, err = gatewayCommand(ctx, "/usr/sbin/ip", []string{"route", "replace", peer.Address + "/32", "dev", name, "src", config.Address, "proto", "static"}, ""); err != nil {
				return err
			}
		} else {
			for _, route := range routes {
				if route.Device == name && (route.Destination == peer.Address || route.Destination == peer.Address+"/32") {
					if _, err = gatewayCommand(ctx, "/usr/sbin/ip", []string{"route", "del", peer.Address + "/32", "dev", name}, ""); err != nil {
						return err
					}
				}
			}
		}
	}
	actual, err := gatewayCommand(ctx, "/usr/bin/wg", []string{"show", name, "allowed-ips"}, "")
	if err != nil {
		return err
	}
	expected := map[string]string{}
	for _, peer := range config.Peers {
		if peer.Enabled {
			expected[peer.PublicKey] = peer.Address + "/32"
		}
	}
	for _, line := range strings.Split(strings.TrimSpace(actual), "\n") {
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) != 2 || expected[fields[0]] != fields[1] {
			return failure("GATEWAY_TRANSPORT_VERIFY")
		}
		delete(expected, fields[0])
	}
	if len(expected) != 0 {
		return failure("GATEWAY_TRANSPORT_VERIFY")
	}
	return nil
}

func saveGatewayFile(directory, name string, raw []byte, exclusive bool) error {
	path := filepath.Join(directory, name)
	if !exclusive {
		existing, err := openStateFile(path, syscall.O_RDONLY)
		if err == nil {
			existing.Close()
		} else if !os.IsNotExist(err) {
			return err
		}
	}
	if exclusive {
		file, err := openStateFile(path, syscall.O_WRONLY|syscall.O_CREAT|syscall.O_EXCL)
		if err != nil {
			return err
		}
		defer file.Close()
		if _, err = file.Write(raw); err != nil {
			return err
		}
		if file.Sync() != nil {
			return failure("GATEWAY_TRANSPORT_STATE")
		}
	} else {
		file, err := os.CreateTemp(directory, ".gateway-")
		if err != nil {
			return err
		}
		temp := file.Name()
		defer os.Remove(temp)
		_, err = file.Write(raw)
		syncErr := file.Sync()
		file.Close()
		if err != nil || syncErr != nil {
			return failure("GATEWAY_TRANSPORT_STATE")
		}
		if os.Rename(temp, path) != nil {
			return failure("GATEWAY_TRANSPORT_STATE")
		}
	}
	parent, err := os.Open(directory)
	if err != nil {
		return err
	}
	defer parent.Close()
	return parent.Sync()
}
