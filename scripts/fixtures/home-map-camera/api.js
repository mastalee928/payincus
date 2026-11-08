import geography from '@/utils/home-region-geography.json'

// Local inventory fixture only. The actual map still owns grouping, filtering and purchase URLs.
const codes = new Set(['us-ashburn-1', 'uk-london-1', 'ap-seoul-1', 'ap-sydney-1'])
const catalog = { regions: geography.map((region, index) => ({ id: 100 + index, name: 'E2 · ' + region.name, countryCode: region.countryCode,
  products: [{ id: 200 + index, resourcePreset: 'E2', cpu: 200, memoryMiB: 768, diskGiB: 30, monthlyPrice: 1000, setupFee: 0, idle: codes.has(region.code) ? 3 : 0, total: 3 }] })) }
let release, failNext = false
export const fixture = {
  hold() { return new Promise(resolve => { release = resolve }) },
  pending: null,
  delay() { this.pending = this.hold() },
  release() { const resolve = release; release = null; this.pending = null; resolve?.() },
  fail() { failNext = true },
  catalog
}
export default { packages: { getPublicCatalog: async () => {
  if (fixture.pending) await fixture.pending
  if (failNext) { failNext = false; throw new Error('local fixture unavailable') }
  return structuredClone(catalog)
} } }
