export const pending = []
const defer = (kind, data) => new Promise((resolve, reject) => pending.push({ kind, data, resolve, reject }))
export default { sshKeys: { list: () => defer('list'), create: data => defer('create', data), delete: id => defer('delete', { id }), generate: () => defer('generate') } }
