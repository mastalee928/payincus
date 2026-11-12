# Invoked only after the original SSH identity and empty-host preflight pass.
# Controller-provided time arrives over that authenticated channel, before
# HTTPS package metadata/certificates can be checked on a freshly DD'd host.
set -eu
umask 077
fail() { printf 'INCUDAL_ERROR:%s\n' "$1"; exit 1; }
[ "$(id -u)" = 0 ] || fail ROOT_REQUIRED
. /etc/os-release
case "$ID" in alpine|debian|ubuntu) ;; *) fail OS_UNSUPPORTED ;; esac
case "$(uname -m)" in x86_64|aarch64) ;; *) fail RESOURCE_ARCHITECTURE_MISMATCH ;; esac
now=$(date -u +%s)
delta=$((now - INCUDAL_CONTROL_EPOCH))
if [ "$delta" -gt 120 ] || [ "$delta" -lt -120 ]; then
  date -u -s "$INCUDAL_CONTROL_UTC" >/dev/null || fail HOST_TIME_SYNC_PENDING
fi

# Package managers retain their own locks. Never remove a lock, kill another
# updater, disable signatures/TLS, or switch the installed distribution branch.
packages() {
  case "$ID" in
    alpine)
      branch=$(printf '%s' "$VERSION_ID" | cut -d. -f1,2)
      case "$branch" in *[!0-9.]*|'') return 1 ;; esac
      [ ! -L /etc/apk/repositories ] || return 1
      for component in main community; do
        grep -Eq "/v$branch/$component/?$" /etc/apk/repositories ||
          printf 'https://dl-cdn.alpinelinux.org/alpine/v%s/%s\n' "$branch" "$component" >> /etc/apk/repositories
      done
      timeout 150 apk add --no-cache bash curl ca-certificates python3 iproute2 wireguard-tools util-linux btrfs-progs tzdata chrony kmod apparmor apparmor-utils
      ;;
    debian|ubuntu)
      export DEBIAN_FRONTEND=noninteractive
      # Interrupted dpkg configuration is resumable, but a live package lock
      # is left alone and causes a bounded retry instead of forced recovery.
      if [ -n "$(dpkg --audit 2>/dev/null)" ]; then timeout 120 dpkg --configure -a || return 1; fi
      timeout 120 apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20 update -qq || return 1
      timeout 150 apt-get -o DPkg::Lock::Timeout=60 -o Acquire::Retries=2 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20 \
        install -y bash curl ca-certificates python3 iproute2 wireguard-tools util-linux btrfs-progs tzdata chrony kmod apparmor
      ;;
  esac
}
packages >/dev/null 2>&1 || fail HOST_DEPENDENCIES_PENDING
command -v aa-exec >/dev/null && aa-exec --help >/dev/null 2>&1 || fail HOST_DEPENDENCIES_PENDING
if [ "$ID" != alpine ] && [ "$(cat /sys/module/apparmor/parameters/enabled 2>/dev/null || true)" = Y ]; then
  systemctl enable --now apparmor >/dev/null 2>&1 || fail HOST_DEPENDENCIES_PENDING
fi

# BBR is optional performance, never an onboarding/sales prerequisite. The
# installed Agent owns safe persistence and continual host follow-up.
# Do not overwrite administrator files here or replay installation for BBR.
modprobe tcp_bbr >/dev/null 2>&1 || true
if ! available=$(sysctl -n net.ipv4.tcp_available_congestion_control 2>/dev/null); then
  echo INCUDAL_BBR:pending
elif printf '%s\n' "$available" | tr ' ' '\n' | grep -qx bbr; then
  modprobe sch_fq >/dev/null 2>&1 || true
  if sysctl -w net.core.default_qdisc=fq net.ipv4.tcp_congestion_control=bbr >/dev/null 2>&1 &&
      [ "$(sysctl -n net.ipv4.tcp_congestion_control 2>/dev/null)" = bbr ]; then
    echo INCUDAL_BBR:enabled
  else
    echo INCUDAL_BBR:pending
  fi
else
  echo INCUDAL_BBR:kernel-unavailable
fi
