package controllerconfig

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"strconv"
)

const leaseRequestPrefix = "payincus/controller-lease-request/v1\n"

// LeaseRequest binds the exact operation body to the current lease and holder.
// BodySHA256 must be computed from bounded bytes by the receiving endpoint,
// never copied from an unverified header. A gate ID changes on each restart.
type LeaseRequest struct {
	LeaseSHA256 string `json:"leaseSha256"`
	Permission  string `json:"permission"`
	BodySHA256  string `json:"bodySha256"`
	Timestamp   string `json:"timestamp"`
	Nonce       string `json:"nonce"`
	Signature   string `json:"signature"`
}

func VerifyLeaseRequest(proof LeaseRequest, publicKey string, leaseSHA256, permission, bodySHA256 string, now int64) error {
	fail := func() error { return failure("CONTROLLER_LEASE_REQUEST_INVALID") }
	if now <= 0 || now > maxSafeInteger || !hashPattern.MatchString(leaseSHA256) || !hashPattern.MatchString(bodySHA256) || proof.LeaseSHA256 != leaseSHA256 || proof.BodySHA256 != bodySHA256 || proof.Permission != permission {
		return fail()
	}
	if permission != "inspect" && permission != "instance-power" && permission != "management-channel" {
		return fail()
	}
	timestamp, err := strconv.ParseInt(proof.Timestamp, 10, 64)
	if err != nil || timestamp <= 0 || timestamp > maxSafeInteger || strconv.FormatInt(timestamp, 10) != proof.Timestamp || timestamp > now+5000 || timestamp < now-5000 {
		return fail()
	}
	nonce, err := base64.RawURLEncoding.Strict().DecodeString(proof.Nonce)
	if err != nil || len(nonce) != 24 || base64.RawURLEncoding.EncodeToString(nonce) != proof.Nonce {
		return fail()
	}
	key, err := decodeBase64(publicKey, 32)
	if err != nil {
		return fail()
	}
	signature, err := decodeBase64(proof.Signature, 64)
	if err != nil {
		return fail()
	}
	message := leaseRequestPrefix + proof.LeaseSHA256 + "\n" + proof.Permission + "\n" + proof.BodySHA256 + "\n" + proof.Timestamp + "\n" + proof.Nonce
	if !ed25519.Verify(key, []byte(message), signature) {
		return fail()
	}
	return nil
}

func LeaseBodySHA256(raw []byte) string {
	digest := sha256.Sum256(raw)
	return hex.EncodeToString(digest[:])
}
