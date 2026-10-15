#!/usr/bin/env bash
# Alpine onboarding, adapted from the ociee installer for PayIncus NAT delivery.
set -euo pipefail
umask 077

INJECT_PANEL_URL=""
INJECT_TOKEN=""
INJECT_AGENT_INSTALL_TOKEN=""
INJECT_AGENT_ENABLED="true"
INJECT_AGENT_BINARY_URL=""
INJECT_AGENT_BINARY_SHA256=""

fail() { printf 'Alpine installation failed: %s\n' "$*" >&2; exit 1; }

install_alpine() {
  [[ $EUID -eq 0 ]] || fail 'root is required'
  . /etc/os-release
  [[ "$ID" == alpine ]] || fail 'this installer requires Alpine Linux'
  local branch="v$(printf '%s' "$VERSION_ID" | cut -d. -f1,2)"
  [[ "$branch" =~ ^v[0-9]+\.[0-9]+$ ]] || fail 'invalid Alpine version'
  [[ "$INJECT_PANEL_URL" == https://* && -n "$INJECT_TOKEN" ]] || fail 'a valid panel installation session is required'
  local mode=nat port=8443
  while [[ $# -gt 0 ]]; do
    [[ $# -ge 2 ]] || fail 'missing argument'
    case "$1" in
      --mode) mode="$2" ;;
      --port) port="$2" ;;
      *) fail 'unsupported argument' ;;
    esac
    shift 2
  done
  [[ "$mode" == nat && "$port" =~ ^[0-9]{1,5}$ ]] || fail 'invalid network settings'
  (( 10#$port >= 1 && 10#$port <= 65535 )) || fail 'invalid API port'
  local management_ip
  management_ip=$(ip -4 -o address show dev incudal-mgmt | awk '{split($4,a,"/"); print a[1]; exit}')
  [[ "$management_ip" =~ ^10\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail 'management tunnel is required'

  # Use signed packages from the installed stable branch, never Alpine edge.
  local repository="https://dl-cdn.alpinelinux.org/alpine/$branch"
  grep -Eq "/$branch/community/?$" /etc/apk/repositories || printf '%s/community\n' "$repository" >> /etc/apk/repositories
  apk add --no-cache incus incus-client incus-openrc bash curl ca-certificates \
    openssl python3 iproute2 iptables ip6tables nftables util-linux coreutils shadow-subids \
    dnsmasq btrfs-progs rsync squashfs-tools tar gzip xz

  rc-update add cgroups boot
  rc-service cgroups status >/dev/null 2>&1 || rc-service cgroups start
  touch /etc/subuid /etc/subgid
  local idmap_file
  for idmap_file in /etc/subuid /etc/subgid; do
    if ! awk -F: '$1 == "root" && $3 >= 65536 { found=1 } END { exit !found }' "$idmap_file"; then
      printf '%s\n' 'root:1000000:65536' >> "$idmap_file"
    fi
  done
  mkdir -p /etc/sysctl.d
  printf '%s\n' 'net.ipv4.ip_forward=1' > /etc/sysctl.d/90-incudal-alpine.conf
  sysctl -p /etc/sysctl.d/90-incudal-alpine.conf
  modprobe btrfs || true
  grep -qw btrfs /proc/filesystems || fail 'the running kernel has no Btrfs support'
  rc-update add incusd default
  rc-service incusd status >/dev/null 2>&1 || rc-service incusd start
  local ready=false attempt
  for attempt in $(seq 1 30); do
    if incus query /1.0 >/dev/null 2>&1; then ready=true; break; fi
    sleep 1
  done
  [[ "$ready" == true ]] || fail 'Incus did not become ready'

  if incus network show incusbr0 >/dev/null 2>&1; then
    [[ "$(incus network get incusbr0 ipv4.address)" == 10.10.0.1/22 ]] || fail 'existing bridge address conflicts'
  else
    incus network create incusbr0 ipv4.address=10.10.0.1/22 ipv4.nat=true ipv4.dhcp=true ipv6.address=none
  fi
  incus config set core.https_address "$management_ip:$port"

  local certificate fingerprint trusted
  certificate=$(mktemp)
  if ! curl -fsS --connect-timeout 15 --max-time 60 "${INJECT_PANEL_URL%/}/api/hosts/cert/$INJECT_TOKEN" -o "$certificate"; then
    rm -f "$certificate"
    fail 'panel certificate download failed'
  fi
  if ! fingerprint=$(openssl x509 -in "$certificate" -noout -fingerprint -sha256 | sed 's/.*=//' | tr -d ':' | tr '[:upper:]' '[:lower:]'); then
    rm -f "$certificate"
    fail 'invalid panel certificate'
  fi
  [[ "$fingerprint" =~ ^[0-9a-f]{64}$ ]] || { rm -f "$certificate"; fail 'invalid panel fingerprint'; }
  trusted=$(incus config trust list --format json | python3 -c 'import json,sys; print("\n".join(x.get("fingerprint", "").replace(":", "").lower() for x in json.load(sys.stdin)))')
  if ! grep -qxF "$fingerprint" <<< "$trusted"; then
    incus config trust add-certificate "$certificate" --name "incudal-panel-${fingerprint:0:12}"
  fi
  rm -f "$certificate"

  [[ "$INJECT_AGENT_ENABLED" == true && -n "$INJECT_AGENT_INSTALL_TOKEN" ]] || fail 'Agent bootstrap is required'
  local agent_script
  agent_script=$(mktemp)
  if ! curl -fsS --connect-timeout 15 --max-time 60 "${INJECT_PANEL_URL%/}/api/agent/install.sh" -o "$agent_script"; then
    rm -f "$agent_script"
    fail 'Agent installer download failed'
  fi
  local agent_result=0
  INCUDAL_PANEL_URL="$INJECT_PANEL_URL" \
  INCUDAL_AGENT_INSTALL_TOKEN="$INJECT_AGENT_INSTALL_TOKEN" \
  INCUDAL_AGENT_BINARY_URL="$INJECT_AGENT_BINARY_URL" \
  INCUDAL_AGENT_BINARY_SHA256="$INJECT_AGENT_BINARY_SHA256" \
  INCUDAL_HEARTBEAT_INTERVAL_SECONDS=60 \
    bash "$agent_script" || agent_result=$?
  rm -f "$agent_script"
  [[ "$agent_result" -eq 0 ]] || fail 'Agent installation failed'
  echo INCUDAL_ALPINE_INSTALL_DONE
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then install_alpine "$@"; fi
