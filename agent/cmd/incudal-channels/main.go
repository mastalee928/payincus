// incudal-channels maintains signed dedicated management transport. It is
// independent of monitoring and exposes no shell, listener or resource writer.
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
	SchemaVersion       int                                     `json:"schemaVersion"`
	PlatformID          string                                  `json:"platformId"`
	NodeID              string                                  `json:"nodeId"`
	TrustedKeys         map[string]string                       `json:"trustedKeys"`
	StateDirectory      string                                  `json:"stateDirectory"`
	SignedConfiguration string                                  `json:"signedConfiguration"`
	LocalIdentities     []controllerconfig.ChannelLocalIdentity `json:"localIdentities"`
}

func load(path string) (configuration, error) {
	var config configuration
	raw, err := controllerconfig.ReadProtectedChannelFile(path, 16384)
	if err != nil {
		return config, err
	}
	if controllerconfig.ValidateProtocolJSON(raw, 16384) != nil {
		return config, fmt.Errorf("invalid configuration")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&config) != nil {
		return config, fmt.Errorf("invalid configuration")
	}
	if _, err = decoder.Token(); err != io.EOF {
		return config, fmt.Errorf("invalid configuration")
	}
	if config.SchemaVersion != 1 || len(config.TrustedKeys) == 0 || len(config.TrustedKeys) > 8 || len(config.LocalIdentities) < 1 || len(config.LocalIdentities) > 2 ||
		!filepath.IsAbs(config.StateDirectory) || !filepath.IsAbs(config.SignedConfiguration) {
		return config, fmt.Errorf("invalid configuration")
	}
	return config, nil
}

func run(ctx context.Context, args []string, output io.Writer) error {
	if len(args) != 2 || (args[0] != "--apply" && args[0] != "--restore" && args[0] != "--serve") || !filepath.IsAbs(args[1]) {
		return fmt.Errorf("usage")
	}
	config, err := load(args[1])
	if err != nil {
		return err
	}
	trust := controllerconfig.Context{PlatformID: config.PlatformID, NodeID: config.NodeID, TrustedKeys: config.TrustedKeys}
	once := func(restore bool) error {
		bounded, cancel := context.WithTimeout(ctx, 20*time.Second)
		defer cancel()
		var result []controllerconfig.ChannelApplyResult
		if restore {
			result, err = controllerconfig.RestoreManagementChannels(bounded, trust, config.StateDirectory, config.LocalIdentities)
		} else {
			var encoded []byte
			encoded, err = controllerconfig.ReadProtectedChannelFile(config.SignedConfiguration, controllerconfig.MaxEnvelopeBytes)
			if err == nil {
				result, err = controllerconfig.ApplyManagementChannels(bounded, encoded, trust, config.StateDirectory, config.LocalIdentities)
			}
		}
		if err != nil {
			return err
		}
		return json.NewEncoder(output).Encode(struct {
			Channels []controllerconfig.ChannelApplyResult `json:"channels"`
			CanWrite bool                                  `json:"canWrite"`
		}{result, false})
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
			// Signed updates are checked first. If unavailable/expired, refreshing
			// locally authenticated current channels preserves recovery and DNS.
			if once(false) != nil {
				fmt.Fprintln(output, `{"code":"CHANNEL_UPDATE_REJECTED","canWrite":false}`)
				if once(true) != nil {
					fmt.Fprintln(output, `{"code":"CHANNEL_REFRESH_REJECTED","canWrite":false}`)
				}
			}
		}
	}
}
func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if run(ctx, os.Args[1:], os.Stdout) != nil {
		fmt.Fprintln(os.Stderr, "Management channels rejected; check protected identities, signed configuration and network conflicts. Existing customer routes are retained.")
		os.Exit(1)
	}
}
