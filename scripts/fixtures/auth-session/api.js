export const pending = []
const request = (kind, data) => new Promise((resolve, reject) => pending.push({ kind, data, resolve, reject }))
export default { auth: { me: () => request('me'), login: (...data) => request('login', data), logout: () => request('logout') } }
