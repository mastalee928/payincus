package main

import (
	"context"
	"io"
	"testing"
)

func TestGatewayTransportRequiresExplicitProtectedConfiguration(t *testing.T) {
	for _, args := range [][]string{nil, {"--apply"}, {"--serve", "relative"}, {"--exec", "/tmp/file"}, {"--restore", "/tmp/file", "extra"}} {
		if run(context.Background(), args, io.Discard) == nil {
			t.Fatal("unsafe gateway invocation")
		}
	}
}
