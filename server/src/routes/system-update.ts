import { execFile, spawn } from 'child_process'
import { mkdir, readFile } from 'fs/promises'
import { join, resolve, sep } from 'path'
import { promisify } from 'util'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  cancelPendingSystemUpdateTask,
  createSystemUpdateTask,
  failStaleSystemUpdateTasks,
  getSystemUpdateTask,
  hasRunningSystemUpdateTask,
  listSystemUpdateTasks,
  markSystemUpdateTaskFinished,
  serializeSystemUpdateTask
} from '../db/system-update-tasks.js'
import { createLog, LogModule, LogResult } from '../db/logs.js'
import {
  canApplyUpdate,
  checkForUpdates,
  getCurrentVersionMetadata,
  getProjectRoot,
  isValidReleaseTag
} from '../lib/system-version.js'
import { getCombinedAdminIdAllowlist } from '../lib/runtime-settings.js'

interface StartUpdateBody {
  targetVersion: string
}

interface TaskParams {
  id: string
}

const execFileAsync = promisify(execFile)

function getRequestUser(request: FastifyRequest): { id: number; username: string; role: 'admin' | 'user' } {
  return request.user as { id: number; username: string; role: 'admin' | 'user' }
}

function parsePositiveId(value: string): number | null {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

async function canManageSystemUpdates(user: { id: number; username: string; role: 'admin' | 'user' }): Promise<boolean> {
  if (user.role !== 'admin') return false
  const { ids: allowedIds } = await getCombinedAdminIdAllowlist(
    'system_update_allowed_admin_ids',
    'SYSTEM_UPDATE_ALLOWED_ADMIN_IDS'
  )
  if (allowedIds.size > 0) {
    return allowedIds.has(user.id)
  }
  return user.username === 'admin'
}

function getLogDir(root: string): string {
  return resolve(process.env.SYSTEM_UPDATE_LOG_DIR || join(root, 'update-logs'))
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

// systemd oneshot 用 --no-block 启动，unit 自身的失败不会回传到 API；而 helper 在拉起 worker
// 之前就会做可信清单与 Git 校验，失败时 worker 永不执行，任务只会留在 pending。这里在启动后
// 用短轮询确认任务是否被 worker 认领，认领不了就立刻判失败，避免留下永久 pending 记录。
const WORKER_CLAIM_TIMEOUT_MS = 24000
const WORKER_CLAIM_POLL_MS = 2000

async function waitForTaskClaim(taskId: number, timeoutMs = WORKER_CLAIM_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs
  let task = await getSystemUpdateTask(taskId)
  while (task && task.status === 'pending' && Date.now() < deadline) {
    await sleep(WORKER_CLAIM_POLL_MS)
    task = await getSystemUpdateTask(taskId)
  }
  return task
}

// 只读取 unit 属性：服务用户无权读 journal（不在 systemd-journal 组），但 systemctl show 允许。
// 必须用绝对路径 /usr/bin/systemctl —— 后端服务的 PATH 把受控 wrapper 放在最前，wrapper 只接受
// start --no-block <unit>，用 'systemctl' 会命中 wrapper 而报错。
async function describeUpdateUnitFailure(unitName: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      '/usr/bin/systemctl',
      ['show', unitName, '-p', 'ActiveState', '-p', 'SubState', '-p', 'Result', '-p', 'ExecMainStatus'],
      { timeout: 10000 }
    )
    const props: Record<string, string> = {}
    for (const line of stdout.split(/\r?\n/)) {
      const separator = line.indexOf('=')
      if (separator > 0) props[line.slice(0, separator).trim()] = line.slice(separator + 1).trim()
    }
    return `unit ${props.ActiveState || 'unknown'}/${props.SubState || 'unknown'}，Result=${props.Result || 'unknown'}，ExecMainStatus=${props.ExecMainStatus || 'unknown'}`
  } catch (error) {
    return `无法读取 unit 状态：${error instanceof Error ? error.message : String(error)}`
  }
}

