import { isIP } from 'node:net'
import { isAbsolute } from 'node:path'
import { acquireDiscoveryProcessLock, readDiscoveryPrivateFile } from '../services/controller-discovery.js'
import { createGatewayAuth, initializeGatewayAuth, type GatewayRole } from '../services/gateway-auth.js'
import { createGatewayConsoleServer } from '../services/gateway-console.js'
import { createGatewayStatusReader } from '../services/gateway-status.js'

// Explicit independent console; no app.ts, Prisma, dotenv or business workers.
async function main() {
  const mode = process.argv[2], path = process.argv[3]
  if (!['--initialize', '--serve'].includes(mode) || !path || !isAbsolute(path) || process.argv.length !== 4) throw new Error('usage')
  const raw = await readDiscoveryPrivateFile(path, 32768), config = JSON.parse(raw) as Record<string, unknown>
  const fields = ['schemaVersion', 'origin', 'listenHost', 'listenPort', 'authDirectory', 'assetDirectory', 'tlsKey', 'tlsCertificate', 'transport', 'initialUser']
  if (!config || raw !== JSON.stringify(config) || Object.keys(config).length !== fields.length || !fields.every(field => Object.hasOwn(config, field)) ||
    config.schemaVersion !== 1 || typeof config.origin !== 'string' || typeof config.listenHost !== 'string' || !isIP(config.listenHost) ||
    config.listenHost === '0.0.0.0' || config.listenHost === '::' || !Number.isInteger(config.listenPort) || Number(config.listenPort) < 1024 || Number(config.listenPort) > 65535) throw new Error('invalid config')
  for (const field of ['authDirectory', 'assetDirectory', 'tlsKey', 'tlsCertificate']) if (typeof config[field] !== 'string' || !isAbsolute(config[field])) throw new Error('protected path required')
  const transport = config.transport as { platformId: string; gatewayId: string; statePath: string; trustedKeys: Record<string, string>; componentVersion: string;backupStatePath?:string }
  const transportFields=['platformId','gatewayId','statePath','trustedKeys','componentVersion']
  if (!transport || !transportFields.every(field=>Object.hasOwn(transport,field))||!Object.keys(transport).every(field=>transportFields.includes(field)||field==='backupStatePath') ||
    !isAbsolute(transport.statePath) || typeof transport.componentVersion !== 'string' || transport.componentVersion.length > 80 ||(transport.backupStatePath!==undefined&&!isAbsolute(transport.backupStatePath))) throw new Error('transport enrollment required')
  if (mode === '--initialize') {
    const user = config.initialUser as { username: string; password: string; role: GatewayRole; totpSeed: string; recoveryCodes: string[] }
    await initializeGatewayAuth(config.authDirectory as string, user)
    process.stdout.write('Independent gateway account initialized; preserve the separate MFA and recovery materials.\n')
    return
  }
  const auth = await createGatewayAuth(config.authDirectory as string)
  const server = await createGatewayConsoleServer({ key: await readDiscoveryPrivateFile(config.tlsKey as string, 16384),
    cert: await readDiscoveryPrivateFile(config.tlsCertificate as string, 32768) }, { auth, origin: config.origin,
    assetDirectory: config.assetDirectory as string, status: createGatewayStatusReader(transport) })
  const release = await acquireDiscoveryProcessLock(config.authDirectory as string)
  try { await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(Number(config.listenPort), config.listenHost as string, resolve) }) }
  catch (error) { await release(); throw error }
  let stopped = false
  const stop = () => { if (stopped) return; stopped = true; server.close(() => { void release().finally(() => process.exit(0)) }); server.closeAllConnections() }
  process.once('SIGTERM', stop); process.once('SIGINT', stop)
  process.stdout.write('Independent gateway console is listening.\n')
}
main().catch(() => { process.stderr.write('Gateway console could not start; check protected local authentication, certificate and transport enrollment.\n'); process.exitCode = 1 })
