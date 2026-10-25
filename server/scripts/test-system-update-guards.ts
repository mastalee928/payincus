import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { ensureSystemUpdateEnvironmentDefaults, restoreSystemUpdateApplication, backupSystemUpdateApplication } from '../src/lib/system-update-files.js'
import { systemUpdateUnitStillStarting } from '../src/lib/system-update-worker-state.js'
import { assertBundledSystemUpdateRuntime, runBundledSystemUpdateMigrations } from '../src/lib/system-update-runtime.js'
import { runSystemUpdateCommand } from '../src/lib/system-update-command.js'

for (const ActiveState of ['activating', 'active', 'reloading']) {
  assert.equal(systemUpdateUnitStillStarting({ ActiveState, SubState: 'start', Result: 'success', ExecMainStatus: '0', Job: '0' }), true, 'slow sealed-file verification must remain pending')
}
assert.equal(systemUpdateUnitStillStarting({ ActiveState: 'inactive', Job: '123 /org/freedesktop/systemd1/job/123' }), true, 'queued dependency jobs are still starting')
for (const ActiveState of ['inactive', 'failed']) assert.equal(systemUpdateUnitStillStarting({ ActiveState, Job: '0' }), false)
assert.equal(systemUpdateUnitStillStarting({ LoadState: 'not-found', ActiveState: 'inactive', Job: '0' }), false)
assert.equal(systemUpdateUnitStillStarting({}), null, 'unavailable observation must not fail a potentially live worker')
assert.equal(systemUpdateUnitStillStarting({ LoadState: 'not-found', ActiveState: 'activating', Job: '0' }), true)

const repoRoot = resolve(import.meta.dirname, '../..')

