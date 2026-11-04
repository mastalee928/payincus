const catalog = { regions: [{ id: 10, name: 'E2 · 美国东部（阿什本）', countryCode: 'us', products: [
  { id: 20, resourcePreset: 'E2', cpu: 200, memoryMiB: 768, diskGiB: 30, monthlyPrice: 1000, setupFee: 100, idle: 4, total: 4 }
] }] }
export default { packages: { getPublicCatalog: async () => catalog } }
