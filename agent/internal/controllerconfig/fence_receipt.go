package controllerconfig

import (
	"crypto/ed25519"
	"encoding/base64"
)

const fenceReceiptPrefix = "payincus/host-fence-receipt/v1\n"

// FenceReceipt is local evidence, never a writer lease. Only the restricted
// host maintenance component may collect and sign facts after actual fencing.
type FenceReceipt struct {
	SchemaVersion            int    `json:"schemaVersion"`
	Purpose                  string `json:"purpose"`
	PlatformID               string `json:"platformId"`
	NodeID                   string `json:"nodeId"`
	ControllerID             string `json:"controllerId"`
	RequestID                string `json:"requestId"`
	Epoch                    string `json:"epoch"`
	Sequence                 string `json:"sequence"`
	CandidateSHA256          string `json:"candidateSha256"`
	Challenge                string `json:"challenge"`
	BootID                   string `json:"bootId"`
	IssuedAt                 int64  `json:"issuedAt"`
	ExpiresAt                int64  `json:"expiresAt"`
	OldConnectionsBlocked    bool   `json:"oldConnectionsBlocked"`
	LegacyCredentialsBlocked bool   `json:"legacyCredentialsBlocked"`
	OutstandingSSHProcesses  int    `json:"outstandingSshProcesses"`
	OutstandingLocalJobs     int    `json:"outstandingLocalJobs"`
	ActiveIncusOperations    int    `json:"activeIncusOperations"`
}
type FenceBinding struct {
	PlatformID, NodeID, ControllerID, RequestID, Epoch, Sequence, CandidateSHA256, Challenge string
}
type fenceEnvelope struct {
	SchemaVersion int    `json:"schemaVersion"`
	Payload       string `json:"payload"`
	Signature     string `json:"signature"`
}

func validFenceReceipt(r FenceReceipt) bool {
	if r.SchemaVersion != 1 || r.Purpose != "host-fence-receipt" || !hashPattern.MatchString(r.CandidateSHA256) {
		return false
	}
	for _, id := range []string{r.PlatformID, r.NodeID, r.ControllerID, r.RequestID, r.BootID} {
		if !uuidPattern.MatchString(id) {
			return false
		}
	}
	if _, err := counter(r.Epoch); err != nil {
		return false
	}
	if _, err := counter(r.Sequence); err != nil {
		return false
	}
	raw, err := base64.RawURLEncoding.Strict().DecodeString(r.Challenge)
	if err != nil || len(raw) != 24 || base64.RawURLEncoding.EncodeToString(raw) != r.Challenge {
		return false
	}
	return r.IssuedAt > 0 && r.IssuedAt <= maxSafeInteger && r.ExpiresAt <= maxSafeInteger && r.ExpiresAt > r.IssuedAt && r.ExpiresAt-r.IssuedAt <= 30000 && r.OldConnectionsBlocked && r.LegacyCredentialsBlocked && r.OutstandingSSHProcesses == 0 && r.OutstandingLocalJobs == 0 && r.ActiveIncusOperations == 0
}
func SignFenceReceipt(r FenceReceipt, key ed25519.PrivateKey) ([]byte, error) {
	if !validFenceReceipt(r) || len(key) != ed25519.PrivateKeySize {
		return nil, failure("CONTROLLER_FENCE_RECEIPT_INVALID")
	}
	raw, err := canonical(r)
	if err != nil {
		return nil, err
	}
	payload := base64.StdEncoding.EncodeToString(raw)
	signature := base64.StdEncoding.EncodeToString(ed25519.Sign(key, []byte(fenceReceiptPrefix+payload)))
	return canonical(fenceEnvelope{1, payload, signature})
}
func VerifyFenceReceipt(encoded []byte, b FenceBinding, publicKey string, now int64) (FenceReceipt, error) {
	var r FenceReceipt
	fail := func() (FenceReceipt, error) { return FenceReceipt{}, failure("CONTROLLER_FENCE_RECEIPT_INVALID") }
	if len(encoded) > 4096 || now <= 0 || now > maxSafeInteger {
		return fail()
	}
	var env fenceEnvelope
	if decodeStrict(encoded, &env) != nil || env.SchemaVersion != 1 {
		return fail()
	}
	raw, err := base64.StdEncoding.Strict().DecodeString(env.Payload)
	if err != nil || base64.StdEncoding.EncodeToString(raw) != env.Payload {
		return fail()
	}
	key, err := decodeBase64(publicKey, 32)
	if err != nil {
		return fail()
	}
	signature, err := decodeBase64(env.Signature, 64)
	if err != nil {
		return fail()
	}
	if !ed25519.Verify(key, []byte(fenceReceiptPrefix+env.Payload), signature) || decodeStrict(raw, &r) != nil || !validFenceReceipt(r) {
		return fail()
	}
	if r.IssuedAt > now+5000 || r.ExpiresAt <= now {
		return fail()
	}
	if r.PlatformID != b.PlatformID || r.NodeID != b.NodeID || r.ControllerID != b.ControllerID || r.RequestID != b.RequestID || r.Epoch != b.Epoch || r.Sequence != b.Sequence || r.CandidateSHA256 != b.CandidateSHA256 || r.Challenge != b.Challenge {
		return fail()
	}
	return r, nil
}
