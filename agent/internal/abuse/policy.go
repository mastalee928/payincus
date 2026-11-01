// Package abuse enforces opt-in plaintext protocol signatures only on customer
// traffic routed out of managed Incus bridges. It never filters host OUTPUT.
// Packet matching cannot detect encrypted, tunneled or split-stream protocols.
package abuse

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
)

const chain = "INCUDAL_ABUSE"
const scanChain = "INCUDAL_ABUSE_SCAN"
const jump = "-A FORWARD -m comment --comment incudal-abuse-v1 -j " + chain

var interfaceName = regexp.MustCompile(`^[a-zA-Z0-9_.-]{1,15}$`)

type Instruction struct {
	Revision    int  `json:"revision"`
	BlockBT     bool `json:"blockBt"`
	BlockMining bool `json:"blockMining"`
	RetryNonce  int  `json:"retryNonce"`
}

// A partially decoded response must never silently turn a switch off.
func (p *Instruction) UnmarshalJSON(data []byte) error {
	var value struct {
		Revision    *int  `json:"revision"`
		BlockBT     *bool `json:"blockBt"`
		BlockMining *bool `json:"blockMining"`
		RetryNonce  *int  `json:"retryNonce"`
	}
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	if value.Revision == nil || value.BlockBT == nil || value.BlockMining == nil || value.RetryNonce == nil {
		return fmt.Errorf("incomplete abuse policy")
	}
	*p = Instruction{Revision: *value.Revision, BlockBT: *value.BlockBT, BlockMining: *value.BlockMining, RetryNonce: *value.RetryNonce}
	return nil
}

type Status struct {
	Instruction
	Applied     bool   `json:"applied"`
	Attempts    int    `json:"attempts"`
	ErrorCode   string `json:"errorCode,omitempty"`
	NextRetryAt string `json:"nextRetryAt,omitempty"`
	CheckedAt   string `json:"checkedAt"`
}

// Instruction's custom decoder must not swallow the additional status fields
// when decoding the embedded policy from the persisted retry state.
func (s *Status) UnmarshalJSON(data []byte) error {
	var p Instruction
	if err := json.Unmarshal(data, &p); err != nil {
		return err
	}
	var value struct {
		Applied     bool   `json:"applied"`
		Attempts    int    `json:"attempts"`
		ErrorCode   string `json:"errorCode"`
		NextRetryAt string `json:"nextRetryAt"`
		CheckedAt   string `json:"checkedAt"`
	}
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	*s = Status{Instruction: p, Applied: value.Applied, Attempts: value.Attempts, ErrorCode: value.ErrorCode, NextRetryAt: value.NextRetryAt, CheckedAt: value.CheckedAt}
	return nil
}

func (p Instruction) valid() bool {
	return p.Revision >= 1 && p.Revision <= 2147483647 && p.RetryNonce >= 0 && p.RetryNonce <= 2147483647
}
func (p Instruction) enabled() bool { return p.BlockBT || p.BlockMining }

func normalizedBridges(bridges []string) ([]string, error) {
	if len(bridges) > 128 {
		return nil, fmt.Errorf("too many managed bridges")
	}
	seen := map[string]bool{}
	for _, name := range bridges {
		if !interfaceName.MatchString(name) || name == "lo" || name == "incudal-mgmt" {
			return nil, fmt.Errorf("invalid customer bridge")
		}
		seen[name] = true
	}
	result := make([]string, 0, len(seen))
	for name := range seen {
		result = append(result, name)
	}
	sort.Strings(result)
	return result, nil
}

// Rules returns only rules owned by this feature; no whole-table restore or
// flush is permitted. mangle/FORWARD runs before generic filter-table ACCEPTs.
func Rules(p Instruction, bridges []string) ([]string, error) {
	if !p.valid() {
		return nil, fmt.Errorf("invalid abuse policy")
	}
	names, err := normalizedBridges(bridges)
	if err != nil {
		return nil, err
	}
	if !p.enabled() {
		return nil, nil
	}
	if len(names) == 0 {
		return nil, fmt.Errorf("no managed customer bridge")
	}
	rules := []string{jump, "-A " + chain + " -o incudal-mgmt -j RETURN"}
	// Inter-bridge and management traffic is not public customer egress.
	for _, name := range names {
		rules = append(rules, "-A "+chain+" -o "+name+" -j RETURN")
	}
	for _, name := range names {
		rules = append(rules, "-A "+chain+" -i "+name+" -j "+scanChain)
	}
	add := func(protocol string, signatures ...string) {
		rule := "-A " + scanChain + " -p " + protocol
		for _, signature := range signatures {
			// Hex avoids shell/parser metacharacters and matches the binary BT
			// length prefix. KMP also handles non-linear skb packet storage.
			rule += " -m string --hex-string \"|" + hex.EncodeToString([]byte(signature)) + "|\" --algo kmp --to 65535"
		}
		rules = append(rules, rule+" -j DROP")
	}
	if p.BlockBT {
		add("tcp", "\x13BitTorrent protocol")
		add("udp", "\x13BitTorrent protocol")
		for _, query := range []string{"1:q4:ping", "1:q9:find_node", "1:q9:get_peers", "1:q13:announce_peer"} {
			add("udp", query, "1:y1:q")
		}
	}
	if p.BlockMining {
		for _, method := range []string{"mining.subscribe", "mining.authorize", "mining.submit", "eth_submitLogin", "eth_submitWork", "eth_getWork"} {
			add("tcp", `"`+method+`"`)
		}
	}
	return rules, nil
}

