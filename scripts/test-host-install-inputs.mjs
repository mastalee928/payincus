import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = readFileSync(new URL('../server/templates/install.sh', import.meta.url), 'utf8').replaceAll('\r\n', '\n')
function extract(name) {
  const start = source.indexOf(`${name}() {`)
  assert.notEqual(start, -1)
  const end = source.indexOf('\n}\n', start)
  assert.notEqual(end, -1)
  return source.slice(start, end + 3)
}
const bash = process.env.BASH_BIN || (process.platform === 'win32' && existsSync('C:/Program Files/Git/bin/bash.exe') ? 'C:/Program Files/Git/bin/bash.exe' : 'bash')
// Only the root check is bypassed in this isolated function copy. All system
// operations are replaced before main runs, and read fails instead of blocking.
const main = extract('main').replace('[[ "$EUID" -ne 0 ]]', 'false')
assert.notEqual(main, extract('main'))
const definitions = `set -euo pipefail
MODE='' TOKEN='' LISTEN_PORT='' IPV6_SUBNET='' IPV6_IFACE=''
INJECT_TOKEN="\${TEST_INJECT_TOKEN:-}" INJECT_MODE="\${TEST_INJECT_MODE:-}"
AGENT_ENABLED=true AGENT_INSTALL_TOKEN=fixture AGENT_ID='' AGENT_SECRET=''
BRIDGE_SUBNET=10.10.0.1/22 IS_PURE_IPV6=false
DIM='' NC='' GREEN='' BLUE='' BOLD='' YELLOW='' CYAN=''
show_banner() { :; }; divider() { :; }
info() { :; }; warn() { :; }; error() { printf '%s\\n' "$*"; }
read() { echo UNEXPECTED_TERMINAL_READ; exit 97; }
detect_system() { echo READ_ONLY_DETECTION; OS_ID=debian; OS_VERSION=13; OS_CODENAME=trixie; }
setup_kernel() { printf 'INSTALL_BOUNDARY port=%s mode=%s heartbeat=%s\\n' "$LISTEN_PORT" "$MODE" "$AGENT_HEARTBEAT_INTERVAL_SECONDS"; exit 0; }
do_uninstall() { echo UNEXPECTED_UNINSTALL; exit 96; }
manage_incudal_agent() { echo UNEXPECTED_AGENT_MENU; exit 96; }
${extract('is_valid_port')}
${extract('configure_agent_heartbeat_interval')}
${extract('confirm_install')}
${main}
main "$@"
`
const token = 'fixture_not_a_real_token'
const outputDirectory = new URL('../logs/host-install-inputs/', import.meta.url)
mkdirSync(outputDirectory, { recursive: true })
const fixturePath = fileURLToPath(new URL('main.sh', outputDirectory))
writeFileSync(fixturePath, definitions)
const cases = [
  { name: 'missing confirmation with port', args: ['--mode', 'nat', '--token', token, '--port', '10001'] },
  { name: 'default port', args: ['--mode', 'nat', '--token', token, '--yes'], port: '8443' },
  { name: 'explicit port', args: ['--mode', 'nat_ipv6', '--token', token, '--port', '10001', '--yes'], port: '10001' },
  { name: 'short flags', args: ['--mode', 'nat', '--token', token, '-p', '65535', '-y'], port: '65535' },
  { name: 'IPv6 subnet injection', args: ['--yes'], env: { TEST_INJECT_TOKEN: token, TEST_INJECT_MODE: 'nat_ipv6', INJECT_IPV6_SUBNET: '2001:db8::/64', INJECT_IPV6_IFACE: 'eth0' }, port: '8443' },
  { name: 'injected parameters', args: ['--yes'], env: { TEST_INJECT_TOKEN: token, TEST_INJECT_MODE: 'nat' }, port: '8443' },
  { name: 'missing confirmation', args: ['--mode', 'nat', '--token', token] },
  { name: 'missing mode', args: ['--token', token, '--yes'] },
  { name: 'missing token', args: ['--mode', 'nat', '--yes'] },
  { name: 'environment cannot imply confirmation', args: ['--mode', 'nat', '--token', token], env: { ASSUME_YES: 'true' } },
  { name: 'invalid mode', args: ['--mode', 'wrong', '--token', token, '--yes'] },
  { name: 'invalid port', args: ['--mode', 'nat', '--token', token, '--port', '22x', '--yes'] },
  { name: 'zero port', args: ['--mode', 'nat', '--token', token, '--port', '0', '--yes'] },
  { name: 'overflow port', args: ['--mode', 'nat', '--token', token, '--port', '65536', '--yes'] },
  { name: 'missing port argument', args: ['--mode', 'nat', '--token', token, '--yes', '--port'] },
  { name: 'unknown flag', args: ['--wrong'] },
  { name: 'agent menu', args: ['--agent'] },
  { name: 'uninstall menu', args: ['--uninstall'] },
  { name: 'yes does not authorize noninteractive uninstall', args: ['--uninstall', '--yes'] },
]
for (const item of cases) {
  const result = spawnSync(bash, [fixturePath, ...item.args], {
    encoding: 'utf8', timeout: 10000, env: { ...process.env, TEST_INJECT_MODE: '', TEST_INJECT_TOKEN: '', ...item.env },
    input: '',
  })
  assert.ifError(result.error)
  const output = result.stdout + result.stderr
  assert.ok(!/UNEXPECTED_/.test(output), `${item.name}: attempted a terminal read or menu`)
  assert.ok(!output.includes(token), `${item.name}: exposed the whole token`)
  if (item.port) {
    assert.equal(result.status, 0, `${item.name}: ${output}`)
    assert.ok(output.includes(`INSTALL_BOUNDARY port=${item.port}`), item.name)
    assert.ok(output.includes('heartbeat=60'), item.name)
  } else {
    assert.notEqual(result.status, 0, item.name)
    assert.ok(!output.includes('INSTALL_BOUNDARY'), item.name)
    assert.ok(!output.includes('READ_ONLY_DETECTION'), `${item.name}: incomplete input must fail before system probes`)
  }
}
console.log('PASS host installer noninteractive inputs: default/explicit port, injected values, confirmation and no terminal reads')
