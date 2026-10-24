#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=install-panel.sh
source "$REPO_ROOT/scripts/install-panel.sh"

WORK_DIR="$(mktemp -d)"
HTTP_FIXTURE_PID=""
trap '[[ -z "$HTTP_FIXTURE_PID" ]] || kill "$HTTP_FIXTURE_PID" 2>/dev/null || true; rm -rf "$WORK_DIR"' EXIT

# A fresh file used to discard the supplied token even though upgrades populated
# empty values. Exercise both paths without real credentials or system ownership.
declare -f generate_env ensure_env_keys get_env_value set_env_if_missing set_env_value set_env_if_value gen_secret gen_password > "$WORK_DIR/env-functions.sh"
# Installer paths are intentionally readonly. Run the unchanged functions in a
# separate shell so test paths cannot weaken those production constants.
bash -s -- "$WORK_DIR" "$WORK_DIR/env-functions.sh" <<'ENV_GUARD'
    set -euo pipefail
    token_work="$1"
    source "$2"
    DEFAULT_PORT=3001
    INSTALL_DIR=/opt/incudal
    GITHUB_REPO=mastalee928/payincus
    RUN_USER=incudal
    log() { printf '%s\n' "$*"; }
    info() { printf '%s\n' "$*"; }
    step() { printf '%s\n' "$*"; }
    ENV_FILE="$token_work/fresh-agent-token.env"
    INCUDAL_AGENT_RELEASE_TOKEN=guard_agent_token_not_a_credential
    chown() { :; }
    generate_env guard_db guard_redis guard_admin installer@example.invalid > "$token_work/agent-token-output" 2>&1
    [[ "$(get_env_value INCUDAL_AGENT_RELEASE_TOKEN)" == "$INCUDAL_AGENT_RELEASE_TOKEN" ]]
    [[ "$(grep -c '^INCUDAL_AGENT_RELEASE_TOKEN=' "$ENV_FILE")" == 1 ]]
    chmod_mode=$(stat -c %a "$ENV_FILE")
    # Windows file modes are not Linux deployment evidence.
    [[ "$(uname -s)" != Linux || "$chmod_mode" == 640 ]]
    if grep -Fq "$INCUDAL_AGENT_RELEASE_TOKEN" "$token_work/agent-token-output"; then
        echo 'installer exposed the supplied Agent token' >&2; exit 1
    fi
    INCUDAL_AGENT_RELEASE_TOKEN=guard_different_agent_token
    generate_env guard_db guard_redis guard_admin installer@example.invalid >> "$token_work/agent-token-output" 2>&1
    [[ "$(get_env_value INCUDAL_AGENT_RELEASE_TOKEN)" == guard_agent_token_not_a_credential ]]
    sed -i 's/^INCUDAL_AGENT_RELEASE_TOKEN=.*/INCUDAL_AGENT_RELEASE_TOKEN=/' "$ENV_FILE"
    ensure_env_keys >> "$token_work/agent-token-output" 2>&1
    [[ "$(get_env_value INCUDAL_AGENT_RELEASE_TOKEN)" == "$INCUDAL_AGENT_RELEASE_TOKEN" ]]
    if grep -Fq "$INCUDAL_AGENT_RELEASE_TOKEN" "$token_work/agent-token-output"; then
        echo 'installer exposed the supplied Agent token' >&2; exit 1
    fi
    ENV_FILE="$token_work/no-agent-token.env"
    unset INCUDAL_AGENT_RELEASE_TOKEN
    chown() { :; }
    generate_env guard_db guard_redis guard_admin installer@example.invalid > /dev/null 2>&1
    [[ -z "$(get_env_value INCUDAL_AGENT_RELEASE_TOKEN)" ]]
ENV_GUARD

mkdir -p "$WORK_DIR/payload"
printf 'payincus installer guard\n' > "$WORK_DIR/payload/version.txt"

