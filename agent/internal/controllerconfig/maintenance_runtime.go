package controllerconfig

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"sync"
	"time"
)

// MaintenanceRuntime owns one incarnation of the host lease gate. Transport
// identity and writer permission are separate; every new epoch revokes old
// execution before local preparations begin. No request supplies audit booleans.
type MaintenanceRuntime struct {
	mutex        sync.Mutex
	trust        Context
	witnessID    string
	witnessKeys  map[string]string
	nodeKey      ed25519.PrivateKey
	socket       string
	bootID       string
	gateID       string
	prepared     *Result
	permit       *PreparePermit
	holderPublic string
	gate         *LeaseGate
	executor     *HostOperationExecutor
	collector    func(context.Context) (RuntimeFenceFacts, error)
}
type RuntimeFenceFacts struct {
	NetworkBlocked           bool
	LegacyCredentialsBlocked bool
	Processes                ProcessAudit
	Writers                  LocalWriterAudit
	ActiveIncusOperations    int
	Observed                 *ObservedState
}
type RuntimePreparation struct {
	Epoch     string   `json:"epoch"`
	GateID    string   `json:"gateId"`
	BootID    string   `json:"bootId"`
	Receipt   string   `json:"receipt,omitempty"`
	GateProof string   `json:"gateProof,omitempty"`
	Blockers  []string `json:"blockers"`
	CanWrite  bool     `json:"canWrite"`
}

func NewMaintenanceRuntime(trust Context, witnessID string, witnessKeys map[string]string, nodeKey ed25519.PrivateKey, socket string,
	collector func(context.Context) (RuntimeFenceFacts, error)) (*MaintenanceRuntime, error) {
	if !uuidPattern.MatchString(trust.PlatformID) || !uuidPattern.MatchString(trust.NodeID) || !uuidPattern.MatchString(witnessID) || len(nodeKey) != ed25519.PrivateKeySize || collector == nil {
		return nil, failure("CONTROLLER_RUNTIME_INVALID")
	}
	boot, err := readMaintenanceBootID()
	if err != nil {
		return nil, err
	}
	var id [16]byte
	if _, err = rand.Read(id[:]); err != nil {
		return nil, err
	}
	id[6] = (id[6] & 15) | 64
	id[8] = (id[8] & 63) | 128
	gateID := fmt.Sprintf("%x-%x-%x-%x-%x", id[0:4], id[4:6], id[6:8], id[8:10], id[10:16])
	keys := map[string]string{}
	for key, value := range witnessKeys {
		raw, err := decodeBase64(value, 32)
		if err != nil || SigningKeyID(raw) != key {
			return nil, failure("CONTROLLER_RUNTIME_INVALID")
		}
		keys[key] = value
	}
	if len(keys) == 0 {
		return nil, failure("CONTROLLER_RUNTIME_INVALID")
	}
	candidates := map[string]string{}
	for key, value := range trust.TrustedKeys {
		candidates[key] = value
	}
	trust.TrustedKeys = candidates
	return &MaintenanceRuntime{trust: trust, witnessID: witnessID, witnessKeys: keys, nodeKey: append(ed25519.PrivateKey{}, nodeKey...), socket: socket, bootID: boot, gateID: gateID, collector: collector}, nil
}

func (r *MaintenanceRuntime) Prepare(ctx context.Context, candidate, permit []byte, holderPublic string) (RuntimePreparation, error) {
	return r.PrepareAuthorized(ctx, candidate, permit, "", holderPublic)
}