function spawnUpdater(scriptName: string, args: string[], logPath: string): void {
  const root = getProjectRoot()
  const scriptPath = process.env.NODE_ENV === 'production'
    ? `server/dist/scripts/${scriptName.replace(/\.ts$/, '.js')}`
    : `server/src/scripts/${scriptName}`
  const nodeArgs = scriptPath.endsWith('.ts')
    ? ['--import', 'tsx', scriptPath, ...args]
    : [scriptPath, ...args]
  const child = spawn(process.execPath, nodeArgs, {
    cwd: root,
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    env: {
      ...process.env,
      INCUDAL_APP_DIR: root,
      SYSTEM_UPDATE_LOG_PATH: logPath,
      SYSTEM_UPDATE_LOG_DIR: getLogDir(root)
    }
  })
  child.unref()
}

async function startSystemUpdateWorker(mode: 'update' | 'rollback', taskId: number, scriptName: string, args: string[], logPath: string): Promise<void> {
  if (process.platform === 'linux' && process.env.NODE_ENV === 'production' && process.env.SYSTEM_UPDATE_USE_SYSTEMD !== 'false') {
    const unitName = mode === 'rollback'
      ? `incudal-online-rollback@${taskId}.service`
      : `incudal-online-update@${taskId}.service`
    await execFileAsync('sudo', ['-n', 'systemctl', 'start', '--no-block', unitName], {
      cwd: getProjectRoot(),
      timeout: 30000
    })
    return
  }

  spawnUpdater(scriptName, args, logPath)
}

async function requireUpdateManager(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const user = getRequestUser(request)
  if (!(await canManageSystemUpdates(user))) {
    await createLog(
      user.id,
      LogModule.SYSTEM,
      'system.update.denied',
      `Denied system update access for ${user.username}`,
      LogResult.WARNING
    )
    reply.code(403).send({ error: 'Super administrator privileges required', code: 'SUPER_ADMIN_REQUIRED' })
    return false
  }
  return true
}