SAFE_ARCHIVE="$WORK_DIR/incudal-v0.0.0-linux-amd64.tar.gz"
tar -czf "$SAFE_ARCHIVE" -C "$WORK_DIR/payload" .
sha256sum "$SAFE_ARCHIVE" > "${SAFE_ARCHIVE}.sha256"

verify_release_checksum "$SAFE_ARCHIVE"
validate_release_archive "$SAFE_ARCHIVE"

printf '%064d  %s\n' 0 "$(basename "$SAFE_ARCHIVE")" > "${SAFE_ARCHIVE}.sha256"
if verify_release_checksum "$SAFE_ARCHIVE"; then
    echo "checksum guard accepted a mismatched archive" >&2
    exit 1
fi

UNSAFE_ARCHIVE="$WORK_DIR/unsafe.tar.gz"
tar -czf "$UNSAFE_ARCHIVE" --transform='s#^#../#' -C "$WORK_DIR/payload" .
if validate_release_archive "$UNSAFE_ARCHIVE"; then
    echo "archive guard accepted a parent traversal path" >&2
    exit 1
fi

grep -Fq -- '-f "${INSTALL_DIR}/current/server/dist/app.js"' "$REPO_ROOT/scripts/install-panel.sh"
grep -Fq '检测到原子 OTA 布局' "$REPO_ROOT/scripts/install-panel.sh"
grep -Fq 'ExecStart=/usr/local/libexec/incudal/incudal-online-task update %i' "$REPO_ROOT/scripts/install-panel.sh"
grep -Fq 'ExecStart=/usr/local/libexec/incudal/incudal-online-task rollback %i' "$REPO_ROOT/scripts/install-panel.sh"
grep -Fq 'chown "root:${RUN_USER}" "$ENV_FILE"' "$REPO_ROOT/scripts/install-panel.sh"
grep -Fq 'Defaults:${RUN_USER} secure_path=/usr/local/libexec/incudal:' "$REPO_ROOT/scripts/install-panel.sh"
grep -Fq 'if [[ -x /usr/bin/node ]]; then' "$REPO_ROOT/scripts/install-panel.sh"
grep -Fq 'current_ver=$(/usr/bin/node -v' "$REPO_ROOT/scripts/install-panel.sh"
grep -Fq -- '--configure-gateway-controller)' "$REPO_ROOT/scripts/install-panel.sh"
grep -Fq -- '"$action" == --initialize' "$REPO_ROOT/scripts/install-gateway-controller.sh"
grep -Fq '/usr/bin/python3 -I -B "$tool" "$action"' "$REPO_ROOT/scripts/install-gateway-controller.sh"
grep -Fq '"$INSTALL_DIR/scripts/install-gateway-controller.sh" --initialize-release' "$REPO_ROOT/scripts/install-panel.sh"
grep -Fq 'chmod go-w /opt' "$REPO_ROOT/scripts/smoke-fresh-install.sh"
grep -Fq 'provision_action=--refresh' "$REPO_ROOT/scripts/install-gateway-controller.sh"
bash -n "$REPO_ROOT/scripts/install-gateway-controller.sh"
grep -Fq 'NOPASSWD: /usr/local/libexec/incudal/systemctl' "$REPO_ROOT/scripts/install-gateway-controller.sh"
if grep -Fq 'NOPASSWD: /usr/local/libexec/incudal/systemctl start' "$REPO_ROOT/scripts/install-gateway-controller.sh"; then
    echo 'gateway sudo rule must use the argument-validating wrapper, without parser-dependent wildcard arguments' >&2
    exit 1
fi
for sudo_source in install-panel.sh install-platform-backup.sh migrate-ota-atomic-layout.sh; do
    grep -Fq 'NOPASSWD: /usr/local/libexec/incudal/systemctl' "$REPO_ROOT/scripts/$sudo_source"
    if grep -Fq 'NOPASSWD: /usr/local/libexec/incudal/systemctl start' "$REPO_ROOT/scripts/$sudo_source"; then
        echo 'managed worker sudo rules must avoid parser-dependent wildcard arguments' >&2
        exit 1
    fi
    if grep -Fq 'requiretty' "$REPO_ROOT/scripts/$sudo_source"; then
        echo 'managed worker sudo rules must not require parser-specific requiretty settings' >&2
        exit 1
    fi
