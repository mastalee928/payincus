import type { PoolCatalogRegion } from './poolCatalog'

/** 展示目录沿用 ociee 的 45 个地理区域；不创建商品、价格或库存。 */
export const POOL_REGION_LOCATIONS = [
  { name: '美国东部（阿什本）', nameEn: 'US East (Ashburn)', nameZhTW: '美國東部（阿什本）', countryCode: 'us' },
  { name: '美国中西部（芝加哥）', nameEn: 'US Midwest (Chicago)', nameZhTW: '美國中西部（芝加哥）', countryCode: 'us' },
  { name: '美国西部（凤凰城）', nameEn: 'US West (Phoenix)', nameZhTW: '美國西部（鳳凰城）', countryCode: 'us' },
  { name: '美国西部（圣何塞）', nameEn: 'US West (San Jose)', nameZhTW: '美國西部（聖荷西）', countryCode: 'us' },
  { name: '加拿大东南部（蒙特利尔）', nameEn: 'Canada Southeast (Montreal)', nameZhTW: '加拿大東南部（蒙特婁）', countryCode: 'ca' },
  { name: '加拿大东南部（多伦多）', nameEn: 'Canada Southeast (Toronto)', nameZhTW: '加拿大東南部（多倫多）', countryCode: 'ca' },
  { name: '墨西哥中部（克雷塔罗）', nameEn: 'Mexico Central (Querétaro)', nameZhTW: '墨西哥中部（克雷塔羅）', countryCode: 'mx' },
  { name: '墨西哥东北部（蒙特雷）', nameEn: 'Mexico Northeast (Monterrey)', nameZhTW: '墨西哥東北部（蒙特雷）', countryCode: 'mx' },
  { name: '巴西东部（圣保罗）', nameEn: 'Brazil East (São Paulo)', nameZhTW: '巴西東部（聖保羅）', countryCode: 'br' },
  { name: '巴西东南部（维涅杜）', nameEn: 'Brazil Southeast (Vinhedo)', nameZhTW: '巴西東南部（維涅杜）', countryCode: 'br' },
  { name: '智利中部（圣地亚哥）', nameEn: 'Chile Central (Santiago)', nameZhTW: '智利中部（聖地牙哥）', countryCode: 'cl' },
  { name: '智利西部（瓦尔帕莱索）', nameEn: 'Chile West (Valparaiso)', nameZhTW: '智利西部（瓦爾帕萊索）', countryCode: 'cl' },
  { name: '哥伦比亚中部（波哥大）', nameEn: 'Colombia Central (Bogota)', nameZhTW: '哥倫比亞中部（波哥大）', countryCode: 'co' },
  { name: '法国中部（巴黎）', nameEn: 'France Central (Paris)', nameZhTW: '法國中部（巴黎）', countryCode: 'fr' },
  { name: '法国南部（马赛）', nameEn: 'France South (Marseille)', nameZhTW: '法國南部（馬賽）', countryCode: 'fr' },
  { name: '德国中部（法兰克福）', nameEn: 'Germany Central (Frankfurt)', nameZhTW: '德國中部（法蘭克福）', countryCode: 'de' },
  { name: '意大利西北部（米兰）', nameEn: 'Italy Northwest (Milan)', nameZhTW: '義大利西北部（米蘭）', countryCode: 'it' },
  { name: '意大利北部（都灵）', nameEn: 'Italy North (Turin)', nameZhTW: '義大利北部（都靈）', countryCode: 'it' },
  { name: '荷兰西北部（阿姆斯特丹）', nameEn: 'Netherlands Northwest (Amsterdam)', nameZhTW: '荷蘭西北部（阿姆斯特丹）', countryCode: 'nl' },
  { name: '塞尔维亚中部（乔万诺瓦茨）', nameEn: 'Serbia Central (Jovanovac)', nameZhTW: '塞爾維亞中部（喬萬諾瓦茨）', countryCode: 'rs' },
  { name: '西班牙中部（马德里）', nameEn: 'Spain Central (Madrid)', nameZhTW: '西班牙中部（馬德里）', countryCode: 'es' },
  { name: '西班牙中部 2（马德里）', nameEn: 'Spain Central 2 (Madrid)', nameZhTW: '西班牙中部 2（馬德里）', countryCode: 'es' },
  { name: '瑞典中部（斯德哥尔摩）', nameEn: 'Sweden Central (Stockholm)', nameZhTW: '瑞典中部（斯德哥爾摩）', countryCode: 'se' },
  { name: '瑞士北部（苏黎世）', nameEn: 'Switzerland North (Zurich)', nameZhTW: '瑞士北部（蘇黎世）', countryCode: 'ch' },
  { name: '英国南部（伦敦）', nameEn: 'UK South (London)', nameZhTW: '英國南部（倫敦）', countryCode: 'gb' },
  { name: '英国西部（纽波特）', nameEn: 'UK West (Newport)', nameZhTW: '英國西部（紐波特）', countryCode: 'gb' },
  { name: '以色列中部（耶路撒冷）', nameEn: 'Israel Central (Jerusalem)', nameZhTW: '以色列中部（耶路撒冷）', countryCode: 'il' },
  { name: '摩洛哥西部（卡萨布兰卡）', nameEn: 'Morocco West (Casablanca)', nameZhTW: '摩洛哥西部（卡薩布蘭卡）', countryCode: 'ma' },
  { name: '沙特阿拉伯西部（吉达）', nameEn: 'Saudi Arabia West (Jeddah)', nameZhTW: '沙烏地阿拉伯西部（吉達）', countryCode: 'sa' },
  { name: '沙特阿拉伯中部（利雅得）', nameEn: 'Saudi Arabia Central (Riyadh)', nameZhTW: '沙烏地阿拉伯中部（利雅德）', countryCode: 'sa' },
  { name: '南非中部（约翰内斯堡）', nameEn: 'South Africa Central (Johannesburg)', nameZhTW: '南非中部（約翰尼斯堡）', countryCode: 'za' },
  { name: '阿联酋东部（迪拜）', nameEn: 'UAE East (Dubai)', nameZhTW: '阿聯酋東部（杜拜）', countryCode: 'ae' },
  { name: '阿联酋中部（阿布扎比）', nameEn: 'UAE Central (Abu Dhabi)', nameZhTW: '阿聯酋中部（阿布達比）', countryCode: 'ae' },
  { name: '澳大利亚东部（悉尼）', nameEn: 'Australia East (Sydney)', nameZhTW: '澳洲東部（雪梨）', countryCode: 'au' },
  { name: '澳大利亚东南部（墨尔本）', nameEn: 'Australia Southeast (Melbourne)', nameZhTW: '澳洲東南部（墨爾本）', countryCode: 'au' },
  { name: '印度西部（孟买）', nameEn: 'India West (Mumbai)', nameZhTW: '印度西部（孟買）', countryCode: 'in' },
  { name: '印度南部（海得拉巴）', nameEn: 'India South (Hyderabad)', nameZhTW: '印度南部（海德拉巴）', countryCode: 'in' },
  { name: '印度尼西亚北部（巴淡）', nameEn: 'Indonesia North (Batam)', nameZhTW: '印尼北部（巴淡）', countryCode: 'id' },
  { name: '日本东部（东京）', nameEn: 'Japan East (Tokyo)', nameZhTW: '日本東部（東京）', countryCode: 'jp' },
  { name: '日本中部（大阪）', nameEn: 'Japan Central (Osaka)', nameZhTW: '日本中部（大阪）', countryCode: 'jp' },
  { name: '马来西亚西部（古来）', nameEn: 'Malaysia West (Kulai)', nameZhTW: '馬來西亞西部（古來）', countryCode: 'my' },
  { name: '新加坡（新加坡）', nameEn: 'Singapore (Singapore)', nameZhTW: '新加坡（新加坡）', countryCode: 'sg' },
  { name: '新加坡西部（新加坡）', nameEn: 'Singapore West (Singapore)', nameZhTW: '新加坡西部（新加坡）', countryCode: 'sg' },
  { name: '韩国中部（首尔）', nameEn: 'South Korea Central (Seoul)', nameZhTW: '韓國中部（首爾）', countryCode: 'kr' },
  { name: '韩国北部（春川）', nameEn: 'South Korea North (Chuncheon)', nameZhTW: '韓國北部（春川）', countryCode: 'kr' }
] as const

