export const pending = []
const defer = (kind, data) => new Promise((resolve, reject) => pending.push({ kind, data, resolve, reject }))
export default { telegram: { getBinding: () => defer('read'), createBindToken: () => defer('generate'), unlink: () => defer('unlink'), setNotification: enabled => defer('notify', { enabled }) } }