done
grep -Fq 'cmp -s "$wrapper" "$root/deploy/incudal-systemctl-wrapper.sh.example"' "$REPO_ROOT/scripts/install-gateway-controller.sh"
for rejected in \
    'start --no-block ssh.service' \
    'restart --no-block incudal-gateway-task@11111111-1111-4111-8111-111111111111.service' \
    'start --no-block incudal-gateway-task@*.service' \
    'start --no-block incudal-gateway-task@11111111-1111-4111-8111-111111111111.service extra'; do
    read -r -a rejected_args <<< "$rejected"
    if bash "$REPO_ROOT/deploy/incudal-systemctl-wrapper.sh.example" "${rejected_args[@]}" >/dev/null 2>&1; then
        echo 'systemctl wrapper accepted an unsupported gateway invocation' >&2
        exit 1
    fi
done

for helper in \
    incudal-online-task.sh.example \
    incudal-systemctl-wrapper.sh.example \
    incudal-ota-chown-wrapper.sh.example; do
    bash -n "$REPO_ROOT/deploy/$helper"
done

# A restrictive caller umask must not prevent APT from reading its public key.
postgresql_function=$(declare -f install_postgresql)
postgresql_function=${postgresql_function//\/etc\/apt\/keyrings\/postgresql.gpg/$WORK_DIR\/postgresql-public.gpg}
postgresql_function=${postgresql_function//\/etc\/apt\/sources.list.d\/pgdg.list/$WORK_DIR\/pgdg.list}
printf '%s\n' "$postgresql_function" > "$WORK_DIR/postgresql-functions.sh"
bash -s -- "$WORK_DIR" <<'PG_KEY_GUARD'
    set -euo pipefail
    key_work="$1"
    source "$key_work/postgresql-functions.sh"
    PG_VERSION=16
    OS_CODENAME=guard
    umask 077
    psql() { printf 'psql (PostgreSQL) 0.1\n'; }
    step() { :; }
    info() { :; }
    log() { :; }
    curl() { printf 'public-key-fixture\n'; }
    gpg() { cat > "${@: -1}"; }
    apt-get() {
        if [[ "$1" == update && "$(uname -s)" == Linux ]]; then
            [[ "$(stat -c %a "$key_work/postgresql-public.gpg")" == 644 ]] || {
                echo 'strict umask left the public PostgreSQL signing key unreadable by APT' >&2
                return 1
            }
        fi
    }
    ensure_postgresql_running() { :; }
    install_postgresql
PG_KEY_GUARD

# Preinstalled PostgreSQL can be stopped (for example, on a fresh CI image).
# Skipping the package install must still start it before database creation.
(
    psql() { printf 'psql (PostgreSQL) 16.4\n'; }
    systemctl() { printf '%s\n' "$*" >> "$WORK_DIR/postgresql-service-calls"; }
    pg_isready() { grep -Fxq 'start postgresql' "$WORK_DIR/postgresql-service-calls"; }
    install_postgresql
    grep -Fxq 'enable postgresql' "$WORK_DIR/postgresql-service-calls"
    grep -Fxq 'start postgresql' "$WORK_DIR/postgresql-service-calls"
)

if grep -Fq 'ExecStart=/usr/bin/node /opt/incudal/current/server/dist/scripts/' \
    "$REPO_ROOT/deploy/incudal-online-update@.service.example" \
    "$REPO_ROOT/deploy/incudal-online-rollback@.service.example"; then
    echo "root unit still executes a worker from current directly" >&2
    exit 1
fi

# Windows Git Bash can provide Python as python.exe rather than python3.
PYTHON_BIN="$(command -v python3 || command -v python)"
if ! command -v python3 >/dev/null && command -v python >/dev/null; then
    python3() { python "$@"; }
fi

for domain in panel.example.com admin.example.com PANEL.example.com xn--fiqs8s.example.com; do
    is_valid_cf_domain "$domain" || { echo "valid CF domain rejected" >&2; exit 1; }
done
for domain in '' localhost 127.0.0.1 https://panel.example.com panel.example.com/ \
    panel.example.com:80 'panel.example.com injected' '-panel.example.com' \
    'panel-.example.com' 'panel..example.com' '.panel.example.com' 'panel.example.com.'; do
    if is_valid_cf_domain "$domain"; then
        echo "invalid CF domain accepted" >&2
        exit 1
    fi
done
[[ "$(printf 'https://panel.example.com\nPANEL.example.com\n' | prompt_cf_domain 客户 panel.example.com 2>/dev/null)" == panel.example.com ]]
show_cf_tunnel_guide > "$WORK_DIR/cf-guide" 2>&1
grep -Fq '内网 Service URL' "$WORK_DIR/cf-guide"
grep -Fq 'http://127.0.0.1:80' "$WORK_DIR/cf-guide"
(
    DOMAIN=customer.sub.example.com
    ADMIN_DOMAIN=control.sub.example.com
    show_cf_route_summary > "$WORK_DIR/cf-routes" 2>&1
    grep -Eq 'customer\.sub\.example\.com +http://127\.0\.0\.1:80' "$WORK_DIR/cf-routes"
    grep -Eq 'control\.sub\.example\.com +http://127\.0\.0\.1:80' "$WORK_DIR/cf-routes"
)

# Invalid tokens and CLI output must not leak, and a failed install must stay failed.
(
    cloudflared() { printf 'Provided Tunnel token is not valid: %s\n' "$3"; return 1; }
    if install_cf_service <<< 'installer-guard-placeholder' > "$WORK_DIR/cf-token-output" 2>&1; then
        echo "failed cloudflared install accepted" >&2
        exit 1
    fi
    ! grep -Fq 'installer-guard-placeholder' "$WORK_DIR/cf-token-output"
    grep -Fq 'Token 无效' "$WORK_DIR/cf-token-output"
    cloudflared() { printf 'unsafe successful output: %s\n' "$3"; }
    install_cf_service <<< 'installer-guard-placeholder' > "$WORK_DIR/cf-token-output" 2>&1
    ! grep -Fq 'installer-guard-placeholder' "$WORK_DIR/cf-token-output"
    cloudflared() { echo 'unexpected invocation' >> "$WORK_DIR/cf-invalid-token-call"; }
    if install_cf_service <<< 'cloudflared service install placeholder' >/dev/null 2>&1; then exit 1; fi
    [[ ! -e "$WORK_DIR/cf-invalid-token-call" ]]
)

mkdir -p "$WORK_DIR/cf-user" "$WORK_DIR/cf-admin"
printf '<html>customer frontend</html>\n' > "$WORK_DIR/cf-user/index.html"
printf '<html>admin frontend</html>\n' > "$WORK_DIR/cf-admin/index.html"

# systemctl may return 1 for not-found. Local unit files can still exist on a
# live test host; neither situation is an inability to query systemd (status 2).
(
    systemctl() { printf 'not-found\n'; return 1; }
    status=0
    cf_service_exists || status=$?
    [[ "$status" -ne 2 ]]
    systemctl() { return 1; }
    status=0
    cf_service_exists || status=$?
    [[ "$status" -eq 2 ]]
)

# Exercise setup without touching /etc, starting services or contacting Cloudflare.
(
    # Ignore a real host's existing unit files when exercising installation.
    cf_service_exists() { [[ "${CF_GUARD_LOAD:-not-found}" != not-found ]]; }
    resolve_static_dist_dir() {
        if [[ "$1" == client/dist/user ]]; then printf '%s' "$WORK_DIR/cf-user";
        else printf '%s' "$WORK_DIR/cf-admin"; fi
    }
    check_cf_prerequisites() { return 0; }
    configure_cf_nginx() { echo nginx >> "$WORK_DIR/cf-actions"; }
    set_env_value() { printf 'env:%s\n' "$1" >> "$WORK_DIR/cf-actions"; }
    systemctl() {
        printf '%s\n' "$*" >> "$WORK_DIR/cf-service-calls"
        case "$1" in
            show) printf '%s\n' "${CF_GUARD_LOAD:-not-found}" ;;
            is-active) [[ "${CF_GUARD_ACTIVE:-yes}" == yes ]] ;;
            enable|start) [[ "${CF_GUARD_START:-yes}" == yes ]] ;;
        esac
    }
    cloudflared() { [[ "${CF_GUARD_INSTALL:-yes}" == yes ]]; }
    CF_GUARD_INSTALL=no
    if setup_cf_tunnel <<< $'panel.example.com\nadmin.example.com\ninstaller-guard-placeholder' >/dev/null 2>&1; then exit 1; fi
    [[ ! -e "$WORK_DIR/cf-actions" && "$CF_TUNNEL_SELECTED" == false ]]
    CF_GUARD_INSTALL=yes
    CF_GUARD_START=no
    if setup_cf_tunnel <<< $'panel.example.com\nadmin.example.com\ninstaller-guard-placeholder' >/dev/null 2>&1; then exit 1; fi
    [[ ! -e "$WORK_DIR/cf-actions" ]]
    CF_GUARD_START=yes
    setup_cf_tunnel <<< $'panel.example.com\nadmin.example.com\ninstaller-guard-placeholder' >/dev/null 2>&1
    [[ "$CF_TUNNEL_SELECTED" == true && "$CF_TUNNEL_VERIFIED" == false ]]
    grep -Fxq nginx "$WORK_DIR/cf-actions"
    [[ "$(grep -c '^env:' "$WORK_DIR/cf-actions")" -eq 6 ]]

    : > "$WORK_DIR/cf-actions"
    configure_cf_nginx() { return 1; }
    CF_TUNNEL_SELECTED=false
    if setup_cf_tunnel <<< $'panel.example.com\nadmin.example.com\ninstaller-guard-placeholder' >/dev/null 2>&1; then exit 1; fi
    [[ ! -s "$WORK_DIR/cf-actions" && "$CF_TUNNEL_SELECTED" == false ]]
    configure_cf_nginx() { echo nginx >> "$WORK_DIR/cf-actions"; }

    # Existing tunnels require explicit reuse and must never be installed/restarted.
    : > "$WORK_DIR/cf-actions"
    : > "$WORK_DIR/cf-service-calls"
    CF_GUARD_LOAD=loaded
    CF_TUNNEL_SELECTED=false
    if setup_cf_tunnel <<< '' >/dev/null 2>&1; then exit 1; fi
    [[ ! -s "$WORK_DIR/cf-actions" && "$CF_TUNNEL_SELECTED" == false ]]
    cloudflared() { echo 'overwrote existing tunnel' >> "$WORK_DIR/cf-actions"; return 1; }
    CF_GUARD_ACTIVE=no
    if setup_cf_tunnel <<< $'reuse\npanel.example.com\nadmin.example.com' >/dev/null 2>&1; then exit 1; fi
    [[ ! -s "$WORK_DIR/cf-actions" ]]
    CF_GUARD_ACTIVE=yes
    setup_cf_tunnel <<< $'reuse\npanel.example.com\nadmin.example.com' >/dev/null 2>&1
    ! grep -Eq '^(enable|start|restart)' "$WORK_DIR/cf-service-calls"
    ! grep -Fq 'overwrote' "$WORK_DIR/cf-actions"
    if setup_cf_tunnel <<< $'reuse\npanel.example.com\nPANEL.example.com' >/dev/null 2>&1; then exit 1; fi
)

