export const pending = []
export default { auth: { getLoginHistory: data => new Promise((resolve, reject) => pending.push({ kind: 'list', data, resolve, reject })) } }
