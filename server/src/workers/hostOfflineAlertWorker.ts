/**
 * 宿主机离线告警 worker
 *
 * 心跳间隔 60 秒；连续 3 分钟（3 个周期）没有心跳视为离线：
 *   - 离线迁移：hostAgent.status online -> offline（带 lastSeenAt 条件做乐观锁，心跳竞态安全），
 *     同时记录 adminOfflineAlertedAt 并向「宿主机」告警 Bot 推送一次。
 *   - 恢复通知：心跳回来后（lastSeenAt 新鲜）若 adminOfflineAlertedAt 非空，
 *     清空标记并推送一次恢复通知。
 * 只监控 enabled=true 的 agent（装过 agent 并至少上报过一次心跳的节点）。
 */

import { prisma } from '../db/prisma.js'
import { notifyAdminHostOffline, notifyAdminHostRecovered } from '../lib/admin-alerts.js'

const HOST_OFFLINE_ALERT_AFTER_MS = 3 * 60 * 1000
const HOST_RECOVERY_FRESH_MS = 90 * 1000
const HOST_OFFLINE_SCAN_INTERVAL_MS = 60 * 1000

let timer: ReturnType<typeof setInterval> | undefined
let ticking = false
let stopped = true

function ownerLabelOf(owner: { username: string; role: string } | null | undefined): string {
  if (!owner) return '未知归属'
  return owner.role === 'admin' ? '官方节点' : `托管主：${owner.username}`
}

async function countHostInstances(hostId: number): Promise<number> {
  try {
    return await prisma.instance.count({ where: { hostId, status: { not: 'deleted' } } })
  } catch {
    return 0
  }
}

async function scanOfflineAgents(): Promise<void> {
  const now = new Date()
  const staleBefore = new Date(now.getTime() - HOST_OFFLINE_ALERT_AFTER_MS)
  const staleAgents = await prisma.hostAgent.findMany({
    where: {
      enabled: true,
      status: 'online',
      lastSeenAt: { not: null, lt: staleBefore }
    },
    include: {
      host: {
        select: {
          id: true,
          name: true,
          user: { select: { username: true, role: true } }
        }
      }
    }
  })

  for (const agent of staleAgents) {
    const claimed = await prisma.hostAgent.updateMany({
      where: {
        id: agent.id,
        status: 'online',
        lastSeenAt: { lt: staleBefore }
      },
      data: {
        status: 'offline',
        adminOfflineAlertedAt: now
      }
    })
    if (claimed.count !== 1) continue

    const instanceCount = await countHostInstances(agent.hostId)
    console.log(`[HostOfflineAlert] 节点 ${agent.host.name} 离线（最后心跳 ${agent.lastSeenAt?.toISOString() ?? 'unknown'}）`)
    void notifyAdminHostOffline({
      hostName: agent.host.name,
      ownerLabel: ownerLabelOf(agent.host.user),
      lastSeenAt: agent.lastSeenAt,
      instanceCount
    }).catch(err => console.warn('[HostOfflineAlert] 离线告警发送失败:', err))
  }
}

async function scanRecoveredAgents(): Promise<void> {
  const now = new Date()
  const freshAfter = new Date(now.getTime() - HOST_RECOVERY_FRESH_MS)
  const recoveredAgents = await prisma.hostAgent.findMany({
    where: {
      adminOfflineAlertedAt: { not: null },
      lastSeenAt: { gte: freshAfter }
    },
    include: {
      host: {
        select: {
          id: true,
          name: true,
          user: { select: { username: true, role: true } }
        }
      }
    }
  })

  for (const agent of recoveredAgents) {
    const downSince = agent.adminOfflineAlertedAt
    const claimed = await prisma.hostAgent.updateMany({
      where: { id: agent.id, adminOfflineAlertedAt: { not: null } },
      data: { adminOfflineAlertedAt: null }
    })
    if (claimed.count !== 1) continue

    const instanceCount = await countHostInstances(agent.hostId)
    console.log(`[HostOfflineAlert] 节点 ${agent.host.name} 心跳恢复`)
    void notifyAdminHostRecovered({
      hostName: agent.host.name,
      ownerLabel: ownerLabelOf(agent.host.user),
      downSince,
      instanceCount
    }).catch(err => console.warn('[HostOfflineAlert] 恢复通知发送失败:', err))
  }
}

async function tick(): Promise<void> {
  if (stopped || ticking) return
  ticking = true
  try {
    await scanOfflineAgents()
  } catch (err) {
    console.error('[HostOfflineAlert] 离线扫描失败:', err)
  }
  try {
    await scanRecoveredAgents()
  } catch (err) {
    console.error('[HostOfflineAlert] 恢复扫描失败:', err)
  } finally {
    ticking = false
  }
}

export function startHostOfflineAlertWorker(): void {
  if (!stopped) return
  stopped = false
  timer = setInterval(() => { void tick() }, HOST_OFFLINE_SCAN_INTERVAL_MS)
  void tick()
  console.log('[HostOfflineAlert] Worker started (scan every 60s, offline after 3min without heartbeat)')
}

export function stopHostOfflineAlertWorker(): void {
  stopped = true
  if (timer) {
    clearInterval(timer)
    timer = undefined
  }
}
