#!/usr/bin/env node
/**
 * 守卫测试总入口：把根 package.json `testGuards` 里的命令逐条 spawn 执行。
 *
 * 为什么不再用 `&&` 串成一条超长脚本：
 *   1) Windows 上脚本字符串会被 shell 静默截断。实测（本机 Git Bash）用 `bash -c` 传 9250 字符的
 *      命令串只执行了 268/302 条，stderr 为空、退出码 0；cmd.exe 在超过 8191 字符时则直接抛
 *      "The command line is too long."。
 *   2) pnpm 对不存在的脚本只打印 `None of the selected packages has a "x" script` 并返回 0。
 *      两条叠加，被截断后剩下的半截脚本名（v1.6.4 实测为 `test:ins`）不会让整链失败 —— 于是
 *      "漏跑一大半守卫"仍然是全绿。
 *   逐条 spawn 后每条命令都远短于 8191 字符，且任一失败都会让本进程以非零退出。
 *
 * 清单唯一来源：根 package.json 的 `testGuards` 数组（顺序即执行顺序），没有第二份手抄清单。
 *
 * 覆盖率纪律：server/package.json 里每个 `test:*` 要么在 `testGuards` 里，要么登记在下面的
 * EXCLUDED_FROM_SUITE（附原因）。两者都没有 → 直接报错，防止新守卫再次被静默漏跑。
 */

import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const LOG_ROOT = resolve(process.env.TEST_RUN_LOG_DIR || join(repoRoot, 'logs'))
const DATABASE_URL_FALLBACK = 'postgresql://user:pass@localhost:5432/db'
const ENTRY_PATTERN = /^pnpm --filter ([A-Za-z0-9._-]+) ([A-Za-z0-9:._-]+)$/
const MAX_CAPTURE_BYTES = 4 * 1024 * 1024
const DEFAULT_TAIL_LINES = 40

const HELP = `usage: node scripts/run-tests.mjs [options]

  (no option)          run every command in the root package.json testGuards array, in order
  --list               print the selected commands with their manifest index, then stop
  --check              validate the manifest (entries exist, every server test:* is classified), then stop
  --only <substring>   run only commands containing <substring> (repeatable)
  --shard <i/n>        run every n-th command (1 <= i <= n), keeping the manifest order inside the shard
  --manifest <path>    read the command list from another JSON file (array, or { "testGuards": [...] })
  --fail-fast          stop at the first failure instead of running the rest
  --tail <n>           number of output lines echoed for a failing command (default ${DEFAULT_TAIL_LINES})
  --help               print this help

environment:
  DATABASE_URL         filled with a placeholder when unset (guards only require the variable to exist)
  TEST_RUN_LOG_DIR     log root (default <repo>/logs, already git-ignored)`

/**
 * 有意不进 `pnpm test` 的 server 守卫：需要活体环境或已构建的 dist，单独在别处执行。
 * 新增守卫若不属于这一类，请加进根 package.json 的 `testGuards`，不要加到这里。
 */
