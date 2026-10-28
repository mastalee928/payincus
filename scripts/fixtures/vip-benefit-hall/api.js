export const pending = []
const request = (kind, params, signal) => new Promise((resolve, reject) => {
  const entry = { kind, params, resolve, reject, aborted: false }
  signal?.addEventListener('abort', () => { entry.aborted = true }, { once: true })
  pending.push(entry)
})
export default { vipBenefits: {
  getMyOverview: signal => request('overview', undefined, signal),
  claim: id => request('claim', { id }),
  claimAll: () => request('claimAll')
} }
