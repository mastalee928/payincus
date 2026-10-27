package controllerconfig

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

func channelCommand(ctx context.Context, program string, args []string, input string) (string, error) {
	return boundedChannelCommand(ctx, program, args, input, 65536)
}

func gatewayCommand(ctx context.Context, program string, args []string, input string) (string, error) {
	return boundedChannelCommand(ctx, program, args, input, MaxGatewayTransportBytes)
}

type boundedChannelOutput struct {
	strings.Builder
	limit int
}

func (b *boundedChannelOutput) Write(raw []byte) (int, error) {
	if len(raw) > b.limit-b.Len() {
		return 0, failure("CONTROLLER_CHANNELS_EXECUTION")
	}
	return b.Builder.Write(raw)
}

func boundedChannelCommand(ctx context.Context, program string, args []string, input string, limit int) (string, error) {
	// Distribution tools can use root-owned links (Ubuntu's /usr/sbin/ip).
	// Resolve only within fixed system tool directories and verify every parent
	// before execution; no PATH lookup or request-supplied executable is used.
	resolved, err := filepath.EvalSymlinks(program)
	if err != nil || (filepath.Dir(resolved) != "/usr/bin" && filepath.Dir(resolved) != "/usr/sbin" && filepath.Dir(resolved) != "/bin" && filepath.Dir(resolved) != "/sbin") {
		return "", failure("CONTROLLER_CHANNELS_TOOL")
	}
	for _, path := range []string{program, resolved} {
		for current := path; ; current = filepath.Dir(current) {
			info, err := os.Lstat(current)
			if err != nil {
				return "", failure("CONTROLLER_CHANNELS_TOOL")
			}
			stat, ok := info.Sys().(*syscall.Stat_t)
			if !ok || stat.Uid != 0 || (info.Mode()&os.ModeSymlink == 0 && info.Mode().Perm()&0022 != 0) {
				return "", failure("CONTROLLER_CHANNELS_TOOL")
			}
			if current == filepath.Dir(current) {
				break
			}
		}
	}
	info, err := os.Lstat(resolved)
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0022 != 0 {
		return "", failure("CONTROLLER_CHANNELS_TOOL")
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || stat.Uid != 0 {
		return "", failure("CONTROLLER_CHANNELS_TOOL")
	}
	bounded, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	cmd := exec.CommandContext(bounded, resolved, args...)
	cmd.Env = []string{"PATH=/usr/sbin:/usr/bin:/sbin:/bin", "LC_ALL=C"}
	cmd.Stdin = strings.NewReader(input)
	output := boundedChannelOutput{limit: limit}
	cmd.Stdout = &output
	if cmd.Run() != nil {
		return "", failure("CONTROLLER_CHANNELS_EXECUTION")
	}
	return output.String(), nil
}
func safeChannelDirectory(directory string) error {
	if !filepath.IsAbs(directory) || filepath.Clean(directory) != directory {
		return failure("CONTROLLER_CHANNELS_PERMISSION")
	}
	for current := directory; ; current = filepath.Dir(current) {
		info, err := os.Lstat(current)
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return failure("CONTROLLER_CHANNELS_PERMISSION")
		}
		stat, ok := info.Sys().(*syscall.Stat_t)
		if !ok || stat.Uid != 0 || info.Mode().Perm()&0022 != 0 || (current == directory && info.Mode().Perm() != 0700) {
			return failure("CONTROLLER_CHANNELS_PERMISSION")
		}
		if current == filepath.Dir(current) {
			break
		}
	}
	return nil
}
func channelReadFile(path string, limit int) ([]byte, error) {
	if safeChannelDirectory(filepath.Dir(path)) != nil {
		return nil, failure("CONTROLLER_CHANNELS_PERMISSION")
	}
	file, err := openStateFile(path, syscall.O_RDONLY)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, int64(limit+1)))
	if err != nil || len(raw) > limit {
		return nil, failure("CONTROLLER_CHANNELS_STATE")
	}
	return raw, nil
}

func ReadProtectedChannelFile(path string, limit int) ([]byte, error) {
	if limit < 1 || limit > 65536 || !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return nil, failure("CONTROLLER_CHANNELS_PERMISSION")
	}
	return channelReadFile(path, limit)
}

