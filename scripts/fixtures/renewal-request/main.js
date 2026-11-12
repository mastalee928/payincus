import { postRenewal } from '../../../client/src/api/renewal-request.ts'
const requests = [], results = [], errors = []
const session = id => localStorage.setItem('token', 'fixture.' + btoa(JSON.stringify({ id, sid: 'test' })) + '.fixture')
session(1)
const http = { post: (url, body, options) => new Promise((resolve, reject) => requests.push({ url, body, options, resolve, reject })) }
window.renewalHarness = { requests, results, errors, session, months: 1, expectedAmount: 10,
  send() { postRenewal(http, '/instances/1/renew', { months: this.months, expectedAmount: this.expectedAmount }).then(v => results.push(v)).catch(e => errors.push(e.message)) },
  batch() { postRenewal(http, '/instances/batch/renew', { months: 1, instanceIds: [1, 2], expectedAmounts: { 1: 10, 2: 20 } }).then(v => results.push(v)).catch(e => errors.push(e.message)) }
}
document.querySelector('#renew').onclick = () => window.renewalHarness.send()