const EXCLUDED_FROM_SUITE = new Map([
  ['test:review-managed-provision', 'requires isolated local *_pool_test PostgreSQL and OpenSSL; actual managed provision cleanup, mTLS failures and resource/refund checks'],
  ['test:review-public-ipv4', 'requires isolated local *_pool_test PostgreSQL; public address allocation, outer join row locks and competing reservations'],
  ['test:review-host-gift-preparation', 'requires isolated local *_pool_test PostgreSQL and OpenSSL; actual gift preparation rollback, resource claims and inbox failure after delivery starts'],
  ['test:review-host-network-sync', 'requires isolated local *_pool_test PostgreSQL and OpenSSL; host network observation routes, stale identity/generation, revocation and atomic persistence'],
  ['test:review-network-persistence', 'requires isolated local *_pool_test PostgreSQL; direct network snapshot identity, generation consumption and transactional primary address persistence'],
  ['test:review-instance-quota', 'requires isolated local *_pool_test PostgreSQL; actual admin/host quota null, omission, zero and range behavior'],
  ['test:review-host-gift-days', 'requires isolated local *_pool_test PostgreSQL; actual gift-days authorization, expiry and suspension races with paid renewal and transactional audit rollback'],
  ['test:review-instance-detail-reads', 'requires Chrome/Edge and local Vite; actual detail route/session/read ordering, pending task/statistics and lifecycle timers'],
  ['test:review-transfer-modal-lifecycle', 'requires Chrome/Edge and local Vite; actual transfer and sensitive verification modal request ordering, draft/session identity and lifecycle'],
  ['test:review-change-plan-lifecycle', 'requires Chrome/Edge and local Vite; actual upgrade modal selection/preview binding, session identity, stale responses and submitted target'],
  ['test:review-terminal-lifecycle', 'requires Chrome/Edge and local Vite; actual KeepAlive terminal keyboard and overlay lifecycle with controlled clipboard and socket boundaries'],
  ['test:review-terminal-session', 'requires Chrome/Edge and local Vite; actual terminal session/list/cloud-init/ticket/socket lifecycle with controlled transport'],
  ['test:review-terminal-commands-lifecycle', 'requires Chrome/Edge and local Vite; actual saved command draft, CRUD response, session, cache and mobile lifecycle'],
  ['test:review-ticket-lifecycle', 'requires Chrome/Edge and local Vite; actual ticket detail, reply draft, pagination, attachment, session and cache lifecycle'],
  ['test:review-ticket-actions', 'requires Chrome/Edge and local Vite; current ticket status, admin actions and create draft/navigation isolation'],
  ['test:review-ticket-instance-card', 'requires Chrome/Edge and local Vite; ticket instance card response, polling, action, session and cache lifecycle'],
  ['test:review-instance-batch-billing', 'requires Chrome/Edge and local Vite; batch billing preview targets, eligibility and session/cache/write response isolation'],
  ['test:review-create-promo', 'requires Chrome/Edge and local Vite; legacy create coupon/plan/session isolation and initial hosting-zone source'],
  ['test:review-instance-logs', 'requires Chrome/Edge and local Vite; instance log query ordering, pagination, failure, session and cache lifecycle'],
  ['test:review-reinstall-selection', 'requires Chrome/Edge and local Vite; reinstall/recreate current image/key membership, submit and modal lifecycle'],
  ['test:review-port-conflict', 'requires Chrome/Edge and local Vite; strict port parsing, numeric duplicates, range and conflict modal submission gates'],
  ['test:review-ticket-uploader', 'requires Chrome/Edge and local Vite; disabled attachment edits, late file picker events and preview URL lifecycle'],
  ['test:review-host-instance-reads', 'requires Chrome/Edge and local Vite; host instance list, traffic, detail, selection and session/cache request ordering'],
  ['test:review-host-delete-lifecycle', 'requires Chrome/Edge and local Vite; host deletion fixed targets, preview validation, pending writes and session/cache lifecycle'],
  ['test:review-host-batch-actions', 'requires Chrome/Edge and local Vite; host suspension, unsuspension and sync fixed targets, partial failures and session/query lifecycle'],
  ['test:review-host-gift-lifecycle', 'requires Chrome/Edge and local Vite; host gift paid targets, strict days, partial retry and session/cache lifecycle'],
  ['test:review-host-price-lifecycle', 'requires Chrome/Edge and local Vite; host renewal price target, amount bounds, newer drafts and list/session/cache lifecycle'],
  ['test:review-host-reset-lifecycle', 'requires Chrome/Edge and local Vite; host traffic reset target, success versus display failure and list/session/cache lifecycle'],
  ['test:review-host-notify-lifecycle', 'requires Chrome/Edge and local Vite; host notification target snapshot, draft preservation and session/cache lifecycle'],
  ['test:review-host-recreate-lifecycle', 'requires Chrome/Edge and local Vite; host recreate image/key preparation, fixed target and session/cache lifecycle'],
  ['test:review-host-single-actions', 'requires Chrome/Edge and local Vite; single host instance sync/swap, fresh config and session/cache lifecycle'],
  ['test:review-host-batch-config', 'requires Chrome/Edge and local Vite; host batch config fixed targets, retry accounting and session/cache lifecycle'],
  ['test:review-host-batch-config-inputs', 'requires Chrome/Edge and local Vite; batch config numeric syntax/ranges, native zero values and exact traffic bytes'],
  ['test:review-host-batch-config-roles', 'requires Chrome/Edge and local Vite; batch config host owner/admin fields and role changes'],
  ['test:review-host-quota-display', 'requires Chrome/Edge and local Vite; host instance zero, finite and unknown quotas by resource'],
  ['test:review-quota-views', 'requires Chrome/Edge and local Vite; ticket quota cards and instance detail site/snapshot tabs'],
  ['test:review-instance-quota-editor', 'requires Chrome/Edge and local Vite; quota editor fields, resource usage, refresh and draft preservation'],
  ['test:review-instance-quota-submit', 'requires Chrome/Edge and local Vite; quota input validation, role/target/session boundaries and save/refresh lifecycle'],
  ['test:review-host-migrate-dedicated', 'requires isolated local *_pool_test PostgreSQL; dedicated instance/host boundary before legacy migration mutations'],
  ['test:review-host-storage-reads', 'requires Chrome/Edge and local Vite; storage list host/session/cache lifecycle, response validation and fallback warning'],
  ['test:review-host-storage-writes', 'requires Chrome/Edge and local Vite; storage create/import/edit/delete targets, duplicate requests, old receipts and retry'],
  ['test:review-host-storage-inputs', 'requires Chrome/Edge and local Vite; storage size syntax, units, exact bounds, zero versus omission and mobile errors'],
  ['test:review-billing-price-preview', 'requires Chrome/Edge and local Vite; admin single/batch price preview invalidation, current targets/session, zero and confirmed submission'],
  ['test:review-billing-price-submit', 'requires Chrome/Edge and local Vite; admin single/batch price write receipts, busy drafts, explicit fresh retry and scoped auxiliary refresh'],
  ['test:review-billing-price-audit', 'requires isolated local *_pool_test PostgreSQL; actual single/batch price audit failure rolls back price, version, balance and billing ledger'],
  ['test:review-user-dialog-reads', 'requires Chrome/Edge and local Vite; actual user balance, ledger, recharge and login dialogs reject old targets/session/page responses and retain retry errors'],
  ['test:review-user-hosting-reads', 'requires Chrome/Edge and local Vite; hosting balance overview/ledger/adjust reads retain current target/session/tab/page and persistent errors'],
  ['test:review-user-hosting-submit', 'requires Chrome/Edge and local Vite; hosting adjustments validate decimals/type/reason, lock busy fields and scope current target/session/draft receipts'],
  ['test:review-two-factor-busy', 'requires Chrome/Edge and local Vite; actual two-factor setup/enable/disable/regeneration immediate mutation gates, fields/cancel protection and retry'],
  ['test:review-two-factor-reads', 'requires Chrome/Edge and local Vite; two-factor status/count read readiness, strict receipts, latest loading, persistent errors and mutation invalidation'],
  ['test:review-two-factor-session', 'requires Chrome/Edge and local Vite; two-factor read/write account/session/role/ABA/cache/draft isolation, secret cleanup and success timer lifecycle'],
  ['test:review-two-factor-receipts', 'requires Chrome/Edge and local Vite; actual TOTP input gates, setup QR/secret/recovery-code and mutation receipt validation with successful retry'],
  ['test:review-change-email-scope', 'requires Chrome/Edge and local Vite; email verification and update fixed targets/session/drafts, immediate cross-operation busy, old timers and unmount isolation'],
  ['test:review-change-email-receipts', 'requires Chrome/Edge and local Vite; strict email verification codes, real four-operation receipt contracts, failed receipt retry and expired verification cleanup'],
  ['test:review-help-editor-reads', 'requires Chrome/Edge and local Vite; help article editor current target/session/ABA read receipts, loading gates, matching ID, persistent error and retry'],
  ['test:review-help-editor-writes', 'requires Chrome/Edge and local Vite; help create/update current target/session/draft/ABA receipts, immediate write busy, fields/close and confirmed API results'],
  ['test:review-password-scope', 'requires Chrome/Edge and local Vite; password initial/verified fixed drafts, session/ABA/cache receipts, immediate busy and pending verification/timer cleanup'],
  ['test:review-password-receipts', 'requires Chrome/Edge and local Vite; password confirmed receipts and actual sensitive verification modal request/verify/parent retry, current logout and old draft cancellation'],
  ['test:review-system-settings-drafts', 'requires Chrome/Edge and local Vite; all 19 system settings groups preserve unrelated drafts, in-flight edits and ABA, independent refresh order, saved baselines and secret masks'],
  ['test:review-system-settings-scope', 'requires Chrome/Edge and local Vite; settings admin/session/ABA/cache/unmount read and write isolation, secret draft cleanup, current loading and same sid refresh'],
  ['test:review-system-settings-receipts', 'requires Chrome/Edge and local Vite; failed initial settings reads block default writes, strict configuration/JSON shape and confirmed save receipts, persistent errors and DOM retry'],
  ['test:review-system-settings-smtp', 'requires Chrome/Edge and local Vite; SMTP tests retain fixed recipient/session/drafts, reject duplicate/cross operations and stale receipts, validate real acceptance counts and keep persistent result'],
  ['test:review-package-priorities', 'requires Chrome/Edge and local Vite; package CPU and boot priorities preserve zero at read and submit, null/absent defaults and strict legal integer boundaries'],
  ['test:review-lottery-draw', 'requires Chrome/Edge and local Vite; real single/ten-draw mutual exclusion, fixed lottery/session/page receipts, cancelled result animation and safe retries without real rewards'],
  ['test:review-telegram-bindings', 'requires Chrome/Edge and local Vite; real Telegram bindings search order, session/cache/draft read isolation, strict response shape and persistent DOM retry without external Telegram'],
  ['test:review-telegram-channel-editor', 'requires Chrome/Edge and local Vite; current channel target/session/cache reads, ready gate, strict masked detail response, persistent retry and close secret cleanup'],
  ['test:review-telegram-channel-submit', 'requires Chrome/Edge and local Vite; frozen create/update fields, current target/session/draft receipts, busy gates, confirmed message/channel and masked token preservation'],
  ['test:review-login-submit', 'requires Chrome/Edge and local Vite; actual user/admin login duplicate and demo busy gates, retry, safe console routing and missing credential/challenge checks with deferred auth API'],
  ['test:review-user-balance-submit', 'requires Chrome/Edge and local Vite; balance adjustment strict amount inputs, immediate busy lock, current session/draft receipts and scoped auxiliary reads'],
  ['test:review-user-points-submit', 'requires Chrome/Edge and local Vite; points adjustment integer/reason gates, busy fields, current targets/session/draft receipts and scoped list refresh'],
  ['test:review-user-balance-audit', 'requires isolated local *_pool_test PostgreSQL; balance and ledger/audit atomic rollback, exact receipts and administrator revocation row-lock races'],
  ['test:review-user-points-write', 'requires isolated local *_pool_test PostgreSQL; actual points admin/session row-lock races, audit/ledger rollback, counters and concurrent insufficient deductions'],
  ['test:review-user-hosting-write', 'requires isolated local *_pool_test PostgreSQL; available/frozen hosting adjustments roll back ledger/audit/read failures and return receipts under current administrator locks'],
  ['test:review-storage-size', 'requires isolated local *_pool_test PostgreSQL and OpenSSL; actual storage create/update capacity boundaries over mTLS'],
  ['test:review-storage-update', 'requires OpenSSL; pinned mTLS storage updates, ETag conflicts and description/config preservation'],
  ['test:review-storage-import', 'requires isolated local *_pool_test PostgreSQL and OpenSSL; exact missing pool checks, import failures and existing pool metadata over mTLS'],
  ['test:review-storage-purpose', 'requires isolated local *_pool_test PostgreSQL; offline platform purpose changes, current authorization, concurrent metadata and atomic audit'],
  ['test:review-host-pagination', 'requires isolated local *_pool_test PostgreSQL; host architecture/network projection, cross-owner pagination and access boundaries'],
  ['test:review-host-redeem-reads', 'requires Chrome/Edge and local Vite; redeem list/options/usages host/session lifecycle, pagination, retries and draft preservation'],
  ['test:review-host-redeem-writes', 'requires Chrome/Edge and local Vite; redeem create/toggle/delete target, duplicate, session, dialog and partial-result lifecycle'],
  ['test:review-host-redeem-copy', 'requires Chrome/Edge and local Vite; clipboard ordering, rejection, timers, session and batch result dialog lifecycle'],
  ['test:review-host-migrate-reads', 'requires Chrome/Edge and local Vite; migration host pagination, destination images/plans, session and dialog lifecycle'],
  ['test:review-host-migrate-writes', 'requires Chrome/Edge and local Vite; fixed migration writes, stale completions, response validation and partial results'],
  ['test:review-host-migrate-parent', 'requires Chrome/Edge and local Vite; synchronous parent selection, current identities, dedicated boundary and result preservation'],
  ['test:review-traffic-limit', 'requires isolated local *_pool_test PostgreSQL; actual user/instance traffic limit omission and bigint boundary validation'],
  ['test:review-traffic-reset-auth', 'requires isolated local *_pool_test PostgreSQL; actual traffic reset actor/target races, billing and baseline checks'],
  ['test:review-payment-locales', 'requires Chrome/Edge and local Vite; actual payment provider controls in three locales, read-only API fixture'],
  ['test:review-markdown-attributes', 'requires Chrome/Edge and local Vite; actual quote escaping, DOM sanitization, event probes and link targets'],
  ['test:review-markdown-browser', 'requires Chrome/Edge and local Vite; actual Markdown output rendered in the terms modal'],
  ['test:review-terms-lifecycle', 'requires Chrome/Edge and local Vite; actual terms modal close, KeepAlive, abort, delayed body and unmount ordering'],
  ['test:review-terms-language', 'requires Chrome/Edge and local Vite; actual terms modal language changes, delayed bodies and failed fetch retry'],
  ['test:review-admin-package-options', 'requires Chrome/Edge and local Vite; legacy admin image/host refresh ordering and current selection gates'],
  ['test:review-admin-package-create', 'requires Chrome/Edge and local Vite; legacy admin package create draft and credential receipt isolation'],
  ['test:review-admin-pool-create-entry', 'requires Chrome/Edge and local Vite; default pool independent of delayed or failed legacy package loading'],
  ['test:review-admin-pool-create-load', 'requires Chrome/Edge and local Vite; actual admin pool catalog/image failures, retry and lifecycle ordering'],
  ['test:review-admin-pool-create', 'requires Chrome/Edge and local Vite; actual admin page pool ordering, target/context isolation and idempotent retry payloads'],
  ['test:review-host-create-instance', 'requires Chrome/Edge and local Vite; actual host gift target identity, lookup ordering and submit payload'],
  ['test:review-vip-level-rules', 'requires Chrome/Edge and local Vite; actual user/hosting VIP rule read gating, save and context isolation'],
  ['test:review-vip-benefit-hall', 'requires Chrome/Edge and local Vite; actual VIP hall visibility/session/read and claim lifecycle'],
  ['test:review-vip-reward-editor', 'requires Chrome/Edge and local Vite; actual VIP admin reward form normalization and save payloads'],
  ['test:review-vip-reward-description', 'requires isolated local *_pool_test PostgreSQL; actual VIP description clearing, omission and unchanged reward configuration'],
  ['test:review-prize-stock', 'requires isolated local *_pool_test PostgreSQL; actual lottery draw/replenishment, duplicate revisions and stock limits'],
  ['test:review-prize-editor', 'requires Chrome/Edge and local Vite; actual prize editor payloads, partial failure reload and duplicate submission gates'],
  ['test:review-instance-badge', 'requires installed Chrome/Edge and local Vite; actual instance badge modal with initial visibility and delayed instance/session/action races'],
  ['test:review-badge-center', 'requires installed Chrome/Edge and local Vite; actual BadgeCenter with KeepAlive, delayed overview/draw/apply callbacks and session changes'],
  ['test:review-badge-motion', 'requires installed Chrome/Edge; parses actual SVG animations, samples repaired transforms and checks reduced motion in all badge documents'],
  ['test:review-badge-image', 'requires installed Chrome/Edge and local Vite; actual BadgeImage/Pinia with delayed catalog and real HTTP image success/failure'],
  ['test:review-expiry-panel', 'requires installed Chrome/Edge and local Vite; actual patrol/history components with Vue KeepAlive and controlled API/timers/visibility for lifecycle races'],
  ['test:review-package-empty-fields', 'requires isolated local *_pool_test PostgreSQL; actual Fastify package/plan empty-field updates, omission semantics and owner authorization'],
  ['test:review-package-form', 'requires installed Chrome/Edge and local Vite; renders actual package form with Vue Router and delayed API fixture for route/session lifecycle'],
  ['test:review-service-worker-browser', 'requires installed Chrome/Edge; registers actual Service Worker on two isolated local HTTP origins and verifies CacheStorage/offline/clear/bounds'],
  ['test:review-init-command-selector', 'requires installed Chrome/Edge and local Vite; renders real selector with delayed API fixture for distro/session/unmount races'],
  ['test:review-init-command-modals', 'requires installed Chrome/Edge and local Vite; renders real init command modals with delayed API/clipboard fixture'],
  ['test:review-ticket-public-authorization', 'requires isolated local *_pool_test PostgreSQL; real bearer middleware and PAT/POA ticket write races with account/token/app/grant revocation'],
  ['test:review-ticket-image-proxy', 'requires isolated local *_pool_test PostgreSQL; real Fastify image proxy access, body timeout and cancellation with intercepted fetch transport'],
  ['test:review-ticket-authorization', 'requires isolated local *_pool_test PostgreSQL; real Fastify ticket creation actor/session revocation and account row-lock races'],
  ['test:review-ticket-target', 'requires isolated local *_pool_test PostgreSQL; real ticket creation races with instance ownership/host/deletion changes and DB rollback'],
  ['test:review-ticket-pagination', 'requires isolated local *_pool_test PostgreSQL; real Fastify ticket list/message pagination and numeric search boundaries'],
  ['test:review-restore-transport', 'requires OpenSSL; actual local mTLS stream restore, total deadlines and exact existence errors'],
  ['test:review-restore-authorization', 'requires isolated local *_pool_test PostgreSQL and OpenSSL; real restore admission/claim/dispatch and current authorization with mTLS refusal boundary'],
  ['test:review-restore-replacement', 'requires isolated local *_pool_test PostgreSQL and OpenSSL; real worker replacement, persisted UUID/device identity, failure fences and mTLS Incus fixture'],
  ['test:review-transfer-cleanup-integration', 'requires isolated local *_pool_test PostgreSQL and OpenSSL; fixed transfer cleanup, UUID and pin checks, database faults, retry/concurrency and dedicated preservation with real mTLS Incus/TLS Caddy boundaries'],
  ['test:review-auto-snapshot-integration', 'requires isolated local *_pool_test PostgreSQL and OpenSSL; automatic snapshot eligibility, shared locks, rotation and remote refusal through mTLS Incus fixture'],
  ['test:review-proxy-site-operations', 'requires isolated local *_pool_test PostgreSQL and OpenSSL; durable proxy intent, authorization, replay and remote-success/database-failure recovery through TLS Caddy fixture'],
  ['test:review-sync-observation-protection-integration', 'requires isolated local *_pool_test PostgreSQL and OpenSSL; actual failed status observations preserve customer resources and dedicated inventory against mTLS Incus fixture'],
  ['test:review-proxy-ipv4-sync-integration', 'requires isolated local *_pool_test PostgreSQL and OpenSSL; durable address-sync intent, same-IP retry, current ownership, failure rollback and TLS Caddy fixture'],
  ['test:review-batch-config-integration', 'requires isolated local *_pool_test PostgreSQL; current batch actor/target locks, resource accounting, concurrency and partial remote failure through Incus fixture'],
  ['test:review-admin-balance-integration', 'requires isolated local *_pool_test PostgreSQL; actual administrative balance routes, current actor/session, approval CAS and ledger rollback'],
  ['test:review-user-list-integration', 'requires isolated local *_pool_test PostgreSQL; real Fastify list payload, fixed SQL count and database-limited latest login retrieval'],
  ['test:review-caddy-integration', 'requires isolated local *_pool_test PostgreSQL and OpenSSL; Caddy credential routes and HTTPS API fixture for ETag/routing/error semantics'],
  ['test:review-caddy-runtime', 'requires explicitly verified REVIEW_CADDY_BINARY and OpenSSL; actual isolated native Caddy API/TLS/atomic reload compatibility, not Linux installation'],
  ['test:review-inbox-send-integration', 'requires isolated local *_pool_test PostgreSQL; current inbox sender/recipients, history and email-queue atomicity with no SMTP dispatch'],
  ['test:review-caddy-lifecycle', 'requires OpenSSL and isolated local TLS listener; Caddy in-flight LRU eviction/reuse and real Fastify credential log redaction'],
  ['test:review-init-env-execution', 'requires Bash and OpenSSL; actually executes init-env.sh repeatedly against isolated temporary ENV_FILE fixtures'],
  ['test:review-proxy-certificates', 'requires OpenSSL and isolated TLS listeners; actual date/hostname/trust verification including expired, self-signed and incomplete chains'],
  ['test:review-aff-eligibility-integration', 'requires isolated local *_pool_test PostgreSQL; AFF current eligibility, row-lock disable races, mail renewals, actor checks and ledger rollback'],
  ['test:review-agent-credentials-integration', 'requires isolated local *_pool_test PostgreSQL; actual Agent credential/token routes and atomic rotation/consumption races with release fetch fixture'],
  ['test:review-finance-authorization-integration', 'requires isolated local *_pool_test PostgreSQL; real AFF, manual recharge/sync and gift-card routes with authorization races and ledger rollback; provider fetch fixture'],
  ['test:review-quota-hosting-integration', 'requires isolated local *_pool_test PostgreSQL; actual quota and hosting adjustment routes with actor/session and concurrency guards'],
  ['test:review-renewal-integration', 'requires isolated local *_pool_test PostgreSQL; renewal period/actor/ownership and atomic ledger rollback with auto-renew routes'],
  ['test:review-queue-sync-integration', 'requires isolated local *_pool_test PostgreSQL; email/task attempt finalization, null timeout and overdue sync selection'],
  ['test:review-oauth-integration', 'requires isolated local *_pool_test PostgreSQL; real OAuth callback/exchange/unbind routes with provider HTTP as fixture boundary'],
  ['test:review-admin-account-integration', 'requires isolated local *_pool_test PostgreSQL; actual admin routes, actor/session rechecks, revocation fault rollback and account deletion race'],
  ['test:review-config-pagination-integration', 'requires isolated local *_pool_test PostgreSQL; actual notifications route pagination and prototype-key configuration/ledger boundaries'],
  ['test:review-task-claim-integration', 'requires isolated local *_pool_test PostgreSQL; tests claim concurrency, cancellation and host/instance/type exclusions'],
  ['test:review-upload-completion-integration', 'requires isolated local *_pool_test PostgreSQL and OpenSSL; real Fastify/PG authorization and queue races, mTLS export and explicit storage fixture'],
  ['test:review-backup-export', 'requires OpenSSL and isolated mTLS listeners; registered server identity, streaming backpressure, cancellation and export deadlines'],
  ['test:review-command-integration', 'requires isolated local *_pool_test PostgreSQL; exercises command route limits, edits, deletion and revocation races'],
  ['test:review-ssh-keys-integration', 'requires isolated local *_pool_test PostgreSQL; exercises actual SSH key parser, duplicate/limit races, user state and asynchronous RSA generation'],
  ['test:review-verification-integration', 'requires isolated local *_pool_test PostgreSQL; tests email verification send/attempt/consumption/purpose and operation-grant expiry boundaries'],
  ['test:review-2fa-integration', 'requires isolated local *_pool_test PostgreSQL; tests actual compare-and-set concurrency, verified snapshots and session revocation'],
  ['test:review-batch-port-range-integration', 'requires isolated local *_pool_test PostgreSQL and OpenSSL; actual batch mapping routes with declared range, NAT bounds, quota and mTLS Incus fixture'],
  ['test:remote-gateway-setup-integration', 'requires isolated local *_gateway_test PostgreSQL; exercises persistent remote planning, interrupted retries, credential protection and port/network conflict fixture'],
  ['test:admin-instance-delete-integration', 'requires an isolated local *_pool_test PostgreSQL database; exercises actual administrator/owner route permissions, refund choices, duplicate requests and resource finalization'],
  ['test:platform-recovery-reconciliation-integration', 'explicit isolated local *_recovery_test PostgreSQL database and built server/dist; tests atomic recovery corrections, actual password/MFA, stale snapshots and rollback'],
  ['test:host-gateway-dns-integration', 'requires explicit opt-in and an empty local *_expiry_test PostgreSQL database; verifies host DNS deployment state and conflict boundaries'],
  ['test:billing-expiry-integration', 'requires explicit opt-in, an empty local *_expiry_test PostgreSQL database and OpenSSL; exercises renewal/expiry scheduler against an HTTPS Incus fixture'],
  ['test:gateway-installation-live', 'explicit Linux root opt-in installs a real fresh gateway using a protected controller enrollment and isolated *_gateway_test database'],
  ['test:gateway-installation-integration', 'requires isolated real PostgreSQL *_gateway_test database for installation preparation, MFA and secret delivery'],
  ['test:gateway-component-integration', 'requires built native Linux gateway component package and root network namespace isolation'],
  ['test:gateway-management-integration', 'requires Linux live read-only probe and isolated real PostgreSQL *_gateway_test database'],
  ['test:gateway-task-integration', 'requires isolated real PostgreSQL *_gateway_test database'],
  ['test:frontend-dist-boundary-guards', 'needs a built client/dist; runs in "pnpm build" and release.yml'],
  ['test:gift-card-flow', 'end-to-end flow test needing live infrastructure'],
  ['test:admin-instance-push-integration', 'integration test needing live infrastructure'],
  ['test:host-onboarding-lease-integration', 'integration test needing live infrastructure'],
  ['test:host-pool-integration', 'integration test needing live infrastructure'],
  ['test:host-pool-recovery-integration', 'integration test needing live infrastructure'],
  ['test:host-public-ip-integration', 'integration test needing live infrastructure'],
  ['test:host-public-ipv6-integration', 'integration test needing live infrastructure'],
  ['test:host-replacement-integration', 'integration test needing live infrastructure'],
  ['test:upaypro-payment-integration', 'integration test needing live infrastructure']
])

