import { IncusApiError, type IncusClient } from './incus/incus-client.js'

/** Only used between creating a brand-new container and its first start. */
export async function prepareNewContainerCloudInit(
  client: Pick<IncusClient, 'request'>,
  name: string,
  cloudInitConfig?: Record<string, string>,
  instanceType: 'container' | 'vm' = 'container'
): Promise<void> {
  if (instanceType !== 'container' || !cloudInitConfig ||
    !['cloud-init.user-data', 'user.user-data'].some(key => cloudInitConfig[key]?.trim())) return

  const path = `/1.0/instances/${encodeURIComponent(name)}/files?path=/etc/cloud/cloud-init.disabled`
  try {
    // Some published cloud images retain the build-time disable marker.
    // Never clean cloud-init state or rerun initialization on an existing disk.
    await client.request('DELETE', path)
  } catch (error) {
    if (!(error instanceof IncusApiError) || error.statusCode !== 404 || error.path !== path) throw error
  }
}
