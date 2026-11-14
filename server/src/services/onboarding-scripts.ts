import { shellQuote as q } from '../lib/host-onboarding.js'
import type { OnboardingGateway } from './onboarding-ssh.js'
import { readFileSync } from 'node:fs'

export function preflightScript(id: string): string {
  return `set -eu
fail() { echo "INCUDAL_ERROR:$1"; exit 1; }
[ "$(id -u)" = 0 ] || fail ROOT_REQUIRED
. /etc/os-release
case "$ID" in alpine|debian|ubuntu) ;; *) fail OS_UNSUPPORTED ;; esac
[ ! -L /etc/incudal-onboarding-id ] || fail HOST_BOOTSTRAP_CONFLICT
if [ -f /etc/incudal-onboarding-id ]; then
  [ "$(cat /etc/incudal-onboarding-id)" = ${q(id)} ] || fail HOST_ALREADY_MANAGED
else
  [ ! -f /etc/wireguard/incudal-mgmt.conf ] || fail HOST_ALREADY_MANAGED
  if command -v incus >/dev/null 2>&1 || command -v lxc >/dev/null 2>&1; then fail HOST_ALREADY_MANAGED; fi
fi
if command -v incus >/dev/null 2>&1; then
  if ! instances=$(incus list --all-projects --format=csv -c n); then
    # A package-only failure may leave the CLI installed before its daemon.
    # Existing database/storage must never be treated as an empty new host.
    [ ! -e /var/lib/incus/database ] && [ ! -L /var/lib/incus/database ] &&
      [ ! -e /var/lib/incus/storage-pools ] && [ ! -L /var/lib/incus/storage-pools ] &&
      [ ! -e /var/lib/incus/containers ] && [ ! -L /var/lib/incus/containers ] &&
      [ ! -e /var/lib/incus/virtual-machines ] && [ ! -L /var/lib/incus/virtual-machines ] || fail INCUS_CHECK_FAILED
    instances=''
  fi
  [ -z "$instances" ] || fail HOST_HAS_INSTANCES
fi
umask 077
[ ! -L /root/.incudal-onboarding ] && [ ! -L ${q('/root/.incudal-onboarding/' + id)} ] || fail HOST_BOOTSTRAP_CONFLICT
mkdir -p ${q('/root/.incudal-onboarding/' + id)}
chmod 700 /root/.incudal-onboarding ${q('/root/.incudal-onboarding/' + id)}
printf '%s' ${q(id)} > /etc/incudal-onboarding-id
echo INCUDAL_PREFLIGHT_OK
`
}