# Stored URLs are read as data, and invalid URL fields cannot enter diagnostics.
(
    get_env_value() {
        if [[ "$1" == FRONTEND_URL ]]; then echo "${CF_GUARD_USER_URL:-https://panel.example.com/}";
        else echo "${CF_GUARD_ADMIN_URL:-https://admin.example.com}"; fi
    }
    load_cf_domains
    [[ "$DOMAIN" == panel.example.com && "$ADMIN_DOMAIN" == admin.example.com ]]
    CF_GUARD_ADMIN_URL=https://PANEL.example.com
    if load_cf_domains; then exit 1; fi
    CF_GUARD_ADMIN_URL=https://admin.example.com/path
    if load_cf_domains; then exit 1; fi
    CF_GUARD_USER_URL=http://panel.example.com
    if load_cf_domains >/dev/null 2>&1; then exit 1; fi
)

# A non-Nginx listener on port 80 must fail preflight without killing it.
(
    ss() { echo 'LISTEN 0 128 0.0.0.0:80 0.0.0.0:* users:(("other-server",pid=42,fd=5))'; }
    systemctl() { return 0; }
    if check_cf_prerequisites > "$WORK_DIR/cf-preflight" 2>&1; then exit 1; fi
    grep -Fq '80 端口被其他程序占用' "$WORK_DIR/cf-preflight"
    ss() { return 0; }
    nginx() { return 1; }
    if check_cf_prerequisites > "$WORK_DIR/cf-preflight" 2>&1; then exit 1; fi
    grep -Fq '现有 Nginx 配置未通过' "$WORK_DIR/cf-preflight"
)