let activeChild = null

function abort(message) {
  process.stderr.write(`[run-tests] ${message}\n`)
  process.exit(1)
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    abort(`cannot read JSON at ${path}: ${error.message}`)
  }
}

function parseArgs(argv) {
  const options = { list: false, check: false, help: false, failFast: false, only: [], shard: null, manifest: null, tail: DEFAULT_TAIL_LINES }
  const value = (index, flag) => {
    const next = argv[index + 1]
    if (next === undefined || next.startsWith('--')) abort(`missing value for ${flag}`)
    return next
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--list') options.list = true
    else if (arg === '--check') options.check = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--fail-fast') options.failFast = true
    else if (arg === '--only') { options.only.push(value(index, arg)); index += 1 }
    else if (arg.startsWith('--only=')) options.only.push(arg.slice(7))
    else if (arg === '--shard') { options.shard = value(index, arg); index += 1 }
    else if (arg.startsWith('--shard=')) options.shard = arg.slice(8)
    else if (arg === '--manifest') { options.manifest = value(index, arg); index += 1 }
    else if (arg.startsWith('--manifest=')) options.manifest = arg.slice(11)
    else if (arg === '--tail') { options.tail = Number(value(index, arg)); index += 1 }
    else if (arg.startsWith('--tail=')) options.tail = Number(arg.slice(7))
    else abort(`unknown argument: ${arg} (see --help)`)
  }
  if (!Number.isInteger(options.tail) || options.tail < 1) abort('--tail must be a positive integer')
  return options
}

