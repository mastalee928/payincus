// incudal-maintenance is a separate, explicit preparation command/service. The
// monitoring Agent never starts it. Preparation can deny management TCP only;
// it cannot grant resource write permissions or change customer forwarding.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"incudal-agent/internal/controllerconfig"
)

type enrollment struct {
	SchemaVersion          int                                    `json:"schemaVersion"`
	PlatformID             string                                 `json:"platformId"`
	NodeID                 string                                 `json:"nodeId"`
	WitnessID              string                                 `json:"witnessId"`
	CandidateKeys          map[string]string                      `json:"candidateKeys"`
	WitnessKeys            map[string]string                      `json:"witnessKeys"`
	IncusSocket            string                                 `json:"incusSocket"`
	ObservedStateDirectory string                                 `json:"observedStateDirectory"`
	ManagementPorts        *controllerconfig.ManagementFencePorts `json:"managementPorts,omitempty"`
}
type input struct {
	Candidate     string `json:"candidate"`
	PreparePermit string `json:"preparePermit"`
}

func strict(raw []byte, value any) error {
	if controllerconfig.ValidateProtocolJSON(raw, 20000) != nil {
		return fmt.Errorf("invalid JSON")
	}
	decoder := json.NewDecoder(bytesReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		return err
	}
	if _, err := decoder.Token(); err != io.EOF {
		return fmt.Errorf("trailing data")
	}
	return nil
}
func run(args []string, source io.Reader, output io.Writer) error {
	flags := flag.NewFlagSet("incudal-maintenance", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	config := flags.String("enrollment", "", "protected enrollment file")
	inspect := flags.Bool("inspect", false, "verify preparation authorities and read local Incus state")
	prepare := flags.Bool("prepare-fence", false, "deny external management TCP using a witness preparation permit")
	restore := flags.Bool("restore-fence", false, "restore previously signed deny-only startup fence")
	if flags.Parse(args) != nil || flags.NArg() != 0 || !filepath.IsAbs(*config) {
		return fmt.Errorf("usage")
	}
	modes := 0
	for _, mode := range []bool{*inspect, *prepare, *restore} {
		if mode {
			modes++
		}
	}
	if modes != 1 {
		return fmt.Errorf("usage")
	}
	raw, err := readEnrollment(*config)
	if err != nil {
		return err
	}
	var enrolled enrollment
	if strict(raw, &enrolled) != nil || enrolled.SchemaVersion != 1 || enrolled.PlatformID == "" || enrolled.NodeID == "" || enrolled.WitnessID == "" ||
		len(enrolled.CandidateKeys) == 0 || len(enrolled.WitnessKeys) == 0 || !filepath.IsAbs(enrolled.IncusSocket) || !filepath.IsAbs(enrolled.ObservedStateDirectory) {
		return fmt.Errorf("enrollment")
	}
	if *prepare || *restore {
		if os.Geteuid() != 0 || enrolled.ManagementPorts == nil {
			return fmt.Errorf("preparation requires protected local management ports and root")
		}
		if _, err := controllerconfig.ManagementFenceRules(*enrolled.ManagementPorts, false); err != nil {
			return err
		}
	}
	if *restore {
		// Startup denies using historical authenticated state only; it neither
		// consumes a remote request nor accepts historical write authorization.
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		trust := controllerconfig.Context{PlatformID: enrolled.PlatformID, NodeID: enrolled.NodeID, TrustedKeys: enrolled.CandidateKeys}
		if err := controllerconfig.RestoreManagementPreparationFence(ctx, trust, enrolled.WitnessID, enrolled.WitnessKeys, *enrolled.ManagementPorts, enrolled.ObservedStateDirectory); err != nil {
			return err
		}
		return json.NewEncoder(output).Encode(struct {
			NetworkFenceApplied bool `json:"networkFenceApplied"`
			CanWrite            bool `json:"canWrite"`
		}{true, false})
	}
	raw, err = io.ReadAll(io.LimitReader(source, 20001))
	if err != nil || len(raw) > 20000 {
		return fmt.Errorf("input")
	}
	var request input
	if strict(raw, &request) != nil || request.Candidate == "" || request.PreparePermit == "" {
		return fmt.Errorf("input")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	trust := controllerconfig.Context{PlatformID: enrolled.PlatformID, NodeID: enrolled.NodeID, TrustedKeys: enrolled.CandidateKeys, Now: time.Now().UnixMilli()}
	if _, err := controllerconfig.VerifyMaintenancePreparation([]byte(request.Candidate), []byte(request.PreparePermit), trust, enrolled.WitnessID, enrolled.WitnessKeys); err != nil {
		return err
	}
	observed, err := controllerconfig.ObservePrepareConfig(enrolled.ObservedStateDirectory, []byte(request.Candidate), trust)
	if err != nil {
		return err
	}
	trust.Previous = &observed.Observed
	trust.Now = time.Now().UnixMilli()
	plan, err := controllerconfig.InspectMaintenancePreparation(ctx, []byte(request.Candidate), []byte(request.PreparePermit),
		trust,
		enrolled.WitnessID, enrolled.WitnessKeys, enrolled.IncusSocket)
	if err != nil {
		return err
	}
	if *prepare {
		// Confirm the local inspection channel is usable before denying external
		// management. Active work is reported, never cancelled implicitly.
		if err := controllerconfig.ApplyManagementPreparationFence(ctx, []byte(request.Candidate), []byte(request.PreparePermit),
			trust, enrolled.WitnessID, enrolled.WitnessKeys, *enrolled.ManagementPorts, enrolled.ObservedStateDirectory); err != nil {
			return err
		}
		trust.Now = time.Now().UnixMilli()
		// Re-read operations after blocking new remote writes. A failed read
		// leaves the deny fence installed and produces no success output.
		plan, err = controllerconfig.InspectMaintenancePreparation(ctx, []byte(request.Candidate), []byte(request.PreparePermit),
			trust, enrolled.WitnessID, enrolled.WitnessKeys, enrolled.IncusSocket)
		if err != nil {
			return err
		}
		plan.NetworkFenceApplied = true
		remaining := plan.Blockers[:0]
		for _, blocker := range plan.Blockers {
			if blocker != "network-fence-not-applied" {
				remaining = append(remaining, blocker)
			}
		}
		plan.Blockers = remaining
	}
	return json.NewEncoder(output).Encode(plan)
}
func main() {
	if len(os.Args) == 3 && os.Args[1] == "--serve" {
		ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		defer cancel()
		if err := serveMaintenance(ctx, os.Args[2]); err != nil {
			fmt.Fprintln(os.Stderr, "Maintenance service could not start; check protected configuration and persisted deny state.")
			os.Exit(1)
		}
		return
	}
	if err := run(os.Args[1:], os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "Maintenance preparation failed; verify protected enrollment, signatures and local Incus availability. Any applied deny fence remains in place.")
		os.Exit(1)
	}
}
