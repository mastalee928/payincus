export { formatPublicPrice, parsePackageIdQuery } from './publicCatalog'

export interface PoolCatalogProduct {
  id: number
  resourcePreset: string
  diskGiB: number
  monthlyPrice: number
  setupFee: number
  cpu: number
  memoryMiB: number
  /** 空闲台数（与分配器同一套就绪判据）。0 = 该档位无货，界面灰掉但保留展示。 */
  idle: number
  total: number
}

export interface PoolCatalogRegion {
  id: number
  name: string
  countryCode: string | null
  products: PoolCatalogProduct[]
}

/**
 * 池子的系统架构。
 * 客户不能指定机器，所以镜像必须由机型决定：E2 是 x86，ARM 各核心是 aarch64。
 */
export function architectureOfPreset(preset: string): 'x86_64' | 'aarch64' {
  return preset.startsWith('ARM') ? 'aarch64' : 'x86_64'
}

/** 机型展示名：E2 保持原样，ARM 显示核心数（ARM2C → ARM 2C）。 */
export function presetLabel(preset: string): string {
  const matched = /^ARM(\d)C$/.exec(preset)
  return matched ? `ARM ${matched[1]}C` : preset
}

/** 机型族：E2 与 ARM 是两级选择（选 ARM 再分核心数）。 */
export function presetFamily(preset: string): 'E2' | 'ARM' {
  return preset.startsWith('ARM') ? 'ARM' : 'E2'
}

/** ARM 的核心数（ARM2C → 2）；E2 返回 null。 */
export function presetCores(preset: string): number | null {
  const matched = /^ARM(\d)C$/.exec(preset)
  return matched ? Number(matched[1]) : null
}

/** 由族与核心数还原预设串：E2 → 'E2'，ARM + 2 → 'ARM2C'。 */
export function presetOf(family: 'E2' | 'ARM', cores: number | null): string {
  return family === 'E2' ? 'E2' : `ARM${cores ?? 1}C`
}

/** 内存展示：MiB → GiB（整数或一位小数）。 */
export function formatMemoryMiB(mib: number): string {
  if (mib >= 1024) return `${(mib / 1024).toFixed(mib % 1024 === 0 ? 0 : 1)} GiB`
  return `${mib} MiB`
}

/** 多台时的实例名：一台就是前缀本身，多台「前缀-01」起编号。与服务端生成规则一致。 */
export function buildPoolInstanceNames(prefix: string, quantity: number): string[] {
  const count = Math.max(1, Math.floor(quantity))
  if (count === 1) return [prefix]
  const width = Math.max(2, String(count).length)
  return Array.from({ length: count }, (_, index) => `${prefix}-${String(index + 1).padStart(width, '0')}`)
}

/** OCI 机型名（客户可见，中英均显示该英文）：E2 → VM.Standard.E2.1.Micro；ARM → VM.Standard.A1.Flex。取不到规格时返回 null。 */
export function ociMachineShape(resourcePreset?: string | null, architecture?: string | null): string | null {
  const preset = resourcePreset || ''
  if (preset.startsWith('ARM') || architecture === 'aarch64') return 'VM.Standard.A1.Flex'
  if (preset === 'E2' || architecture === 'x86_64') return 'VM.Standard.E2.1.Micro'
  return null
}