function loadManifest(options) {
  const source = options.manifest ? resolve(repoRoot, options.manifest) : join(repoRoot, 'package.json')
  if (!existsSync(source)) abort(`manifest not found: ${source}`)
  const parsed = readJson(source)
  const entries = Array.isArray(parsed) ? parsed : parsed.testGuards
  if (!Array.isArray(entries) || entries.length === 0) {
    abort(
      options.manifest
        ? `manifest ${source} must be a non-empty array of commands, or an object with a non-empty "testGuards" array`
        : `root package.json (${source}) has no non-empty "testGuards" array; the guard manifest lives there`
    )
  }
  const commands = []
  entries.forEach((entry, index) => {
    if (typeof entry !== 'string' || entry.trim() === '') abort(`manifest entry #${index + 1} must be a non-empty command string`)
    commands.push(entry.trim())
  })
  return { source, commands }
}

function scriptTable(packageName) {
  const path = join(repoRoot, packageName, 'package.json')
  if (!existsSync(path)) abort(`workspace package "${packageName}" has no package.json`)
  return readJson(path).scripts || {}
}

/** 逐条确认清单里的脚本真实存在：pnpm 对未知脚本会返回 0，所以这里必须自己拦。 */
function validateEntries(commands) {
  const problems = []
  const tables = new Map()
  for (const command of commands) {
    const match = ENTRY_PATTERN.exec(command)
    if (!match) {
      problems.push(`unsupported command shape (expected "pnpm --filter <pkg> <script>"): ${command}`)
      continue
    }
    const packageName = match[1]
    const script = match[2]
    if (!tables.has(packageName)) tables.set(packageName, scriptTable(packageName))
    if (typeof tables.get(packageName)[script] !== 'string') {
      problems.push(`${packageName}/package.json defines no "${script}" script (referenced by: ${command})`)
    }
  }
  return problems
}