function read(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

const serverApp = read('server/src/app.ts')
const route = read('server/src/routes/system-update.ts')
const versionLib = read('server/src/lib/system-version.ts')
const prismaSchema = read('server/prisma/schema.prisma')
const migration = read('server/prisma/migrations/20260623093000_add_system_update_tasks/migration.sql')
const adminApi = read('client/src/api/admin.ts')
const userApi = read('client/src/api/index.ts')
const adminRouter = read('client/src/router/admin.ts')
const adminNav = read('client/src/config/side-nav-items-admin.ts')
const releaseWorkflow = read('.github/workflows/release.yml')
const onlineScript = read('scripts/apply-online-update.sh')
const atomicMigrationScript = read('scripts/migrate-ota-atomic-layout.sh')
const installPanel = read('scripts/install-panel.sh')
const backendService = read('deploy/incudal-backend.service.example')
const updateService = read('deploy/incudal-online-update@.service.example')
const rollbackService = read('deploy/incudal-online-rollback@.service.example')
const onlineTaskHelper = read('deploy/incudal-online-task.sh.example')
const systemctlWrapper = read('deploy/incudal-systemctl-wrapper.sh.example')
const otaChownWrapper = read('deploy/incudal-ota-chown-wrapper.sh.example')
const runTask = read('server/src/scripts/run-system-update-task.ts')
const startTask = read('server/src/scripts/start-system-update-task.ts')
const rollbackTask = read('server/src/scripts/rollback-system-update-task.ts')
const systemUpdateTasksDb = read('server/src/db/system-update-tasks.ts')
const rootPackage = read('package.json')
const serverPackage = read('server/package.json')
const freshInstall = read('scripts/smoke-fresh-install.sh')
for (const worker of [runTask, rollbackTask]) {
  assert.ok(worker.includes('const deadline = Date.now() + 180000'),
    'allow a bounded three-minute cold startup on small hosts while retaining health checks')
}

for (const [begin, end, mutation] of [
  ['async function applyArtifactLegacy', 'async function applyArtifactUpdate', 'await clearInstallDirForArtifact()'],
  ['async function applyArtifactAtomic', 'async function applyArtifactLegacy', 'await switchCurrentRelease(releaseDir)'],
  ['async function applyGitUpdate', 'async function refreshLocalOnboardingGateway', "await run('git', ['checkout'"],
] as const) {
  const body = runTask.slice(runTask.indexOf(begin), runTask.indexOf(end))
  assert.ok(body.indexOf("await run('systemctl', ['stop', serviceName]") >= 0 &&
    body.indexOf("await run('systemctl', ['stop', serviceName]") < body.indexOf(mutation),
  'stop the only backend before changing files or current release; leave host/customer services running')
}
assert.ok(runTask.includes('await backupSystemUpdateApplication(installDir, failedInstallBackup)'),
  'failed install preservation must exclude staging/download/cache copies that can exhaust rollback time')

assert.ok(runTask.includes("run('tar', ['--no-same-owner', '-xzf', artifactPath"), 'root OTA extraction must not inherit build-runner archive ownership')
assert.ok(releaseWorkflow.includes('tar --owner=0 --group=0 --numeric-owner -czf'), 'new release archives must remain compatible with installed OTA workers that preserve archive owners')
assert.ok(freshInstall.includes('member.uid != 0 or member.gid != 0'), 'both architecture fresh-install jobs must inspect actual archive ownership before install normalization can hide an OTA regression')
const migrationAndInstaller = runTask.slice(runTask.indexOf('await deployDatabaseMigrations()'), runTask.indexOf('await verifyUpdatedRuntime(Boolean(artifact))'))
assert.ok(migrationAndInstaller.indexOf('await chownInstallDir()') >= 0 && migrationAndInstaller.indexOf('await chownInstallDir()') < migrationAndInstaller.indexOf("const backupInstaller"), 'OTA must harden installed files before the root-only backup installer checks its sources')

assert.ok(
  serverApp.includes("import systemUpdateRoutes from './routes/system-update.js'") &&
    serverApp.includes("fastify.register(systemUpdateRoutes, { prefix: '/api/admin/system-update' })"),
  'system update routes must be mounted only under the admin API namespace'
)

assert.ok(
  route.includes('onRequest: [fastify.authenticateAdmin]') &&
    route.includes('SUPER_ADMIN_REQUIRED') &&
    route.includes("return user.username === 'admin'") &&
    route.includes('SYSTEM_UPDATE_ALLOWED_ADMIN_IDS'),
  'system update routes must require admin authentication plus super-admin gating'
)

assert.ok(
  versionLib.includes('const tagPattern = /^v\\d+\\.\\d+\\.\\d+') &&
    versionLib.includes('repositoryAvailable: false') &&
    versionLib.includes("rev-parse', '--is-inside-work-tree") &&
    versionLib.includes('interface GitHubReleaseAsset') &&
    versionLib.includes('getOtaReleaseInfo') &&
    versionLib.includes('ota-manifest.json') &&
    versionLib.includes('SYSTEM_UPDATE_RELEASE_REPOSITORY') &&
    route.includes('isValidReleaseTag(targetVersion)') &&
    route.includes('GIT_REPOSITORY_REQUIRED') &&
    route.includes('additionalProperties: false'),
  'system update must only accept controlled release tags, keep the Git working-tree probe available, expose OTA manifest metadata, and reject extra input'
)

// OTA 的 artifact 模式（下载 release 包 + 校验 sha256 + 原子发布）不需要 Git —— Git 只是拿不到
// artifact 时「在机器上从源码构建」的回退路径。用 release 包部署（一键脚本的默认形态）的机器
// 曾被入口处的硬性 Git 检查整个挡在门外，无法在线更新。因此判定必须是「有本机可用 artifact
// 或 是 Git 工作区」，且这个判定必须在所有入口保持一致，绝不能退回成无条件要求 Git。
assert.ok(
  versionLib.includes('export async function hasUsableOtaArtifact') &&
    versionLib.includes('export async function canApplyUpdate') &&
    versionLib.includes('if (await hasUsableOtaArtifact(tag)) return true') &&
    versionLib.includes('return await isGitRepository(root)') &&
    versionLib.includes('async function listReleaseTagsFromGitHub') &&
    versionLib.includes('/releases?per_page=30') &&
    versionLib.includes('async function checkForUpdatesWithoutGit') &&
    route.includes('canApplyUpdate(targetVersion)') &&
    startTask.includes('canApplyUpdate(targetVersion, appDir)') &&
    !route.includes('if (!(await isGitRepository()))') &&
    !startTask.includes('if (!(await isGitRepository(appDir)))') &&
    !onlineScript.includes('在线更新需要 /opt/incudal 是包含 release tag 的 Git checkout'),
  'online updates must be allowed whenever a usable OTA artifact exists, falling back to requiring a Git checkout only for source-build mode; no entry point may hard-require Git again'
)

assert.ok(
  versionLib.includes('const latest = tags[0] ? await buildAvailableUpdate(tags[0]) : null') &&
    versionLib.includes('updates.push(latest?.version === tag ? latest : await buildAvailableUpdate(tag))') &&
    versionLib.includes('latest,') &&
    versionLib.includes('updateAvailable: updates.length > 0') &&
    route.includes('canManageUpdates: await canManageSystemUpdates(getRequestUser(request))') &&
    route.includes("fastify.post<{ Body: StartUpdateBody }>('/start'") &&
    route.includes('if (!(await requireUpdateManager(request, reply))) return'),
  'system update checks must always expose the newest release tag while keeping updateAvailable and mutation permissions separate'
)

assert.ok(
  prismaSchema.includes('model SystemUpdateTask') &&
    prismaSchema.includes('enum SystemUpdateTaskStatus') &&
    migration.includes('CREATE TABLE "system_update_tasks"') &&
    migration.includes('FOREIGN KEY ("started_by_user_id") REFERENCES "users"("id")'),
  'system update tasks must be persisted with an audited admin user'
)

assert.ok(
  adminApi.includes('/admin/system-update/version') &&
    adminApi.includes('/admin/system-update/start') &&
    adminRouter.includes("path: '/admin/system-update'") &&
    adminNav.includes("path: '/admin/system-update'"),
  'admin frontend must expose the version update page and API client'
)

assert.ok(
  !userApi.includes('/admin/system-update') &&
    !userApi.includes('systemUpdate'),
  'customer API bundle must not expose system update endpoints'
)

assert.ok(
  runTask.includes("git', ['checkout', '--force', targetVersion]") &&
    runTask.includes("git', ['clean', '-fdx'") &&
    runTask.includes("'-e', '.env'") &&
    runTask.includes("'-e', '.gitconfig'") &&
    runTask.includes("git', ['config', '--global', '--add', 'safe.directory', appDir]") &&
    runTask.includes("targetVersion = task.targetVersion") &&
    runTask.includes("pnpm', ['build']") &&
    runTask.includes("test:frontend-dist-boundary-guards") &&
    runTask.includes("test:frontend-route-guards") &&
    runTask.includes("systemctl', ['restart', serviceName]") &&
    runTask.includes('waitForBackendHealth()') &&
    runTask.includes("verify:production") &&
    runTask.includes("verify:log-header") &&
    runTask.includes("smoke:agent-release") &&
    runTask.includes("tryMarkSystemUpdateTaskRunning(taskId, ['pending'], logPath)") &&
    runTask.includes('already claimed or finished; skipping duplicate worker') &&
    runTask.includes('await closePrismaDatabase()'),
  'online updater must build, migrate, guard, restart, and verify before marking success'
)

assert.ok(
  systemUpdateTasksDb.includes('export async function tryMarkSystemUpdateTaskRunning') &&
    systemUpdateTasksDb.includes('updateMany({') &&
    systemUpdateTasksDb.includes('status: { in: allowedStatuses }') &&
    systemUpdateTasksDb.includes('return result.count === 1') &&
    rollbackTask.includes("tryMarkSystemUpdateTaskRunning(taskId, ['success', 'failed'], logPath)") &&
    rollbackTask.includes('already claimed or not rollbackable; skipping duplicate worker') &&
    rollbackTask.includes('await closePrismaDatabase()'),
  'online update and rollback workers must atomically claim tasks before touching staging, downloads, releases, or rollback paths'
)

assert.ok(
  runTask.includes('SYSTEM_UPDATE_APPLY_MODE') &&
    runTask.includes('getOtaReleaseInfo(targetVersion)') &&
    runTask.includes('selectRuntimeArtifact') &&
    runTask.includes('downloadArtifact') &&
    runTask.includes('createHash') &&
    runTask.includes('OTA artifact sha256 mismatch') &&
    runTask.includes("tar', ['--no-same-owner', '-xzf', artifactPath") &&
    runTask.includes('assertArtifactStaging') &&
    runTask.includes("'.git'") &&
    runTask.includes('No usable OTA artifact found; falling back to Git build mode') &&
    runTask.includes('Skipping source-based Agent release smoke in artifact mode') &&
    runTask.includes('autoRollbackFromBackup') &&
    runTask.includes('switchCurrentRelease') &&
    runTask.includes('applyArtifactAtomic') &&
    runTask.includes('function deriveInstallDir') &&
    runTask.includes("resolvedAppDir.endsWith('/current')") &&
    runTask.includes("releasesDir.endsWith('/releases')") &&
    runTask.includes("join(installDir, '.incudal-update-downloads')") &&
    runTask.includes("join(installDir, 'current')") &&
    runTask.includes("join(installDir, 'releases')") &&
    runTask.includes('SYSTEM_UPDATE_MIN_FREE_MB') &&
    runTask.includes('SYSTEM_UPDATE_RELEASES_KEEP') &&
    runTask.includes('SYSTEM_UPDATE_BACKUP_TASKS_KEEP') &&
    runTask.includes('assertRequiredCommands()') &&
    runTask.includes('defaultExecutionPath') &&
    runTask.includes("PATH: executionPath") &&
    runTask.includes("cleanupUpdateDownloadDir('更新开始前')") &&
    runTask.includes('assertEnoughDiskSpace') &&
    runTask.includes('磁盘空间不足，无法继续 OTA 更新') &&
    runTask.includes('runPostUpdateCleanup(backupPath)') &&
    runTask.includes('runFailedUpdateCleanup()') &&
    runTask.includes('cleanupOldReleases') &&
    runTask.includes('getRecentProtectedBackupPaths') &&
    runTask.includes('getCurrentReleaseTarget') &&
    runTask.includes('已删除旧 release') &&
    runTask.includes("'.incudal-update-downloads'") &&
    !runTask.includes("cp -a ${JSON.stringify(stagingDir)}/.") &&
    !runTask.includes("cp -a ${JSON.stringify(backupDir)}/.") &&
    runTask.includes('Auto rollback completed successfully') &&
    runTask.includes("status: rolledBack ? 'rolled_back' : 'failed'") &&
    runTask.includes('failed-update'),
  'online updater must prefer checksum-verified OTA release artifacts, support atomic current/release switching, clean OTA caches, preflight disk space, prune old releases safely, and preserve Git fallback mode'
)

assert.ok(
  runTask.includes('assertBundledSystemUpdateRuntime(stagingDir)') &&
    runTask.includes('assertBundledSystemUpdateRuntime(releaseDir)') &&
    runTask.includes('assertBundledSystemUpdateRuntime(installDir)') &&
    !runTask.includes("['install', '--prod', '--frozen-lockfile', '--force']") &&
    runTask.includes('backupSystemUpdateApplication(installDir, backupDir)') &&
    runTask.includes('runSystemUpdateCommand') &&
    runTask.includes('Automatic rollback blocked'),
  'verified artifacts must use complete bundled dependencies inside each release, retain relative links and stop command children before rollback'
)

assert.ok(
  runTask.includes("const requiredCommands = ['bash', 'corepack', 'curl', 'git', 'pg_dump', 'pnpm', 'systemctl', 'tar']") &&
    runTask.includes('async function backupDatabase') &&
    runTask.includes('db-pre-migrate-${targetVersion}-${timestamp}.sql') &&
    runTask.includes("run('pg_dump', ['--format=plain', '--no-owner', '--no-privileges', '--file', temporaryPath]") &&
    runTask.includes('env: buildPostgresEnvFromDatabaseUrl(databaseUrl)') &&
    runTask.includes('function buildPostgresEnvFromDatabaseUrl') &&
    runTask.includes('env.PGPASSWORD = decodeURIComponent(url.password)') &&
    // 回归防护：连接凭据只能走 env，绝不能把带密码的 DATABASE_URL 作为 pg_dump 参数（会泄漏进 OTA 日志）；
    // 也绝不能把整个 URL 塞进 PGDATABASE（会回退到 socket+root 连接触发 role "root" does not exist）。
    !runTask.includes('env: { PGDATABASE: databaseUrl }') &&
    !runTask.includes("run('pg_dump', [databaseUrl") &&
    !runTask.includes("'--dbname', databaseUrl") &&
    !runTask.includes("'--dbname=' + databaseUrl") &&
    runTask.includes('OTA database backup failed; migration was not started') &&
    runTask.includes('databaseBackupPath = await backupDatabase(backupDir, timestamp)') &&
    runTask.includes('databaseMigrationAttempted = true') &&
    runTask.includes('await runBundledSystemUpdateMigrations(appDir') &&
    runTask.indexOf('databaseBackupPath = await backupDatabase(backupDir, timestamp)') <
      runTask.indexOf('await deployDatabaseMigrations()') &&
    runTask.indexOf('await deployDatabaseMigrations()') < runTask.indexOf('await verifyUpdatedRuntime(Boolean(artifact))') &&
    runTask.includes('DB 已迁移但代码回滚，DB 与旧代码可能不兼容') &&
    runTask.includes('DB 不会自动回滚') &&
    runTask.includes('该备份将保留'),
  'online updater must back up PostgreSQL, deploy new-release migrations before restart, abort on failure, and preserve the backup with an explicit rollback warning'
)

assert.ok(
  route.includes("execFileAsync('sudo', ['-n', 'systemctl', 'start', '--no-block', unitName]") &&
    route.includes("incudal-online-update@${taskId}.service") &&
    route.includes("incudal-online-rollback@${taskId}.service") &&
    updateService.includes('User=root') &&
    updateService.includes('ExecStart=/usr/local/libexec/incudal/incudal-online-task update %i') &&
    !updateService.includes('/opt/incudal/current/server/dist/scripts/') &&
    rollbackService.includes('User=root') &&
    rollbackService.includes('ExecStart=/usr/local/libexec/incudal/incudal-online-task rollback %i') &&
    !rollbackService.includes('/opt/incudal/current/server/dist/scripts/') &&
    installPanel.includes('/etc/sudoers.d/incudal-online-update') &&
    installPanel.includes('NOPASSWD: /usr/local/libexec/incudal/systemctl\n') &&
    !installPanel.includes('NOPASSWD: /usr/local/libexec/incudal/systemctl start') &&
    installPanel.includes('Defaults:${RUN_USER} secure_path=/usr/local/libexec/incudal:') &&
    installPanel.includes('/usr/local/libexec/incudal/incudal-online-task seal') &&
    installPanel.includes('install -o root -g root -m 0755') &&
    installPanel.includes('readonly SERVICE_NAME="incudal-backend"') &&
    installPanel.includes('SYSTEM_UPDATE_RELEASE_REPOSITORY') &&
    installPanel.includes('SYSTEM_UPDATE_RELEASE_TOKEN') &&
    installPanel.includes('SYSTEM_UPDATE_APPLY_MODE=auto') &&
    installPanel.includes('app_dir="${INSTALL_DIR}/current"') &&
    updateService.includes('Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin') &&
    rollbackService.includes('Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin') &&
    installPanel.includes('Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin') &&
    backendService.includes('Environment=PATH=/usr/local/libexec/incudal:') &&
    installPanel.includes('NoNewPrivileges=false') &&
    backendService.includes('NoNewPrivileges=false') &&
    backendService.includes('/opt/incudal/.git /opt/incudal/update-logs'),
  'production online updates must run through root-owned fixed helpers with restricted sudoers and sudo-compatible backend privileges'
)

assert.ok(
  onlineTaskHelper.includes('verify_manifest') &&
    onlineTaskHelper.includes('sha256sum --check --strict --quiet') &&
    onlineTaskHelper.includes('current points outside releases') &&
    onlineTaskHelper.includes('verify_git_control') &&
    onlineTaskHelper.includes('executable Git hooks are forbidden') &&
    onlineTaskHelper.includes('/usr/bin/chown root:root "$INSTALL_DIR"') &&
    onlineTaskHelper.includes('write_manifest') &&
    systemctlWrapper.includes('"$#" -ne 3') &&
    systemctlWrapper.includes('^incudal-online-(update|rollback)@[1-9][0-9]*\\.service$') &&
    systemctlWrapper.includes('exec /usr/bin/systemctl start --no-block "$UNIT_NAME"') &&
    otaChownWrapper.includes('"$#" -ne 3') &&
    otaChownWrapper.includes('exec /usr/local/libexec/incudal/incudal-online-task harden'),
  'root helpers must verify sealed releases, preserve root ownership, and reject broadened systemctl/chown arguments'
)

assert.ok(
  runTask.includes("pnpm', ['install', '--frozen-lockfile', '--prod=false']") &&
    runTask.includes("NODE_ENV: 'development'") &&
    runTask.includes("PNPM_CONFIG_PROD: 'false'"),
  'online updater must install build-time dependencies even when the production service environment sets NODE_ENV=production'
)

assert.ok(
  runTask.includes('server/certs') &&
    runTask.includes('agent-release') &&
    runTask.includes("'.npm'") &&
    runTask.includes("'.cache'") &&
    rollbackTask.includes('pre-rollback') &&
    rollbackTask.includes('PATH: executionPath') &&
    rollbackTask.includes("chown', ['-R', 'incudal:incudal', installDir]") &&
    rollbackTask.includes('waitForBackendHealth()') &&
    rollbackTask.includes('verify-split-host.sh'),
  'online update and rollback must preserve runtime assets and verify the split deployment'
)

assert.ok(
  releaseWorkflow.includes('cp scripts/apply-online-update.sh release/scripts/') &&
    releaseWorkflow.includes("fs.writeFileSync('release/version.json'") &&
    releaseWorkflow.includes('incudal-${VERSION}-ota-manifest.json') &&
    releaseWorkflow.includes('sha256sum "$file" > "$file.sha256"') &&
    releaseWorkflow.includes('ota-manifest.json') &&
    releaseWorkflow.includes('pnpm --filter server test:frontend-dist-boundary-guards') &&
    releaseWorkflow.includes('pnpm --filter server test:frontend-route-guards') &&
    releaseWorkflow.includes('cp scripts/migrate-ota-atomic-layout.sh release/scripts/') &&
    onlineScript.includes('APP_DIR="$INSTALL_DIR"') &&
    onlineScript.includes('APP_DIR="$INSTALL_DIR/current"') &&
    onlineScript.includes('INCUDAL_APP_DIR="$APP_DIR"') &&
    runTask.includes('const appDir = resolve(process.env.INCUDAL_APP_DIR || process.cwd())') &&
    rollbackTask.includes('function deriveInstallDir') &&
    read('server/src/scripts/start-system-update-task.ts').includes("releasesDir.endsWith('/releases')") &&
    serverPackage.includes('"update:online:start": "node dist/scripts/start-system-update-task.js"') &&
    releaseWorkflow.includes('fetch-depth: 0') &&
    releaseWorkflow.includes('cp -r deploy/* release/deploy/') &&
    rootPackage.includes('"update:online": "bash scripts/apply-online-update.sh"') &&
    installPanel.includes('git init -q') &&
    installPanel.includes('git fetch --tags --force --quiet origin') &&
    onlineScript.includes('node "$APP_DIR/server/dist/scripts/start-system-update-task.js"') &&
    onlineScript.includes('git rev-parse --is-inside-work-tree') &&
    read('server/src/scripts/start-system-update-task.ts').includes('INSTALL_DIR: installDir'),
  'release package and package scripts must expose the controlled online updater and version metadata'
)

assert.ok(
  atomicMigrationScript.includes('current_link="$INSTALL_DIR/current"') &&
    atomicMigrationScript.includes('releases_dir="$INSTALL_DIR/releases"') &&
    atomicMigrationScript.includes('WorkingDirectory=${app_dir}') &&
    atomicMigrationScript.includes('WorkingDirectory=${INSTALL_DIR}') &&
    atomicMigrationScript.includes('ExecStart=/usr/local/libexec/incudal/incudal-online-task update %i') &&
    atomicMigrationScript.includes('mv -Tf "$next_link" "$current_link"') &&
    atomicMigrationScript.includes('bash "$current_link/scripts/verify-split-host.sh"'),
  'atomic OTA migration script must create current/releases layout, rewrite systemd units, and verify the split host'
)

// 停在 pending、从未被 worker 认领的任务没有任何进程会推进它，但会被 hasRunningSystemUpdateTask()
// 一直算作占用，把之后所有更新与回滚挡成 409，而以前没有任何清理入口。回归要求：发起更新前回收
// 陈旧 pending；启动后用短轮询确认任务被认领，认领不了立即判失败并给出 unit 级原因与排查命令；
// 同时提供仅限超级管理员的取消入口（只允许取消 pending）。
assert.ok(
  route.includes('failStaleSystemUpdateTasks()') &&
    route.includes('system.update.stale_pending_released') &&
    route.includes('waitForTaskClaim(task.id)') &&
    route.includes('WORKER_CLAIM_TIMEOUT_MS') &&
    route.includes('describeUpdateUnitFailure(unitName)') &&
    route.includes('if (state.starting === false)') &&
    route.includes('cancelPendingSystemUpdateTask(task.id,') &&
    route.includes('await reconcileUnclaimedUpdate(claimed)') &&
    route.includes("'/usr/bin/systemctl'") &&
    route.includes('更新任务未在') &&
    route.includes("journalctl -u '${unitName}'") &&
    route.includes("'/tasks/:id/cancel'") &&
    route.includes('cancelPendingSystemUpdateTask(id') &&
    route.includes('TASK_NOT_CANCELLABLE') &&
    systemUpdateTasksDb.includes('export async function failStaleSystemUpdateTasks') &&
    systemUpdateTasksDb.includes('export async function cancelPendingSystemUpdateTask') &&
    systemUpdateTasksDb.includes("status: 'pending',") &&
    systemUpdateTasksDb.includes('startedAt: null') &&
    adminApi.includes('/admin/system-update/tasks/${id}/cancel') &&
    read('client/src/views/admin/SystemUpdateView.vue').includes('cancelTask') &&
    read('client/src/views/admin/SystemUpdateView.vue').includes("selectedTask?.status === 'pending'"),
  'a stuck pending update task must never block later updates: stale unclaimed pending tasks are released before starting, an unclaimed task is failed with unit-level detail instead of staying pending, and super admins can cancel a pending task'
)

assert.ok(runTask.includes('restoreSystemUpdateApplication(backupDir, installDir)') &&
  rollbackTask.includes('restoreSystemUpdateApplication(backupPath, installDir)'), 'automatic and manual rollback must use the same database-excluding restore')
for (const source of [runTask, rollbackTask]) {
  for (const line of source.split('\n').filter(line => line.includes('await cp('))) {
    assert.ok(line.includes('verbatimSymlinks: true'), 'backup and staging copies must retain sealed relative links')
  }
}
const fixture = await mkdtemp(join(tmpdir(), 'incudal-ota-copy-'))
try {
  const source = join(fixture, 'source'), backup = join(fixture, 'backup'), restored = join(fixture, 'restored')
  await mkdir(join(source, 'modules'), { recursive: true })
  await mkdir(join(source, 'store'))
  await mkdir(join(source, 'server'))
  await writeFile(join(source, 'store/library.js'), 'fixture dependency')
  await writeFile(join(source, '.env'), 'fixture runtime configuration')
  await ensureSystemUpdateEnvironmentDefaults(join(source, '.env'))
  assert.equal(await readFile(join(source, '.env'), 'utf8'), 'fixture runtime configuration\nPAYMENT_CALLBACK_SKIP_IP_WHITELIST=false\n')
  await ensureSystemUpdateEnvironmentDefaults(join(source, '.env'))
  assert.equal((await readFile(join(source, '.env'), 'utf8')).match(/PAYMENT_CALLBACK_SKIP_IP_WHITELIST/g)?.length, 1)
  await writeFile(join(source, '.env'), 'fixture runtime configuration\nPAYMENT_CALLBACK_SKIP_IP_WHITELIST=true\n')
  await ensureSystemUpdateEnvironmentDefaults(join(source, '.env'))
  assert.ok((await readFile(join(source, '.env'), 'utf8')).includes('PAYMENT_CALLBACK_SKIP_IP_WHITELIST=true'), 'unsafe explicit setting is not overwritten or hidden from readiness checks')
  await writeFile(join(source, '.env'), 'fixture runtime configuration')
  let links = true
  try { await symlink('../store/library.js', join(source, 'modules/library.js')) } catch (error) {
    if (process.platform !== 'win32' || (error as NodeJS.ErrnoException).code !== 'EPERM') throw error
    links = false
    console.log('Windows symlink privilege unavailable; Linux CI verifies literal link restoration')
  }
  await cp(source, backup, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true })
  const dump = 'db-pre-migrate-v1.7.2-20261025035150.sql'
  await writeFile(join(backup, dump), 'private database backup')
  await writeFile(join(backup, dump + '.tmp'), 'interrupted private backup')
  await writeFile(join(backup, 'server', dump), 'ordinary nested application file')
  await restoreSystemUpdateApplication(backup, restored)
  await assert.rejects(readFile(join(restored, dump)), { code: 'ENOENT' })
  await assert.rejects(readFile(join(restored, dump + '.tmp')), { code: 'ENOENT' })
  assert.equal(await readFile(join(backup, dump), 'utf8'), 'private database backup', 'original database backup remains retained')
  assert.equal(await readFile(join(restored, '.env'), 'utf8'), 'fixture runtime configuration')
  assert.equal(await readFile(join(restored, 'server', dump), 'utf8'), 'ordinary nested application file')
  if (links) {
    assert.equal(await readlink(join(restored, 'modules/library.js')), '../store/library.js', 'rollback must preserve the trusted manifest link text')
    await rm(source, { recursive: true })
    await rm(backup, { recursive: true })
    assert.equal(await readFile(join(restored, 'modules/library.js'), 'utf8'), 'fixture dependency', 'restored dependencies must work without staging or backup')
  }
} finally { await rm(fixture, { recursive: true, force: true }) }
const runtimeFixture = await mkdtemp(join(tmpdir(), 'incudal-bundled-runtime-'))
try {
  const bundle = join(runtimeFixture, 'bundle')
  await mkdir(join(bundle, 'server'), { recursive: true })
  await writeFile(join(bundle, 'server/package.json'), JSON.stringify({ dependencies: { fastify: '1.0.0' } }))
  await assert.rejects(assertBundledSystemUpdateRuntime(bundle), /missing bundled runtime dependency/)
  await mkdir(join(runtimeFixture, 'node_modules/fastify'), { recursive: true })
  await writeFile(join(runtimeFixture, 'node_modules/fastify/package.json'), '{"main":"index.js"}')
  await writeFile(join(runtimeFixture, 'node_modules/fastify/index.js'), 'throw new Error("must not execute during validation")')
  await assert.rejects(assertBundledSystemUpdateRuntime(bundle), /outside its release/, 'parent installation must never satisfy an incomplete artifact')
  await mkdir(join(bundle, 'node_modules/fastify'), { recursive: true })
  await writeFile(join(bundle, 'node_modules/fastify/package.json'), '{"main":"index.js"}')
  await writeFile(join(bundle, 'node_modules/fastify/index.js'), 'throw new Error("validation must not execute package code")')
  await assertBundledSystemUpdateRuntime(bundle)
  const prismaModule = join(bundle, 'server/node_modules/prisma')
  await mkdir(prismaModule, { recursive: true })
  await writeFile(join(prismaModule, 'package.json'), JSON.stringify({ bin: { prisma: 'cli.cjs' } }))
  await writeFile(join(prismaModule, 'cli.cjs'), 'if(require.main===module)process.stdout.write(JSON.stringify({args:process.argv.slice(2),fixture:process.env.OTA_CLI_TEST}))')
  let migrationOutput = ''
  await runBundledSystemUpdateMigrations(bundle, { env: { ...process.env, OTA_CLI_TEST: 'expected' },
    stdout: data => { migrationOutput += data }, stderr: () => {} })
  assert.deepEqual(JSON.parse(migrationOutput), { args: ['migrate', 'deploy'], fixture: 'expected' },
    'execute only the bundled Prisma CLI with fixed migration arguments and inherited connection environment')
  await writeFile(join(prismaModule, 'package.json'), JSON.stringify({ bin: { prisma: '../../../../node_modules/fastify/index.js' } }))
  await assert.rejects(runBundledSystemUpdateMigrations(bundle, { env: process.env, stdout: () => {}, stderr: () => {} }), /Command failed/)
  await mkdir(join(bundle, '.cache'), { recursive: true }); await writeFile(join(bundle, '.cache/tool'), 'mutable cache')
  await mkdir(join(bundle, '.incudal-update-downloads'), { recursive: true }); await writeFile(join(bundle, '.incudal-update-downloads/archive'), 'disposable archive')
  const snapshot = join(runtimeFixture, 'snapshot')
  await backupSystemUpdateApplication(bundle, snapshot)
  await assert.rejects(readFile(join(snapshot, '.cache/tool')), { code: 'ENOENT' })
  await assert.rejects(readFile(join(snapshot, '.incudal-update-downloads/archive')), { code: 'ENOENT' })
  assert.ok(await readFile(join(snapshot, 'server/package.json'), 'utf8'))
  assert.equal((await runSystemUpdateCommand(process.execPath, ['-e', 'process.stdout.write("checked")'], { cwd: runtimeFixture, env: process.env, capture: true, timeoutMs: 5000 })), 'checked')
  if (process.platform === 'linux') {
    const counter = join(runtimeFixture, 'child-write-count')
    const grandchild = `const fs=require('node:fs');process.on('SIGTERM',()=>{});fs.writeFileSync(${JSON.stringify(counter)},'start');setInterval(()=>fs.appendFileSync(${JSON.stringify(counter)},'x'),20)`
    const parent = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:'inherit'});process.on('SIGTERM',()=>{});setInterval(()=>{},1000)`
    await assert.rejects(runSystemUpdateCommand(process.execPath, ['-e', parent], { cwd: runtimeFixture, env: process.env, timeoutMs: 2000 }), /Command timed out/)
    const stopped = await readFile(counter, 'utf8')
    await new Promise(done => setTimeout(done, 250))
    assert.equal(await readFile(counter, 'utf8'), stopped, 'timed-out grandchildren must stop writing before rollback can run')
  } else console.log('Linux CI and native validation cover command process-group termination')
} finally { await rm(runtimeFixture, { recursive: true, force: true }) }
console.log('system update guards passed: trusted rollback, complete bundled runtime, bounded child lifecycle and pending observation')
