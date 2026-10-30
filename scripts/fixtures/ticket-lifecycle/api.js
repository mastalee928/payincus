export const pending = [], calls = []
export const controls = { list: false, pending: false }
const defer = (kind, id, data) => new Promise((resolve, reject) => pending.push({ kind, id, data, resolve, reject }))
const list = data => { calls.push('list'); return controls.list ? defer('list', null, data) : Promise.resolve({ tickets: [], total: 0 }) }
export default {
  systemConfig: { async getPublic() { return {} } },
  tickets: {
    list, getMyHostTickets: list,
    getPendingCount: () => { calls.push('pending'); return controls.pending ? defer('pending') : Promise.resolve({ userTickets: 0, hostTickets: 0, total: 0, isHostOwner: false }) },
    get: id => defer('detail', id), getMessages: (id, data) => defer('messages', id, data),
    getSupportContext: id => defer('support', id),
    getAttachmentContent: id => defer('attachment', id),
    reply: (id, content, attachments) => defer('reply', id, { content, files: attachments.map(file => file.name) }),
  },
  instances: { list: params => defer('instances', null, params) },
}
