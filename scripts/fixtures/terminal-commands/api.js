export const pending = []
const defer = (kind, data) => new Promise((resolve, reject) => pending.push({ kind, data, resolve, reject }))
export default { terminalSavedCommands: { list: () => defer('list'), create: data => defer('create', data),
  update: (id, data) => defer('update', { id, ...data }), delete: id => defer('delete', { id }) } }
