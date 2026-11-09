#!/bin/sh
# Official same-branch OpenSSH fix. No password, host-key or sshd policy changes.
# Sourced by fresh-install generators; update mode is explicit maintenance only.
alpine_ssh_fail() { printf 'Alpine SSH security: %s\n' "$1" >&2; return 1; }

alpine_ssh_minimum() {
  case "$1" in
    3.19) printf '%s\n' '9.6_p1-r3' ;;
    3.20) printf '%s\n' '9.7_p1-r6' ;;
    3.21) printf '%s\n' '9.9_p2-r1' ;;
    3.22) printf '%s\n' '10.0_p1-r11' ;;
    3.23) printf '%s\n' '10.2_p1-r1' ;;
    3.24) printf '%s\n' '10.3_p1-r2' ;;
    3.25) printf '%s\n' '10.6_p2-r0' ;;
    *) alpine_ssh_fail 'this Alpine branch has no verified password-authentication patch baseline'; return 1 ;;
  esac
}

alpine_ssh_version() {
  # With an argument apk info prints description/URL/size; list installed
  # packages instead so the value is exactly package-version, never prose.
  alpine_ssh_package_info=$(apk info -v 2>/dev/null) || return 1
  printf '%s\n' "$alpine_ssh_package_info" | sed -n "s/^$1-\([0-9][^ ]*\)$/\1/p" | head -n 1
}

alpine_ssh_assert_fixed() {
  alpine_ssh_release=$(cat /etc/alpine-release) || return 1
  alpine_ssh_branch=$(printf '%s' "$alpine_ssh_release" | cut -d. -f1,2)
  # This baseline belongs to the observed edge development release. A future
  # stable 3.25 must not silently use edge repositories during maintenance.
  case "$alpine_ssh_branch:$alpine_ssh_release" in
    3.25:3.25.0_alpha[0-9]*) ;; 3.25:*) return 1 ;; esac
  alpine_ssh_min=$(alpine_ssh_minimum "$alpine_ssh_branch") || return 1
  alpine_ssh_installed=$(alpine_ssh_version openssh-server)
  [ -n "$alpine_ssh_installed" ] || { alpine_ssh_fail 'openssh-server is not installed'; return 1; }
  [ "${alpine_ssh_installed%-r*}" = "${alpine_ssh_min%-r*}" ] || {
    alpine_ssh_fail 'OpenSSH is not from the verified Alpine branch package series'; return 1;
  }
  alpine_ssh_comparison=$(apk version -t "$alpine_ssh_installed" "$alpine_ssh_min") || return 1
  case "$alpine_ssh_comparison" in '='|'>') ;; *)
    alpine_ssh_fail 'the installed OpenSSH package does not contain the required fix'; return 1;
  esac
  for alpine_ssh_package in openssh-server-pam openssh-server-krb5; do
    if apk info -e "$alpine_ssh_package" >/dev/null 2>&1; then
      alpine_ssh_variant=$(alpine_ssh_version "$alpine_ssh_package") || return 1
      [ "${alpine_ssh_variant%-r*}" = "${alpine_ssh_min%-r*}" ] || return 1
      case "$(apk version -t "$alpine_ssh_variant" "$alpine_ssh_min")" in '='|'>') ;; *) return 1 ;; esac
    fi
  done
}

alpine_ssh_preserved_files() {
  # Hashes remain local. Never print password hashes, key material or this manifest.
  find /etc/ssh > "$alpine_ssh_lock/paths" || return 1
  printf '%s\n' /etc/passwd /etc/shadow /etc/group /etc/apk/repositories /etc/conf.d/sshd >> "$alpine_ssh_lock/paths"
  while IFS= read -r alpine_ssh_file; do
    [ -e "$alpine_ssh_file" ] || [ -L "$alpine_ssh_file" ] || continue
    # apk preserves a modified sshd_config and writes the vendor replacement
    # beside it. Only a newly created standard backup is allowed; effective
    # configuration below must remain byte-identical as well.
    if [ "$alpine_ssh_file" = /etc/ssh/sshd_config.apk-new ] && [ "${alpine_ssh_had_apk_new:-true}" = false ]; then continue; fi
    stat -c '%n %a %u %g %F' "$alpine_ssh_file" || return 1
    if [ -L "$alpine_ssh_file" ]; then readlink "$alpine_ssh_file" || return 1; fi
    if [ -f "$alpine_ssh_file" ]; then sha256sum "$alpine_ssh_file" || return 1; fi
  done < "$alpine_ssh_lock/paths"
}

