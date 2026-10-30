export const calls = []
export default {
  oauth: {
    getConfigs: async () => ({ configs: [{ provider: 'github', clientId: 'display-only-client', clientSecretMasked: 'masked', enabled: true }] }),
    updateConfig: async (provider, payload) => { calls.push({ provider, payload }); return { message: 'fixture saved' } },
  },
  oauthApps: {
    listScopes: async () => ({ scopes: [] }),
    list: async () => ({ apps: [] }),
    listAuthorizations: async () => ({ authorizations: [], total: 0, totalPages: 1 }),
  },
}
