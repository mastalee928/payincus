#!/usr/bin/env bash
set -Eeuo pipefail

# Execute the complete, unchanged installer. Network, root identity and service
# manager boundaries are local fixtures; file creation, checksums and staging run
# for real in a fresh directory. This does not certify a Linux service install.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_ROOT="$(cd "$1" && pwd)"
export TEST_ROOT
cat > "$TEST_ROOT/boundaries.sh" <<'BOUNDARIES'
uname() {
  case "${1:-}" in -s) echo Linux ;; -m) echo "${TEST_ARCH:-x86_64}" ;; *) command uname "$@" ;; esac
}
id() { if [[ "${1:-}" == -u ]]; then echo 0; else command id "$@"; fi; }
# Only pretend the init manager is available. All installation target directory
# checks, including a parent that is a file, retain the real shell behavior.
[() {
  if [[ "$#" == 3 && "$1" == -d && "$3" == ']' && ( "$2" == /run/systemd/system || "$2" == /run/openrc ) ]]; then
    return 0
  fi
  builtin [ "$@"
}
systemctl() { printf '%s\n' "service $*" >> "$TEST_CASE/events"; return 0; }
rc-service() { printf '%s\n' "service $*" >> "$TEST_CASE/events"; return 0; }
rc-update() { printf '%s\n' "service $*" >> "$TEST_CASE/events"; return 0; }
nft() { return 0; }
apt-get() { echo 'Unexpected package installation' >&2; return 90; }
apk() { echo 'Unexpected package installation' >&2; return 90; }
# The fixture must not chown host files. Preserve all real install operations and
# permissions, but strip the root ownership request in this unprivileged test.
install() {
  local -a args=()
  while (( $# )); do
    case "$1" in -o|-g) shift 2 ;; *) args+=("$1"); shift ;; esac
  done
  local target="${args[${#args[@]}-1]}"
  [[ "$target" == "$TEST_CASE/"* ]] || { echo 'Unsafe install target' >&2; return 91; }
  command install "${args[@]}"
}
curl() {
  local url='' target=''
  while (( $# )); do
    case "$1" in -o) target="$2"; shift 2 ;; -*) shift ;; *) url="$1"; shift ;; esac
  done
  [[ "$target" == "$TEST_CASE/"* ]] || { echo 'Unsafe download target' >&2; return 92; }
  case "$url" in
    https://agent-installer.invalid/api/agent/manifest.json*)
      printf '%s\n' manifest >> "$TEST_CASE/events"
      [[ -d "$(dirname "$target")" ]] || { echo 'Manifest parent missing' >&2; return 93; }
      command cp "$TEST_CASE/manifest.json" "$target" ;;
    https://agent-installer.invalid/api/agent/binary/incudal-agent-linux-*)
      printf '%s\n' binary >> "$TEST_CASE/events"
      [[ "${TEST_FAILURE:-}" != download ]] || return 22
      command cp "$TEST_CASE/candidate" "$target" ;;
    https://agent-installer.invalid/api/agent/install-config/ait_fixture_only_*)
      printf '%s\n' token >> "$TEST_CASE/events"
      command cp "$TEST_CASE/install-config" "$target" ;;
    *) echo 'Unexpected network request rejected' >&2; return 94 ;;
  esac
}
BOUNDARIES

new_case() {
  export TEST_CASE="$TEST_ROOT/$1"
  mkdir -p "$TEST_CASE/tmp"
  : > "$TEST_CASE/events"
  export TMPDIR="$TEST_CASE/tmp"
  export INCUDAL_INSTALL_DIR="$TEST_CASE/custom/bin"
  export INCUDAL_AGENT_BIN="$INCUDAL_INSTALL_DIR/incudal-agent"
  export INCUDAL_CONFIG_FILE="$TEST_CASE/custom/config/config.yaml"
  export INCUDAL_SERVICE_FILE="$TEST_CASE/custom/service/agent.service"
  export INCUDAL_PANEL_URL='https://agent-installer.invalid'
  export INCUDAL_AGENT_INSTALL_TOKEN='ait_fixture_only_not_a_real_credential'
  export INCUDAL_INIT_SYSTEM=systemd
  export BASH_ENV="$TEST_ROOT/boundaries.sh"
  export TEST_ARCH=x86_64 TEST_FAILURE='' INCUDAL_AGENT_DRY_RUN=0
  unset INCUDAL_AGENT_ID INCUDAL_AGENT_SECRET INCUDAL_AGENT_BINARY_URL INCUDAL_AGENT_BINARY_SHA256
  cat > "$TEST_CASE/candidate" <<'CANDIDATE'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' smoke >> "$TEST_CASE/events"
[[ "$#" == 3 && "$1" == -config && "$3" == -once ]]
[[ -s "$2" ]]
[[ "${TEST_FAILURE:-}" != smoke ]]
CANDIDATE
  cat > "$TEST_CASE/install-config" <<'CONFIG'
INCUDAL_AGENT_ID='agt_fixture_only'
INCUDAL_AGENT_SECRET='ias_fixture_only_not_a_real_credential'
CONFIG
  local digest
  digest="$(sha256sum "$TEST_CASE/candidate" | awk '{print $1}')"
  printf '{"files":{"linux-amd64":{"name":"incudal-agent-linux-amd64","sha256":"%s"},"linux-arm64":{"name":"incudal-agent-linux-arm64","sha256":"%s"}}}\n' "$digest" "$digest" > "$TEST_CASE/manifest.json"
}

