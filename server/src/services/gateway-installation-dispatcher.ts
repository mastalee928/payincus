import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { prisma } from '../db/prisma.js'
import { GatewayTaskError } from '../lib/gateway-task-plan.js'
import { expireGatewayInstallationTasks } from './gateway-task-journal.js'

const exec = promisify(execFile), attempts = new Map<string, number>()
let dispatching = false
export function gatewayInstallationExecutorAvailable() {
  return process.platform === 'linux' && existsSync('/etc/systemd/system/incudal-gateway-task@.service') && existsSync('/usr/local/libexec/incudal/systemctl')
}
export async function launchGatewayInstallationTask(id: string) {
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id)) throw new GatewayTaskError('GATEWAY_INSTALLATION_INVALID')
  if (!gatewayInstallationExecutorAvailable()) throw new GatewayTaskError('GATEWAY_INSTALL_EXECUTOR_UNAVAILABLE')
  try {
    await exec('/usr/bin/sudo', ['-n', '/usr/local/libexec/incudal/systemctl', 'start', '--no-block', `incudal-gateway-task@${id}.service`],
      { timeout: 10000, maxBuffer: 4096, env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin' } })
    attempts.set(id, Date.now())
  } catch { throw new GatewayTaskError('GATEWAY_INSTALL_EXECUTOR_UNAVAILABLE') }
}
export async function dispatchGatewayInstallationTasks() {
  if (dispatching) return
  dispatching = true
  try {
    await expireGatewayInstallationTasks()
    if (!gatewayInstallationExecutorAvailable()) return
    const tasks = await prisma.managementGatewayTask.findMany({ where: { kind: 'install', OR: [
      { status: 'awaiting_confirmation', preparationState: 'queued' }, { status: 'queued', preparationState: 'ready' }
    ] }, orderBy: { createdAt: 'asc' }, take: 8, select: { id: true } })
    const pending = new Set(tasks.map(task => task.id))
    for (const id of attempts.keys()) if (!pending.has(id)) attempts.delete(id)
    for (const task of tasks) if (Date.now() - (attempts.get(task.id) || 0) >= 15000) {
      await launchGatewayInstallationTask(task.id).catch(() => {})
    }
  } finally { dispatching = false }
}
export function startGatewayInstallationDispatcher() {
  const run = () => { void dispatchGatewayInstallationTasks().catch(() => {}) }
  const timer = setInterval(run, 15000); timer.unref(); run()
  return () => clearInterval(timer)
}
