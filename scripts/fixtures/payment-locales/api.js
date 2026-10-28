export const calls = []
export default { admin: {
  getPaymentProviders: async () => { calls.push('list'); return { providers: [] } },
  createPaymentProvider: async () => { calls.push('unexpected-create'); throw Error('No writes in locale fixture') },
  updatePaymentProvider: async () => { calls.push('unexpected-update'); throw Error('No writes in locale fixture') },
  deletePaymentProvider: async () => { calls.push('unexpected-delete'); throw Error('No writes in locale fixture') },
  updatePaymentProviderStatus: async () => { calls.push('unexpected-status'); throw Error('No writes in locale fixture') },
} }