# Only live connection metrics from this service invocation can prove readiness.
(
    systemctl() { [[ "$1" != show ]] || echo 0123456789abcdef0123456789abcdef; }
    journalctl() {
        [[ "$1" == _SYSTEMD_INVOCATION_ID=0123456789abcdef0123456789abcdef ]] || return 1
        echo 'Starting metrics server on 127.0.0.1:20241/metrics'
    }
    curl() { echo "cloudflared_tunnel_ha_connections ${CF_GUARD_CONNECTIONS:-4}"; }
    cf_connection_ready
    journalctl() { echo 'Starting metrics server on [::1]:20241/metrics'; }
    curl() {
        [[ "${*: -1}" == 'http://[::1]:20241/metrics' ]] || return 1
        echo "cloudflared_tunnel_ha_connections ${CF_GUARD_CONNECTIONS:-4}"
    }
    cf_connection_ready
    CF_GUARD_CONNECTIONS=0
    status=0; cf_connection_ready || status=$?
    [[ "$status" -eq 1 ]]
    curl() { echo '# unrelated metrics'; }
    status=0; cf_connection_ready || status=$?
    [[ "$status" -eq 2 ]]
    journalctl() { echo 'Starting metrics server on 0.0.0.0:20241/metrics'; }
    status=0; cf_connection_ready || status=$?
    [[ "$status" -eq 2 ]]
)

