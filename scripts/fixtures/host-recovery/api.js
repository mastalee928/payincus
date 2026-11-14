export const reads = [], writes = []
export default { hostOnboarding: {
  inspectRecovery: hostId => new Promise((resolve, reject) => reads.push({ hostId, resolve, reject })),
  checkRecoveryNow: hostId => new Promise((resolve, reject) => writes.push({ hostId, resolve, reject })),
} }
