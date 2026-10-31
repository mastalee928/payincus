export const requests = []
const defer = (kind, data) => new Promise((resolve, reject) => requests.push({ kind, data, resolve, reject }))
export default { admin: {
  getLatePayments: data => defer('list', data),
  resolveLatePayment: (id, action, note) => defer('resolve', { id, action, note })
} }