// Gateway peer catalogs have their own bounded reader; host messages retain
// the existing smaller limit and all root/file/identity checks.
func ReadProtectedGatewayFile(path string) ([]byte, error) {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return nil, failure("CONTROLLER_CHANNELS_PERMISSION")
	}
	return channelReadFile(path, MaxGatewayTransportBytes)
}
func LockChannelService(directory string) (func(), error) {
	if safeChannelDirectory(directory) != nil {
		return nil, failure("CONTROLLER_CHANNELS_PERMISSION")
	}
	file, err := openStateFile(filepath.Join(directory, "channel-service.lock"), syscall.O_CREAT|syscall.O_RDWR)
	if err != nil {
		return nil, err
	}
	if syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB) != nil {
		file.Close()
		return nil, failure("CONTROLLER_CHANNELS_BUSY")
	}
	return func() { syscall.Flock(int(file.Fd()), syscall.LOCK_UN); file.Close() }, nil
}
func saveChannelRecord(directory string, encoded []byte) error {
	existing, err := openStateFile(filepath.Join(directory, "channels.json"), syscall.O_RDONLY)
	if err == nil {
		existing.Close()
	} else if !os.IsNotExist(err) {
		return err
	}
	file, err := os.CreateTemp(directory, ".channels-")
	if err != nil {
		return err
	}
	name := file.Name()
	defer os.Remove(name)
	if _, err = file.Write(encoded); err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err != nil || closeErr != nil {
		return failure("CONTROLLER_CHANNELS_STATE")
	}
	if os.Rename(name, filepath.Join(directory, "channels.json")) != nil {
		return failure("CONTROLLER_CHANNELS_STATE")
	}
	parent, err := os.Open(directory)
	if err != nil {
		return err
	}
	defer parent.Close()
	return parent.Sync()
}
func publicChannelEndpoint(ctx context.Context, host string) (string, error) {
	if ip := net.ParseIP(host); ip != nil {
		if !validHost(ip.String()) {
			return "", failure("CONTROLLER_CHANNELS_ENDPOINT")
		}
		return ip.String(), nil
	}
	addresses, err := net.DefaultResolver.LookupIP(ctx, "ip4", host)
	if err != nil || len(addresses) == 0 || len(addresses) > 16 {
		return "", failure("CONTROLLER_CHANNELS_ENDPOINT")
	}
	for _, ip := range addresses {
		if !validHost(ip.String()) {
			return "", failure("CONTROLLER_CHANNELS_ENDPOINT")
		}
	}
	return addresses[0].String(), nil
}

func preflightManagementChannel(ctx context.Context, channel ManagementChannel, trust Context, ownPublic string) (bool, error) {
	name := "incudal-ha-" + channel.Slot
	alias := "payincus-channel/v1/" + trust.PlatformID + "/" + trust.NodeID + "/" + channel.Slot
	raw, err := channelCommand(ctx, "/usr/sbin/ip", []string{"-j", "link", "show"}, "")
	if err != nil {
		return false, err
	}
	var links []struct {
		Name  string `json:"ifname"`
		Alias string `json:"ifalias"`
	}
	if json.Unmarshal([]byte(raw), &links) != nil {
		return false, failure("CONTROLLER_CHANNELS_LINK")
	}
	found := false
	for _, link := range links {
		if link.Name == name {
			found = true
			if link.Alias != alias {
				return false, failure("CONTROLLER_CHANNELS_LINK_CONFLICT")
			}
		}
	}
	if found {
		pub, err := channelCommand(ctx, "/usr/bin/wg", []string{"show", name, "public-key"}, "")
		if err != nil || strings.TrimSpace(pub) != ownPublic {
			return false, failure("CONTROLLER_CHANNELS_LINK_CONFLICT")
		}
		peers, err := channelCommand(ctx, "/usr/bin/wg", []string{"show", name, "peers"}, "")
		if err != nil || (strings.TrimSpace(peers) != "" && strings.TrimSpace(peers) != channel.PublicKey) {
			return false, failure("CONTROLLER_CHANNELS_LINK_CONFLICT")
		}
	}
	raw, err = channelCommand(ctx, "/usr/sbin/ip", []string{"-j", "-4", "address", "show"}, "")
	if err != nil {
		return false, err
	}
	var addresses []struct {
		Name   string `json:"ifname"`
		Values []struct {
			Local  string `json:"local"`
			Prefix int    `json:"prefixlen"`
		} `json:"addr_info"`
	}
	if json.Unmarshal([]byte(raw), &addresses) != nil {
		return false, failure("CONTROLLER_CHANNELS_LINK")
	}
	for _, link := range addresses {
		for _, address := range link.Values {
			if (address.Local == channel.NodeAddress && (link.Name != name || address.Prefix != 32)) || (link.Name == name && address.Local != channel.NodeAddress) {
				return false, failure("CONTROLLER_CHANNELS_ADDRESS_CONFLICT")
			}
		}
	}
	// Check all route tables before any replacement. Only our exact host route
	// may be updated; overlapping customer/other transport networks are refused.
	raw, err = channelCommand(ctx, "/usr/sbin/ip", []string{"-j", "-4", "route", "show", "table", "all"}, "")
	if err != nil {
		return false, err
	}
	var routes []struct {
		Destination string `json:"dst"`
		Device      string `json:"dev"`
		Gateway     string `json:"gateway"`
		Type        string `json:"type"`
	}
	if json.Unmarshal([]byte(raw), &routes) != nil {
		return false, failure("CONTROLLER_CHANNELS_ROUTE")
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
			return false, failure("CONTROLLER_CHANNELS_ROUTE")
		}
		if network.Contains(net.ParseIP(channel.ControlAddress)) || network.Contains(net.ParseIP(channel.NodeAddress)) {
			if route.Device != name || route.Gateway != "" || !(route.Destination == channel.ControlAddress+"/32" || route.Destination == channel.ControlAddress || route.Destination == channel.NodeAddress+"/32" || route.Destination == channel.NodeAddress) {
				return false, failure("CONTROLLER_CHANNELS_ROUTE_CONFLICT")
			}
		}
	}
	return found, nil
}

