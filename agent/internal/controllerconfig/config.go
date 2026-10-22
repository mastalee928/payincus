// Package controllerconfig validates candidate controller configurations only.
// It never changes routing, Agent configuration or resource-writer permissions.
package controllerconfig

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

const MaxEnvelopeBytes = 12288
const maxPayloadBytes = 6144
const maxTTLMS int64 = 900000
const clockSkewMS int64 = 30000
const maxSafeInteger int64 = 9007199254740991
const signingPrefix = "payincus/controller-prepare/v1\n"

var uuidPattern = regexp.MustCompile(`^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$`)
var keyPattern = regexp.MustCompile(`^key_[a-f0-9]{64}$`)
var hashPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)
var counterPattern = regexp.MustCompile(`^[1-9][0-9]{0,18}$`)
var numericHost = regexp.MustCompile(`^[0-9.]+$`)
var labelPattern = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$`)

type Error struct{ Code string }

func (e *Error) Error() string  { return e.Code }
func failure(code string) error { return &Error{Code: code} }
func invalid() error            { return failure("CONTROLLER_CONFIG_INVALID") }

type Gateway struct {
	GatewayID      string `json:"gatewayId"`
	EndpointHost   string `json:"endpointHost"`
	EndpointPort   int    `json:"endpointPort"`
	PublicKey      string `json:"publicKey"`
	NodeAddress    string `json:"nodeAddress"`
	ControlAddress string `json:"controlAddress"`
}
type PrepareConfig struct {
	SchemaVersion int     `json:"schemaVersion"`
	Purpose       string  `json:"purpose"`
	PlatformID    string  `json:"platformId"`
	NodeID        string  `json:"nodeId"`
	ControllerID  string  `json:"controllerId"`
	RequestID     string  `json:"requestId"`
	Epoch         string  `json:"epoch"`
	Sequence      string  `json:"sequence"`
	IssuedAt      int64   `json:"issuedAt"`
	ExpiresAt     int64   `json:"expiresAt"`
	PanelBaseURL  string  `json:"panelBaseUrl"`
	Gateway       Gateway `json:"gateway"`
}
type envelope struct {
	SchemaVersion int    `json:"schemaVersion"`
	KeyID         string `json:"keyId"`
	Payload       string `json:"payload"`
	Signature     string `json:"signature"`
}
type ObservedState struct {
	SchemaVersion int    `json:"schemaVersion"`
	PlatformID    string `json:"platformId"`
	NodeID        string `json:"nodeId"`
	Epoch         string `json:"epoch"`
	Sequence      string `json:"sequence"`
	PayloadSHA256 string `json:"payloadSha256"`
}
type Context struct {
	PlatformID  string
	NodeID      string
	Now         int64
	TrustedKeys map[string]string
	Previous    *ObservedState
}
type Result struct {
	Config    PrepareConfig
	Observed  ObservedState
	Duplicate bool
	CanWrite  bool // Always false: candidate verification is not a writer lease.
}

func canonical(value any) ([]byte, error) {
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return nil, err
	}
	return bytes.TrimSuffix(buffer.Bytes(), []byte{'\n'}), nil
}
func decodeStrict(raw []byte, value any) error {
	if !utf8.Valid(raw) {
		return invalid()
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		return invalid()
	}
	encoded, err := canonical(value)
	if err != nil || !bytes.Equal(raw, encoded) {
		return failure("CONTROLLER_CONFIG_NON_CANONICAL")
	}
	return nil
}
func decodeBase64(value string, size int) ([]byte, error) {
	if len(value) != 4*((size+2)/3) {
		return nil, invalid()
	}
	raw, err := base64.StdEncoding.Strict().DecodeString(value)
	if err != nil || len(raw) != size || base64.StdEncoding.EncodeToString(raw) != value {
		return nil, invalid()
	}
	return raw, nil
}
func counter(value string) (int64, error) {
	if !counterPattern.MatchString(value) {
		return 0, invalid()
	}
	n, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return 0, invalid()
	}
	return n, nil
}
func validHost(value string) bool {
	if len(value) > 253 || value != strings.ToLower(value) {
		return false
	}
	if ip := net.ParseIP(value); ip != nil && ip.To4() != nil {
		if ip.To4().String() != value {
			return false
		}
		p := ip.To4()
		a, b, c := p[0], p[1], p[2]
		return !(a == 0 || a == 10 || a == 127 || a >= 224 || (a == 100 && b >= 64 && b <= 127) || (a == 169 && b == 254) || (a == 172 && b >= 16 && b <= 31) || (a == 192 && b == 168) || (a == 192 && b == 0) || (a == 198 && (b == 18 || b == 19 || (b == 51 && c == 100))) || (a == 203 && b == 0 && c == 113))
	}
	if numericHost.MatchString(value) || !strings.Contains(value, ".") || strings.HasSuffix(value, ".localhost") || strings.HasSuffix(value, ".local") {
		return false
	}
	for _, label := range strings.Split(value, ".") {
		if len(label) > 63 || !labelPattern.MatchString(label) {
			return false
		}
	}
	return true
}
func validManagementIP(value string) bool {
	ip := net.ParseIP(value)
	if ip == nil || ip.To4() == nil || !strings.HasPrefix(value, "10.") || ip.To4().String() != value {
		return false
	}
	p := ip.To4()
	return !(p[1] == 10 && p[2] < 4)
}
func validPort(value int) bool { return value > 0 && value <= 65535 }
func validPanelURL(value string) bool {
	if len(value) > 300 || strings.HasSuffix(value, ":") {
		return false
	}
	for _, b := range []byte(value) {
		if b < 0x21 || b > 0x7e {
			return false
		}
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme != "https" || parsed.User != nil || parsed.Path != "" || parsed.RawPath != "" || parsed.RawQuery != "" || parsed.ForceQuery || parsed.Fragment != "" || !validHost(parsed.Hostname()) {
		return false
	}
	port := parsed.Port()
	if port != "" {
		n, err := strconv.Atoi(port)
		if err != nil || !validPort(n) || port != strconv.Itoa(n) || n == 443 {
			return false
		}
	}
	return value == "https://"+parsed.Host
}
func validateConfig(value PrepareConfig, ctx Context) error {
	if value.SchemaVersion != 1 || value.Purpose != "controller-prepare" {
		return invalid()
	}
	for _, id := range []string{value.PlatformID, value.NodeID, value.ControllerID, value.RequestID, value.Gateway.GatewayID} {
		if !uuidPattern.MatchString(id) {
			return invalid()
		}
	}
	if _, err := counter(value.Epoch); err != nil {
		return err
	}
	if _, err := counter(value.Sequence); err != nil {
		return err
	}
	if value.IssuedAt <= 0 || value.IssuedAt > maxSafeInteger || value.ExpiresAt > maxSafeInteger || value.ExpiresAt <= value.IssuedAt || value.ExpiresAt-value.IssuedAt > maxTTLMS {
		return invalid()
	}
	if !validPanelURL(value.PanelBaseURL) || !validHost(value.Gateway.EndpointHost) || !validPort(value.Gateway.EndpointPort) || !validManagementIP(value.Gateway.NodeAddress) || !validManagementIP(value.Gateway.ControlAddress) || value.Gateway.NodeAddress == value.Gateway.ControlAddress {
		return invalid()
	}
	publicKey, err := decodeBase64(value.Gateway.PublicKey, 32)
	if err != nil {
		return err
	}
	if bytes.Equal(publicKey, make([]byte, 32)) {
		return invalid()
	}
	if value.PlatformID != ctx.PlatformID || value.NodeID != ctx.NodeID {
		return failure("CONTROLLER_CONFIG_IDENTITY_MISMATCH")
	}
	if value.IssuedAt > ctx.Now+clockSkewMS || value.ExpiresAt <= ctx.Now {
		return failure("CONTROLLER_CONFIG_EXPIRED")
	}
	return nil
}
func SigningKeyID(publicKey []byte) string {
	sum := sha256.Sum256(publicKey)
	return "key_" + hex.EncodeToString(sum[:])
}

func VerifyPrepareConfig(encoded []byte, ctx Context) (Result, error) {
	var result Result
	if len(encoded) > MaxEnvelopeBytes || ctx.Now <= 0 || ctx.Now > maxSafeInteger || !uuidPattern.MatchString(ctx.PlatformID) || !uuidPattern.MatchString(ctx.NodeID) {
		return result, invalid()
	}
	var env envelope
	if err := decodeStrict(encoded, &env); err != nil {
		return result, err
	}
	if env.SchemaVersion != 1 || !keyPattern.MatchString(env.KeyID) {
		return result, invalid()
	}
	trusted, ok := ctx.TrustedKeys[env.KeyID]
	if !ok {
		return result, failure("CONTROLLER_CONFIG_UNTRUSTED_KEY")
	}
	publicKey, err := decodeBase64(trusted, ed25519.PublicKeySize)
	if err != nil {
		return result, err
	}
	if SigningKeyID(publicKey) != env.KeyID {
		return result, failure("CONTROLLER_CONFIG_KEY_INVALID")
	}
	signature, err := decodeBase64(env.Signature, ed25519.SignatureSize)
	if err != nil {
		return result, err
	}
	if len(env.Payload) > 4*((maxPayloadBytes+2)/3) {
		return result, invalid()
	}
	payload, err := base64.StdEncoding.Strict().DecodeString(env.Payload)
	if err != nil || len(payload) > maxPayloadBytes || base64.StdEncoding.EncodeToString(payload) != env.Payload {
		return result, invalid()
	}
	if !ed25519.Verify(publicKey, []byte(signingPrefix+env.KeyID+"\n"+env.Payload), signature) {
		return result, failure("CONTROLLER_CONFIG_SIGNATURE_INVALID")
	}
	var config PrepareConfig
	if err := decodeStrict(payload, &config); err != nil {
		return result, err
	}
	if err := validateConfig(config, ctx); err != nil {
		return result, err
	}
	sum := sha256.Sum256(payload)
	observed := ObservedState{1, config.PlatformID, config.NodeID, config.Epoch, config.Sequence, hex.EncodeToString(sum[:])}
	duplicate := false
	if old := ctx.Previous; old != nil {
		if old.SchemaVersion != 1 || old.PlatformID != ctx.PlatformID || old.NodeID != ctx.NodeID || !hashPattern.MatchString(old.PayloadSHA256) {
			return result, failure("CONTROLLER_CONFIG_STATE_INVALID")
		}
		oldEpoch, e1 := counter(old.Epoch)
		oldSequence, e2 := counter(old.Sequence)
		if e1 != nil || e2 != nil {
			return result, invalid()
		}
		epoch, _ := counter(config.Epoch)
		sequence, _ := counter(config.Sequence)
		if epoch < oldEpoch || (epoch == oldEpoch && sequence < oldSequence) {
			return result, failure("CONTROLLER_CONFIG_ROLLBACK")
		}
		if epoch == oldEpoch && sequence == oldSequence {
			if observed.PayloadSHA256 != old.PayloadSHA256 {
				return result, failure("CONTROLLER_CONFIG_CONFLICT")
			}
			duplicate = true
		}
	}
	result = Result{Config: config, Observed: observed, Duplicate: duplicate, CanWrite: false}
	return result, nil
}

func ErrorCode(err error) string {
	var typed *Error
	if errors.As(err, &typed) {
		return typed.Code
	}
	return "CONTROLLER_CONFIG_INVALID"
}
