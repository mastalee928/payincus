const byId = id => document.getElementById(id)
let csrf = '', session = null
const blockers = {
  'legacy-credential-audit-required': '旧管理凭据尚未完成隔离核验',
  'local-process-audit-required': '本地管理任务尚未完成核验',
  'host-write-service-not-ready': '宿主写权限门禁尚未就绪',
  'backup-not-configured': '独立灾备尚未配置'
}
async function api(path, body) {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Gateway-CSRF': csrf },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const data = await response.json()
  if (!response.ok) { const error = new Error(response.status === 429 ? '请求过于频繁，请稍后重试。' : response.status === 503 ? '暂时无法核验网关状态，请重新检查。' : '认证未通过，请检查账号、密码与验证码。'); error.status = response.status; throw error }
  return data
}
function loggedOut() {
  session = null; csrf = ''; byId('console-view').hidden = true; byId('login-view').hidden = false
  byId('password').value = ''; byId('totp').value = ''; byId('recovery-code').value = ''
}
function authenticated(value) {
  session = value; csrf = value.csrf; byId('login-view').hidden = true; byId('console-view').hidden = false
  byId('password').value = ''; byId('totp').value = ''; byId('recovery-code').value = ''
}
async function refresh() {
  const button = byId('refresh'); button.disabled = true; byId('console-view').setAttribute('aria-busy', 'true')
  byId('console-error').textContent = ''
  try {
    const state = await api('/api/status')
    byId('gateway-summary').textContent = state.transportReady ? '管理传输已配置，接管条件另行核验。' : '管理传输尚未通过核验。'
    byId('slot').textContent = state.slot.toUpperCase(); byId('generation').textContent = `${state.configurationEpoch} / ${state.configurationSequence}`
    byId('address').textContent = state.address; byId('version').textContent = state.componentVersion; byId('identity').textContent = state.gatewayId
    byId('write-state').textContent = state.canWrite ? '当前具备受限控制权' : '当前只读'
    byId('blockers').replaceChildren(...state.blockers.map(code => { const item = document.createElement('li'); item.textContent = blockers[code] || code; return item }))
    byId('node-count').textContent = `${state.peers.length} 个节点`
    const items = state.peers.map(peer => {
      const row = document.createElement('li'); row.className = 'node'
      const name = document.createElement('span'); name.className = 'node-name'; name.textContent = peer.nodeId
      const address = document.createElement('span'); address.className = 'node-value'; address.textContent = peer.address
      const status = document.createElement('span'); status.className = 'node-value node-state'
      const recent = peer.lastHandshakeAt > 0 && Date.now() / 1000 - peer.lastHandshakeAt <= 180
      status.textContent = !peer.enabled ? '已撤销' : recent ? '近期握手' : '等待握手'; if (peer.enabled && recent) status.classList.add('online')
      row.append(name, address, status); return row
    })
    if (!items.length) { const item = document.createElement('li'); item.className = 'muted'; item.textContent = '此网关尚未登记节点。'; items.push(item) }
    byId('nodes').replaceChildren(...items)
    byId('backup-status').textContent = state.backup.ready ? (state.backup.lastCompletedAt ? `最近完成：${new Date(state.backup.lastCompletedAt).toLocaleString()}` : '尚无已完成备份。') : '独立备份尚未就绪。'
    byId('updated').textContent = `检查于 ${new Date().toLocaleTimeString()}`
  } catch (error) {
    if (error.status === 401) { loggedOut(); byId('login-error').textContent = '登录已失效，请重新认证。'; byId('username').focus() }
    else { byId('console-error').textContent = error.message; byId('gateway-summary').textContent = '本次检查失败，以下为上次检查结果。' }
  }
  finally { button.disabled = false; byId('console-view').removeAttribute('aria-busy') }
}
byId('login-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = byId('login-submit'); button.disabled = true; button.textContent = '正在认证'
  byId('login-form').setAttribute('aria-busy', 'true'); byId('login-error').textContent = ''
  for (const id of ['username', 'password', 'totp', 'recovery-code']) byId(id).removeAttribute('aria-invalid')
  try {
    const data = { username: byId('username').value, password: byId('password').value }
    if (byId('recovery-fields').hidden) data.totp = byId('totp').value; else data.recoveryCode = byId('recovery-code').value
    authenticated(await api('/api/login', data)); byId('refresh').focus(); await refresh()
  } catch (error) {
    byId('login-error').textContent = error.message
    byId('password').setAttribute('aria-invalid', 'true'); byId('password').setAttribute('aria-describedby', 'login-error')
  } finally { button.disabled = false; button.textContent = '登录网关'; byId('login-form').removeAttribute('aria-busy') }
})
byId('recovery-toggle').addEventListener('click', () => {
  const show = byId('recovery-fields').hidden; byId('recovery-fields').hidden = !show; byId('recovery-toggle').setAttribute('aria-expanded', String(show))
  byId('recovery-toggle').textContent = show ? '使用验证器' : '使用恢复码'; byId('totp').required = !show; byId('totp').disabled = show; byId('recovery-code').required = show
  byId(show ? 'recovery-code' : 'totp').focus()
})
byId('refresh').addEventListener('click', refresh)
byId('logout').addEventListener('click', async () => { try { await api('/api/logout', {}); loggedOut(); byId('username').focus() } catch (error) { byId('console-error').textContent = error.message } })
byId('theme').addEventListener('click', () => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' })
api('/api/session').then(value => { authenticated(value); return refresh() }).catch(loggedOut)