// ApplyManagementChannels touches only dedicated, marked management links.
// Highest signed configuration is persisted before kernel changes, so a partial
// failure can be retried but can never fall back to a lower generation. Existing
// channel identities/addresses/keys are immutable; replacement needs a separate
// explicit retirement plan. Omitted channels are retained, never auto-deleted.
func ApplyManagementChannels(ctx context.Context, encoded []byte, trust Context, directory string, local []ChannelLocalIdentity) ([]ChannelApplyResult, error) {
	return applyManagementChannels(ctx, encoded, trust, directory, local, false)
}

// Startup restores the latest local authenticated transport configuration only.
// Expired transport grants no resource writer, but must preserve recovery paths
// while the controller is offline. No downloaded expired update is used.
func RestoreManagementChannels(ctx context.Context, trust Context, directory string, local []ChannelLocalIdentity) ([]ChannelApplyResult, error) {
	return applyManagementChannels(ctx, nil, trust, directory, local, true)
}

func applyManagementChannels(ctx context.Context, encoded []byte, trust Context, directory string, local []ChannelLocalIdentity, restore bool) ([]ChannelApplyResult, error) {
	if os.Geteuid() != 0 || safeChannelDirectory(directory) != nil {
		return nil, failure("CONTROLLER_CHANNELS_PERMISSION")
	}
	if len(local) < 1 || len(local) > 2 {
		return nil, failure("CONTROLLER_CHANNELS_LOCAL_IDENTITY")
	}
	lock, err := openStateFile(filepath.Join(directory, "channels.lock"), syscall.O_CREAT|syscall.O_RDWR)
	if err != nil {
		return nil, err
	}
	defer lock.Close()
	if syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB) != nil {
		return nil, failure("CONTROLLER_CHANNELS_BUSY")
	}
	defer syscall.Flock(int(lock.Fd()), syscall.LOCK_UN)
	var old *ManagementChannels
	prior, err := channelReadFile(filepath.Join(directory, "channels.json"), MaxEnvelopeBytes)
	if err == nil {
		var env envelope
		var payload ManagementChannels
		if decodeStrict(prior, &env) != nil {
			return nil, failure("CONTROLLER_CHANNELS_STATE")
		}
		// Historical verification preserves a high watermark after TTL expires.
		if raw, e := base64.StdEncoding.Strict().DecodeString(env.Payload); e != nil || decodeStrict(raw, &payload) != nil {
			return nil, failure("CONTROLLER_CHANNELS_STATE")
		}
		historical := trust
		historical.Now = payload.IssuedAt
		historical.Previous = nil
		checked, e := VerifyManagementChannels(prior, historical)
		if e != nil {
			return nil, e
		}
		trust.Previous = &checked.Observed
		old = &checked.Config
	} else if !os.IsNotExist(err) {
		return nil, err
	} else {
		// Once initialized, a missing signed high watermark is a damaged state,
		// never an implicit first installation accepting an older object.
		if _, markerErr := channelReadFile(filepath.Join(directory, "channel-identity.json"), 4096); !os.IsNotExist(markerErr) {
			return nil, failure("CONTROLLER_CHANNELS_STATE_REQUIRED")
		}
	}
	trust.Now = time.Now().UnixMilli()
	if restore {
		if old == nil {
			return nil, failure("CONTROLLER_CHANNELS_STATE_REQUIRED")
		}
		encoded = prior
		trust.Now = old.IssuedAt
	}
	checked, err := VerifyManagementChannels(encoded, trust)
	if err != nil {
		return nil, err
	}
	if old != nil {
		for _, prior := range old.Channels {
			retained := false
			for _, channel := range checked.Config.Channels {
				if channel.Slot == prior.Slot {
					retained = true
				}
			}
			if !retained {
				return nil, failure("CONTROLLER_CHANNELS_RETIREMENT_REQUIRED")
			}
		}
	}
	keys := map[string]string{}
	publicKeys := map[string]string{}
	for _, value := range local {
		if (value.Slot != "a" && value.Slot != "b") || keys[value.Slot] != "" || !filepath.IsAbs(value.PrivateKeyPath) {
			return nil, failure("CONTROLLER_CHANNELS_LOCAL_IDENTITY")
		}
		raw, err := channelReadFile(value.PrivateKeyPath, 64)
		if err != nil {
			return nil, err
		}
		key := strings.TrimSuffix(string(raw), "\n")
		decoded, err := decodeBase64(key, 32)
		if err != nil || strings.Trim(string(decoded), "\x00") == "" {
			return nil, failure("CONTROLLER_CHANNELS_LOCAL_IDENTITY")
		}
		pub, err := channelCommand(ctx, "/usr/bin/wg", []string{"pubkey"}, key+"\n")
		if err != nil {
			return nil, err
		}
		keys[value.Slot], publicKeys[value.Slot] = key, strings.TrimSpace(pub)
	}
	if keys["a"] != "" && keys["a"] == keys["b"] {
		return nil, failure("CONTROLLER_CHANNELS_LOCAL_IDENTITY")
	}
	manifest, err := canonical(struct {
		SchemaVersion int               `json:"schemaVersion"`
		PlatformID    string            `json:"platformId"`
		NodeID        string            `json:"nodeId"`
		PublicKeys    map[string]string `json:"publicKeys"`
	}{1, trust.PlatformID, trust.NodeID, publicKeys})
	if err != nil {
		return nil, err
	}
	marker, markerErr := channelReadFile(filepath.Join(directory, "channel-identity.json"), 4096)
	if markerErr == nil {
		if string(marker) != string(manifest) {
			return nil, failure("CONTROLLER_CHANNELS_LOCAL_IDENTITY")
		}
	} else if !os.IsNotExist(markerErr) {
		return nil, markerErr
	}
	endpoints := map[string]string{}
	for _, channel := range checked.Config.Channels {
		if keys[channel.Slot] == "" {
			return nil, failure("CONTROLLER_CHANNELS_LOCAL_IDENTITY")
		}
		if old != nil {
			for _, prior := range old.Channels {
				if prior.Slot == channel.Slot && (prior.GatewayID != channel.GatewayID || prior.PublicKey != channel.PublicKey || prior.NodeAddress != channel.NodeAddress || prior.ControlAddress != channel.ControlAddress) {
					return nil, failure("CONTROLLER_CHANNELS_REPLACEMENT_REQUIRED")
				}
			}
		}
		endpoints[channel.Slot], err = publicChannelEndpoint(ctx, channel.EndpointHost)
		if err != nil {
			return nil, err
		}
		if _, err = preflightManagementChannel(ctx, channel, trust, publicKeys[channel.Slot]); err != nil {
			return nil, err
		}
	}
	if os.IsNotExist(markerErr) {
		// Publish the immutable local identity before the first signed record.
		// Interrupted initialization requires explicit review rather than reset.
		file, err := openStateFile(filepath.Join(directory, "channel-identity.json"), syscall.O_CREAT|syscall.O_EXCL|syscall.O_WRONLY)
		if err != nil {
			return nil, err
		}
		_, writeErr := file.Write(manifest)
		syncErr := file.Sync()
		file.Close()
		parent, err := os.Open(directory)
		if err != nil {
			return nil, err
		}
		directoryErr := parent.Sync()
		parent.Close()
		if writeErr != nil || syncErr != nil || directoryErr != nil {
			return nil, failure("CONTROLLER_CHANNELS_STATE")
		}
	}
	if err = saveChannelRecord(directory, encoded); err != nil {
		return nil, err
	}
	results := []ChannelApplyResult{}
	for _, channel := range checked.Config.Channels {
		if trust.Now = time.Now().UnixMilli(); !restore && trust.Now >= checked.Config.ExpiresAt {
			return results, failure("CONTROLLER_CHANNELS_EXPIRED")
		}
		name := "incudal-ha-" + channel.Slot
		alias := "payincus-channel/v1/" + trust.PlatformID + "/" + trust.NodeID + "/" + channel.Slot
		found, err := preflightManagementChannel(ctx, channel, trust, publicKeys[channel.Slot])
		if err != nil {
			return results, err
		}
		if !found {
			if _, err = channelCommand(ctx, "/usr/sbin/ip", []string{"link", "add", name, "type", "wireguard"}, ""); err != nil {
				return results, err
			}
			if _, err = channelCommand(ctx, "/usr/sbin/ip", []string{"link", "set", "dev", name, "alias", alias}, ""); err != nil {
				return results, err
			}
		} else {
			pub, err := channelCommand(ctx, "/usr/bin/wg", []string{"show", name, "public-key"}, "")
			if err != nil {
				return results, err
			}
			if strings.TrimSpace(pub) != publicKeys[channel.Slot] {
				return results, failure("CONTROLLER_CHANNELS_LINK_CONFLICT")
			}
		}
		// stdin carries the local private key; neither arguments, logs nor output
		// contain key material. Never use showconf/dump (they expose private keys).
		wireguard := fmt.Sprintf("[Interface]\nPrivateKey = %s\n[Peer]\nPublicKey = %s\nEndpoint = %s:%d\nAllowedIPs = %s/32\nPersistentKeepalive = 25\n", keys[channel.Slot], channel.PublicKey, endpoints[channel.Slot], channel.EndpointPort, channel.ControlAddress)
		if _, err = channelCommand(ctx, "/usr/bin/wg", []string{"syncconf", name, "/dev/stdin"}, wireguard); err != nil {
			return results, err
		}
		for _, args := range [][]string{{"address", "replace", channel.NodeAddress + "/32", "dev", name}, {"link", "set", "dev", name, "mtu", strconv.Itoa(channel.MTU), "up"}, {"route", "replace", channel.ControlAddress + "/32", "dev", name, "src", channel.NodeAddress, "proto", "static"}} {
			if _, err = channelCommand(ctx, "/usr/sbin/ip", args, ""); err != nil {
				return results, err
			}
		}
		peer, err := channelCommand(ctx, "/usr/bin/wg", []string{"show", name, "peers"}, "")
		if err != nil || strings.TrimSpace(peer) != channel.PublicKey {
			return results, failure("CONTROLLER_CHANNELS_VERIFICATION")
		}
		allowed, err := channelCommand(ctx, "/usr/bin/wg", []string{"show", name, "allowed-ips"}, "")
		if err != nil || strings.TrimSpace(allowed) != channel.PublicKey+"\t"+channel.ControlAddress+"/32" {
			return results, failure("CONTROLLER_CHANNELS_VERIFICATION")
		}
		endpoint, err := channelCommand(ctx, "/usr/bin/wg", []string{"show", name, "endpoints"}, "")
		if err != nil || strings.TrimSpace(endpoint) != channel.PublicKey+"\t"+endpoints[channel.Slot]+":"+strconv.Itoa(channel.EndpointPort) {
			return results, failure("CONTROLLER_CHANNELS_VERIFICATION")
		}
		if _, err = preflightManagementChannel(ctx, channel, trust, publicKeys[channel.Slot]); err != nil {
			return results, err
		}
		results = append(results, ChannelApplyResult{channel.Slot, name, channel.GatewayID, true, true})
	}
	return results, nil
}
