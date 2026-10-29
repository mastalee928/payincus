export const pending = []
const defer = (kind, id) => new Promise((resolve, reject) => pending.push({ kind, id, resolve, reject }))
export default {
  auth: { async me() { return { user: { id: 1, username: 'isolated-ui', role: 'user' } } } },
  entertainment: {
    getPoints: () => defer('points'), getLotteries: () => defer('lotteries'),
    draw: id => defer('draw', id), drawMulti: id => defer('multi', id),
    getLotteryRecords: () => defer('records'), getPointsLogs: () => defer('logs'),
  },
}
