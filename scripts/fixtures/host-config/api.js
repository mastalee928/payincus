export const pending = []
export default { hosts: { update: (id, data) => new Promise((resolve, reject) => pending.push({ id, data, resolve, reject })) } }
