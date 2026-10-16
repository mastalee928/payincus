package upgrade

import (
	"regexp"
	"strings"
)

var semverPattern = regexp.MustCompile(`^v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$`)
var numericIdentifier = regexp.MustCompile(`^[0-9]+$`)

type releaseVersion struct {
	core []string
	pre  []string
}

func parseReleaseVersion(value string) (releaseVersion, bool) {
	if len(value) > 128 {
		return releaseVersion{}, false
	}
	m := semverPattern.FindStringSubmatch(value)
	if m == nil {
		return releaseVersion{}, false
	}
	v := releaseVersion{core: m[1:4]}
	if m[4] != "" {
		v.pre = strings.Split(m[4], ".")
		for _, part := range v.pre {
			if numericIdentifier.MatchString(part) && len(part) > 1 && part[0] == '0' {
				return releaseVersion{}, false
			}
		}
	}
	return v, true
}

func compareNumber(a, b string) int {
	if len(a) < len(b) {
		return -1
	}
	if len(a) > len(b) {
		return 1
	}
	return strings.Compare(a, b)
}

func compareReleaseVersions(a, b string) (int, bool) {
	x, xok := parseReleaseVersion(a)
	y, yok := parseReleaseVersion(b)
	if !xok || !yok {
		return 0, false
	}
	for i := 0; i < 3; i++ {
		if result := compareNumber(x.core[i], y.core[i]); result != 0 {
			return result, true
		}
	}
	if len(x.pre) == 0 && len(y.pre) == 0 {
		return 0, true
	}
	if len(x.pre) == 0 {
		return 1, true
	}
	if len(y.pre) == 0 {
		return -1, true
	}
	for i := 0; i < len(x.pre) || i < len(y.pre); i++ {
		if i >= len(x.pre) {
			return -1, true
		}
		if i >= len(y.pre) {
			return 1, true
		}
		left, right := x.pre[i], y.pre[i]
		if left == right {
			continue
		}
		ln, rn := numericIdentifier.MatchString(left), numericIdentifier.MatchString(right)
		if ln && rn {
			return compareNumber(left, right), true
		}
		if ln != rn {
			if ln {
				return -1, true
			}
			return 1, true
		}
		return strings.Compare(left, right), true
	}
	return 0, true
}

// ShouldUpgrade also protects a newer agent when its panel is rolled back or
// serves a cached older manifest. Unknown legacy/dev versions still bootstrap.
func ShouldUpgrade(current, target string) bool {
	if target == "" || current == target {
		return false
	}
	result, known := compareReleaseVersions(current, target)
	return !known || result < 0
}
