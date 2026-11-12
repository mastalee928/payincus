package performance

import (
	"fmt"
	"os"
	"strings"
)

func ensureOpenRCModules() error {
	if _, err := os.Stat("/sbin/openrc-run"); os.IsNotExist(err) {
		return nil
	} else if err != nil {
		return err
	}
	const path = "/etc/modules"
	info, err := os.Lstat(path)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	if err == nil && (!info.Mode().IsRegular() || info.Mode()&0022 != 0 || !rootOwned(info)) {
		return fmt.Errorf("unsafe modules file")
	}
	raw, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	text := string(raw)
	next := text
	for _, module := range []string{"tcp_bbr", "sch_fq"} {
		found := false
		for _, line := range strings.Split(text, "\n") {
			if strings.TrimSpace(line) == module {
				found = true
			}
		}
		if !found {
			if next != "" && !strings.HasSuffix(next, "\n") {
				next += "\n"
			}
			next += module + "\n"
		}
	}
	if next == text {
		return nil
	}
	// /etc is root-owned. Open with nofollow via the platform helper; preserve
	// all prior bytes and do not rewrite administrator entries.
	return writeModules(path, raw, []byte(next))
}