/** server/package.json 的 test:* 必须逐条归类：在清单里，或在 EXCLUDED_FROM_SUITE 里。 */
function unclassifiedServerGuards(commands) {
  const inManifest = new Set(commands)
  return Object.keys(scriptTable('server'))
    .filter(name => name.startsWith('test:'))
    .filter(name => !inManifest.has(`pnpm --filter server ${name}`) && !EXCLUDED_FROM_SUITE.has(name))
}

function selectCommands(commands, options) {
  let selected = commands.map((command, index) => ({ index: index + 1, command }))
  if (options.only.length > 0) {
    const missing = options.only.filter(needle => !commands.some(command => command.includes(needle)))
    if (missing.length > 0) abort(`--only matched no command for: ${missing.join(', ')}`)
    selected = selected.filter(entry => options.only.some(needle => entry.command.includes(needle)))
  }
  if (options.shard !== null) {
    const parts = String(options.shard).split('/')
    const index = Number(parts[0])
    const total = Number(parts[1])
    if (parts.length !== 2 || !Number.isInteger(index) || !Number.isInteger(total) || index < 1 || total < 1 || index > total) {
      abort(`--shard must look like "1/4" with 1 <= index <= total (got "${options.shard}")`)
    }
    selected = selected.filter((entry, position) => position % total === index - 1)
    if (selected.length === 0) abort(`--shard ${options.shard} selected no command`)
  }
  return selected
}

