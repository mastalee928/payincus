export const pending = []
export default { logs: { list: params => new Promise((resolve, reject) => pending.push({ params, resolve, reject })) } }
