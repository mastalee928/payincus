package controllerconfig

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"sync"
	"time"
)

// LeaseGate is an in-process, monotonic authorization gate. The owning service
// must generate a fresh gate ID on every start, collect physical fence facts,
// load persisted high watermarks and close active sessions when denial begins.
// This module alone never opens an endpoint or grants root shell access.
type LeaseGate struct {
	mutex       sync.Mutex
	binding     LeaseBinding
	keys        map[string]string
	active      *WriteLease
	digest      string
	deadline    time.Time
	now         func() time.Time
	anchor      time.Time
	logicalTime int64
	requests    map[string]time.Time
	revoked     bool
	inflight    map[uint64]context.CancelFunc
	requestID   uint64
}

func NewLeaseGate(binding LeaseBinding, witnessKeys map[string]string) (*LeaseGate, error) {
	for _, id := range []string{binding.WitnessID, binding.PlatformID, binding.NodeID, binding.ControllerID, binding.RequestID, binding.LeaseID, binding.BootID, binding.GateID} {
		if !uuidPattern.MatchString(id) {
			return nil, failure("CONTROLLER_LEASE_GATE_INVALID")
		}
	}
	if !hashPattern.MatchString(binding.CandidateSHA256) || !keyPattern.MatchString(binding.HolderKeyID) || len(witnessKeys) == 0 {
		return nil, failure("CONTROLLER_LEASE_GATE_INVALID")
	}
	for _, value := range []string{binding.Epoch, binding.Sequence} {
		if _, err := counter(value); err != nil {
			return nil, err
		}
	}
	keys := make(map[string]string, len(witnessKeys))
	for id, public := range witnessKeys {
		raw, err := decodeBase64(public, 32)
		if err != nil || SigningKeyID(raw) != id {
			return nil, failure("CONTROLLER_LEASE_GATE_INVALID")
		}
		keys[id] = public
	}
	return &LeaseGate{binding: binding, keys: keys, now: time.Now, requests: make(map[string]time.Time), inflight: make(map[uint64]context.CancelFunc)}, nil
}

func (g *LeaseGate) Accept(encoded []byte) error {
	g.mutex.Lock()
	defer g.mutex.Unlock()
	if g.revoked {
		return failure("CONTROLLER_LEASE_GATE_DENIED")
	}
	now := g.now()
	logicalNow, err := g.observeTime(now)
	if err != nil {
		return err
	}
	lease, err := VerifyWriteLease(encoded, LeaseTrust{g.binding, g.keys, logicalNow})
	if err != nil {
		return err
	}
	digest := sha256.Sum256(encoded)
	hash := hex.EncodeToString(digest[:])
	if g.active != nil {
		old, _ := counter(g.active.LeaseSequence)
		next, _ := counter(lease.LeaseSequence)
		if next < old {
			return failure("CONTROLLER_LEASE_GATE_ROLLBACK")
		}
		if next == old {
			if hash != g.digest || !now.Before(g.deadline) {
				return failure("CONTROLLER_LEASE_GATE_REPLAY")
			}
			return nil
		}
	}
	remaining := time.Duration(lease.ExpiresAt-logicalNow) * time.Millisecond
	if remaining <= 0 || remaining > 30*time.Second {
		return failure("CONTROLLER_LEASE_GATE_INVALID")
	}
	g.active = &lease
	g.digest = hash
	g.deadline = now.Add(remaining)
	return nil
}

// Called with the gate mutex held. Apply the same nondecreasing logical clock
// to lease receipt and holder proofs; otherwise clock rollback can revive a
// request after its nonce retention window.
func (g *LeaseGate) observeTime(now time.Time) (int64, error) {
	logicalNow := now.UnixMilli()
	if !g.anchor.IsZero() {
		elapsed := now.Sub(g.anchor).Milliseconds()
		if elapsed < 0 {
			return 0, failure("CONTROLLER_LEASE_GATE_CLOCK")
		}
		minimum := g.logicalTime + elapsed
		if logicalNow+5000 < minimum {
			return 0, failure("CONTROLLER_LEASE_GATE_CLOCK")
		}
		if logicalNow < minimum {
			logicalNow = minimum
		}
	}
	// Record elapsed monotonic time even for invalid leases; wall rollback must
	// not resurrect an unobserved renewal after a prior expiry.
	g.anchor, g.logicalTime = now, logicalNow
	return logicalNow, nil
}