# Real local HTTP responses: 200 alone is insufficient, and roles must not swap.
cat > "$WORK_DIR/cf-http-fixture.py" <<'PY'
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        code = {'/502': 502, '/530': 530, '/access': 302}.get(self.path, 200)
        if self.path == '/api/health':
            body = b'{"status":"ok"}'
        elif self.path == '/bad-health':
            body = b'{"status":"failed"}'
        else:
            role = 'cf-admin' if self.headers.get('Host') == 'admin.example.com' else 'cf-user'
            body = (Path(sys.argv[2]) / role / 'index.html').read_bytes()
        self.send_response(code)
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *args):
        pass

server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
Path(sys.argv[1]).write_text(str(server.server_port), encoding='utf-8')
server.serve_forever()
PY
"$PYTHON_BIN" "$WORK_DIR/cf-http-fixture.py" "$WORK_DIR/cf-http-port" "$WORK_DIR" &
HTTP_FIXTURE_PID=$!
for attempt in {1..50}; do
    [[ ! -s "$WORK_DIR/cf-http-port" ]] || break
    sleep 0.1
done
[[ -s "$WORK_DIR/cf-http-port" ]]
CF_HTTP_URL="http://127.0.0.1:$(cat "$WORK_DIR/cf-http-port")"
cf_probe_http 用户端 "$CF_HTTP_URL/" "$WORK_DIR/cf-user/index.html" panel.example.com
cf_probe_http 管理端 "$CF_HTTP_URL/" "$WORK_DIR/cf-admin/index.html" admin.example.com
cf_probe_http 健康检查 "$CF_HTTP_URL/api/health" health
if cf_probe_http 错误页面 "$CF_HTTP_URL/" "$WORK_DIR/cf-admin/index.html" panel.example.com > "$WORK_DIR/cf-probe" 2>&1; then exit 1; fi
grep -Fq '内容不符' "$WORK_DIR/cf-probe"
if cf_probe_http 错误健康状态 "$CF_HTTP_URL/bad-health" health >/dev/null 2>&1; then exit 1; fi
for route in 502 530 access; do
    if cf_probe_http 公网 "$CF_HTTP_URL/$route" health > "$WORK_DIR/cf-probe" 2>&1; then exit 1; fi
    case "$route" in
        502) grep -Fq 'Type=HTTP、URL=127.0.0.1:80' "$WORK_DIR/cf-probe" ;;
        530) grep -Fq '1033' "$WORK_DIR/cf-probe" ;;
        access) grep -Fq 'Access' "$WORK_DIR/cf-probe" ;;
    esac
