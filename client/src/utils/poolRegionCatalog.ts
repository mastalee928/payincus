import type { PoolCatalogRegion } from './poolCatalog'

/** 展示目录沿用 ociee 的 45 个地理区域；不创建商品、价格或库存。 */
export const POOL_REGION_LOCATIONS = [
  { name: '美国东部（阿什本）', countryCode: 'us' },
  { name: '美国中西部（芝加哥）', countryCode: 'us' },
  { name: '美国西部（凤凰城）', countryCode: 'us' },
  { name: '美国西部（圣何塞）', countryCode: 'us' },
  { name: '加拿大东南部（蒙特利尔）', countryCode: 'ca' },
  { name: '加拿大东南部（多伦多）', countryCode: 'ca' },
  { name: '墨西哥中部（克雷塔罗）', countryCode: 'mx' },
  { name: '墨西哥东北部（蒙特雷）', countryCode: 'mx' },
  { name: '巴西东部（圣保罗）', countryCode: 'br' },
  { name: '巴西东南部（维涅杜）', countryCode: 'br' },
  { name: '智利中部（圣地亚哥）', countryCode: 'cl' },
  { name: '智利西部（瓦尔帕莱索）', countryCode: 'cl' },
  { name: '哥伦比亚中部（波哥大）', countryCode: 'co' },
  { name: '法国中部（巴黎）', countryCode: 'fr' },
  { name: '法国南部（马赛）', countryCode: 'fr' },
  { name: '德国中部（法兰克福）', countryCode: 'de' },
  { name: '意大利西北部（米兰）', countryCode: 'it' },
  { name: '意大利北部（都灵）', countryCode: 'it' },
  { name: '荷兰西北部（阿姆斯特丹）', countryCode: 'nl' },
  { name: '塞尔维亚中部（乔万诺瓦茨）', countryCode: 'rs' },
  { name: '西班牙中部（马德里）', countryCode: 'es' },
  { name: '西班牙中部 2（马德里）', countryCode: 'es' },
  { name: '瑞典中部（斯德哥尔摩）', countryCode: 'se' },
  { name: '瑞士北部（苏黎世）', countryCode: 'ch' },
  { name: '英国南部（伦敦）', countryCode: 'gb' },
  { name: '英国西部（纽波特）', countryCode: 'gb' },
  { name: '以色列中部（耶路撒冷）', countryCode: 'il' },
  { name: '摩洛哥西部（卡萨布兰卡）', countryCode: 'ma' },
  { name: '沙特阿拉伯西部（吉达）', countryCode: 'sa' },
  { name: '沙特阿拉伯中部（利雅得）', countryCode: 'sa' },
  { name: '南非中部（约翰内斯堡）', countryCode: 'za' },
  { name: '阿联酋东部（迪拜）', countryCode: 'ae' },
  { name: '阿联酋中部（阿布扎比）', countryCode: 'ae' },
  { name: '澳大利亚东部（悉尼）', countryCode: 'au' },
  { name: '澳大利亚东南部（墨尔本）', countryCode: 'au' },
  { name: '印度西部（孟买）', countryCode: 'in' },
  { name: '印度南部（海得拉巴）', countryCode: 'in' },
  { name: '印度尼西亚北部（巴淡）', countryCode: 'id' },
  { name: '日本东部（东京）', countryCode: 'jp' },
  { name: '日本中部（大阪）', countryCode: 'jp' },
  { name: '马来西亚西部（古来）', countryCode: 'my' },
  { name: '新加坡（新加坡）', countryCode: 'sg' },
  { name: '新加坡西部（新加坡）', countryCode: 'sg' },
  { name: '韩国中部（首尔）', countryCode: 'kr' },
  { name: '韩国北部（春川）', countryCode: 'kr' }
] as const

export interface PoolPurchaseRegion {
  key: string
  name: string
  countryCode: string | null
  /** 保留原目录分组及商品编号；E2 / ARM 只在展示层归入同一个地理区域。 */
  regions: PoolCatalogRegion[]
}

const normalize = (value: string) => value.normalize('NFKC').replace(/\s+/g, '').toLowerCase()

export function buildPoolPurchaseRegions(catalog: PoolCatalogRegion[]): PoolPurchaseRegion[] {
  const result: PoolPurchaseRegion[] = POOL_REGION_LOCATIONS.map(location => ({
    ...location, key: `location:${location.countryCode}:${location.name}`, regions: []
  }))
  for (const region of catalog) {
    const countryCode = region.countryCode?.trim().toLowerCase() ?? null
    // API 名称为「机型分组 · 地区」。兼容旧目录的城市短名与「国家 · 城市」。
    const name = normalize(region.name.replace(/^[^·]+·\s*/, ''))
    const candidates = result.filter(entry => entry.key.startsWith('location:') && entry.countryCode === countryCode)
    let location = candidates.find(entry => normalize(entry.name) === name)
    if (!location) {
      const tokens = name.split(/[·()]/).filter(Boolean)
      const cityMatches = candidates.filter(entry => tokens.includes(normalize(entry.name).match(/\(([^()]+)\)$/)?.[1] ?? ''))
      // 马德里、新加坡有两个区域；短名有歧义时不能把价格、库存归到猜测的位置。
      if (cityMatches.length === 1) location = cityMatches[0]
    }
    if (location) location.regions.push(region)
    else result.push({ key: `custom:${region.id}`, name: region.name, countryCode, regions: [region] })
  }
  return result
}

export function poolPurchaseRegionStock(region: PoolPurchaseRegion): number {
  return region.regions.reduce((sum, group) => sum + group.products.reduce((stock, product) => stock + product.idle, 0), 0)
}
