// Independent gateway transport service. No business backend or arbitrary shell.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"incudal-agent/internal/controllerconfig"
)

type configuration struct {
	SchemaVersion       int               `json:"schemaVersion"`
	PlatformID          string            `json:"platformId"`
	GatewayID           string            `json:"gatewayId"`
	TrustedKeys         map[string]string `json:"trustedKeys"`
	StateDirectory      string            `json:"stateDirectory"`
	SignedConfiguration string            `json:"signedConfiguration"`
	PrivateKeyPath      string            `json:"privateKeyPath"`
}

func run(ctx context.Context, args []string, output io.Writer) error {
	if len(args) != 2 || (args[0] != "--apply" && args[0] != "--restore" && args[0] != "--serve") || !filepath.IsAbs(args[1]) {
		return fmt.Errorf("usage")
	}
	raw, err := controllerconfig.ReadProtectedChannelFile(args[1], 16384)
	if err != nil {
		return err
	}
	if controllerconfig.ValidateProtocolJSON(raw, 16384) != nil {
		return fmt.Errorf("invalid config")
	}
	var config configuration
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&config) != nil || config.SchemaVersion != 1 || !filepath.IsAbs(config.StateDirectory) || !filepath.IsAbs(config.SignedConfiguration) || !filepath.IsAbs(config.PrivateKeyPath) || len(config.TrustedKeys) == 0 {
		return fmt.Errorf("invalid config")
	}
	if _, err = decoder.Token(); err != io.EOF {
		return fmt.Errorf("invalid config")
	}
	trust := controllerconfig.Context{PlatformID: config.PlatformID, NodeID: config.GatewayID, TrustedKeys: config.TrustedKeys}
	once := func(restore bool) error {
		var encoded []byte
		var err error
		if !restore {
			encoded, err = controllerconfig.ReadProtectedChannelFile(config.SignedConfiguration, 65536)
			if err != nil {
				return err
			}
		}
		bounded, cancel := context.WithTimeout(ctx, 20*time.Second)
		defer cancel()
		if err = controllerconfig.ApplyGatewayTransport(bounded, encoded, trust, config.StateDirectory, config.PrivateKeyPath, restore); err != nil {
			return err
		}
		return json.NewEncoder(output).Encode(struct {
			TransportApplied bool `json:"transportApplied"`
			CanWrite         bool `json:"canWrite"`
		}{true, false})
	}
	if args[0] == "--apply" {
		return once(false)
	}
	if args[0] == "--restore" {
		return once(true)
	}
	release, err := controllerconfig.LockChannelService(config.StateDirectory)
	if err != nil {
		return err
	}
	defer release()
	if err = once(true); err != nil {
		return err
	}
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			if once(false) != nil {
				fmt.Fprintln(output, `{"code":"GATEWAY_UPDATE_REJECTED","canWrite":false}`)
				if once(true) != nil {
					fmt.Fprintln(output, `{"code":"GATEWAY_RESTORE_REJECTED","canWrite":false}`)
				}
			}
		}
	}
}
func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if run(ctx, os.Args[1:], os.Stdout) != nil {
		fmt.Fprintln(os.Stderr, "Gateway transport refused; check protected identity, signature, peer tombstones and route conflicts.")
		os.Exit(1)
	}
}