export function prepareKeyScript(id: string): string {
  const now = new Date()
  const bootstrap = readFileSync(new URL('../../templates/onboarding-prepare.sh', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const timezone = readFileSync(new URL('../../templates/host-timezone.py', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  return `INCUDAL_CONTROL_EPOCH=${Math.floor(now.getTime() / 1000)}
INCUDAL_CONTROL_UTC=${q(now.toISOString().slice(0, 19).replace('T', ' '))}
${bootstrap}
set -eu
umask 077
[ ! -L /usr/local/libexec ] || fail HOST_BOOTSTRAP_CONFLICT
mkdir -p /usr/local/libexec
[ ! -L /usr/local/libexec/incudal-host-timezone.py ] || fail HOST_BOOTSTRAP_CONFLICT
temporary=$(mktemp /usr/local/libexec/.incudal-timezone.XXXXXX)
printf '%s' ${q(timezone)} > "$temporary"
chmod 700 "$temporary"
mv "$temporary" /usr/local/libexec/incudal-host-timezone.py
python3 /usr/local/libexec/incudal-host-timezone.py --install || fail HOST_TIME_SYNC_PENDING
if [ "$ID" = alpine ]; then
  if [ -x /etc/init.d/ntpd ]; then
    if rc-service ntpd status >/dev/null 2>&1; then rc-service ntpd stop >/dev/null || fail HOST_TIME_SYNC_PENDING; fi
    rc-update del ntpd default >/dev/null 2>&1 || true
  fi
  rc-update add chronyd default >/dev/null || fail HOST_TIME_SYNC_PENDING
  rc-service chronyd status >/dev/null 2>&1 || rc-service chronyd start >/dev/null || fail HOST_TIME_SYNC_PENDING
else
  systemctl enable --now chrony >/dev/null 2>&1 || fail HOST_TIME_SYNC_PENDING
fi
chronyc waitsync 6 1 0 2 >/dev/null 2>&1 || fail HOST_TIME_SYNC_PENDING
printf 'INCUDAL_OS_ID:%s\\n' "$ID"
key=${q('/root/.incudal-onboarding/' + id + '/wg.key')}
[ ! -L "$key" ] && [ ! -L ${q('/root/.incudal-onboarding/' + id + '/key.lock')} ] || fail HOST_BOOTSTRAP_CONFLICT
exec 9>${q('/root/.incudal-onboarding/' + id + '/key.lock')}
flock -w 15 9 || fail HOST_DEPENDENCIES_PENDING
if [ ! -s "$key" ]; then
  temporary=$(mktemp "$(dirname "$key")/.wg-key.XXXXXX")
  if ! wg genkey > "$temporary" || ! wg pubkey < "$temporary" >/dev/null; then
    rm -f "$temporary"; fail HOST_DEPENDENCIES_PENDING
  fi
  mv "$temporary" "$key"
fi
printf 'INCUDAL_PUBLIC_KEY:'
wg pubkey < "$key"
printf 'INCUDAL_BIND_IP:'
ip -4 route get 1.1.1.1 | awk '{for(i=1;i<=NF;i++) if($i=="src") {print $(i+1); exit}}'
`
}

export function wireguardScript(id: string, gateway: OnboardingGateway): string {
  const authorizedKey = `from="${gateway.controlIp}",no-agent-forwarding,no-X11-forwarding ${gateway.managementSshPublicKey} incudal-control-management`
  return `set -eu
umask 077
mkdir -p /root/.ssh
touch /root/.ssh/authorized_keys
chmod 700 /root/.ssh
chmod 600 /root/.ssh/authorized_keys
grep -Fxq ${q(authorizedKey)} /root/.ssh/authorized_keys || printf '\\n%s\\n' ${q(authorizedKey)} >> /root/.ssh/authorized_keys
mkdir -p /etc/wireguard
key=$(cat ${q('/root/.incudal-onboarding/' + id + '/wg.key')})
if [ ! -f /etc/wireguard/incudal-mgmt.conf ]; then
  printf '%s\n' '[Interface]' "PrivateKey = $key" ${q('Address = ' + gateway.managementIp + '/32')} 'MTU = 1420' '[Peer]' ${q('PublicKey = ' + gateway.publicKey)} ${q('Endpoint = ' + gateway.endpoint)} ${q('AllowedIPs = ' + gateway.controlIp + '/32')} 'PersistentKeepalive = 25' > /etc/wireguard/incudal-mgmt.conf
else
  grep -Fxq ${q('Address = ' + gateway.managementIp + '/32')} /etc/wireguard/incudal-mgmt.conf &&
  grep -Fxq ${q('PublicKey = ' + gateway.publicKey)} /etc/wireguard/incudal-mgmt.conf || { echo INCUDAL_ERROR:MANAGEMENT_NETWORK_CONFLICT; exit 1; }
fi
if command -v systemctl >/dev/null 2>&1; then
  systemctl enable --now wg-quick@incudal-mgmt.service >/dev/null
else
  [ -e /etc/init.d/wg-quick.incudal-mgmt ] || ln -s /etc/init.d/wg-quick /etc/init.d/wg-quick.incudal-mgmt
  rc-update add wg-quick.incudal-mgmt default >/dev/null
  rc-service wg-quick.incudal-mgmt status >/dev/null 2>&1 || rc-service wg-quick.incudal-mgmt start
fi
echo INCUDAL_TUNNEL_STARTED
`
}

export function installerStartScript(id: string, attempt: number, url: string, defaults: { storageSize: number; osId?: string; retryFailedInstall?: boolean }): string {
  const directory = '/root/.incudal-onboarding/' + id
  const downloadUrl = defaults.osId === 'alpine' ? `${url}?os=alpine` : url
  const runner = `#!/bin/sh
set -eu
cd ${q(directory)} || exit 1
printf '%s' "$$" > install.pid
cat /proc/sys/kernel/random/boot_id > install.boot
sed 's/.*) //' "/proc/$$/stat" | awk '{print $20}' > install.ticks
printf '%s' installing > install.phase
set +e
# The runner owns the gate while waiting. Services started by the installer
# must not inherit it and keep onboarding permanently busy after completion.
INCUDAL_ONBOARDING_STORAGE=lvm timeout 2400 bash ./install.sh --mode nat --port 8443${defaults.osId === 'alpine' ? '' : ' --yes'} </dev/null 8>&-
code=$?
set -e
printf '%s' "$code" > install.exit.tmp
mv install.exit.tmp install.exit
rmdir install.lock
exit "$code"
`
  return `set -eu
umask 077
cd ${q(directory)}
[ ! -L install.gate ] || { echo INCUDAL_ERROR:HOST_BOOTSTRAP_CONFLICT; exit 1; }
exec 8>>install.gate
flock -n 8 || { echo INCUDAL_ERROR:INSTALL_BUSY; exit 1; }
if [ -f install.exit ] && [ "$(cat install.exit)" = 0 ]; then echo INCUDAL_INSTALL_DONE; exit 0; fi
if [ -d install.lock ]; then
  ${installerAliveScript()}
  if installer_alive; then echo INCUDAL_INSTALL_RUNNING; exit 0; fi
  if [ "$(cat install.phase 2>/dev/null || true)" = downloading ]; then
    # This gate remains open in curl and the detached runner. Installation
    # starts only after the runner persists the installing phase.
    rmdir install.lock
  else
  ${defaults.retryFailedInstall === false ? '[ -f install.exit ] && [ "$(cat install.exit)" = 75 ] || { echo INCUDAL_ERROR:INSTALL_INTERRUPTED; exit 1; }' : ':'}
  if [ "$(cat install.attempt 2>/dev/null || echo 0)" -ge ${q(attempt)} ]; then
    if [ "$(cat install.exit 2>/dev/null || true)" = 75 ]; then echo INCUDAL_ERROR:INSTALL_DEPENDENCIES_PENDING; else echo INCUDAL_ERROR:INSTALL_INTERRUPTED; fi
    exit 1
  fi
  rmdir install.lock
  fi
fi
${defaults.retryFailedInstall === false ? 'if [ -f install.exit ] && [ "$(cat install.exit)" != 75 ]; then echo INCUDAL_ERROR:INSTALL_FAILED; exit 1; fi' : ':'}
if [ -f install.exit ] && [ "$(cat install.attempt)" = ${q(attempt)} ]; then
  if [ "$(cat install.exit)" = 75 ]; then echo INCUDAL_ERROR:INSTALL_DEPENDENCIES_PENDING; else echo INCUDAL_ERROR:INSTALL_FAILED; fi
  exit 1
fi
mkdir install.lock
printf '%s' downloading > install.phase
printf '%s' ${q(attempt)} > install.attempt
rm -f install.exit
if ! curl --fail --show-error --location --connect-timeout 15 --max-time 120 ${q(downloadUrl)} -o install.sh; then rmdir install.lock; echo INCUDAL_ERROR:INSTALL_DOWNLOAD_FAILED; exit 1; fi
printf '%s' ${q(runner)} > run.sh
nohup sh ./run.sh >install.log 2>&1 </dev/null &
printf '%s' "$!" > install.pid
echo INCUDAL_INSTALL_RUNNING
`
}

function installerAliveScript(): string {
  return `installer_alive() {
  [ -f install.pid ] && [ -f install.boot ] || return 1
  pid=$(cat install.pid)
  case "$pid" in ''|*[!0-9]*) return 1 ;; esac
  [ "$pid" -gt 1 ] && [ "$(cat install.boot)" = "$(cat /proc/sys/kernel/random/boot_id)" ] && kill -0 "$pid" 2>/dev/null || return 1
  [ -f install.ticks ] || return 0
  ticks=$(sed 's/.*) //' "/proc/$pid/stat" | awk '{print $20}')
  [ -n "$ticks" ] && [ "$ticks" = "$(cat install.ticks)" ]
}`
}

export function installerPollScript(id: string): string {
  return `set -eu
cd ${q('/root/.incudal-onboarding/' + id)}
${installerAliveScript()}
# A just-started runner may not have written PID/boot/ticks yet. The inherited
# process lock covers that window as well as the download and installer.
[ ! -L install.gate ] || { echo INCUDAL_ERROR:HOST_BOOTSTRAP_CONFLICT; exit 1; }
exec 8>>install.gate
if ! flock -n 8; then echo running; exit 0; fi
if [ -f install.exit ]; then
  case "$(cat install.exit)" in
    0) echo done ;;
    75) echo INCUDAL_ERROR:INSTALL_DEPENDENCIES_PENDING; exit 1 ;;
    *) echo INCUDAL_ERROR:INSTALL_FAILED; exit 1 ;;
  esac
elif installer_alive; then
  echo running
else echo INCUDAL_ERROR:INSTALL_INTERRUPTED; exit 1
fi
`
}
