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
