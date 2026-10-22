package controllerconfig

import (
	"context"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestReadLocalIncusQuiescence(t *testing.T) {
	dir := t.TempDir()
	if err := os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "unix.socket")
	listener, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.Chmod(path, 0600); err != nil {
		t.Fatal(err)
	}
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" || r.URL.RequestURI() != "/1.0/operations?recursion=1&all-projects=true" || r.Header.Get("Authorization") != "" {
			t.Error("unexpected request")
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"type":"sync","status_code":200,"metadata":{}}`))
	})}
	go server.Serve(listener)
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	result, err := ReadIncusQuiescence(ctx, path)
	if err != nil || len(result.ActiveOperationIDs) != 0 {
		t.Fatalf("read: %v", err)
	}
	if err = os.Chmod(path, 0666); err != nil {
		t.Fatal(err)
	}
	if _, err = ReadIncusQuiescence(ctx, path); err == nil {
		t.Fatal("unsafe socket accepted")
	}
	if err = os.Chmod(path, 0600); err != nil {
		t.Fatal(err)
	}
	linked := filepath.Join(dir, "linked")
	if err = os.Symlink(path, linked); err != nil {
		t.Fatal(err)
	}
	if _, err = ReadIncusQuiescence(ctx, linked); err == nil {
		t.Fatal("symlink socket accepted")
	}
	canceled, cancelNow := context.WithCancel(context.Background())
	cancelNow()
	if _, err = ReadIncusQuiescence(canceled, path); err == nil {
		t.Fatal("cancel ignored")
	}
}

func TestReadIncusQuiescenceRejectsResponseFailures(t *testing.T) {
	for _, scenario := range []string{"denied", "redirect", "html", "oversize", "unknown-group"} {
		t.Run(scenario, func(t *testing.T) {
			dir := t.TempDir()
			os.Chmod(dir, 0700)
			path := filepath.Join(dir, "unix.socket")
			listener, err := net.Listen("unix", path)
			if err != nil {
				t.Fatal(err)
			}
			os.Chmod(path, 0600)
			server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch scenario {
				case "denied":
					w.WriteHeader(403)
				case "redirect":
					w.Header().Set("Location", "http://untrusted.invalid/")
					w.WriteHeader(302)
				case "html":
					w.Write([]byte("<html>login</html>"))
				case "oversize":
					w.Write([]byte(strings.Repeat(" ", 1048577)))
				case "unknown-group":
					w.Write([]byte(`{"type":"sync","status_code":200,"metadata":{"unknown":[]}}`))
				}
			})}
			go server.Serve(listener)
			defer server.Close()
			if _, err := ReadIncusQuiescence(context.Background(), path); err == nil {
				t.Fatal("unsafe response accepted")
			}
		})
	}
}
