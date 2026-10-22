package controllerconfig

import (
	"crypto/ed25519"
	"encoding/base64"
)

const gateProofPrefix = "payincus/controller-gate-proof/v1\n"

// GateProof binds a physically audited host receipt to this maintenance
// service incarnation and the nominated holder. Codec only; never collect
// audit facts from request-supplied booleans.
type GateProof struct {
	SchemaVersion   int    `json:"schemaVersion"`
	Purpose         string `json:"purpose"`
	PlatformID      string `json:"platformId"`
	NodeID          string `json:"nodeId"`
	ControllerID    string `json:"controllerId"`
	RequestID       string `json:"requestId"`
	Epoch           string `json:"epoch"`
	Sequence        string `json:"sequence"`
	CandidateSHA256 string `json:"candidateSha256"`
	ReceiptSHA256   string `json:"receiptSha256"`
	BootID          string `json:"bootId"`
	GateID          string `json:"gateId"`
	HolderKeyID     string `json:"holderKeyId"`
	IssuedAt        int64  `json:"issuedAt"`
	ExpiresAt       int64  `json:"expiresAt"`
}

func SignGateProof(p GateProof, key ed25519.PrivateKey) ([]byte, error) {
	fail := func() ([]byte, error) { return nil, failure("CONTROLLER_GATE_PROOF_INVALID") }
	if p.SchemaVersion != 1 || p.Purpose != "controller-gate-proof" || len(key) != ed25519.PrivateKeySize {
		return fail()
	}
	for _, id := range []string{p.PlatformID, p.NodeID, p.ControllerID, p.RequestID, p.BootID, p.GateID} {
		if !uuidPattern.MatchString(id) {
			return fail()
		}
	}
	for _, value := range []string{p.Epoch, p.Sequence} {
		if _, err := counter(value); err != nil {
			return fail()
		}
	}
	if !hashPattern.MatchString(p.CandidateSHA256) || !hashPattern.MatchString(p.ReceiptSHA256) || !keyPattern.MatchString(p.HolderKeyID) || p.IssuedAt <= 0 || p.IssuedAt > maxSafeInteger || p.ExpiresAt > maxSafeInteger || p.ExpiresAt <= p.IssuedAt || p.ExpiresAt-p.IssuedAt > 30000 {
		return fail()
	}
	raw, err := canonical(p)
	if err != nil {
		return fail()
	}
	payload := base64.StdEncoding.EncodeToString(raw)
	return canonical(fenceEnvelope{1, payload, base64.StdEncoding.EncodeToString(ed25519.Sign(key, []byte(gateProofPrefix+payload)))})
}
