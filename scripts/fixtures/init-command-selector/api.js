export const pending = []
export default {
  auth: { async me() { return { user: { id: 1, username: 'isolated-ui', role: 'user' } } } },
  initCommands: {
    getAvailable(distro, signal) {
      // Deliberately deliver late results even after abort: exercise the response guard itself.
      return new Promise((resolve, reject) => pending.push({ distro, signal, resolve, reject }))
    },
  },
}
