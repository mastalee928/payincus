export const pending = []
const request = (kind, params, signal) => new Promise((resolve, reject) => pending.push({ kind, params, signal, resolve, reject }))
export default { entertainment: {
  getBadgeCatalog: async () => ({ series: [], badges: [] }),
  getBadgeOverview: signal => request('overview', undefined, signal),
  drawBadgeRandom: () => request('random'),
  drawBadgeRandomMulti: () => request('multi'),
  drawBadgeSelect: badgeId => request('select', { badgeId }),
  applyBadgeToAvatar: ownershipId => request('avatar', { ownershipId }),
  applyBadgeToInstance: (ownershipId, instanceId) => request('instance', { ownershipId, instanceId }),
  unapplyBadge: ownershipId => request('unapply', { ownershipId }),
} }
