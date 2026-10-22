package controllerconfig

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"syscall"
	"testing"
)

func persistentFixtures(t *testing.T) (Context, [][]byte) {
	t.Helper()
	raw, err := os.ReadFile("testdata/node-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var f struct {
		PublicKey, KeyID, PlatformID, NodeID string
		Now                                  int64
		Cases                                []struct {
			Encoded string
			Accept  bool
		}
	}
	if err = json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	ctx := Context{PlatformID: f.PlatformID, NodeID: f.NodeID, Now: f.Now, TrustedKeys: map[string]string{f.KeyID: f.PublicKey}}
	var items [][]byte
	for _, c := range f.Cases {
		if c.Accept {
			items = append(items, []byte(c.Encoded))
		}
	}
	return ctx, items
}

func makeFIFO(t *testing.T, path string) {
	t.Helper()
	if err := syscall.Mkfifo(path, 0600); err != nil {
		t.Fatal(err)
	}
}

func privateDirectory(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestPersistentHighestObservedCandidate(t *testing.T) {
	ctx, items := persistentFixtures(t)
	dir := privateDirectory(t)
	first, err := ObservePrepareConfig(dir, items[0], ctx)
	if err != nil || first.CanWrite || first.Duplicate {
		t.Fatalf("first observation: %v", err)
	}
	duplicate, err := ObservePrepareConfig(dir, items[0], ctx)
	if err != nil || !duplicate.Duplicate {
		t.Fatalf("duplicate: %v", err)
	}
	_, err = ObservePrepareConfig(dir, items[3], ctx)
	if err != nil {
		t.Fatal(err)
	}
	// A fresh context cannot override the on-disk watermark with an old snapshot.
	if _, err = ObservePrepareConfig(dir, items[0], ctx); ErrorCode(err) != "CONTROLLER_CONFIG_ROLLBACK" {
		t.Fatalf("old disk state accepted: %v", err)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "observed.json"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = ObservePrepareConfig(dir, []byte("invalid"), ctx); err == nil {
		t.Fatal("invalid candidate accepted")
	}
	after, _ := os.ReadFile(filepath.Join(dir, "observed.json"))
	if string(raw) != string(after) {
		t.Fatal("invalid candidate overwrote state")
	}
}

func TestConcurrentObservationIsSerialized(t *testing.T) {
	ctx, items := persistentFixtures(t)
	dir := privateDirectory(t)
	var wg sync.WaitGroup
	results := make(chan error, 10)
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r, e := ObservePrepareConfig(dir, items[0], ctx)
			if r.CanWrite {
				t.Error("writer authority")
			}
			results <- e
		}()
	}
	wg.Wait()
	close(results)
	for err := range results {
		if err != nil {
			t.Fatal(err)
		}
	}
}

func TestCorruptOrUnsafeStateDoesNotResetTrust(t *testing.T) {
	ctx, items := persistentFixtures(t)
	for _, kind := range []string{"corrupt", "wrong-mode", "symlink", "hardlink", "directory", "fifo", "lock-symlink", "directory-symlink"} {
		t.Run(kind, func(t *testing.T) {
			dir := privateDirectory(t)
			path := filepath.Join(dir, "observed.json")
			var setupErr error
			switch kind {
			case "corrupt":
				setupErr = os.WriteFile(path, []byte("{}"), 0600)
			case "wrong-mode":
				setupErr = os.WriteFile(path, []byte("{}"), 0644)
			case "symlink":
				setupErr = os.Symlink(filepath.Join(dir, "missing"), path)
			case "hardlink":
				setupErr = os.WriteFile(filepath.Join(dir, "original"), []byte("{}"), 0600)
				if setupErr == nil {
					setupErr = os.Link(filepath.Join(dir, "original"), path)
				}
			case "directory":
				setupErr = os.Mkdir(path, 0700)
			case "fifo":
				makeFIFO(t, path)
			case "lock-symlink":
				setupErr = os.Symlink(filepath.Join(dir, "missing"), filepath.Join(dir, "observe.lock"))
			case "directory-symlink":
				link := dir + "-link"
				setupErr = os.Symlink(dir, link)
				defer os.Remove(link)
				dir = link
			}
			if setupErr != nil {
				t.Fatal(setupErr)
			}
			if _, err := ObservePrepareConfig(dir, items[0], ctx); err == nil {
				t.Fatal("unsafe state accepted")
			}
		})
	}
}

func TestWritableAncestorIsRejected(t *testing.T) {
	ctx, items := persistentFixtures(t)
	parent := t.TempDir()
	if err := os.Chmod(parent, 0777); err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(parent, "private")
	if err := os.Mkdir(dir, 0700); err != nil {
		t.Fatal(err)
	}
	if _, err := ObservePrepareConfig(dir, items[0], ctx); ErrorCode(err) != "CONTROLLER_CONFIG_STATE_INVALID" {
		t.Fatalf("writable ancestor accepted: %v", err)
	}
}
