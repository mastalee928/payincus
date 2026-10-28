export const pending = []
const request = (kind, params) => new Promise((resolve, reject) => pending.push({ kind, params: JSON.parse(JSON.stringify(params ?? {})), resolve, reject }))
export default {
  packages: { list: async () => ({ packages: [] }) },
  admin: { lookupUser: username => request('lookup', { username }) },
  hostPools: { catalog: () => request('catalog'), createForUser: data => request('create', data) },
  images: { getSystemImages: type => request('images', { type }) }
}
