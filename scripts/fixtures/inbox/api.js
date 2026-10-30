export const pending = []
const request = (kind, data) => new Promise((resolve, reject) => pending.push({ kind, data, resolve, reject }))
export default { inbox: { list: data => request('list', data), markAsRead: id => request('read', { id }),
  markAllAsRead: () => request('readAll'), delete: id => request('delete', { id }), deleteRead: () => request('deleteRead'),
  getUnreadCount: () => request('unread') } }
