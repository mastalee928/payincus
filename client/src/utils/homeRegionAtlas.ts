import geography from './home-region-geography.json'
import { buildPoolPurchaseRegions, poolPurchaseRegionStock, type PoolPurchaseRegion } from './poolRegionCatalog'
import { continentOf } from './countryContinent'
import type { PoolCatalogProduct, PoolCatalogRegion } from './poolCatalog'

export type AtlasGeography = typeof geography[number]
export type AtlasProduct = PoolCatalogProduct & { regionId: number }
export interface AtlasRegion extends PoolPurchaseRegion {
  geography: AtlasGeography | null
  slug: string
  stock: number
  products: AtlasProduct[]
  status: 'available' | 'sold-out' | 'unlisted'
  continent: string
  displayX: number | null
  displayY: number | null
}

/** Display geography never supplies products or invents availability. Original group/product IDs survive. */
export function buildAtlasRegions(catalog: PoolCatalogRegion[]): AtlasRegion[] {
  return buildPoolPurchaseRegions(catalog).map(location => {
    const point = geography.find(entry => entry.name === location.name && entry.countryCode === location.countryCode) ?? null
    const products = location.regions.flatMap(group => group.products.map(product => ({ ...product, regionId: group.id })))
      .sort((a, b) => Number(b.idle > 0) - Number(a.idle > 0) || a.monthlyPrice - b.monthlyPrice || a.id - b.id)
    const stock = poolPurchaseRegionStock(location)
    // Same-city regions get a small presentation-only separation. The geographic coordinates remain unchanged.
    const siblings = point ? geography.filter(entry => entry.geonameId === point.geonameId) : []
    const separation = siblings.length > 1 ? (siblings.findIndex(entry => entry.slug === point?.slug) - (siblings.length - 1) / 2) * 12 : 0
    return { ...location, geography: point, slug: point?.slug ?? `platform-region-${location.regions[0]?.id}`,
      displayX: point ? point.x + separation : null, displayY: point ? point.y + separation * 0.4 : null,
      stock, products, continent: continentOf(location.countryCode),
      status: stock > 0 ? 'available' : products.length ? 'sold-out' : 'unlisted' }
  })
}

export function atlasPurchaseTarget(product: AtlasProduct) {
  return { path: '/purchase', query: { region: String(product.regionId), product: String(product.id) } }
}

/** Homepage selects a location; the existing purchase page owns configuration selection. */
export function atlasRegionPurchaseTarget(region: AtlasRegion) {
  const group = region.regions.find(entry => entry.products.some(product => product.idle > 0)) ?? region.regions[0]
  return group ? { path: '/purchase', query: { region: String(group.id) } } : { path: '/purchase' }
}

export function atlasRegionFromQuery(regions: AtlasRegion[], query: string | null): AtlasRegion | undefined {
  if (!query) return undefined
  const aliases: Record<string, string> = { 'us-east': 'us-ashburn-1', 'us-west': 'us-sanjose-1', frankfurt: 'eu-frankfurt-1' }
  return regions.find(region => region.slug === (aliases[query] ?? query) || region.regions.some(group => String(group.id) === query))
}
