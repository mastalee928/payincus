//go:build !linux

package main

import "os"

func lockMaintenanceService(string) (func(), error) { return nil, os.ErrPermission }
