export const pending = []
const defer = (kind, data) => new Promise((resolve, reject) => pending.push({ kind, data, resolve, reject }))
export default {
  auth: { login: (username, password, totpCode, recoveryCode, turnstileToken) => defer('login', { username, password, totpCode, recoveryCode, turnstileToken }), logout: () => defer('logout'), me: async () => ({ user: { id: 1, username: 'isolated', role: 'user' } }) },
  systemConfig: { getPublic: async () => ({ turnstileEnabled: false, registrationEnabled: true }) },
  oauth: { getProviders: async () => ({ providers: [] }) },
}