// AuthorizeRequest is the endpoint authorization boundary. The holder must
// prove possession for this lease and exact operation bytes; one nonce is
// consumed once per gate, even across renewal. Consumer enforces its own
// operation allowlist, body limit and physical fencing before calling here.
func (g *LeaseGate) AuthorizeRequest(proof LeaseRequest, holderPublicKey, permission string, body []byte) error {
	g.mutex.Lock()
	defer g.mutex.Unlock()
	now := g.now()
	logicalNow, err := g.observeTime(now)
	if err != nil {
		return err
	}
	if len(body) > 65536 || g.active == nil || !now.Before(g.deadline) || logicalNow >= g.active.ExpiresAt {
		return failure("CONTROLLER_LEASE_GATE_DENIED")
	}
	key, err := decodeBase64(holderPublicKey, 32)
	if err != nil || SigningKeyID(key) != g.binding.HolderKeyID {
		return failure("CONTROLLER_LEASE_GATE_DENIED")
	}
	allowed := false
	for _, value := range g.active.Permissions {
		if value == permission {
			allowed = true
			break
		}
	}
	if !allowed {
		return failure("CONTROLLER_LEASE_GATE_DENIED")
	}
	if err = VerifyLeaseRequest(proof, holderPublicKey, g.digest, permission, LeaseBodySHA256(body), logicalNow); err != nil {
		return err
	}
	for nonce, expires := range g.requests {
		if !now.Before(expires) {
			delete(g.requests, nonce)
		}
	}
	if _, exists := g.requests[proof.Nonce]; exists {
		return failure("CONTROLLER_LEASE_GATE_REPLAY")
	}
	if len(g.requests) >= 1024 {
		return failure("CONTROLLER_LEASE_GATE_CAPACITY")
	}
	// Retain for the entire maximum lease lifetime; logical time validation
	// prevents a stale proof from reviving after renewal or clock adjustment.
	g.requests[proof.Nonce] = now.Add(30 * time.Second)
	return nil
}

// Internal status check only. Endpoints must use AuthorizeRequest; knowing a
// public key ID is not proof of possession and cannot authorize an operation.
func (g *LeaseGate) authorize(holderKeyID, permission string) error {
	g.mutex.Lock()
	defer g.mutex.Unlock()
	if g.active == nil || !g.now().Before(g.deadline) || holderKeyID != g.binding.HolderKeyID {
		return failure("CONTROLLER_LEASE_GATE_DENIED")
	}
	for _, allowed := range g.active.Permissions {
		if allowed == permission {
			return nil
		}
	}
	return failure("CONTROLLER_LEASE_GATE_DENIED")
}

// Bind already-authenticated execution to the remaining lease. Cancellation
// does not undo a daemon-accepted Incus task; quiescence is checked separately.
func (g *LeaseGate) executionContext(parent context.Context, holderKeyID, permission string) (context.Context, func(), error) {
	g.mutex.Lock()
	defer g.mutex.Unlock()
	now := g.now()
	logicalNow, err := g.observeTime(now)
	if err != nil {
		return nil, nil, err
	}
	if g.revoked || g.active == nil || holderKeyID != g.binding.HolderKeyID || !now.Before(g.deadline) || logicalNow >= g.active.ExpiresAt || len(g.inflight) >= 128 {
		return nil, nil, failure("CONTROLLER_LEASE_GATE_DENIED")
	}
	allowed := false
	for _, value := range g.active.Permissions {
		if value == permission {
			allowed = true
			break
		}
	}
	if !allowed {
		return nil, nil, failure("CONTROLLER_LEASE_GATE_DENIED")
	}
	remaining := g.deadline.Sub(now)
	wallRemaining := time.Duration(g.active.ExpiresAt-logicalNow) * time.Millisecond
	if wallRemaining < remaining {
		remaining = wallRemaining
	}
	ctx, cancel := context.WithTimeout(parent, remaining)
	g.requestID++
	id := g.requestID
	g.inflight[id] = cancel
	return ctx, func() { cancel(); g.mutex.Lock(); delete(g.inflight, id); g.mutex.Unlock() }, nil
}

func (g *LeaseGate) Revoke() {
	g.mutex.Lock()
	defer g.mutex.Unlock()
	// Retain active sequence/digest so a revoked lease cannot be replayed.
	g.deadline = time.Time{}
	g.revoked = true
	for _, cancel := range g.inflight {
		cancel()
	}
}
