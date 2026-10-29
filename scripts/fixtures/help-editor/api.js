export const pending = []
const defer = (kind, data) => new Promise((resolve, reject) => pending.push({ kind, data, resolve, reject }))
export default { help: {
  categoryConfig: async () => ({ categories: [{ id:'general',name:'General',color:'#6b7280' }] }),
  adminList: async () => ({ articles:[],total:0,totalPages:1 }),
  adminGet: id => defer('get', { id }),
  update: (id, data) => defer('update', { id, ...data }),
  create: data => defer('create', data),
} }
