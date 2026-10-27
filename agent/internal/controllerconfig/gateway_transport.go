package controllerconfig

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
)

const gatewayTransportPrefix = "payincus/gateway-transport/v1\n"
const MaxGatewayTransportBytes = 1024 * 1024
const MaxGatewayTransportPayloadBytes = 768 * 1024
const MaxGatewayTransportPeers = 4094

type GatewayTransportPeer struct {
	NodeID    string `json:"nodeId"`
	PublicKey string `json:"publicKey"`
	Address   string `json:"address"`
	Enabled   bool   `json:"enabled"`
}
type GatewayTransport struct {
	SchemaVersion int                    `json:"schemaVersion"`
	Purpose       string                 `json:"purpose"`
	PlatformID    string                 `json:"platformId"`
	GatewayID     string                 `json:"gatewayId"`
	Epoch         string                 `json:"epoch"`
	Sequence      string                 `json:"sequence"`
	IssuedAt      int64                  `json:"issuedAt"`
	ExpiresAt     int64                  `json:"expiresAt"`
	Slot          string                 `json:"slot"`
	Address       string                 `json:"address"`
	ListenPort    int                    `json:"listenPort"`
	MTU           int                    `json:"mtu"`
	Peers         []GatewayTransportPeer `json:"peers"`
}

func VerifyGatewayTransport(encoded []byte, trust Context) (GatewayTransport, ObservedState, error) {
	var config GatewayTransport
	fail := func() (GatewayTransport, ObservedState, error) {
		return GatewayTransport{}, ObservedState{}, failure("GATEWAY_TRANSPORT_INVALID")
	}
	if len(encoded) > MaxGatewayTransportBytes || trust.Now <= 0 || trust.Now > maxSafeInteger {
		return fail()
	}
	var env envelope
	if decodeStrict(encoded, &env) != nil || env.SchemaVersion != 1 {
		return fail()
	}
	public, exists := trust.TrustedKeys[env.KeyID]
	if !exists {
		return fail()
	}
	key, err := decodeBase64(public, 32)
	if err != nil || SigningKeyID(key) != env.KeyID {
		return fail()
	}
	sig, err := decodeBase64(env.Signature, 64)
	if err != nil {
		return fail()
	}
	raw, err := base64.StdEncoding.Strict().DecodeString(env.Payload)
	if err != nil || len(raw) > MaxGatewayTransportPayloadBytes || base64.StdEncoding.EncodeToString(raw) != env.Payload || !ed25519.Verify(key, []byte(gatewayTransportPrefix+env.KeyID+"\n"+env.Payload), sig) || decodeStrict(raw, &config) != nil {
		return fail()
	}
	if config.SchemaVersion != 1 || config.Purpose != "gateway-transport" || !uuidPattern.MatchString(config.PlatformID) || !uuidPattern.MatchString(config.GatewayID) ||
		config.PlatformID != trust.PlatformID || config.GatewayID != trust.NodeID || (config.Slot != "a" && config.Slot != "b") || !validManagementIP(config.Address) || !validPort(config.ListenPort) || config.MTU < 1280 || config.MTU > 1420 || len(config.Peers) > MaxGatewayTransportPeers {
		return fail()
	}
	for _, value := range []string{config.Epoch, config.Sequence} {
		if _, err := counter(value); err != nil {
			return fail()
		}
	}
	if config.IssuedAt <= 0 || config.IssuedAt > maxSafeInteger || config.ExpiresAt > maxSafeInteger || config.ExpiresAt <= config.IssuedAt || config.ExpiresAt-config.IssuedAt > maxTTLMS || config.IssuedAt > trust.Now+5000 || config.ExpiresAt <= trust.Now {
		return fail()
	}
	addresses, keys := map[string]bool{config.Address: true}, map[string]bool{}
	for i, peer := range config.Peers {
		if !uuidPattern.MatchString(peer.NodeID) || (i > 0 && peer.NodeID <= config.Peers[i-1].NodeID) || !validManagementIP(peer.Address) || addresses[peer.Address] || keys[peer.PublicKey] {
			return fail()
		}
		key, err := decodeBase64(peer.PublicKey, 32)
		if err != nil || bytes.Equal(key, make([]byte, 32)) {
			return fail()
		}
		addresses[peer.Address], keys[peer.PublicKey] = true, true
	}
	digest := sha256.Sum256(raw)
	observed := ObservedState{1, config.PlatformID, config.GatewayID, config.Epoch, config.Sequence, hex.EncodeToString(digest[:])}
	if old := trust.Previous; old != nil {
		if old.SchemaVersion != 1 || old.PlatformID != config.PlatformID || old.NodeID != config.GatewayID || !hashPattern.MatchString(old.PayloadSHA256) {
			return fail()
		}
		epoch, e1 := counter(old.Epoch)
		seq, e2 := counter(old.Sequence)
		nextEpoch, _ := counter(config.Epoch)
		nextSeq, _ := counter(config.Sequence)
		if e1 != nil || e2 != nil || nextEpoch < epoch || (nextEpoch == epoch && nextSeq < seq) || (nextEpoch == epoch && nextSeq == seq && old.PayloadSHA256 != observed.PayloadSHA256) {
			return fail()
		}
	}
	return config, observed, nil
}