alpine_ssh_listener_binary() {
  alpine_ssh_pid=$(cat /run/sshd.pid) || return 1
  case "$alpine_ssh_pid" in ''|*[!0-9]*) return 1 ;; esac
  alpine_ssh_running=$(readlink "/proc/$alpine_ssh_pid/exe") || return 1
  alpine_ssh_binary=${alpine_ssh_running% (deleted)}
  case "$alpine_ssh_binary" in /usr/sbin/sshd|/usr/sbin/sshd.pam|/usr/sbin/sshd.krb5) ;; *) return 1 ;; esac
  printf '%s\n' "$alpine_ssh_binary"
}

alpine_ssh_listener_current() {
  alpine_ssh_binary=$(alpine_ssh_listener_binary) || return 1
  alpine_ssh_pid=$(cat /run/sshd.pid) || return 1
  alpine_ssh_running_inode=$(stat -Lc '%d:%i' "/proc/$alpine_ssh_pid/exe") || return 1
  alpine_ssh_package_inode=$(stat -Lc '%d:%i' "$alpine_ssh_binary") || return 1
  [ "$alpine_ssh_running_inode" = "$alpine_ssh_package_inode" ]
}

alpine_ssh_standard_service() (
  # Effective-config comparisons below use the standard OpenRC config path.
  # A customized service is kept untouched until its arguments are validated.
  [ ! -f /etc/conf.d/sshd ] || . /etc/conf.d/sshd
  [ "${cfgfile:-${SSHD_CONFIG:-/etc/ssh/sshd_config}}" = /etc/ssh/sshd_config ] &&
    [ "${SSHD_CONFDIR:-/etc/ssh}" = /etc/ssh ] &&
    [ "${SSHD_PIDFILE:-/run/sshd.pid}" = /run/sshd.pid ] &&
    [ -z "${command_args:-${SSHD_OPTS:-}}" ] && [ -z "${SSHD_BINARY:-}" ]
)

alpine_ssh_lock_release() {
  # Only this process's private manifest may be removed. SIGKILL leaves a
  # diagnosable owner; it never permits rm -rf of an unverified shared path.
  [ -f "$alpine_ssh_lock/owner" ] && [ ! -L "$alpine_ssh_lock/owner" ] || return 1
  [ "$(cat "$alpine_ssh_lock/owner")" = "$alpine_ssh_owner" ] || return 1
  for alpine_ssh_name in repositories paths before-unsorted before after-unsorted after effective-before effective-after owner; do
    [ ! -L "$alpine_ssh_lock/$alpine_ssh_name" ] || return 1
    [ ! -e "$alpine_ssh_lock/$alpine_ssh_name" ] || rm -- "$alpine_ssh_lock/$alpine_ssh_name" || return 1
  done
  rmdir -- "$alpine_ssh_lock"
}

