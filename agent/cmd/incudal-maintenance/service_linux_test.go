package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"incudal-agent/internal/controllerconfig"
)

// Called only by the isolated preparation harness, after it has checked that
// this process is root in a separate network namespace. Uses real persisted
// authorization, production startup restoration and the production listener.
func testMaintenanceServiceLifecycle(t *testing.T, dir, enrollmentPath string, request []byte, enrolled enrollment) {
	t.Helper()
	ca, cert, key, identity := maintenanceTestCertificates(t)
	write := func(name string, raw []byte) string {
		path := filepath.Join(dir, name)
		if err := os.WriteFile(path, raw, 0600); err != nil {
			t.Fatal(err)
		}
		return path
	}
	freeAddress := func() string {
		l, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		address := l.Addr().String()
		l.Close()
		return address
	}
	_, nodeKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	enrolled.NodeSeedPath = write("node.seed", []byte(base64.StdEncoding.EncodeToString(nodeKey.Seed())))
	enrollmentBytes, _ := json.Marshal(enrolled)
	if os.WriteFile(enrollmentPath, enrollmentBytes, 0600) != nil {
		t.Fatal("enrollment write")
	}
	var in input
	if json.Unmarshal(request, &in) != nil {
		t.Fatal("request")
	}
	checked, err := controllerconfig.VerifyPrepareConfig([]byte(in.Candidate), controllerconfig.Context{PlatformID: enrolled.PlatformID, NodeID: enrolled.NodeID, Now: time.Now().UnixMilli(), TrustedKeys: enrolled.CandidateKeys})
	if err != nil {
		t.Fatal(err)
	}
	holder, _, _ := ed25519.GenerateKey(rand.Reader)
	holderPublic := base64.StdEncoding.EncodeToString(holder)
	leaf, err := x509.ParseCertificate(identity.Certificate[0])
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(leaf.Raw)
	config := serviceConfiguration{SchemaVersion: 1, Enrollment: enrollmentPath, ListenAddress: freeAddress(), TLSCertificate: write("service.crt", cert), TLSPrivateKey: write("service.key", key), ClientCA: write("client-ca.crt", ca),
		ClientIdentities: map[string]maintenanceClientIdentity{fmt.Sprintf("%x", digest): {checked.Config.ControllerID, holderPublic}}}
	configRaw, _ := json.Marshal(config)
	path := write("service.json", configRaw)
	roots := x509.NewCertPool()
	roots.AppendCertsFromPEM(ca)
	tr := &http.Transport{TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS13, RootCAs: roots, Certificates: []tls.Certificate{identity}}}
	defer tr.CloseIdleConnections()
	client := &http.Client{Transport: tr, Timeout: 3 * time.Second}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- serveMaintenance(ctx, path) }()
	url := "https://" + config.ListenAddress + "/v1/inspect"
	deadline := time.Now().Add(5 * time.Second)
	var response *http.Response
	for time.Now().Before(deadline) {
		select {
		case err := <-done:
			t.Fatalf("startup failed: %v", err)
		default:
		}
		var err error
		response, err = client.Post(url, "application/json", bytes.NewReader(request))
		if err == nil {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if response == nil {
		t.Fatal("production listener did not start")
	}
	raw, _ := io.ReadAll(response.Body)
	response.Body.Close()
	var plan MaintenanceOutput
	if response.StatusCode != 200 || json.Unmarshal(raw, &plan) != nil || plan.CanWrite || !plan.PreparationPermitted {
		t.Fatalf("production HTTPS inspection rejected: %d", response.StatusCode)
	}
	attestBody, _ := json.Marshal(map[string]string{"candidate": in.Candidate, "preparePermit": in.PreparePermit, "holderPublicKey": holderPublic})
	attested, err := client.Post("https://"+config.ListenAddress+"/v1/attest", "application/json", bytes.NewReader(attestBody))
	if err != nil {
		t.Fatal(err)
	}
	attestedRaw, _ := io.ReadAll(attested.Body)
	attested.Body.Close()
	var preparation controllerconfig.RuntimePreparation
	if attested.StatusCode != 200 || json.Unmarshal(attestedRaw, &preparation) != nil || preparation.Receipt != "" || preparation.GateProof != "" || preparation.CanWrite || len(preparation.Blockers) < 2 {
		t.Fatal("actual unisolated service created writer evidence")
	}
	duplicate := config
	duplicate.ListenAddress = freeAddress()
	duplicateRaw, _ := json.Marshal(duplicate)
	if serveMaintenance(context.Background(), write("duplicate.json", duplicateRaw)) == nil {
		t.Fatal("different port opened duplicate host service")
	}
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("service ignored shutdown")
	}
	if l, err := net.DialTimeout("tcp", config.ListenAddress, 200*time.Millisecond); err == nil {
		l.Close()
		t.Fatal("listener survived shutdown")
	}
	// Missing signed startup state cannot be replaced by an empty initialization.
	missingDirectory := filepath.Join(dir, "missing-state")
	if err := os.Mkdir(missingDirectory, 0700); err != nil {
		t.Fatal(err)
	}
	enrolled.ObservedStateDirectory = missingDirectory
	enrolledRaw, _ := json.Marshal(enrolled)
	config.Enrollment = write("missing-enrollment.json", enrolledRaw)
	config.ListenAddress = freeAddress()
	missingConfig, _ := json.Marshal(config)
	if serveMaintenance(context.Background(), write("missing-service.json", missingConfig)) == nil {
		t.Fatal("missing deny state allowed startup")
	}
	if l, err := net.DialTimeout("tcp", config.ListenAddress, 200*time.Millisecond); err == nil {
		l.Close()
		t.Fatal("missing deny state opened listener")
	}
	for _, address := range []string{"0.0.0.0:18443", "8.8.8.8:18443", "127.0.0.1:8443", "127.0.0.1:2200", "127.0.0.1:018443"} {
		config.Enrollment = enrollmentPath
		config.ListenAddress = address
		bad, _ := json.Marshal(config)
		if serveMaintenance(context.Background(), write("invalid-service.json", bad)) == nil {
			t.Fatalf("unsafe address accepted: %s", address)
		}
	}
}
