export const pending = []
const defer = (kind, data) => new Promise((resolve, reject) => pending.push({ kind, data, resolve, reject }))
export default {
  billing: { getPackagePlans: id => defer('plans', { id }), getUserBalance: () => defer('balance'),
    getChangePlanPreview: (id, planId) => defer('preview', { id, planId }), changePlan: (id, planId) => defer('change', { id, planId }) },
}
