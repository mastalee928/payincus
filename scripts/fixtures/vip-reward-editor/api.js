export const pending = []
const request = (kind, params) => new Promise((resolve, reject) => pending.push({ kind, params: params === undefined ? undefined : JSON.parse(JSON.stringify(params)), resolve, reject }))
export default { admin: {
  getVipLevelRules: type => request('rules', { type }),
  updateVipLevelRules: (type, rules, options) => request('saveRules', { type, rules, options }),
  getVipBenefitRewards: () => request('rewards'),
  createVipBenefitReward: data => request('create', { data }),
  updateVipBenefitReward: (id, data) => request('update', { id, data }),
  deleteVipBenefitReward: id => request('delete', { id })
}, packages: { list: () => request('packages'), getPlans: id => request('plans', { id }) } }