// canonicalRule accepts iptables-save's quoted/plain string representation and
// extension option order, while preserving rule and repeated match order.
func canonicalRule(line string) string {
	var tokens []string
	var token strings.Builder
	quoted, escaped := false, false
	for _, ch := range line {
		if escaped {
			token.WriteRune(ch)
			escaped = false
			continue
		}
		if ch == '\\' && quoted {
			escaped = true
			continue
		}
		if ch == '"' {
			quoted = !quoted
			continue
		}
		if (ch == ' ' || ch == '\t') && !quoted {
			if token.Len() > 0 {
				tokens = append(tokens, token.String())
				token.Reset()
			}
		} else {
			token.WriteRune(ch)
		}
	}
	if quoted || escaped {
		return "INVALID"
	}
	if token.Len() > 0 {
		tokens = append(tokens, token.String())
	}
	var normalized []string
	for i := 0; i < len(tokens); i++ {
		if tokens[i] == "-m" && i+1 < len(tokens) && tokens[i+1] == "string" {
			i += 2
			var options []string
			for i < len(tokens) && strings.HasPrefix(tokens[i], "--") && i+1 < len(tokens) {
				key, value := tokens[i], tokens[i+1]
				if key == "--string" {
					key, value = "--hex-string", hex.EncodeToString([]byte(value))
				}
				if key == "--hex-string" {
					value = strings.ToLower(strings.Trim(value, "|"))
				}
				if !(key == "--from" && value == "0") && !(key == "--to" && value == "65535") {
					options = append(options, key+"="+value)
				}
				i += 2
			}
			i--
			sort.Strings(options)
			normalized = append(normalized, "STRING{"+strings.Join(options, ";")+"}")
		} else {
			normalized = append(normalized, tokens[i])
		}
	}
	return strings.Join(normalized, " ")
}

func ownedRules(snapshot string) []string {
	var lines []string
	for _, line := range strings.Split(snapshot, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "-A "+chain+" ") || strings.HasPrefix(line, "-A "+scanChain+" ") ||
			(strings.HasPrefix(line, "-A FORWARD ") && (strings.HasSuffix(line, "-j "+chain) || strings.HasSuffix(line, "-g "+chain))) {
			lines = append(lines, line)
		}
	}
	return lines
}

func matches(snapshot string, expected []string) bool {
	actual := ownedRules(snapshot)
	if len(actual) != len(expected) {
		return false
	}
	for i := range expected {
		if canonicalRule(actual[i]) != canonicalRule(expected[i]) {
			return false
		}
	}
	if len(expected) > 0 {
		// A foreign mangle ACCEPT/RETURN placed before our hook can bypass it.
		for _, line := range strings.Split(snapshot, "\n") {
			if strings.HasPrefix(line, "-A FORWARD ") {
				return canonicalRule(line) == canonicalRule(jump)
			}
		}
		return false
	}
	return true
}

func replacement(snapshot string, rules []string) string {
	lines := []string{"*mangle", ":" + chain + " - [0:0]", ":" + scanChain + " - [0:0]", "-F " + chain, "-F " + scanChain}
	for _, line := range ownedRules(snapshot) {
		if strings.HasPrefix(line, "-A FORWARD ") {
			lines = append(lines, strings.Replace(line, "-A ", "-D ", 1))
		}
	}
	for _, rule := range rules {
		if canonicalRule(rule) == canonicalRule(jump) {
			lines = append(lines, strings.Replace(rule, "-A FORWARD", "-I FORWARD 1", 1))
		} else {
			lines = append(lines, rule)
		}
	}
	return strings.Join(append(lines, "COMMIT", ""), "\n")
}