run_installer() {
  bash "$REPO_ROOT/server/templates/agent-install.sh" > "$TEST_CASE/output" 2>&1
}

assert_no_staging() {
  if find "$TEST_CASE/custom" -type f \( -name '*.download*' -o -name '*.tmp' -o -name '*.new*' -o -name '*.manifest.*' \) | read -r _; then
    echo 'Installer left staging files' >&2; exit 1
  fi
}

for arch in x86_64 aarch64; do
  new_case "new-parent-$arch"
  export TEST_ARCH="$arch"
  [[ ! -e "$TEST_CASE/custom" ]]
  if ! run_installer; then cat "$TEST_CASE/output"; exit 1; fi
  cmp "$TEST_CASE/candidate" "$INCUDAL_AGENT_BIN"
  grep -Fq 'agent_id: "agt_fixture_only"' "$INCUDAL_CONFIG_FILE"
  [[ -s "$INCUDAL_SERVICE_FILE" ]]
  [[ "$(head -n 4 "$TEST_CASE/events" | tr '\n' ' ')" == 'manifest binary token smoke ' ]]
  assert_no_staging
  printf 'PASS R088 new custom parent, manifest, real hash/staging and installed files (%s fixture)\n' "$arch"
done

for failure in parent download checksum smoke; do
  new_case "old-install-$failure"
  mkdir -p "$(dirname "$INCUDAL_AGENT_BIN")" "$(dirname "$INCUDAL_CONFIG_FILE")" "$(dirname "$INCUDAL_SERVICE_FILE")"
  printf 'old-binary\n' > "$INCUDAL_AGENT_BIN"
  printf 'old-config\n' > "$INCUDAL_CONFIG_FILE"
  printf 'old-service\n' > "$INCUDAL_SERVICE_FILE"
  cp "$INCUDAL_AGENT_BIN" "$TEST_CASE/old-bin"
  cp "$INCUDAL_CONFIG_FILE" "$TEST_CASE/old-config"
  cp "$INCUDAL_SERVICE_FILE" "$TEST_CASE/old-service"
  export TEST_FAILURE="$failure"
  if [[ "$failure" == parent ]]; then
    # BIN is existing and valid, but the new service parent is a regular file.
    printf 'blocked parent\n' > "$TEST_CASE/blocked"
    export INCUDAL_SERVICE_FILE="$TEST_CASE/blocked/service"
  elif [[ "$failure" == checksum ]]; then
    printf 'corrupt-download\n' >> "$TEST_CASE/candidate"
  fi
  if run_installer; then echo "Expected $failure failure" >&2; exit 1; fi
  cmp "$TEST_CASE/old-bin" "$INCUDAL_AGENT_BIN"
  cmp "$TEST_CASE/old-config" "$INCUDAL_CONFIG_FILE"
  cmp "$TEST_CASE/old-service" "$TEST_CASE/custom/service/agent.service"
  if grep -q '^service ' "$TEST_CASE/events"; then echo 'Old service changed before smoke success' >&2; exit 1; fi
  if [[ "$failure" != smoke ]] && grep -q '^token$' "$TEST_CASE/events"; then echo 'Token consumed before preflight/download succeeded' >&2; exit 1; fi
  case "$failure" in
    parent) [[ ! -s "$TEST_CASE/events" ]] ;;
    download) grep -q '^binary$' "$TEST_CASE/events" ;;
    checksum) grep -Fq 'sha256 mismatch' "$TEST_CASE/output" ;;
    smoke) grep -Fq 'staged Agent smoke test failed' "$TEST_CASE/output" ;;
  esac
  assert_no_staging
  printf 'PASS R089 %s failure preserves old binary/config/service, no service mutation\n' "$failure"
done

for manager in systemd openrc; do
  for identity in token static; do
    new_case "dry-$manager-$identity"
    export INCUDAL_INIT_SYSTEM="$manager" INCUDAL_AGENT_DRY_RUN=1
    if [[ "$identity" == static ]]; then
      unset INCUDAL_AGENT_INSTALL_TOKEN
      export INCUDAL_AGENT_ID='agt_fixture_only'
      export INCUDAL_AGENT_SECRET='ias_fixture_only_not_a_real_credential'
    fi
    if ! run_installer; then cat "$TEST_CASE/output"; exit 1; fi
    if grep -Eq 'ait_fixture_only_not_a_real_credential|ias_fixture_only_not_a_real_credential|ias_from_install_token' "$TEST_CASE/output"; then
      echo 'Dry run disclosed fixture credentials' >&2; exit 1
    fi
    grep -Fq '<redacted>' "$TEST_CASE/output"
    if [[ "$identity" == token ]]; then grep -Fq '<redacted-install-token>' "$TEST_CASE/output"; fi
    [[ ! -e "$TEST_CASE/custom" && ! -s "$TEST_CASE/events" ]]
    printf 'PASS R090 dry-run %s/%s redaction, zero downloads/service calls/installed files\n' "$manager" "$identity"
  done
done
printf 'PASS unchanged installer: 10 isolated cases; service manager, root and network are fixtures\n'