alpine_ssh_lock_acquire() {
  # util-linux flock is installed by both platform Alpine initializers. The
  # descriptor remains open in apk/hooks if the updater is killed; it is never
  # released on a guessed timeout. Unknown legacy directories remain blocked.
  command -v flock >/dev/null 2>&1 || { alpine_ssh_fail 'safe process lock is unavailable'; return 1; }
  alpine_ssh_gate=/run/incudal-alpine-ssh-security.flock
  if [ -e "$alpine_ssh_gate" ] || [ -L "$alpine_ssh_gate" ]; then
    [ ! -L "$alpine_ssh_gate" ] && [ -f "$alpine_ssh_gate" ] &&
      [ "$(stat -c '%u:%h:%a' "$alpine_ssh_gate")" = '0:1:600' ] || return 1
  fi
  (umask 077; : >> "$alpine_ssh_gate") || return 1
  exec 9>> "$alpine_ssh_gate"
  # BusyBox timeout leaves an inherited watchdog for up to one second after
  # its command exits. Wait a bounded two seconds for actual descriptor release;
  # never unlock/delete the gate or assume a live updater/descendant has ended.
  flock -w 2 9 || { alpine_ssh_fail 'another SSH security update is active'; return 1; }
  if [ -e "$alpine_ssh_lock" ] || [ -L "$alpine_ssh_lock" ]; then
    [ ! -L "$alpine_ssh_lock" ] && [ -d "$alpine_ssh_lock" ] &&
      [ "$(stat -c '%u:%a' "$alpine_ssh_lock")" = '0:700' ] || return 1
    [ -f "$alpine_ssh_lock/owner" ] && [ ! -L "$alpine_ssh_lock/owner" ] &&
      [ "$(stat -c '%u:%h:%a' "$alpine_ssh_lock/owner")" = '0:1:600' ] || return 1
    IFS=' ' read -r alpine_ssh_version_owner alpine_ssh_old_boot alpine_ssh_old_pid alpine_ssh_old_ticks alpine_ssh_extra < "$alpine_ssh_lock/owner"
    [ "$alpine_ssh_version_owner" = 'v2' ] && [ -z "$alpine_ssh_extra" ] && [ "$alpine_ssh_old_boot" = "$alpine_ssh_boot" ] || return 1
    case "$alpine_ssh_old_pid:$alpine_ssh_old_ticks" in *[!0-9:]*|:*|*:) return 1 ;; esac
    if [ -d "/proc/$alpine_ssh_old_pid" ]; then
      alpine_ssh_current_ticks=$(sed 's/.*) //' "/proc/$alpine_ssh_old_pid/stat" | awk '{print $20}') || return 1
      [ "$alpine_ssh_current_ticks" != "$alpine_ssh_old_ticks" ] || { alpine_ssh_fail 'original update owner is still alive'; return 1; }
    fi
    # Holding the inherited gate proves that neither old owner nor descendants
    # still hold it. Validate every file before deleting any known manifest.
    for alpine_ssh_file in "$alpine_ssh_lock"/* "$alpine_ssh_lock"/.[!.]* "$alpine_ssh_lock"/..?*; do
      [ -e "$alpine_ssh_file" ] || [ -L "$alpine_ssh_file" ] || continue
      case "${alpine_ssh_file##*/}" in repositories|paths|before-unsorted|before|after-unsorted|after|effective-before|effective-after|owner) ;; *) return 1 ;; esac
      [ ! -L "$alpine_ssh_file" ] && [ -f "$alpine_ssh_file" ] && [ "$(stat -c '%u:%h' "$alpine_ssh_file")" = '0:1' ] || return 1
    done
    if [ "$alpine_ssh_mode" = update ]; then
      # An interrupted write can only resume after proving the saved account,
      # key and effective-policy baseline. Never discard it to make a retry pass.
      [ -s "$alpine_ssh_lock/before" ] && [ -s "$alpine_ssh_lock/effective-before" ] || return 1
      alpine_ssh_had_apk_new=true
      grep -q '^/etc/ssh/sshd_config.apk-new ' "$alpine_ssh_lock/before" || alpine_ssh_had_apk_new=false
      alpine_ssh_preserved_files > "$alpine_ssh_lock/after-unsorted" || return 1
      sort "$alpine_ssh_lock/after-unsorted" > "$alpine_ssh_lock/after" || return 1
      alpine_ssh_binary=$(alpine_ssh_listener_binary) || return 1
      "$alpine_ssh_binary" -T > "$alpine_ssh_lock/effective-after" || return 1
      cmp -s "$alpine_ssh_lock/before" "$alpine_ssh_lock/after" &&
        cmp -s "$alpine_ssh_lock/effective-before" "$alpine_ssh_lock/effective-after" || return 1
    fi
    alpine_ssh_new_owner=$alpine_ssh_owner
    alpine_ssh_owner="$(cat "$alpine_ssh_lock/owner")"
    alpine_ssh_lock_release || return 1
    alpine_ssh_owner=$alpine_ssh_new_owner
  fi
  (umask 077; mkdir "$alpine_ssh_lock") || return 1
  (umask 077; printf '%s\n' "$alpine_ssh_owner" > "$alpine_ssh_lock/owner")
}

