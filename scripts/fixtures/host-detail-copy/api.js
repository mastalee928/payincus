export const pending = []
export default { hosts: { get: id => new Promise((resolve, reject) => pending.push({ id, resolve, reject })) } }