done
(
    curl() { return 6; }
    sleep() { return 0; }
    if cf_probe_http 公网 https://panel.example.com/ health > "$WORK_DIR/cf-probe" 2>&1; then exit 1; fi
    grep -Fq 'DNS 解析失败' "$WORK_DIR/cf-probe"
    grep -Fq 'DNS 缓存或传播延迟' "$WORK_DIR/cf-probe"
    grep -Fq '无需重装面板' "$WORK_DIR/cf-probe"
)

# Recover transient public failures using the same resolver and verified response.
# Persistent failures are bounded; local, HTTP, content and TLS failures do not retry.
(
    sleep() { echo "$1" >> "$WORK_DIR/cf-retry-sleeps"; }
    curl() {
        local call_count=0 arg
        [[ ! -f "$WORK_DIR/cf-retry-count" ]] || call_count="$(cat "$WORK_DIR/cf-retry-count")"
        call_count=$((call_count+1))
        printf '%s' "$call_count" > "$WORK_DIR/cf-retry-count"
        for arg in "$@"; do
            [[ "$arg" != https://panel.example.com/* ]] || {
                if [[ "$CF_GUARD_RETRY_CODE" -ne 0 ]] &&
                    [[ "$CF_GUARD_RETRY_ALWAYS" == yes || "$call_count" -eq 1 ]]; then
                    return "$CF_GUARD_RETRY_CODE"
                fi
                # Use the real local HTTP fixture for the successful response.
                set -- "${@:1:$#-1}" "$CF_HTTP_URL/${arg#https://panel.example.com/}"
                break
            }
        done
        command curl "$@"
    }
    CF_GUARD_RETRY_ALWAYS=no
    for CF_GUARD_RETRY_CODE in 6 7 28; do
        rm -f "$WORK_DIR/cf-retry-count" "$WORK_DIR/cf-retry-sleeps"
        cf_probe_http 公网 https://panel.example.com/api/health health > "$WORK_DIR/cf-probe" 2>&1
        [[ "$(cat "$WORK_DIR/cf-retry-count")" == 2 ]]
        [[ "$(cat "$WORK_DIR/cf-retry-sleeps")" == 3 ]]
        grep -Fq 'API status=ok' "$WORK_DIR/cf-probe"
    done
    CF_GUARD_RETRY_ALWAYS=yes
    CF_GUARD_RETRY_CODE=6
    rm -f "$WORK_DIR/cf-retry-count" "$WORK_DIR/cf-retry-sleeps"
    if cf_probe_http 公网 https://panel.example.com/api/health health > "$WORK_DIR/cf-probe" 2>&1; then exit 1; fi
    [[ "$(cat "$WORK_DIR/cf-retry-count")" == 3 ]]
    [[ "$(wc -l < "$WORK_DIR/cf-retry-sleeps")" -eq 2 ]]
    ! grep -Fq '通过' "$WORK_DIR/cf-probe"
    CF_GUARD_RETRY_CODE=60
    rm -f "$WORK_DIR/cf-retry-count" "$WORK_DIR/cf-retry-sleeps"
    if cf_probe_http 公网 https://panel.example.com/api/health health >/dev/null 2>&1; then exit 1; fi
    [[ "$(cat "$WORK_DIR/cf-retry-count")" == 1 && ! -e "$WORK_DIR/cf-retry-sleeps" ]]
    CF_GUARD_RETRY_ALWAYS=no
    CF_GUARD_RETRY_CODE=0
    for route in 502 bad-health; do
        rm -f "$WORK_DIR/cf-retry-count" "$WORK_DIR/cf-retry-sleeps"
        if cf_probe_http 公网 "https://panel.example.com/$route" health >/dev/null 2>&1; then exit 1; fi
        [[ "$(cat "$WORK_DIR/cf-retry-count")" == 1 && ! -e "$WORK_DIR/cf-retry-sleeps" ]]
    done
    curl() { echo call >> "$WORK_DIR/cf-local-count"; return 6; }
    if cf_probe_http 本机 "$CF_HTTP_URL/api/health" health >/dev/null 2>&1; then exit 1; fi
    [[ "$(wc -l < "$WORK_DIR/cf-local-count")" -eq 1 && ! -e "$WORK_DIR/cf-retry-sleeps" ]]
)

# Diagnostics collect all layers, and no failure/unknown state can announce success.
(
    DOMAIN=panel.example.com
    ADMIN_DOMAIN=admin.example.com
    nginx() { return 0; }
    systemctl() { return 0; }
    journalctl() { return 0; }
    curl() { return 0; }
    sleep() { return 0; }
    resolve_static_dist_dir() { echo "$WORK_DIR/cf-user"; }
    cf_connection_ready() { return "${CF_GUARD_READY:-0}"; }
    cf_probe_http() {
        echo "$1" >> "$WORK_DIR/cf-diagnostic-calls"
        [[ "$1" != "${CF_GUARD_FAIL:-none}" ]]
    }
    diagnose_cf_tunnel >/dev/null 2>&1
    [[ "$CF_TUNNEL_VERIFIED" == true ]]
    CF_GUARD_FAIL=用户端公网页面
    if diagnose_cf_tunnel >/dev/null 2>&1; then exit 1; fi
    [[ "$CF_TUNNEL_VERIFIED" == false ]]
    grep -Fxq '管理端公网 API' "$WORK_DIR/cf-diagnostic-calls"
    CF_GUARD_FAIL=none
    CF_GUARD_READY=2
    if diagnose_cf_tunnel > "$WORK_DIR/cf-diagnostic" 2>&1; then exit 1; fi
    grep -Fq '尚未验证' "$WORK_DIR/cf-diagnostic"
    CF_TUNNEL_SELECTED=true
    get_env_value() { return 0; }
    show_result > "$WORK_DIR/cf-result" 2>&1
    ! grep -Fq '部署成功' "$WORK_DIR/cf-result"
    grep -Fq '尚未全部验证通过' "$WORK_DIR/cf-result"
)

echo "install-panel guards passed (including CF setup, secret handling and layered diagnostics)"
