export const pending = []
const defer = (id, kind = 'list', name, data) => new Promise((resolve, reject) => pending.push({ id, kind, name, data, resolve, reject }))
export default { hosts: {
  getStoragePools: id => defer(id),
  createStoragePool: (id, data) => defer(id, 'create', data.name, data),
  updateStoragePool: (id, name, data) => defer(id, 'edit', name, data),
  deleteStoragePool: (id, name) => defer(id, 'delete', name),
} }
