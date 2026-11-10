//go:build !linux

package guestguard

func syncDirectory(string) error { return nil } // Unit fixtures only; enforcement is Linux-only.