export default async function systemUpdateRoutes(fastify: FastifyInstance) {
  fastify.get('/version', {
    onRequest: [fastify.authenticateAdmin]
  }, async (_request: FastifyRequest) => {
    return { version: await getCurrentVersionMetadata() }
  })

  fastify.get('/check', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request: FastifyRequest) => {
    const result = await checkForUpdates()
    return {
      ...result,
      canManageUpdates: await canManageSystemUpdates(getRequestUser(request))
    }
  })

  fastify.get('/tasks', {
    onRequest: [fastify.authenticateAdmin]
  }, async (_request: FastifyRequest) => {
    const tasks = await listSystemUpdateTasks(30)
    return { tasks: tasks.map(serializeSystemUpdateTask) }
  })

  fastify.get<{ Params: TaskParams }>('/tasks/:id', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request: FastifyRequest<{ Params: TaskParams }>, reply: FastifyReply) => {
    const id = parsePositiveId(request.params.id)
    if (!id) return reply.code(400).send({ error: 'Invalid task id', code: 'INVALID_TASK_ID' })
    const task = await getSystemUpdateTask(id)
    if (!task) return reply.code(404).send({ error: 'Task not found', code: 'TASK_NOT_FOUND' })
    return { task: serializeSystemUpdateTask(task) }
  })

  fastify.get<{ Params: TaskParams }>('/tasks/:id/logs', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request: FastifyRequest<{ Params: TaskParams }>, reply: FastifyReply) => {
    // 更新日志含命令输出/路径，仅限可管理更新的超级管理员读取（与 /start、/rollback 一致）
    if (!(await requireUpdateManager(request, reply))) return
    const id = parsePositiveId(request.params.id)
    if (!id) return reply.code(400).send({ error: 'Invalid task id', code: 'INVALID_TASK_ID' })
    const task = await getSystemUpdateTask(id)
    if (!task) return reply.code(404).send({ error: 'Task not found', code: 'TASK_NOT_FOUND' })
    if (!task.logPath) return { logs: '' }

    const root = getProjectRoot()
    const logDir = getLogDir(root)
    const logPath = resolve(task.logPath)
    if (logPath !== logDir && !logPath.startsWith(`${logDir}${sep}`)) {
      return reply.code(403).send({ error: 'Log path is outside update log directory', code: 'LOG_PATH_FORBIDDEN' })
    }

    try {
      const logs = await readFile(logPath, 'utf8')
      return { logs: logs.slice(-200000) }
    } catch {
      return { logs: '' }
    }
  })

  fastify.post<{ Body: StartUpdateBody }>('/start', {
    onRequest: [fastify.authenticateAdmin],
    schema: {
      body: {
        type: 'object',
        required: ['targetVersion'],
        additionalProperties: false,
        properties: {
          targetVersion: { type: 'string', minLength: 5, maxLength: 64 }
        }
      }
    }
  }, async (request: FastifyRequest<{ Body: StartUpdateBody }>, reply: FastifyReply) => {
    if (!(await requireUpdateManager(request, reply))) return
    const targetVersion = request.body.targetVersion.trim()
    if (!isValidReleaseTag(targetVersion)) {
      return reply.code(400).send({ error: 'Target version must be a release tag like v1.2.3', code: 'INVALID_TARGET_VERSION' })
    }
    // artifact 模式（下载 release 包 + 校验 sha256 + 原子发布）不需要 Git；只有在目标版本
    // 拿不到本机可用 artifact、必须回退到「源码构建」时才真的需要 Git 工作区。
    if (!(await canApplyUpdate(targetVersion))) {
      return reply.code(409).send({
        error: 'No usable OTA artifact for this platform and the deployment directory is not a Git working tree',
        code: 'GIT_REPOSITORY_REQUIRED'
      })
    }
    // 先回收「从未启动」的陈旧 pending 记录，否则它们会被下面这行当成占用，永久挡住更新与回滚。
    const releasedStaleTasks = await failStaleSystemUpdateTasks()
    if (releasedStaleTasks > 0) {
      await createLog(
        getRequestUser(request).id,
        LogModule.SYSTEM,
        'system.update.stale_pending_released',
        `Released ${releasedStaleTasks} stale pending system update task(s)`,
        LogResult.WARNING
      )
    }
    if (await hasRunningSystemUpdateTask()) {
      return reply.code(409).send({ error: 'Another update task is already running', code: 'UPDATE_TASK_RUNNING' })
    }

    const user = getRequestUser(request)
    const root = getProjectRoot()
    const logDir = getLogDir(root)
    await mkdir(logDir, { recursive: true })

    const current = await getCurrentVersionMetadata(root)
    const task = await createSystemUpdateTask({
      targetVersion,
      fromVersion: current.version,
      startedByUserId: user.id,
      logPath: join(logDir, `system-update-pending-${Date.now()}.log`)
    })
    const logPath = join(logDir, `system-update-${task.id}.log`)

    await createLog(
      user.id,
      LogModule.SYSTEM,
      'system.update.start',
      `Started system update from ${current.version} to ${targetVersion}`,
      LogResult.SUCCESS
    )
    try {
      await startSystemUpdateWorker('update', task.id, 'run-system-update-task.ts', [String(task.id), targetVersion], logPath)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await markSystemUpdateTaskFinished(task.id, {
        status: 'failed',
        errorMessage: `Failed to start system update worker: ${message}`,
        backupPath: null
      })
      return reply.code(500).send({ error: 'Failed to start system update worker', code: 'UPDATE_WORKER_START_FAILED' })
    }

    const claimed = await waitForTaskClaim(task.id)
    if (claimed && claimed.status === 'pending') {
      const unitName = `incudal-online-update@${task.id}.service`
      const detail = await describeUpdateUnitFailure(unitName)
      await markSystemUpdateTaskFinished(task.id, {
        status: 'failed',
        errorMessage: `更新任务未在 ${Math.round(WORKER_CLAIM_TIMEOUT_MS / 1000)} 秒内启动（${detail}）。常见原因：受保护文件被手工替换后未重新 seal，或 Git 元数据不符。排查命令：journalctl -u '${unitName}'`,
        backupPath: null
      })
    }
    const finalTask = await getSystemUpdateTask(task.id)
    return reply.code(202).send({ task: serializeSystemUpdateTask(finalTask ?? { ...task, logPath }) })
  })

  fastify.post<{ Params: TaskParams }>('/tasks/:id/rollback', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request: FastifyRequest<{ Params: TaskParams }>, reply: FastifyReply) => {
    if (!(await requireUpdateManager(request, reply))) return
    const id = parsePositiveId(request.params.id)
    if (!id) return reply.code(400).send({ error: 'Invalid task id', code: 'INVALID_TASK_ID' })
    const task = await getSystemUpdateTask(id)
    if (!task) return reply.code(404).send({ error: 'Task not found', code: 'TASK_NOT_FOUND' })
    if (!task.backupPath) return reply.code(400).send({ error: 'Task has no backup path', code: 'BACKUP_MISSING' })
    if (await hasRunningSystemUpdateTask()) {
      return reply.code(409).send({ error: 'Another update task is already running', code: 'UPDATE_TASK_RUNNING' })
    }

    const user = getRequestUser(request)
    const root = getProjectRoot()
    const logDir = getLogDir(root)
    await mkdir(logDir, { recursive: true })
    const logPath = join(logDir, `system-update-${id}-rollback.log`)
    await createLog(
      user.id,
      LogModule.SYSTEM,
      'system.update.rollback',
      `Started rollback for system update task #${id}`,
      LogResult.WARNING
    )
    try {
      await startSystemUpdateWorker('rollback', id, 'rollback-system-update-task.ts', [String(id)], logPath)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await markSystemUpdateTaskFinished(id, {
        status: 'failed',
        errorMessage: `Failed to start rollback worker: ${message}`,
        backupPath: task.backupPath
      })
      return reply.code(500).send({ error: 'Failed to start rollback worker', code: 'ROLLBACK_WORKER_START_FAILED' })
    }
    return reply.code(202).send({ taskId: id, logPath })
  })

  // 清理从未启动的 pending 任务：这种记录没有任何进程会推进它，却会把后续更新与回滚全部挡成 409。
  // 只允许取消 pending（未认领）任务；running 的任务由 worker 自己收尾，不做中途取消。
  fastify.post<{ Params: TaskParams }>('/tasks/:id/cancel', {
    onRequest: [fastify.authenticateAdmin]
  }, async (request: FastifyRequest<{ Params: TaskParams }>, reply: FastifyReply) => {
    if (!(await requireUpdateManager(request, reply))) return
    const id = parsePositiveId(request.params.id)
    if (!id) return reply.code(400).send({ error: 'Invalid task id', code: 'INVALID_TASK_ID' })
    const task = await getSystemUpdateTask(id)
    if (!task) return reply.code(404).send({ error: 'Task not found', code: 'TASK_NOT_FOUND' })

    const cancelled = await cancelPendingSystemUpdateTask(id, '已由管理员取消：任务从未启动')
    if (!cancelled) {
      return reply.code(409).send({ error: 'Only a pending update task can be cancelled', code: 'TASK_NOT_CANCELLABLE' })
    }

    const user = getRequestUser(request)
    await createLog(
      user.id,
      LogModule.SYSTEM,
      'system.update.cancel',
      `Cancelled pending system update task #${id}`,
      LogResult.WARNING
    )
    const updated = await getSystemUpdateTask(id)
    return reply.code(200).send({ task: serializeSystemUpdateTask(updated ?? task) })
  })
}