func (r *MaintenanceRuntime) PrepareAuthorized(ctx context.Context, candidate, permit []byte, controllerID, holderPublic string) (RuntimePreparation, error) {
	r.mutex.Lock()
	defer r.mutex.Unlock()
	trust := r.trust
	trust.Now = time.Now().UnixMilli()
	if r.prepared != nil {
		trust.Previous = &r.prepared.Observed
	}
	checked, err := VerifyMaintenancePreparation(candidate, permit, trust, r.witnessID, r.witnessKeys)
	if err != nil {
		return RuntimePreparation{}, err
	}
	if controllerID != "" && checked.Config.ControllerID != controllerID {
		return RuntimePreparation{}, failure("CONTROLLER_RUNTIME_IDENTITY")
	}
	holder, err := decodeBase64(holderPublic, 32)
	if err != nil {
		return RuntimePreparation{}, err
	}
	if r.prepared != nil && checked.Duplicate && r.holderPublic != holderPublic {
		return RuntimePreparation{}, failure("CONTROLLER_RUNTIME_HOLDER")
	}
	if r.prepared != nil && !checked.Duplicate && checked.Config.Epoch == r.prepared.Config.Epoch {
		return RuntimePreparation{}, failure("CONTROLLER_RUNTIME_NEW_EPOCH_REQUIRED")
	}
	// A valid new preparation revokes old authorization even if its new local
	// audits fail. Invalid authority cannot cause revocation or local side effects.
	if !checked.Duplicate && r.gate != nil {
		r.gate.Revoke()
		r.gate = nil
		r.executor = nil
	}
	var env envelope
	if decodeStrict(permit, &env) != nil {
		return RuntimePreparation{}, invalid()
	}
	raw, _ := base64.StdEncoding.Strict().DecodeString(env.Payload)
	var authority PreparePermit
	if decodeStrict(raw, &authority) != nil {
		return RuntimePreparation{}, invalid()
	}
	r.prepared = &checked
	r.permit = &authority
	r.holderPublic = holderPublic
	facts, err := r.collector(ctx)
	if err != nil {
		if r.gate != nil {
			r.gate.Revoke()
		}
		return RuntimePreparation{}, err
	}
	if facts.Observed != nil && *facts.Observed != checked.Observed {
		if r.gate != nil {
			r.gate.Revoke()
		}
		return RuntimePreparation{}, failure("CONTROLLER_RUNTIME_WATERMARK")
	}
	result := RuntimePreparation{Epoch: checked.Config.Epoch, GateID: r.gateID, BootID: r.bootID, Blockers: []string{}}
	if !facts.NetworkBlocked {
		result.Blockers = append(result.Blockers, "network-fence-not-applied")
	}
	if !facts.LegacyCredentialsBlocked {
		result.Blockers = append(result.Blockers, "legacy-credential-audit-required")
	}
	if !facts.Processes.StableSnapshot || facts.Processes.SSHSessionProcesses > 0 {
		result.Blockers = append(result.Blockers, "ssh-processes-outstanding")
	}
	if !facts.Writers.Complete || !facts.Writers.ManagedWriterIsolationVerified {
		result.Blockers = append(result.Blockers, "local-process-audit-required")
	}
	if facts.ActiveIncusOperations > 0 {
		result.Blockers = append(result.Blockers, "active-incus-operations")
	}
	if len(result.Blockers) > 0 {
		if r.gate != nil {
			r.gate.Revoke()
		}
		return result, nil
	}
	// Recheck authorization time after collection; a slow audit cannot mint a
	// fresh receipt from an expired candidate or preparation permit.
	trust.Now = time.Now().UnixMilli()
	if _, err = VerifyMaintenancePreparation(candidate, permit, trust, r.witnessID, r.witnessKeys); err != nil {
		if r.gate != nil {
			r.gate.Revoke()
		}
		return RuntimePreparation{}, err
	}
	now := time.Now().UnixMilli()
	expires := now + 30000
	if expires > authority.ExpiresAt {
		expires = authority.ExpiresAt
	}
	if expires > checked.Config.ExpiresAt {
		expires = checked.Config.ExpiresAt
	}
	receipt, err := SignFenceReceipt(FenceReceipt{1, "host-fence-receipt", checked.Config.PlatformID, checked.Config.NodeID, checked.Config.ControllerID, checked.Config.RequestID,
		checked.Config.Epoch, checked.Config.Sequence, checked.Observed.PayloadSHA256, authority.Challenge, r.bootID, now, expires, true, true, 0, 0, 0}, r.nodeKey)
	if err != nil {
		return RuntimePreparation{}, err
	}
	proof, err := SignGateProof(GateProof{1, "controller-gate-proof", checked.Config.PlatformID, checked.Config.NodeID, checked.Config.ControllerID, checked.Config.RequestID,
		checked.Config.Epoch, checked.Config.Sequence, checked.Observed.PayloadSHA256, LeaseBodySHA256(receipt), r.bootID, r.gateID, SigningKeyID(holder), now, expires}, r.nodeKey)
	if err != nil {
		return RuntimePreparation{}, err
	}
	result.Receipt = string(receipt)
	result.GateProof = string(proof)
	return result, nil
}

