export const pending = []
const defer = (kind, data) => new Promise((resolve, reject) => pending.push({ kind, data, resolve, reject }))
export default {
  systemConfig: { list: () => defer('configs') },
  adminNotificationChannels: { list: () => defer('channels'), get: id => defer('channel', id) },
  telegram: { listBindings: data => defer('bindings', data) },
}
