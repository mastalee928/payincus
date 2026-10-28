export const pending = []
function request(kind, params, signal) {
  // Deliberately permit late responses after cancellation to verify callback fences.
  return new Promise((resolve, reject) => pending.push({ kind, params, signal, resolve, reject }))
}
export default { admin: {
  expiryEnforcementStatus: signal => request('status', undefined, signal),
  startExpiryEnforcement: () => request('start'),
  runExpiryEnforcement: () => request('run'),
  expiryEnforcementHistory: (params, signal) => request('history', params, signal),
} }