function pad(value, width) {
  return String(value).padStart(width, ' ')
}

function timestamp(date = new Date()) {
  const two = value => String(value).padStart(2, '0')
  return `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}-${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.round(milliseconds / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
}

function slug(command) {
  return command.replace(/^pnpm --filter /, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function tailLines(text, count) {
  return text.split(/\r?\n/).filter(line => line.trim() !== '').slice(-count)
}

function runCommand(entry, position, total, context) {
  return new Promise(resolveRun => {
    process.stdout.write(`\n[${pad(position, String(total).length)}/${total}] ${entry.command}\n`)
    const logPath = join(context.logDir, `${String(entry.index).padStart(3, '0')}-${slug(entry.command)}.log`)
    writeFileSync(logPath, `# ${entry.command}\n`)
    const chunks = []
    let captured = 0
    let truncated = false
    let settled = false
    const startedAt = Date.now()
    const finish = result => {
      if (settled) return
      settled = true
      activeChild = null
      resolveRun({ ...result, milliseconds: Date.now() - startedAt, logPath })
    }
    const handle = (chunk, sink) => {
      sink.write(chunk)
      appendFileSync(logPath, chunk)
      if (captured < MAX_CAPTURE_BYTES) {
        chunks.push(chunk.toString('utf8'))
        captured += chunk.length
      } else {
        truncated = true
      }
    }
    const child = spawn(entry.command, {
      cwd: repoRoot,
      shell: true,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: context.env
    })
    activeChild = child
    child.stdout.on('data', chunk => handle(chunk, process.stdout))
    child.stderr.on('data', chunk => handle(chunk, process.stderr))
    child.on('error', error => finish({ ok: false, reason: `spawn failed: ${error.message}`, output: '', truncated: false }))
    child.on('close', (code, signal) => {
      const output = chunks.join('')
      if (code === 0) {
        finish({ ok: true, reason: '', output, truncated })
      } else {
        finish({ ok: false, reason: signal ? `killed by signal ${signal}` : `exit code ${code}`, output, truncated })
      }
    })
  })
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(`${HELP}\n`)
    return
  }

  const { source, commands } = loadManifest(options)
  const manifestGuards = commands.filter(command => command.startsWith('pnpm --filter server test:')).length

  const problems = validateEntries(commands)
  if (problems.length > 0) {
    process.stderr.write(`[run-tests] manifest ${source} references scripts that do not exist (pnpm would silently exit 0 for those):\n`)
    problems.forEach(problem => process.stderr.write(`  - ${problem}\n`))
    process.exit(1)
  }

  const partialRun = options.only.length > 0 || options.shard !== null || options.manifest !== null
  const unclassified = partialRun ? [] : unclassifiedServerGuards(commands)
  if (unclassified.length > 0) {
    process.stderr.write('[run-tests] server/package.json defines guard scripts that this suite does not cover:\n')
    unclassified.forEach(name => process.stderr.write(`  - ${name}\n`))
    process.stderr.write('[run-tests] add them to the root package.json "testGuards" array, or record why they stay out in EXCLUDED_FROM_SUITE (scripts/run-tests.mjs)\n')
    process.exit(1)
  }

  const selected = selectCommands(commands, options)

  if (options.list) {
    selected.forEach(entry => process.stdout.write(`${pad(entry.index, 3)}  ${entry.command}\n`))
    process.stdout.write(`\nmanifest: ${source}\nplanned: ${selected.length}\n`)
    return
  }

  if (options.check) {
    process.stdout.write(`manifest: ${source}\n`)
    process.stdout.write(`planned: ${commands.length} (${commands.length - manifestGuards} type-check/other + ${manifestGuards} server guards)\n`)
    process.stdout.write(`excluded from the suite: ${EXCLUDED_FROM_SUITE.size}\n`)
    for (const [name, reason] of EXCLUDED_FROM_SUITE) process.stdout.write(`  - ${name} (${reason})\n`)
    process.stdout.write('manifest is valid: every entry resolves to an existing script, every server test:* is classified\n')
    return
  }

  const env = { ...process.env }
  let databaseUrlNote = 'inherited from the environment'
  if (!env.DATABASE_URL) {
    env.DATABASE_URL = DATABASE_URL_FALLBACK
    databaseUrlNote = `placeholder ${DATABASE_URL_FALLBACK}`
  }
  const logDir = join(LOG_ROOT, `test-run-${timestamp()}`)
  mkdirSync(logDir, { recursive: true })

  process.stdout.write(`[run-tests] node ${process.version} on ${process.platform}; one child process per command, no long shell line\n`)
  process.stdout.write(`[run-tests] manifest: ${source}\n`)
  process.stdout.write(`[run-tests] DATABASE_URL: ${databaseUrlNote}\n`)
  process.stdout.write(`[run-tests] logs: ${logDir}\n`)
  if (process.env.npm_config_script_shell) {
    process.stdout.write('[run-tests] note: npm_config_script_shell is set but not needed; that workaround itself truncates long script strings on Windows\n')
  }
  process.stdout.write(`[run-tests] planned: ${selected.length}${partialRun ? ` of ${commands.length}` : ''}\n`)

  const stop = () => {
    if (activeChild) activeChild.kill()
    process.stdout.write('\n[run-tests] interrupted\n')
    process.exit(130)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)

  const startedAt = Date.now()
  const failures = []
  const durations = []
  let executed = 0
  for (const [position, entry] of selected.entries()) {
    const result = await runCommand(entry, position + 1, selected.length, { logDir, env })
    executed += 1
    durations.push({ command: entry.command, milliseconds: result.milliseconds })
    if (result.ok) {
      process.stdout.write(`    ok (${formatDuration(result.milliseconds)})\n`)
      continue
    }
    failures.push({ entry, result })
    process.stdout.write(`    FAILED (${result.reason}, ${formatDuration(result.milliseconds)})\n`)
    process.stdout.write(`    log: ${result.logPath}\n`)
    process.stdout.write(`    ---- last ${options.tail} lines ----\n`)
    tailLines(result.output, options.tail).forEach(line => process.stdout.write(`    ${line}\n`))
    if (result.truncated) process.stdout.write('    (captured output was truncated; read the log file)\n')
    if (options.failFast) break
  }

  durations.sort((left, right) => right.milliseconds - left.milliseconds)
  const summary = [
    '================ summary ================',
    `planned:  ${selected.length}${partialRun ? ` (of ${commands.length})` : ''}`,
    `executed: ${executed}`,
    `passed:   ${executed - failures.length}`,
    `failed:   ${failures.length}`,
    `duration: ${formatDuration(Date.now() - startedAt)}`,
    ...durations.slice(0, 5).map(item => `slowest:  ${formatDuration(item.milliseconds)}  ${item.command}`),
    ...(failures.length > 0 ? ['failed guards:', ...failures.map(({ entry, result }) => `  - ${entry.command} (${result.reason}) -> ${result.logPath}`)] : []),
    `logs:     ${logDir}`,
    `result:   ${failures.length === 0 ? 'ALL GUARDS PASSED' : `FAILED (${failures.length})`}`,
    '========================================='
  ]
  writeFileSync(join(logDir, 'summary.txt'), `${summary.join('\n')}\n`)
  summary.forEach(line => process.stdout.write(`${line}\n`))
  process.exit(failures.length === 0 ? 0 : 1)
}

main().catch(error => {
  process.stderr.write(`[run-tests] unexpected error: ${error && error.stack ? error.stack : error}\n`)
  process.exit(1)
})
