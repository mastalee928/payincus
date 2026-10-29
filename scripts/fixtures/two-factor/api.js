export const pending = []
const defer = (kind, data) => new Promise((resolve, reject) => pending.push({ kind, data, resolve, reject }))
export default { auth: {
  get2FAStatus: () => defer('status'),
  getRecoveryCodes: () => defer('codes-status'),
  setup2FA: () => defer('setup'),
  enable2FA: code => defer('enable', { code }),
  disable2FA: (password, code) => defer('disable', { password, code }),
  regenerateRecoveryCodes: (password, code) => defer('regenerate', { password, code }),
} }
