/**
 * Incus 镜像读取（重装属性同步）
 */

import type { IncusClient } from './incus-client.js'
import type { IncusImage, IncusImageAlias } from '../../types/incus.js'

/** 获取镜像详情 */
export async function getImage(client: IncusClient, fingerprint: string): Promise<IncusImage> {
  return client.request<IncusImage>('GET', `/1.0/images/${fingerprint}`)
}

/** 获取镜像别名详情 */
export async function getImageAlias(client: IncusClient, aliasName: string): Promise<IncusImageAlias> {
  return client.request<IncusImageAlias>('GET', `/1.0/images/aliases/${aliasName}`)
}
