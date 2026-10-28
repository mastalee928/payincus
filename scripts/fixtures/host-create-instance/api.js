export const pending = []
const request = (kind, params) => new Promise((resolve, reject) => pending.push({ kind, params: JSON.parse(JSON.stringify(params ?? {})), resolve, reject }))
export default {
  auth: { me: () => request('me') },
  packages: { list: () => request('packages'), getPlans: id => request('plans', { id }) },
  sshKeys: { list: () => request('keys') },
  images: { getSystemImages: (type, memory, hostId) => request('images', { type, memory, hostId }) },
  hosts: { lookupGiftTargetUser: (hostId, username) => request('lookup', { hostId, username }), createInstanceForUser: (hostId, data) => request('gift', { hostId, data }) },
  instances: { create: data => request('self', { data }) },
  initCommands: { getAvailable: async () => ({ commands: [] }) }
}
