import { dirname, isAbsolute, join } from 'node:path'
import { acquireDiscoveryProcessLock, createFileDiscoveryRepository, createControllerDiscoveryServer, readDiscoveryPrivateFile } from '../services/controller-discovery.js'

// Explicit standalone entrypoint. It deliberately imports neither app.ts,
// dotenv, Prisma nor the platform backup scheduler. It grants no write lease.
async function main() {
  const path = process.argv[2]
  if (!path || !isAbsolute(path) || process.argv.length !== 3) throw new Error('configuration required')
  const raw = JSON.parse(await readDiscoveryPrivateFile(path, 16384)) as Record<string, unknown>
  const keys = ['schemaVersion', 'authority', 'listenHost', 'listenPort', 'stateDirectory', 'trustedConfigKeys']
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length !== keys.length || !keys.every(k => Object.hasOwn(raw, k)) ||
    raw.schemaVersion !== 1 || typeof raw.authority !== 'string' || raw.listenHost !== '127.0.0.1' || !Number.isInteger(raw.listenPort) ||
    Number(raw.listenPort) < 1024 || Number(raw.listenPort) > 65535 || typeof raw.stateDirectory !== 'string' || !isAbsolute(raw.stateDirectory) ||
    !raw.trustedConfigKeys || typeof raw.trustedConfigKeys !== 'object' || Array.isArray(raw.trustedConfigKeys)) throw new Error('configuration invalid')
  const directory = dirname(path)
  const tls = { key: await readDiscoveryPrivateFile(join(directory, 'tls.key'), 16384), cert: await readDiscoveryPrivateFile(join(directory, 'tls.crt'), 32768) }
  const repository = await createFileDiscoveryRepository(raw.stateDirectory)
  const server = createControllerDiscoveryServer(tls, { authority: raw.authority, trustedConfigKeys: raw.trustedConfigKeys as Record<string, string>, repository })
  const release = await acquireDiscoveryProcessLock(raw.stateDirectory)
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(Number(raw.listenPort), '127.0.0.1', resolve) })
  } catch (error) { await release(); throw error }
  const stop = () => { server.close(() => { void release().finally(() => process.exit(0)) }); server.closeAllConnections() }
  process.once('SIGTERM', stop); process.once('SIGINT', stop)
  process.stdout.write('Controller candidate discovery is listening; write authority is disabled.\n')
}
main().catch(() => { process.stderr.write('Controller discovery could not start. Check the protected configuration and state.\n'); process.exitCode = 1 })