alpine_ssh_security_update() (
  set -eu
  alpine_ssh_mode=${1:-install}
  case "$alpine_ssh_mode" in install|update) ;; *) alpine_ssh_fail 'invalid maintenance mode'; exit 1 ;; esac
  [ "$(id -u)" = 0 ] || { alpine_ssh_fail 'root is required'; exit 1; }
  alpine_ssh_release=$(cat /etc/alpine-release)
  alpine_ssh_branch=$(printf '%s' "$alpine_ssh_release" | cut -d. -f1,2)
  case "$alpine_ssh_branch:$alpine_ssh_release" in
    3.25:3.25.0_alpha[0-9]*) ;; 3.25:*) alpine_ssh_fail 'stable 3.25 requires its own signed branch baseline'; exit 1 ;; esac
  alpine_ssh_min=$(alpine_ssh_minimum "$alpine_ssh_branch") || exit 1
  # Signed packages and indexes from this branch only; never change repositories.
  alpine_ssh_lock=/run/incudal-alpine-ssh-security.lock
  # Read with a builtin: /proc/self identifies this updater subshell, whereas
  # POSIX $$ would still identify its parent.
  IFS=' ' read -r alpine_ssh_pid alpine_ssh_stat_tail < /proc/self/stat
  alpine_ssh_ticks=$(sed 's/.*) //' "/proc/$alpine_ssh_pid/stat" | awk '{print $20}')
  alpine_ssh_boot=$(cat /proc/sys/kernel/random/boot_id)
  case "$alpine_ssh_pid:$alpine_ssh_ticks" in *[!0-9:]*|:*) alpine_ssh_fail 'cannot prove update process identity'; exit 1 ;; esac
  alpine_ssh_owner="v2 $alpine_ssh_boot $alpine_ssh_pid $alpine_ssh_ticks"
  alpine_ssh_lock_acquire || { alpine_ssh_fail 'update lock ownership could not be verified'; exit 1; }
  trap 'alpine_ssh_lock_release' EXIT
  trap 'exit 1' HUP INT TERM
  if [ "$alpine_ssh_branch" = 3.25 ]; then
    printf '%s\n' 'https://dl-cdn.alpinelinux.org/alpine/edge/main' > "$alpine_ssh_lock/repositories"
  else
    printf 'https://dl-cdn.alpinelinux.org/alpine/v%s/main\n' "$alpine_ssh_branch" > "$alpine_ssh_lock/repositories"
  fi
  if [ "$alpine_ssh_mode" = update ]; then
    alpine_ssh_standard_service || { alpine_ssh_fail 'custom SSH service arguments require separate validation'; exit 1; }
    alpine_ssh_old=$(alpine_ssh_version openssh-server)
    [ -n "$alpine_ssh_old" ] || { alpine_ssh_fail 'existing SSH server is missing'; exit 1; }
    # Revision-only backports avoid the historical cross-version restart hooks.
    [ "${alpine_ssh_old%-r*}" = "${alpine_ssh_min%-r*}" ] || {
      alpine_ssh_fail 'cross-version SSH upgrade requires separate connection-preservation validation'; exit 1;
    }
    case "$alpine_ssh_branch" in
      3.22|3.23|3.24|3.25)
        [ "$(apk version -t "$alpine_ssh_old" '10.0_p1-r2')" != '<' ] || {
          alpine_ssh_fail 'this old revision has an automatic restart hook and requires separate validation'; exit 1;
        } ;;
    esac
    rc-service sshd status >/dev/null 2>&1 || { alpine_ssh_fail 'existing SSH listener is not running'; exit 1; }
    alpine_ssh_binary=$(alpine_ssh_listener_binary) || { alpine_ssh_fail 'SSH listener uses an unsupported binary or PID path'; exit 1; }
    timeout 5 env sshd_disable_keygen=yes rc-service sshd checkconfig >/dev/null 2>&1 || { alpine_ssh_fail 'existing SSH configuration is invalid'; exit 1; }
    "$alpine_ssh_binary" -T > "$alpine_ssh_lock/effective-before" || exit 1
    alpine_ssh_had_apk_new=false
    if [ -e /etc/ssh/sshd_config.apk-new ] || [ -L /etc/ssh/sshd_config.apk-new ]; then alpine_ssh_had_apk_new=true; fi
    alpine_ssh_preserved_files > "$alpine_ssh_lock/before-unsorted" || exit 1
    sort "$alpine_ssh_lock/before-unsorted" > "$alpine_ssh_lock/before"
  fi
  alpine_ssh_updated=false
  if ! alpine_ssh_assert_fixed >/dev/null 2>&1; then
    timeout 20 apk --repositories-file "$alpine_ssh_lock/repositories" update || { alpine_ssh_fail 'signed package index refresh failed'; exit 1; }
    alpine_ssh_base=${alpine_ssh_min%-r*}
    set -- "openssh-server~$alpine_ssh_base" "openssh-server-common~$alpine_ssh_base" "openssh-keygen~$alpine_ssh_base"
    # Preserve installed variants, SFTP and clients; exact revision dependencies
    # must not hold server-common/keygen at the vulnerable revision.
    for alpine_ssh_package in openssh openssh-server-pam openssh-server-krb5 openssh-sftp-server openssh-client-common openssh-client-default openssh-client-krb5 openssh-keysign openssh-sk-helper; do
      if apk info -e "$alpine_ssh_package" >/dev/null 2>&1; then set -- "$@" "$alpine_ssh_package~$alpine_ssh_base"; fi
    done
    timeout 60 apk --repositories-file "$alpine_ssh_lock/repositories" add --no-cache --upgrade "$@" || { alpine_ssh_fail 'same-branch signed OpenSSH update failed'; exit 1; }
    alpine_ssh_updated=true
  fi
  alpine_ssh_assert_fixed || exit 1
  if [ "$alpine_ssh_mode" = update ]; then
    if ! alpine_ssh_listener_current; then
      timeout 5 env sshd_disable_keygen=yes rc-service sshd reload || { alpine_ssh_fail 'SSH listener reload failed; maintenance remains incomplete'; exit 1; }
      alpine_ssh_attempt=0
      until alpine_ssh_listener_current; do
        alpine_ssh_attempt=$((alpine_ssh_attempt + 1))
        [ "$alpine_ssh_attempt" -lt 30 ] || { alpine_ssh_fail 'listener has not loaded the patched binary'; exit 1; }
        sleep 0.1
      done
    fi
    alpine_ssh_preserved_files > "$alpine_ssh_lock/after-unsorted" || exit 1
    sort "$alpine_ssh_lock/after-unsorted" > "$alpine_ssh_lock/after"
    alpine_ssh_binary=$(alpine_ssh_listener_binary) || exit 1
    "$alpine_ssh_binary" -T > "$alpine_ssh_lock/effective-after" || exit 1
    cmp -s "$alpine_ssh_lock/effective-before" "$alpine_ssh_lock/effective-after" || {
      alpine_ssh_fail 'effective SSH configuration changed during the package update'; exit 1;
    }
    cmp -s "$alpine_ssh_lock/before" "$alpine_ssh_lock/after" || {
      # Only paths/mode changes are diagnostic; local account/key digests never
      # leave the guest, including when an official package creates apk-new.
      diff -u "$alpine_ssh_lock/before" "$alpine_ssh_lock/after" | sed -E 's/[a-f0-9]{64}/[local digest]/g' >&2
      alpine_ssh_fail 'SSH identity, account or configuration changed during the package update'; exit 1;
    }
    rc-service sshd status >/dev/null 2>&1 || { alpine_ssh_fail 'SSH listener is unavailable after reload'; exit 1; }
  fi
  if [ "$alpine_ssh_updated" = true ]; then printf '%s\n' 'INCUDAL_ALPINE_SSH_PATCH_INSTALLED'
  else printf '%s\n' 'INCUDAL_ALPINE_SSH_ALREADY_FIXED'; fi
)
