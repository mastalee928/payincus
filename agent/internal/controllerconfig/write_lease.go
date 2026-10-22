package controllerconfig

import (
	"crypto/ed25519"
	"encoding/base64"
)

const writeLeasePrefix = "payincus/controller-write-lease/v1\n"

// WriteLease is a protocol object only. A verified signature is insufficient
// without local fencing, a current gate identity and monotonic enforcement.
type WriteLease struct {
	SchemaVersion   int      `json:"schemaVersion"`
	Purpose         string   `json:"purpose"`
	WitnessID       string   `json:"witnessId"`
	PlatformID      string   `json:"platformId"`
	NodeID          string   `json:"nodeId"`
	ControllerID    string   `json:"controllerId"`
	RequestID       string   `json:"requestId"`
	Epoch           string   `json:"epoch"`
	Sequence        string   `json:"sequence"`
	CandidateSHA256 string   `json:"candidateSha256"`
	LeaseID         string   `json:"leaseId"`
	LeaseSequence   string   `json:"leaseSequence"`
	BootID          string   `json:"bootId"`
	GateID          string   `json:"gateId"`
	HolderKeyID     string   `json:"holderKeyId"`
	IssuedAt        int64    `json:"issuedAt"`
	ExpiresAt       int64    `json:"expiresAt"`
	Permissions     []string `json:"permissions"`
}
type LeaseBinding struct {
	WitnessID, PlatformID, NodeID, ControllerID, RequestID, Epoch, Sequence, CandidateSHA256, LeaseID, BootID, GateID, HolderKeyID string
}
type LeaseTrust struct {
	Binding     LeaseBinding
	WitnessKeys map[string]string
	Now         int64
}

func VerifyWriteLease(encoded []byte, trust LeaseTrust) (WriteLease, error) {
	fail := func() (WriteLease, error) { return WriteLease{}, failure("CONTROLLER_WRITE_LEASE_INVALID") }
	if len(encoded) > 4096 || trust.Now <= 0 || trust.Now > maxSafeInteger {
		return fail()
	}
	var env envelope
	if decodeStrict(encoded, &env) != nil || env.SchemaVersion != 1 || !keyPattern.MatchString(env.KeyID) {
		return fail()
	}
	public, ok := trust.WitnessKeys[env.KeyID]
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
	if err != nil || base64.StdEncoding.EncodeToString(raw) != env.Payload || !ed25519.Verify(key, []byte(writeLeasePrefix+env.KeyID+"\n"+env.Payload), signature) {
		return fail()
	}
	var p WriteLease
	if decodeStrict(raw, &p) != nil || p.SchemaVersion != 1 || p.Purpose != "controller-write-lease" {
		return fail()
	}
	for _, id := range []string{p.WitnessID, p.PlatformID, p.NodeID, p.ControllerID, p.RequestID, p.LeaseID, p.BootID, p.GateID} {
		if !uuidPattern.MatchString(id) {
			return fail()
		}
	}
	for _, value := range []string{p.Epoch, p.Sequence, p.LeaseSequence} {
		if _, err = counter(value); err != nil {
			return fail()
		}
	}
	if !hashPattern.MatchString(p.CandidateSHA256) || !keyPattern.MatchString(p.HolderKeyID) || p.IssuedAt <= 0 || p.IssuedAt > trust.Now || p.ExpiresAt <= trust.Now || p.ExpiresAt > maxSafeInteger || p.ExpiresAt-p.IssuedAt > 30000 {
		return fail()
	}
	permissions := map[string]int{"inspect": 1, "instance-power": 2, "management-channel": 3}
	last := 0
	if len(p.Permissions) < 1 || len(p.Permissions) > 3 {
		return fail()
	}
	for _, permission := range p.Permissions {
		rank := permissions[permission]
		if rank <= last {
			return fail()
		}
		last = rank
	}
	b := trust.Binding
	if p.WitnessID != b.WitnessID || p.PlatformID != b.PlatformID || p.NodeID != b.NodeID || p.ControllerID != b.ControllerID || p.RequestID != b.RequestID || p.Epoch != b.Epoch || p.Sequence != b.Sequence || p.CandidateSHA256 != b.CandidateSHA256 || p.LeaseID != b.LeaseID || p.BootID != b.BootID || p.GateID != b.GateID || p.HolderKeyID != b.HolderKeyID {
		return fail()
	}
	return p, nil
}
