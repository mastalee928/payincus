//go:build !linux

package guestguard

import "fmt"

func processLock(string) (func(), error) { return nil, fmt.Errorf("guest protection requires Linux") }
