export const pending = []
const request = (kind, params) => new Promise((resolve, reject) => pending.push({ kind, params, resolve, reject }))
export default { giftCards: Object.fromEntries(['list', 'stats', 'generate', 'batch', 'enable', 'disable', 'delete', 'batchDisable', 'batchDelete'].map(kind => [kind, params => request(kind, params)])) }
