package controllerconfig

import (
	"crypto/ed25519"
	"encoding/base64"
)

const preparePermitPrefix = "payincus/host-fence-prepare/v1\n"

type PreparePermit struct {
	SchemaVersion   int    `json:"schemaVersion"`
	Purpose         string `json:"purpose"`
	WitnessID       string `json:"witnessId"`
	PlatformID      string `json:"platformId"`
	NodeID          string `json:"nodeId"`
	ControllerID    string `json:"controllerId"`
	RequestID       string `json:"requestId"`
	Epoch           string `json:"epoch"`
	Sequence        string `json:"sequence"`
	CandidateSHA256 string `json:"candidateSha256"`
	Challenge       string `json:"challenge"`
	IssuedAt        int64  `json:"issuedAt"`
	ExpiresAt       int64  `json:"expiresAt"`
}
type PreparePermitTrust struct {
	Binding     FenceBinding
	WitnessID   string
	TrustedKeys map[string]string
	Now         int64
}

// VerifyPreparePermit authenticates permission to prepare local fencing only.
// It cannot authorize resource writes or bypass locally persisted epoch state.
func VerifyPreparePermit(encoded []byte, trust PreparePermitTrust) (PreparePermit, error) {
	fail := func() (PreparePermit, error) { return PreparePermit{}, failure("CONTROLLER_PREPARE_PERMIT_INVALID") }
	if len(encoded) > 4096 || trust.Now <= 0 || trust.Now > maxSafeInteger {
		return fail()
	}
	var env envelope
	if decodeStrict(encoded, &env) != nil || env.SchemaVersion != 1 || !keyPattern.MatchString(env.KeyID) {
		return fail()
	}
	public, ok := trust.TrustedKeys[env.KeyID]
	if !ok {
		return fail()
	}
	key, err := decodeBase64(public, 32)
	if err != nil || SigningKeyID(key) != env.KeyID {
		return fail()
	}
	signature, err := decodeBase64(env.Signature, 64)
	if err != nil {
		return fail()
	}
	raw, err := base64.StdEncoding.Strict().DecodeString(env.Payload)
	if err != nil || base64.StdEncoding.EncodeToString(raw) != env.Payload {
		return fail()
	}
	if !ed25519.Verify(key, []byte(preparePermitPrefix+env.KeyID+"\n"+env.Payload), signature) {
		return fail()
	}
	var p PreparePermit
	if decodeStrict(raw, &p) != nil || p.SchemaVersion != 1 || p.Purpose != "host-fence-prepare" {
		return fail()
	}
	for _, id := range []string{p.WitnessID, p.PlatformID, p.NodeID, p.ControllerID, p.RequestID} {
		if !uuidPattern.MatchString(id) {
			return fail()
		}
	}
	if _, err = counter(p.Epoch); err != nil {
		return fail()
	}
	if _, err = counter(p.Sequence); err != nil {
		return fail()
	}
	challenge, err := base64.RawURLEncoding.Strict().DecodeString(p.Challenge)
	if err != nil || len(challenge) != 24 || base64.RawURLEncoding.EncodeToString(challenge) != p.Challenge || !hashPattern.MatchString(p.CandidateSHA256) {
		return fail()
	}
	if p.IssuedAt <= 0 || p.IssuedAt > maxSafeInteger || p.ExpiresAt > maxSafeInteger || p.ExpiresAt <= p.IssuedAt || p.ExpiresAt-p.IssuedAt > 60000 || p.IssuedAt > trust.Now+5000 || p.ExpiresAt <= trust.Now {
		return fail()
	}
	b := trust.Binding
	if p.WitnessID != trust.WitnessID || p.PlatformID != b.PlatformID || p.NodeID != b.NodeID || p.ControllerID != b.ControllerID || p.RequestID != b.RequestID || p.Epoch != b.Epoch || p.Sequence != b.Sequence || p.CandidateSHA256 != b.CandidateSHA256 || p.Challenge != b.Challenge {
		return fail()
	}
	return p, nil
}
