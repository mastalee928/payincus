package main

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func maintenanceTestCertificates(t *testing.T) ([]byte, []byte, []byte, tls.Certificate) {
	t.Helper()
	newKey := func() *ecdsa.PrivateKey {
		key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
		return key
	}
	caKey := newKey()
	ca := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "maintenance-test-ca"}, NotBefore: time.Now().Add(-time.Minute), NotAfter: time.Now().Add(time.Hour), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign}
	caDER, err := x509.CreateCertificate(rand.Reader, ca, ca, &caKey.PublicKey, caKey)
	if err != nil {
		t.Fatal(err)
	}
	caPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caDER})
	leaf := func(serial int64, usage x509.ExtKeyUsage) ([]byte, []byte) {
		key := newKey()
		cert := &x509.Certificate{SerialNumber: big.NewInt(serial), Subject: pkix.Name{CommonName: "maintenance-test"}, NotBefore: time.Now().Add(-time.Minute), NotAfter: time.Now().Add(time.Hour), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{usage}, IPAddresses: []net.IP{net.ParseIP("127.0.0.1")}}
		der, err := x509.CreateCertificate(rand.Reader, cert, ca, &key.PublicKey, caKey)
		if err != nil {
			t.Fatal(err)
		}
		encodedKey, err := x509.MarshalPKCS8PrivateKey(key)
		if err != nil {
			t.Fatal(err)
		}
		return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: encodedKey})
	}
	serverCert, serverKey := leaf(2, x509.ExtKeyUsageServerAuth)
	clientCert, clientKey := leaf(3, x509.ExtKeyUsageClientAuth)
	client, err := tls.X509KeyPair(clientCert, clientKey)
	if err != nil {
		t.Fatal(err)
	}
	return caPEM, serverCert, serverKey, client
}

func TestMaintenanceHTTPSIdentityAndClosedEndpoints(t *testing.T) {
	ca, cert, key, identity := maintenanceTestCertificates(t)
	pair, err := tls.X509KeyPair(cert, key)
	if err != nil {
		t.Fatal(err)
	}
	roots := x509.NewCertPool()
	roots.AppendCertsFromPEM(ca)
	var calls atomic.Int32
	handler := newMaintenanceHandler("/protected/enrollment.json", func(args []string, source io.Reader, output io.Writer) error {
		calls.Add(1)
		if len(args) != 3 || args[1] != "--enrollment" || args[2] != "/protected/enrollment.json" {
			t.Error("command arguments changed")
		}
		raw, _ := io.ReadAll(source)
		if string(raw) == "reject" {
			output.Write([]byte("partial result must be discarded"))
			return fmt.Errorf("private enrollment detail")
		}
		output.Write([]byte(`{"canWrite":false}`))
		return nil
	})
	server := httptest.NewUnstartedServer(handler)
	server.Config.ErrorLog = nil
	server.TLS = &tls.Config{MinVersion: tls.VersionTLS13, Certificates: []tls.Certificate{pair}, ClientCAs: roots, ClientAuth: tls.RequireAndVerifyClientCert}
	server.StartTLS()
	defer server.Close()
	transport := &http.Transport{TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS13, RootCAs: roots, Certificates: []tls.Certificate{identity}}}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 3 * time.Second}
	post := func(method, path, contentType, body string) *http.Response {
		r, _ := http.NewRequest(method, server.URL+path, strings.NewReader(body))
		r.Header.Set("Content-Type", contentType)
		response, err := client.Do(r)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { response.Body.Close() })
		return response
	}
	for _, path := range []string{"/v1/lease", "/v1/operations", "/v1/prepare?x=1", "/v1/prepare?", "/v1/%70repare", "/v1/prepare/"} {
		if post("POST", path, "application/json", "{}").StatusCode != 404 {
			t.Fatalf("unsafe path allowed: %s", path)
		}
	}
	if post("GET", "/v1/prepare", "application/json", "{}").StatusCode != 404 || post("POST", "/v1/inspect", "text/plain", "{}").StatusCode != 400 || post("POST", "/v1/prepare", "application/json", strings.Repeat("x", 20001)).StatusCode != 400 || calls.Load() != 0 {
		t.Fatal("invalid requests invoked command")
	}
	for _, path := range []string{"/v1/prepare", "/v1/inspect"} {
		r := post("POST", path, "application/json", "{}")
		body, _ := io.ReadAll(r.Body)
		if r.StatusCode != 200 || string(body) != `{"canWrite":false}` || r.Header.Get("Cache-Control") != "no-store" || r.Header.Get("X-Content-Type-Options") != "nosniff" {
			t.Fatal("bad successful plan")
		}
	}
	r := post("POST", "/v1/inspect", "application/json", "reject")
	body, _ := io.ReadAll(r.Body)
	if r.StatusCode != 409 || bytes.Contains(body, []byte("partial")) || bytes.Contains(body, []byte("private")) {
		t.Fatal("rejected command leaked partial output or enrollment")
	}
	for _, certs := range [][]tls.Certificate{nil, {func() tls.Certificate { _, _, _, foreign := maintenanceTestCertificates(t); return foreign }()}} {
		tr := &http.Transport{TLSClientConfig: &tls.Config{RootCAs: roots, Certificates: certs}}
		cl := &http.Client{Transport: tr, Timeout: 3 * time.Second}
		resp, err := cl.Post(server.URL+"/v1/inspect", "application/json", strings.NewReader("{}"))
		tr.CloseIdleConnections()
		if err == nil {
			resp.Body.Close()
			t.Fatal("missing or foreign client identity reached handler")
		}
	}
	if calls.Load() != 3 {
		t.Fatal("unauthenticated TLS request invoked command")
	}
}

func TestMaintenanceHandlerRejectsOverlapAndUnverifiedTLS(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	h := newMaintenanceHandler("/private/enrollment.json", func(_ []string, _ io.Reader, out io.Writer) error {
		calls.Add(1)
		close(entered)
		<-release
		_, err := out.Write([]byte(`{"canWrite":false}`))
		return err
	})
	request := func(verified bool) *http.Request {
		r := httptest.NewRequest("POST", "https://127.0.0.1/v1/prepare", strings.NewReader("{}"))
		r.Header.Set("Content-Type", "application/json")
		if verified {
			r.TLS = &tls.ConnectionState{VerifiedChains: [][]*x509.Certificate{{{}}}}
		}
		return r
	}
	unauthenticated := httptest.NewRecorder()
	h.ServeHTTP(unauthenticated, request(false))
	if unauthenticated.Code != 401 || calls.Load() != 0 {
		t.Fatal("unverified TLS allowed")
	}
	first := httptest.NewRecorder()
	done := make(chan struct{})
	go func() { h.ServeHTTP(first, request(true)); close(done) }()
	<-entered
	second := httptest.NewRecorder()
	h.ServeHTTP(second, request(true))
	if second.Code != 409 || calls.Load() != 1 {
		t.Error("overlapping mutation allowed")
	}
	close(release)
	<-done
	if first.Code != 200 {
		t.Fatal("first request failed")
	}
}
