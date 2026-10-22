//go:build !linux

package main

import (
	"bytes"
	"os"
)

func bytesReader(raw []byte) *bytes.Reader       { return bytes.NewReader(raw) }
func readEnrollment(path string) ([]byte, error) { return nil, os.ErrPermission }
