import { createPrivateKey } from 'node:crypto'
import { isIP } from 'node:net'
import { isAbsolute } from 'node:path'
import { readDiscoveryPrivateFile } from '../services/controller-discovery.js'
import { acquireControllerWitnessServiceLock, createControllerWitnessServer, initializeControllerWitness,
  openControllerWitnessService, type WitnessClient, type WitnessEnrollment } from '../services/controller-witness-service.js'

// Explicit standalone authority; imports no business backend, database,
// platform backup or dotenv. Initialization must be deliberately requested.
async function main() {
  const mode = process.argv[2], path = process.argv[3]
  if (!['--initialize', '--serve'].includes(mode) || !path || !isAbsolute(path) || process.argv.length !== 4) throw new Error('configuration required')
  const rawText = await readDiscoveryPrivateFile(path, 65536)
  const config = JSON.parse(rawText) as Record<string, unknown>
  const fields = ['schemaVersion', 'authority', 'listenHost', 'listenPort', 'stateDirectory', 'enrollment',
    'signingKey', 'tlsKey', 'tlsCertificate', 'clientCA', 'clients', 'initialCandidates']
  if (!config || typeof config !== 'object' || Array.isArray(config) || rawText !== JSON.stringify(config) || Object.keys(config).length !== fields.length ||
    !fields.every(field => Object.hasOwn(config, field)) || config.schemaVersion !== 1 || typeof config.authority !== 'string' ||
    typeof config.listenHost !== 'string' || !isIP(config.listenHost) || ['0.0.0.0', '::'].includes(config.listenHost) ||
    !Number.isInteger(config.listenPort) || Number(config.listenPort) < 1024 || Number(config.listenPort) > 65535 ||
    typeof config.stateDirectory !== 'string' || !isAbsolute(config.stateDirectory) || !config.enrollment || !config.clients ||
    !config.initialCandidates) throw new Error('configuration invalid')
  for (const field of ['signingKey', 'tlsKey', 'tlsCertificate', 'clientCA']) {
    if (typeof config[field] !== 'string' || !isAbsolute(config[field])) throw new Error('protected path required')
  }
  const signingKey = createPrivateKey(await readDiscoveryPrivateFile(config.signingKey as string, 16384))
  if (mode === '--initialize') {
    await initializeControllerWitness(config.stateDirectory, config.enrollment as WitnessEnrollment, signingKey,
      config.initialCandidates as Record<string, string>)
    process.stdout.write('Witness authority initialized; no host writer has been activated.\n')
    return
  }
  const service = await openControllerWitnessService(config.stateDirectory, config.enrollment as WitnessEnrollment, signingKey)
  const server = createControllerWitnessServer({ key: await readDiscoveryPrivateFile(config.tlsKey as string, 16384),
    cert: await readDiscoveryPrivateFile(config.tlsCertificate as string, 32768), ca: await readDiscoveryPrivateFile(config.clientCA as string, 32768),
    requestCert: true, rejectUnauthorized: true }, service, config.clients as Record<string, WitnessClient>, config.authority)
  const release = await acquireControllerWitnessServiceLock(config.stateDirectory)
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(Number(config.listenPort), config.listenHost as string, resolve) })
  } catch (error) { await release(); throw error }
  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    server.close(() => { void release().finally(() => process.exit(0)) })
    server.closeAllConnections()
  }
  process.once('SIGTERM', stop); process.once('SIGINT', stop)
  process.stdout.write('Independent witness is listening; signed host fencing is required for activation.\n')
}
main().catch(() => { process.stderr.write('Witness could not start; check protected enrollment, identity and persistent authority state.\n'); process.exitCode = 1 })
