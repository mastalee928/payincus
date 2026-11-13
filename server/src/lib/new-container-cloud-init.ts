import { IncusApiError, type IncusClient } from './incus/incus-client.js'
import { execWithOutput } from './incus/incus-instances.js'
import { OWNER_DEBIAN11_IMAGES } from './owner-selected-images.js'

/** Only used between creating a brand-new container and its first start. */
export async function prepareNewContainerCloudInit(
  client: Pick<IncusClient, 'request'>,
  name: string,
  cloudInitConfig?: Record<string, string>,
  instanceType: 'container' | 'vm' = 'container'
): Promise<void> {
  if (instanceType !== 'container' || !cloudInitConfig ||
    !['cloud-init.user-data', 'user.user-data'].some(key => cloudInitConfig[key]?.trim())) return

  const image = await client.request<{ config?: Record<string, string> }>('GET', `/1.0/instances/${encodeURIComponent(name)}`)
  if (Object.values(OWNER_DEBIAN11_IMAGES).some(source => source.sha256 === image.config?.['image.user.payincus.source-sha256'])) {
    // Its first-boot installer owns this disable marker until cloud-init and
    // all prerequisites have been installed. Removing it here races apt.
    return
  }

  const path = `/1.0/instances/${encodeURIComponent(name)}/files?path=/etc/cloud/cloud-init.disabled`
  try {
    // Some published cloud images retain the build-time disable marker.
    // Never clean cloud-init state or rerun initialization on an existing disk.
    await client.request('DELETE', path)
  } catch (error) {
    if (!(error instanceof IncusApiError) || error.statusCode !== 404 || error.path !== path) throw error
  }
}

/** Only for a new disk carrying this generator's explicit completion marker. */
export async function waitForNewGuestInitialization(client: IncusClient, name: string, cloudInitConfig?: Record<string, string>): Promise<void> {
  if (!Object.values(cloudInitConfig || {}).some(value => value.includes('/var/lib/incudal/initialization-ready'))) return
  const deadline = Date.now() + 240000
  while (Date.now() < deadline) {
    try {
      const result = await execWithOutput(client, name, ['sh', '-c',
        'test -f /var/lib/incudal/initialization-ready && { test ! -x /usr/local/sbin/payincus-image-bootstrap || test -f /var/lib/incudal/image-bootstrap-complete; } && printf "INCUDAL_INITIALIZATION_READY"'], {}, Math.min(10000, deadline - Date.now()))
      if ((result.metadata as { return?: number } | null)?.return === 0 && result.stdout === 'INCUDAL_INITIALIZATION_READY') return
    } catch (error) {
      if (error instanceof Error && /no longer owns|cancelled|INSTANCE_(?:EXPIRED|BOOT_BLOCKED)/.test(error.message)) throw error
      // The Incus guest agent and package installation can still be starting.
      // Never rerun setup on a customer disk or expose command output.
    }
    await new Promise(resolve => setTimeout(resolve, 2000))
  }
  throw new Error('实例必要初始化尚未成功，开通保持未完成并进入自动清理重试')
}
