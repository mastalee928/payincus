package performance

import "strings"

// Append fixed managed settings while preserving every existing byte. sysctl
// uses the last assignment; module lists need only one uncommented module.
func appendRequired(old, desired string) string {
	next := old
	for _, line := range strings.Split(desired, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, setting := strings.Cut(line, "=")
		found := false
		for _, previous := range strings.Split(old, "\n") {
			previous = strings.TrimSpace(previous)
			if setting {
				k, v, ok := strings.Cut(previous, "=")
				if ok && strings.TrimSpace(k) == strings.TrimSpace(key) {
					found = strings.TrimSpace(v) == strings.TrimSpace(value)
				}
			} else if previous == line {
				found = true
			}
		}
		if !found {
			if next != "" && !strings.HasSuffix(next, "\n") {
				next += "\n"
			}
			next += line + "\n"
		}
	}
	return next
}
