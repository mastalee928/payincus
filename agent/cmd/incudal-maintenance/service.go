package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"
)

type serviceConfiguration struct {
	SchemaVersion  int    `json:"schemaVersion"`
	Enrollment     string `json:"enrollment"`
	ListenAddress  string `json:"listenAddress"`
	TLSCertificate string `json:"tlsCertificate"`
	TLSPrivateKey  string `json:"tlsPrivateKey"`
	ClientCA       string `json:"clientCa"`
}

// Independent HTTPS preparation service. Mutual TLS and node-scoped signed
// candidate/witness authority are both required. No arbitrary shell, browser
// login, lease bearer endpoint or resource writer is exposed here.
func maintenanceHandler(enrollmentPath string) http.Handler {
	return newMaintenanceHandler(enrollmentPath, run)
}

func newMaintenanceHandler(enrollmentPath string, command func([]string, io.Reader, io.Writer) error) http.Handler {
	var mutex sync.Mutex
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		fail := func(status int, code string) {
			w.WriteHeader(status)
			json.NewEncoder(w).Encode(struct {
				Code string `json:"code"`
			}{code})
		}
		if r.TLS == nil || len(r.TLS.VerifiedChains) == 0 {
			fail(401, "MAINTENANCE_IDENTITY_REQUIRED")
			return
		}
		mode := ""
		if r.Method == "POST" && r.URL.RawQuery == "" && !r.URL.ForceQuery && r.URL.EscapedPath() == "/v1/inspect" {
			mode = "--inspect"
		}
		if r.Method == "POST" && r.URL.RawQuery == "" && !r.URL.ForceQuery && r.URL.EscapedPath() == "/v1/prepare" {
			mode = "--prepare-fence"
		}
		if mode == "" {
			fail(404, "MAINTENANCE_ENDPOINT_UNKNOWN")
			return
		}
		if r.Header.Get("Content-Type") != "application/json" || r.Header.Get("Content-Encoding") != "" || r.ContentLength > 20000 {
			fail(400, "MAINTENANCE_REQUEST_INVALID")
			return
		}
		raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 20000))
		if err != nil {
			fail(400, "MAINTENANCE_REQUEST_INVALID")
			return
		}
		if !mutex.TryLock() {
			fail(409, "MAINTENANCE_BUSY")
			return
		}
		defer mutex.Unlock()
		var output bytes.Buffer
		if err = command([]string{mode, "--enrollment", enrollmentPath}, bytes.NewReader(raw), &output); err != nil {
			fail(409, "MAINTENANCE_PREPARATION_REJECTED")
			return
		}
		// Command output only contains public plan facts, never enrollment or
		// signatures. A disconnected caller cannot cancel an already applied
		// denial; retry must obtain the current state and remaining blockers.
		w.WriteHeader(200)
		w.Write(output.Bytes())
	})
}

func serveMaintenance(ctx context.Context, configPath string) error {
	if os.Geteuid() != 0 {
		return fmt.Errorf("root required")
	}
	raw, err := readEnrollment(configPath)
	if err != nil {
		return err
	}
	var config serviceConfiguration
	if strict(raw, &config) != nil || config.SchemaVersion != 1 {
		return fmt.Errorf("invalid service config")
	}
	for _, path := range []string{config.Enrollment, config.TLSCertificate, config.TLSPrivateKey, config.ClientCA} {
		if !filepath.IsAbs(path) {
			return fmt.Errorf("absolute protected paths required")
		}
	}
	host, port, err := net.SplitHostPort(config.ListenAddress)
	ip := net.ParseIP(host)
	if err != nil || ip == nil || (!ip.IsLoopback() && !ip.IsPrivate()) || ip.IsUnspecified() {
		return fmt.Errorf("explicit loopback or private management IP required")
	}
	number, err := strconv.Atoi(port)
	if err != nil || number < 1024 || number > 65535 || strconv.Itoa(number) != port || net.JoinHostPort(ip.String(), port) != config.ListenAddress {
		return fmt.Errorf("invalid listener port")
	}
	enrollmentRaw, err := readEnrollment(config.Enrollment)
	if err != nil {
		return err
	}
	var enrolled enrollment
	if strict(enrollmentRaw, &enrolled) != nil || enrolled.ManagementPorts == nil || number == enrolled.ManagementPorts.SSH || number == enrolled.ManagementPorts.Incus {
		return fmt.Errorf("independent enrolled service port required")
	}
	release, err := lockMaintenanceService(enrolled.ObservedStateDirectory)
	if err != nil {
		return err
	}
	defer release()
	cert, err := readEnrollment(config.TLSCertificate)
	if err != nil {
		return err
	}
	key, err := readEnrollment(config.TLSPrivateKey)
	if err != nil {
		return err
	}
	pair, err := tls.X509KeyPair(cert, key)
	if err != nil {
		return err
	}
	ca, err := readEnrollment(config.ClientCA)
	if err != nil {
		return err
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(ca) {
		return fmt.Errorf("client CA invalid")
	}
	// Restore signed deny state before opening the listener; no historical
	// lease survives restart. Missing/corrupt state refuses service startup.
	if err = run([]string{"--restore-fence", "--enrollment", config.Enrollment}, bytes.NewReader(nil), io.Discard); err != nil {
		return err
	}
	listener, err := net.Listen("tcp", config.ListenAddress)
	if err != nil {
		return err
	}
	defer listener.Close()
	server := &http.Server{Handler: maintenanceHandler(config.Enrollment), ReadHeaderTimeout: 3 * time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 25 * time.Second, IdleTimeout: 5 * time.Second, MaxHeaderBytes: 8192,
		TLSConfig: &tls.Config{MinVersion: tls.VersionTLS13, Certificates: []tls.Certificate{pair}, ClientAuth: tls.RequireAndVerifyClientCert, ClientCAs: roots}}
	stopped := make(chan struct{})
	defer close(stopped)
	go func() {
		select {
		case <-ctx.Done():
			shutdown, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			server.Shutdown(shutdown)
			server.Close()
		case <-stopped:
		}
	}()
	err = server.Serve(tls.NewListener(listener, server.TLSConfig))
	if err == http.ErrServerClosed {
		return nil
	}
	return err
}
