export const pending = []
const catalog = () => new Promise((resolve, reject) => pending.push({ resolve, reject }))
export default { entertainment: { getBadgeCatalog: catalog, adminGetBadgeCatalog: catalog } }
