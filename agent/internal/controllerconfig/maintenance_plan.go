package controllerconfig

import (
	"context"
	"encoding/base64"
	"sort"
)

type MaintenancePlan struct {
	PlatformID            string        `json:"platformId"`
	NodeID                string        `json:"nodeId"`
	Epoch                 string        `json:"epoch"`
	Sequence              string        `json:"sequence"`
	ControllerID          string        `json:"controllerId"`
	GatewayID             string        `json:"gatewayId"`
	ManagementAddress     string        `json:"managementAddress"`
	ControllerAddress     string        `json:"controllerAddress"`
	PreparationPermitted  bool          `json:"preparationPermitted"`
	ActiveIncusOperations int           `json:"activeIncusOperations"`
	ReadyForFencing       bool          `json:"readyForFencing"`
	CanWrite              bool          `json:"canWrite"`
	Blockers              []string      `json:"blockers"`
	NetworkFenceApplied   bool          `json:"networkFenceApplied"`
	ProcessAudit          *ProcessAudit `json:"processAudit,omitempty"`
}

// InspectMaintenancePreparation verifies both independent authorities before
// reading local Incus. It only creates a plan, never changes routes, keys,
// firewall, Agent URL or writer permissions. An observed candidate alone must
// never become a root instruction. Callers retain highest epoch separately.
func InspectMaintenancePreparation(ctx context.Context, candidate, permit []byte, trust Context, witnessID string, witnessKeys map[string]string, socketPath string) (MaintenancePlan, error) {
	var empty MaintenancePlan
	checked, err := VerifyMaintenancePreparation(candidate, permit, trust, witnessID, witnessKeys)
	if err != nil {
		return empty, err
	}
	config := checked.Config
	processes, err := ReadLocalProcessAudit(ctx)
	if err != nil {
		return empty, err
	}
	operations, err := ReadIncusQuiescence(ctx, socketPath)
	if err != nil {
		return empty, err
	}
	blockers := []string{}
	if len(operations.ActiveOperationIDs) > 0 {
		blockers = append(blockers, "active-incus-operations")
	}
	blockers = append(blockers, "network-fence-not-applied", "legacy-credential-audit-required", "local-process-audit-required")
	sort.Strings(blockers)
	return MaintenancePlan{PlatformID: config.PlatformID, NodeID: config.NodeID, Epoch: config.Epoch, Sequence: config.Sequence,
		ControllerID: config.ControllerID, GatewayID: config.Gateway.GatewayID, ManagementAddress: config.Gateway.NodeAddress,
		ControllerAddress: config.Gateway.ControlAddress, PreparationPermitted: true, ActiveIncusOperations: len(operations.ActiveOperationIDs),
		Blockers: blockers, ProcessAudit: &processes}, nil
}

// Validate authorities before persisting a new watermark or accessing Incus.
func VerifyMaintenancePreparation(candidate, permit []byte, trust Context, witnessID string, witnessKeys map[string]string) (Result, error) {
	var empty Result
	if len(permit) > 4096 {
		return empty, failure("CONTROLLER_PREPARE_PERMIT_INVALID")
	}
	checked, err := VerifyPrepareConfig(candidate, trust)
	if err != nil {
		return empty, err
	}
	var env envelope
	if decodeStrict(permit, &env) != nil {
		return empty, failure("CONTROLLER_PREPARE_PERMIT_INVALID")
	}
	raw, err := base64.StdEncoding.Strict().DecodeString(env.Payload)
	if err != nil || len(raw) > 4096 {
		return empty, failure("CONTROLLER_PREPARE_PERMIT_INVALID")
	}
	var untrusted PreparePermit
	if decodeStrict(raw, &untrusted) != nil {
		return empty, failure("CONTROLLER_PREPARE_PERMIT_INVALID")
	}
	config := checked.Config
	binding := FenceBinding{config.PlatformID, config.NodeID, config.ControllerID, config.RequestID, config.Epoch, config.Sequence, checked.Observed.PayloadSHA256, untrusted.Challenge}
	if _, err = VerifyPreparePermit(permit, PreparePermitTrust{binding, witnessID, witnessKeys, trust.Now}); err != nil {
		return empty, err
	}
	return checked, nil
}
