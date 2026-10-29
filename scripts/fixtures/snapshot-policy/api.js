export const pending = []
const defer = (kind, id, data) => new Promise((resolve, reject) => pending.push({ kind, id, data, resolve, reject }))
export default { instances: {
  getSnapshots: id => defer('snapshots', id), getSnapshotPolicy: id => defer('policy', id),
  updateSnapshotPolicy: (id, data) => defer('update', id, data),
  createSnapshot: (id, data) => defer('create', id, data),
  deleteSnapshot: (id, snapshotId) => defer('delete', id, { snapshotId }),
  restoreSnapshot: (id, snapshotId) => defer('restore', id, { snapshotId }),
  retrySnapshotOperation: (id, operationId) => defer('retry', id, { operationId }),
} }