func (r *MaintenanceRuntime) AcceptLease(ctx context.Context, encoded []byte) error {
	return r.AcceptLeaseAuthorized(ctx, encoded, "", "")
}
func (r *MaintenanceRuntime) AcceptLeaseAuthorized(ctx context.Context, encoded []byte, controllerID, holderPublic string) error {
	r.mutex.Lock()
	defer r.mutex.Unlock()
	if r.prepared == nil || r.permit == nil {
		return failure("CONTROLLER_RUNTIME_NOT_PREPARED")
	}
	if len(encoded) > 4096 {
		return failure("CONTROLLER_RUNTIME_LEASE_INVALID")
	}
	if (controllerID != "" && r.prepared.Config.ControllerID != controllerID) || (holderPublic != "" && holderPublic != r.holderPublic) {
		return failure("CONTROLLER_RUNTIME_IDENTITY")
	}
	var env envelope
	var untrusted WriteLease
	if decodeStrict(encoded, &env) != nil {
		return invalid()
	}
	raw, err := base64.StdEncoding.Strict().DecodeString(env.Payload)
	if err != nil || decodeStrict(raw, &untrusted) != nil {
		return invalid()
	}
	holder, _ := decodeBase64(r.holderPublic, 32)
	config := r.prepared.Config
	binding := LeaseBinding{r.witnessID, config.PlatformID, config.NodeID, config.ControllerID, config.RequestID, config.Epoch, config.Sequence, r.prepared.Observed.PayloadSHA256,
		untrusted.LeaseID, r.bootID, r.gateID, SigningKeyID(holder)}
	if _, err = VerifyWriteLease(encoded, LeaseTrust{binding, r.witnessKeys, time.Now().UnixMilli()}); err != nil {
		return err
	}
	if untrusted.ExpiresAt > config.ExpiresAt {
		return failure("CONTROLLER_RUNTIME_EXPIRED")
	}
	facts, err := r.collector(ctx)
	if err != nil || !facts.NetworkBlocked || !facts.LegacyCredentialsBlocked || !facts.Processes.StableSnapshot || facts.Processes.SSHSessionProcesses > 0 ||
		!facts.Writers.Complete || !facts.Writers.ManagedWriterIsolationVerified || facts.ActiveIncusOperations > 0 ||
		(facts.Observed != nil && *facts.Observed != r.prepared.Observed) {
		if r.gate != nil {
			r.gate.Revoke()
		}
		return failure("CONTROLLER_RUNTIME_FENCING_REQUIRED")
	}
	if r.gate == nil {
		gate, err := NewLeaseGate(binding, r.witnessKeys)
		if err != nil {
			return err
		}
		if err = gate.Accept(encoded); err != nil {
			return err
		}
		executor, err := NewHostOperationExecutor(gate, r.socket)
		if err != nil {
			gate.Revoke()
			return err
		}
		r.gate = gate
		r.executor = executor
		return nil
	}
	return r.gate.Accept(encoded)
}

func (r *MaintenanceRuntime) Execute(ctx context.Context, body []byte, proof LeaseRequest, holderPublic string) (HostOperationResult, error) {
	r.mutex.Lock()
	if r.executor == nil || holderPublic != r.holderPublic {
		r.mutex.Unlock()
		return HostOperationResult{}, failure("CONTROLLER_RUNTIME_DENIED")
	}
	executor := r.executor
	gate := r.gate
	observed := r.prepared.Observed
	r.mutex.Unlock()
	return executor.ExecuteAudited(ctx, body, proof, holderPublic, func(ctx context.Context) error {
		facts, err := r.collector(ctx)
		if err != nil || !facts.NetworkBlocked || !facts.LegacyCredentialsBlocked || !facts.Processes.StableSnapshot || facts.Processes.SSHSessionProcesses > 0 ||
			!facts.Writers.Complete || !facts.Writers.ManagedWriterIsolationVerified || (facts.Observed != nil && *facts.Observed != observed) {
			gate.Revoke()
			return failure("CONTROLLER_RUNTIME_FENCING_REQUIRED")
		}
		return nil
	})
}
func (r *MaintenanceRuntime) Revoke() {
	r.mutex.Lock()
	defer r.mutex.Unlock()
	if r.gate != nil {
		r.gate.Revoke()
	}
}
