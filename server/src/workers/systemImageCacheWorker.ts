import { prisma } from '../db/prisma.js'
import { recoveryHeld } from '../services/platform-backup-core.js'
import { cacheSystemImage } from '../services/system-image-cache.js'
import { officialImageAvailable } from '../lib/official-image-availability.js'

let timer: ReturnType<typeof setInterval> | undefined
let active: Promise<void> | undefined
let stopped = true
let controller: AbortController | undefined
let cursor = 0
const delays = new Map<string, number>()
async function prepareNext() {
  if (stopped || recoveryHeld()) return
  const images = await prisma.systemImage.findMany({ where: { remoteAlias: { startsWith: 'images:' } }, orderBy: { id: 'asc' } })
  const targets = images.flatMap(image => (image.instanceType === 'both' ? ['container', 'vm'] : [image.instanceType])
    .map(type => ({ image, type: type as 'container' | 'vm' })))
  if (!targets.length) return
  for (let i = 0; i < targets.length; i++) {
    const target = targets[cursor++ % targets.length], key = `${target.image.id}:${target.type}`
    if ((delays.get(key) || 0) > Date.now()) continue
    try {
      if (await officialImageAvailable(target.image.remoteAlias, target.image.architecture, target.type) === false) {
        delays.set(key, Date.now() + 6 * 60 * 60000); continue
      }
      await cacheSystemImage(target.image.remoteAlias, target.image.architecture, target.type, controller?.signal)
      delays.set(key, Date.now() + 24 * 60 * 60000)
      console.log(`[SystemImageCache] 镜像 #${target.image.id} (${target.type}) 已校验并持久保存`)
    } catch (error) {
      delays.set(key, Date.now() + 5 * 60000)
      console.warn(`[SystemImageCache] 镜像 #${target.image.id} (${target.type}) 等待自动补齐:`, error instanceof Error ? error.message : 'verification failed')
    }
    return // One bounded download at a time, independent of billing workers.
  }
}
export function startSystemImageCacheWorker() {
  if (timer) return
  stopped = false
  const tick = () => {
    if (active || stopped) return
    controller = new AbortController()
    active = prepareNext().catch(error => console.warn('[SystemImageCache] 目录检查待重试:', error instanceof Error ? error.message : 'failed'))
      .finally(() => { active = undefined; controller = undefined })
  }
  timer = setInterval(tick, 15000); tick()
}
export async function stopSystemImageCacheWorker() {
  stopped = true
  if (timer) clearInterval(timer)
  timer = undefined
  controller?.abort(Error('SYSTEM_IMAGE_WORKER_STOPPED'))
  await active
}
