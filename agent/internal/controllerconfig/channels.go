package controllerconfig

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
)

const channelsPrefix = "payincus/host-management-channels/v1\n"

// Transport configuration changes only the two dedicated management links.
// It is not a writer lease, customer route or generic WireGuard config proxy.
type ManagementChannel struct {
	Slot           string `json:"slot"`
	GatewayID      string `json:"gatewayId"`
	EndpointHost   string `json:"endpointHost"`
	EndpointPort   int    `json:"endpointPort"`
	PublicKey      string `json:"publicKey"`
	NodeAddress    string `json:"nodeAddress"`
	ControlAddress string `json:"controlAddress"`
	MTU            int    `json:"mtu"`
}
type ManagementChannels struct {
	SchemaVersion int                 `json:"schemaVersion"`
	Purpose       string              `json:"purpose"`
	PlatformID    string              `json:"platformId"`
	NodeID        string              `json:"nodeId"`
	Epoch         string              `json:"epoch"`
	Sequence      string              `json:"sequence"`
	IssuedAt      int64               `json:"issuedAt"`
	ExpiresAt     int64               `json:"expiresAt"`
	Channels      []ManagementChannel `json:"channels"`
}
type ChannelsResult struct {
	Config    ManagementChannels
	Observed  ObservedState
	Duplicate bool
}

type ChannelLocalIdentity struct {
	Slot           string `json:"slot"`
	PrivateKeyPath string `json:"privateKeyPath"`
}
type ChannelApplyResult struct {
	Slot      string `json:"slot"`
	Interface string `json:"interface"`
	GatewayID string `json:"gatewayId"`
	Applied   bool   `json:"applied"`
	Verified  bool   `json:"verified"`
}

func validateManagementChannels(config ManagementChannels, trust Context) error {
	if config.SchemaVersion != 1 || config.Purpose != "host-management-channels" || !uuidPattern.MatchString(config.PlatformID) ||
		!uuidPattern.MatchString(config.NodeID) || config.PlatformID != trust.PlatformID || config.NodeID != trust.NodeID {
		return failure("CONTROLLER_CHANNELS_IDENTITY")
	}
	for _, value := range []string{config.Epoch, config.Sequence} {
		if _, err := counter(value); err != nil {
			return err
		}
	}
	if config.IssuedAt <= 0 || config.IssuedAt > maxSafeInteger || config.ExpiresAt > maxSafeInteger || config.ExpiresAt <= config.IssuedAt ||
		config.ExpiresAt-config.IssuedAt > maxTTLMS || config.IssuedAt > trust.Now+5000 || config.ExpiresAt <= trust.Now || len(config.Channels) < 1 || len(config.Channels) > 2 {
		return failure("CONTROLLER_CHANNELS_INVALID")
	}
	addresses, gateways, keys := map[string]bool{}, map[string]bool{}, map[string]bool{}
	for i, channel := range config.Channels {
		if (channel.Slot != "a" && channel.Slot != "b") || (i > 0 && channel.Slot <= config.Channels[i-1].Slot) ||
			!uuidPattern.MatchString(channel.GatewayID) || gateways[channel.GatewayID] || !validHost(channel.EndpointHost) ||
			!validPort(channel.EndpointPort) || !validManagementIP(channel.NodeAddress) || !validManagementIP(channel.ControlAddress) ||
			channel.NodeAddress == channel.ControlAddress || addresses[channel.NodeAddress] || addresses[channel.ControlAddress] || keys[channel.PublicKey] ||
			channel.MTU < 1280 || channel.MTU > 1420 {
			return failure("CONTROLLER_CHANNELS_INVALID")
		}
		key, err := decodeBase64(channel.PublicKey, 32)
		if err != nil || bytes.Equal(key, make([]byte, 32)) {
			return failure("CONTROLLER_CHANNELS_INVALID")
		}
		addresses[channel.NodeAddress], addresses[channel.ControlAddress], gateways[channel.GatewayID], keys[channel.PublicKey] = true, true, true, true
	}
	return nil
}

func VerifyManagementChannels(encoded []byte, trust Context) (ChannelsResult, error) {
	var empty ChannelsResult
	if len(encoded) > MaxEnvelopeBytes || trust.Now <= 0 || trust.Now > maxSafeInteger {
		return empty, invalid()
	}
	var env envelope
	if decodeStrict(encoded, &env) != nil || env.SchemaVersion != 1 {
		return empty, invalid()
	}
	public, ok := trust.TrustedKeys[env.KeyID]
	if !ok {
		return empty, failure("CONTROLLER_CHANNELS_UNTRUSTED")
	}
	key, err := decodeBase64(public, 32)
	if err != nil || SigningKeyID(key) != env.KeyID {
		return empty, invalid()
	}
	sig, err := decodeBase64(env.Signature, 64)
	if err != nil {
		return empty, err
	}
	raw, err := base64.StdEncoding.Strict().DecodeString(env.Payload)
	if err != nil || len(raw) > maxPayloadBytes || base64.StdEncoding.EncodeToString(raw) != env.Payload ||
		!ed25519.Verify(key, []byte(channelsPrefix+env.KeyID+"\n"+env.Payload), sig) {
		return empty, failure("CONTROLLER_CHANNELS_SIGNATURE")
	}
	var config ManagementChannels
	if decodeStrict(raw, &config) != nil {
		return empty, invalid()
	}
	if err = validateManagementChannels(config, trust); err != nil {
		return empty, err
	}
	digest := sha256.Sum256(raw)
	state := ObservedState{1, config.PlatformID, config.NodeID, config.Epoch, config.Sequence, hex.EncodeToString(digest[:])}
	duplicate := false
	if old := trust.Previous; old != nil {
		if old.SchemaVersion != 1 || old.PlatformID != state.PlatformID || old.NodeID != state.NodeID || !hashPattern.MatchString(old.PayloadSHA256) {
			return empty, invalid()
		}
		epoch, err1 := counter(old.Epoch)
		sequence, err2 := counter(old.Sequence)
		if err1 != nil || err2 != nil {
			return empty, invalid()
		}
		nextEpoch, _ := counter(state.Epoch)
		nextSequence, _ := counter(state.Sequence)
		if nextEpoch < epoch || (nextEpoch == epoch && nextSequence < sequence) {
			return empty, failure("CONTROLLER_CHANNELS_ROLLBACK")
		}
		if nextEpoch == epoch && nextSequence == sequence {
			if state.PayloadSHA256 != old.PayloadSHA256 {
				return empty, failure("CONTROLLER_CHANNELS_CONFLICT")
			}
			duplicate = true
		}
	}
	return ChannelsResult{config, state, duplicate}, nil
}
