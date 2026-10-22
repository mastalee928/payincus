package main

import (
	"context"
	"io"
	"testing"
)

func TestChannelsRequiresExplicitProtectedConfiguration(t *testing.T) {
	for _, args := range [][]string{nil, {"--apply"}, {"--apply", "relative"}, {"--shell", "/tmp/file"}, {"--serve", "relative"}, {"--apply", "/tmp/file", "extra"}} {
		if run(context.Background(), args, io.Discard) == nil {
			t.Fatal("unsafe arguments accepted")
		}
	}
}