export interface PoolPurchaseRegion {
  key: string
  name: string
  /** 静态目录的多语言展示名；目录外的自定义条目缺失这两个字段，展示时回退 name。 */
  nameEn?: string
  nameZhTW?: string
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

/** 区域展示名按当前语言取：en 用英文名、zh-TW 用繁中名，缺失（目录外条目）回退中文原名。 */
export function poolRegionLocalizedName(region: { name: string; nameEn?: string; nameZhTW?: string }, locale: string): string {
  if (locale === 'en') return region.nameEn ?? region.name
  if (locale === 'zh-TW') return region.nameZhTW ?? region.name
  return region.name
}

/** 搜索匹配：三种语言的名称都参与匹配，任何语言下都能按任意语言的输入找到区域。 */
export function poolRegionMatchesSearch(region: { name: string; nameEn?: string; nameZhTW?: string }, query: string): boolean {
  const q = query.toLocaleLowerCase()
  return [region.name, region.nameEn, region.nameZhTW].some(name => !!name && name.toLocaleLowerCase().includes(q))
}

/** 把服务端「机型分组 · 地区」「国家 · 城市」等原名映射为目录展示名并本地化（三种语言都映射，中文以目录规范名展示）；目录外名称原样返回。匹配复用 buildPoolPurchaseRegions。 */
export function localizePoolRegionName(regionName: string, countryCode: string | null | undefined, locale: string): string {
  const located = buildPoolPurchaseRegions([{ id: -1, name: regionName, countryCode: countryCode?.trim().toLowerCase() ?? null, products: [] }])
    .find(entry => entry.regions.some(region => region.id === -1))
  return located ? poolRegionLocalizedName(located, locale) : regionName
}
