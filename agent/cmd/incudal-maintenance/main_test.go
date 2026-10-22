package main

import (
	"bytes"
	"strings"
	"testing"
)

func TestMaintenanceRejectsWithoutExplicitPreflight(t *testing.T) {
	for _, args := range [][]string{nil, {"--inspect"}, {"--enrollment", "relative"}, {"--inspect", "--enrollment", "relative"}, {"--apply", "--enrollment", "/tmp/config"}, {"--prepare-fence", "--inspect", "--enrollment", "/tmp/config"}, {"--prepare-fence", "--enrollment", "relative"}} {
		var output bytes.Buffer
		if err := run(args, strings.NewReader("{}"), &output); err == nil {
			t.Fatal("unsafe arguments accepted")
		}
		if output.Len() != 0 {
			t.Fatal("returned misleading result")
		}
	}
	for _, args := range [][]string{{"--restore-fence", "--prepare-fence", "--enrollment", "/tmp/config"}, {"--restore-fence", "--inspect", "--enrollment", "/tmp/config"}} {
		var output bytes.Buffer
		if run(args, strings.NewReader("{}"), &output) == nil {
			t.Fatal("multiple modes accepted")
		}
	}
}
func TestStrictCommandJSON(t *testing.T) {
	for _, raw := range []string{`{"candidate":"a","candidate":"b","preparePermit":"c"}`, `{"candidate":"a","preparePermit":"b","command":"run"}`, `{"candidate":"a","preparePermit":"b"}{}`} {
		var request input
		if strict([]byte(raw), &request) == nil {
			t.Fatal("ambiguous/unknown request accepted")
		}
	}
}
