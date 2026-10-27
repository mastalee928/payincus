import { execFile } from 'node:child_process'
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto'
import { isIPv4 } from 'node:net'
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Client, SFTPWrapper } from 'ssh2'
import { GatewayTaskError, gatewayExecutorFailureCode, gatewayTaskHash, validateGatewayTaskPlan } from '../lib/gateway-task-plan.js'
import { validateCredentials, type OnboardingCredentials } from '../lib/host-onboarding.js'
import { signGatewayTransport } from '../lib/gateway-transport.js'
import { validateGatewayInstallationDesired, validateGatewayInstallationRequest, validateGatewayInstallationPreview,
  validateGatewayInstallationReceipt, validateGatewayBootstrapMaterial, type GatewayInstallationDesired, type GatewayInstallationRequest } from '../lib/gateway-installation.js'
import { readDiscoveryPrivateFile, validateDiscoveryPrivateDirectory } from './controller-discovery.js'
import { inspectLocalManagementGateway, inspectRemoteManagementGateway } from './gateway-preflight.js'
import { connectOnboardingSsh, sshExec } from './onboarding-ssh.js'
import { verifyRemoteGatewayDomain } from './onboarding-gateway-endpoint.js'

interface Component { directory: string; version: string; sourceCommit: string }
interface Enrollment { schemaVersion: 1 | 2; platformId: string; signingKeyPath: string; signingKeyId?: string; packageSigningKey: string; components: Partial<Record<'amd64' | 'arm64', Component>> }
const scripts = fileURLToPath(new URL('../../../scripts/', import.meta.url))
const python = '/usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin /usr/bin/python3 -I -B'
function require(value: unknown, code = 'GATEWAY_CONTROLLER_CONFIGURATION_INVALID'): asserts value { if (!value) throw new GatewayTaskError(code) }
const safePath = (value: unknown): value is string => typeof value === 'string' && isAbsolute(value) && resolve(value) === value && /^\/[A-Za-z0-9_./-]+$/.test(value)
async function privateDirectory(path: string) {
  await validateDiscoveryPrivateDirectory(dirname(path))
  await mkdir(path, { mode: 0o700 }).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error })
  await validateDiscoveryPrivateDirectory(path)
}
async function privateFile(path: string, value: string) {
  await validateDiscoveryPrivateDirectory(dirname(path))
  // The directory belongs only to this task and the serialized root worker.
  try { await readDiscoveryPrivateFile(path, 65536) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  await writeFile(path, value, { mode: 0o600 }); await chmod(path, 0o600)
}
async function enrollment() {
  require(process.platform === 'linux' && process.getuid?.() === 0, 'GATEWAY_PRIVILEGED_WORKER_REQUIRED')
  const path = process.env.GATEWAY_CONTROLLER_CONFIG || '/var/lib/incudal-gateway-controller/enrollment.json'
  require(safePath(path))
  const raw = await readDiscoveryPrivateFile(path, 8192), config = JSON.parse(raw) as Enrollment
  require(config && ((config.schemaVersion === 1 && Object.keys(config).length === 5) ||
    (config.schemaVersion === 2 && Object.keys(config).length === 6 && typeof config.signingKeyId === 'string')) &&
    /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(config.platformId) && safePath(config.signingKeyPath) &&
    typeof config.packageSigningKey === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(config.packageSigningKey) &&
    Buffer.from(config.packageSigningKey, 'base64').toString('base64') === config.packageSigningKey &&
    Buffer.from(config.packageSigningKey, 'base64').some(byte => byte !== 0) &&
    config.components && Object.keys(config.components).length > 0 && Object.keys(config.components).every(key => key === 'amd64' || key === 'arm64'))
  for (const component of Object.values(config.components)) require(component && Object.keys(component).length === 3 && safePath(component.directory) &&
    /^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(component.version) && /^[a-f0-9]{40}$/.test(component.sourceCommit))
  const key = createPrivateKey(await readDiscoveryPrivateFile(config.signingKeyPath, 16384))
  require(key.asymmetricKeyType === 'ed25519')
  const publicKey = createPublicKey(key).export({ type: 'spki', format: 'der' }).subarray(12).toString('base64')
  require(publicKey !== config.packageSigningKey, 'GATEWAY_SIGNING_KEYS_MUST_BE_INDEPENDENT')
  if (config.schemaVersion === 2) {
    require(config.signingKeyId === 'key_' + createHash('sha256').update(Buffer.from(publicKey, 'base64')).digest('hex'))
    const identity = JSON.parse(await readDiscoveryPrivateFile(join(dirname(path), 'identity.json'), 1024)) as Record<string, unknown>
    require(identity && Object.keys(identity).length === 4 && identity.schemaVersion === 1 &&
      identity.platformId === config.platformId && identity.signingKeyId === config.signingKeyId && identity.packageSigningKey === config.packageSigningKey)
    require(config.signingKeyPath === join(dirname(path), 'signing.pem'))
  }
  const requests = join(dirname(path), 'requests'); await privateDirectory(requests)
  return { config, key, publicKey, requests }
}

export async function createGatewayInstallationDriver(planInput: unknown, credentials: OnboardingCredentials | undefined, signal: AbortSignal) {
  const plan = validateGatewayTaskPlan(planInput), control = await enrollment()
  require(plan.platformId === control.config.platformId && plan.kind === 'install' && plan.target.mode !== 'existing', 'GATEWAY_INSTALLATION_INVALID')
  const localRoot = join(control.requests, plan.taskId); await privateDirectory(localRoot)
  let client: Client | undefined, sftp: SFTPWrapper | undefined
  const abort = () => client?.destroy()
  signal.addEventListener('abort', abort, { once: true })
  const local = (program: string, args: string[], input?: string, timeout = 60000) => new Promise<string>((resolve, reject) => {
    const child = execFile(program, args, { signal, timeout, maxBuffer: 65536, env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LC_ALL: 'C', PYTHONDONTWRITEBYTECODE: '1' } }, (error, stdout) => {
      if (error) reject(new GatewayTaskError(gatewayExecutorFailureCode(stdout,
        error.killed ? 'GATEWAY_INSTALL_TIMEOUT' : 'GATEWAY_INSTALL_EXECUTOR_FAILED'))); else resolve(stdout)
    })
    child.stdin?.end(input)
  })
  try {
    if (plan.target.mode !== 'local') {
      validateCredentials(credentials)
      const target = plan.target.ssh!
      client = await connectOnboardingSsh({ host: target.address, port: target.port, password: credentials.password || undefined,
        privateKey: credentials.privateKey || undefined }, async fingerprint => fingerprint === target.fingerprint)
      require(!signal.aborted, 'GATEWAY_TASK_LEASE_LOST')
      sftp = await new Promise<SFTPWrapper>((resolve, reject) => client!.sftp((error, value) => error ? reject(new GatewayTaskError('GATEWAY_INSTALL_TRANSFER_FAILED')) : resolve(value)))
    } else require(credentials === undefined)
    const inspect = (desired: GatewayInstallationDesired) => {
      const input = { schemaVersion: 1, platformId: plan.platformId, gatewayId: plan.gatewayId, expectedMachineId: plan.target.machineId,
        slot: desired.slot, network: desired.network, address: desired.address, listenPort: desired.listenPort, consolePort: desired.consolePort }
      return client ? inspectRemoteManagementGateway(client, input) : inspectLocalManagementGateway(input)
    }
    const remoteScript = (source: string, data: unknown) => sshExec(client!, python + ' -',
      `import base64,json\nDATA=json.loads(base64.b64decode('${Buffer.from(JSON.stringify(data)).toString('base64')}'))\n` + source, 120000)
    const stage = async (component: Component, architecture: 'amd64' | 'arm64') => {
      const pin = join(localRoot, 'package.pub'); await privateFile(pin, control.config.packageSigningKey)
      const verified = JSON.parse(await local('/usr/bin/python3', ['-I', '-B', join(scripts, 'verify-gateway-component-package.py'), component.directory, pin,
        architecture, component.version, component.sourceCommit])) as { manifestHash: string; verified: boolean }
      require(verified.verified && /^[a-f0-9]{64}$/.test(verified.manifestHash))
      let packageDirectory = component.directory, taskDirectory = localRoot
      if (client) {
        packageDirectory = '/var/lib/incudal-gateway-controller/packages/' + verified.manifestHash
        taskDirectory = '/var/lib/incudal-gateway-controller/requests/' + plan.taskId
        const manifest = JSON.parse(Buffer.from(JSON.parse(await readFile(join(component.directory, 'manifest.json'), 'utf8')).payload, 'base64').toString()) as { files: Array<{ path: string; mode: number }> }
        const files = [...manifest.files, { path: 'manifest.json', mode: 0o644 }, { path: 'package.json', mode: 0o644 }]
        await remoteScript(`import os,stat\nfrom pathlib import Path\nfor value in [DATA['packageDirectory'],DATA['taskDirectory']]:\n p=Path(value)\n for item in reversed([p,*p.parents]):\n  if not item.exists() and not item.is_symlink(): item.mkdir(mode=0o700)\n  s=item.lstat()\n  assert stat.S_ISDIR(s.st_mode) and s.st_uid==0 and not s.st_mode&0o022\nfor name in ['bin','lib','scripts','ui']:\n p=Path(DATA['packageDirectory'],name)\n if not p.exists() and not p.is_symlink():p.mkdir(mode=0o755)\n s=p.lstat();assert stat.S_ISDIR(s.st_mode) and s.st_uid==0 and not s.st_mode&0o022\nfor item in DATA['files']:\n p=Path(DATA['packageDirectory'],item['path'])\n if p.exists() or p.is_symlink():\n  s=p.lstat();assert stat.S_ISREG(s.st_mode) and s.st_uid==0 and s.st_nlink==1 and not s.st_mode&0o022\n`, { packageDirectory, taskDirectory, files })
        await putPrivate(taskDirectory + '/package.pub', control.config.packageSigningKey)
        const verifier = await readFile(join(scripts, 'verify-gateway-component-package.py'), 'utf8')
        const verifyRemote = async () => JSON.parse(await remoteScript(`import sys\nsys.argv=['verify',DATA['directory'],DATA['pin'],DATA['architecture'],DATA['version'],DATA['commit']]\n` + verifier,
          { directory: packageDirectory, pin: taskDirectory + '/package.pub', architecture, version: component.version, commit: component.sourceCommit })) as { manifestHash: string }
        let cached = false
        try { cached = (await verifyRemote()).manifestHash === verified.manifestHash } catch { /* Incomplete staging can be copied again; it is never executed. */ }
        for (const file of cached ? [] : files) {
          require(!signal.aborted, 'GATEWAY_TASK_LEASE_LOST')
          await new Promise<void>((resolve, reject) => sftp!.fastPut(join(component.directory, file.path), packageDirectory + '/' + file.path,
            { concurrency: 32, mode: file.mode }, error => error ? reject(new GatewayTaskError('GATEWAY_INSTALL_TRANSFER_FAILED')) : resolve()))
          await new Promise<void>((resolve, reject) => sftp!.chmod(packageDirectory + '/' + file.path, file.mode, error => error ? reject(new GatewayTaskError('GATEWAY_INSTALL_TRANSFER_FAILED')) : resolve()))
        }
        const actual = await verifyRemote()
        require(actual.manifestHash === verified.manifestHash, 'GATEWAY_INSTALL_COMPONENT_CHANGED')
      }
      const policy = { schemaVersion: 1, platformId: plan.platformId, platformSigningKey: control.publicKey,
        packageSigningKey: control.config.packageSigningKey, packageDirectory, componentVersion: component.version, componentCommit: component.sourceCommit }
      return { packageDirectory, taskDirectory, policy, manifestHash: verified.manifestHash }
    }
    const putPrivate = async (path: string, raw: string) => {
      if (!client) { await privateFile(path, raw); return }
      await remoteScript(`import os,stat\nfrom pathlib import Path\np=Path(DATA['path'])\nfor a in p.parents:\n s=a.lstat();assert stat.S_ISDIR(s.st_mode) and s.st_uid==0 and not s.st_mode&0o022\nfd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_NOFOLLOW|os.O_NONBLOCK,0o600)\nwith os.fdopen(fd,'wb') as f:\n s=os.fstat(f.fileno());assert stat.S_ISREG(s.st_mode) and s.st_uid==0 and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o600\n f.truncate();f.write(DATA['value'].encode());f.flush();os.fsync(f.fileno())\n`, { path, value: raw })
    }
    const run = async (command: 'gateway-install-plan.py' | 'execute-gateway-install.py', prepared: Awaited<ReturnType<typeof stage>>, request: GatewayInstallationRequest) => {
      require(!signal.aborted, 'GATEWAY_TASK_LEASE_LOST')
      await putPrivate(prepared.taskDirectory + '/policy.json', JSON.stringify(prepared.policy))
      await putPrivate(prepared.taskDirectory + '/request.json', JSON.stringify(request))
      const script = prepared.packageDirectory + '/scripts/' + command
      // The approved Python program returns a strict public error object on
      // failure. Preserve that code without returning stderr or arbitrary JSON.
      const raw = client ? await sshExec(client,
        `/bin/sh -c '${python} ${script} ${prepared.taskDirectory}/policy.json ${prepared.taskDirectory}/request.json; result=$?; [ "$result" -le 1 ]'`, '', 120000) :
        await local('/usr/bin/python3', ['-I', '-B', script, prepared.taskDirectory + '/policy.json', prepared.taskDirectory + '/request.json'], undefined, 120000)
      const code = gatewayExecutorFailureCode(raw, '')
      if (code) throw new GatewayTaskError(code)
      return JSON.parse(raw) as unknown
    }
    return {
      platformSigningKey: control.publicKey,
      inspect,
      async prepare(input: GatewayInstallationDesired) {
        const desired = validateGatewayInstallationDesired(input, { ...plan, machineId: plan.target.machineId })
        const initial = await inspect(desired)
        require(initial.architecture === 'amd64' || initial.architecture === 'arm64', 'GATEWAY_SYSTEM_UNSUPPORTED')
        const component = control.config.components[initial.architecture]
        require(component, 'GATEWAY_COMPONENT_UNAVAILABLE')
        const staged = await stage(component, initial.architecture), report = await inspect(desired)
        const now = Date.now()
        const signedTransport = signGatewayTransport({ schemaVersion: 1, purpose: 'gateway-transport', platformId: plan.platformId, gatewayId: plan.gatewayId,
          epoch: '1', sequence: '1', issuedAt: now, expiresAt: now + 600000, slot: desired.slot, address: desired.address, listenPort: desired.listenPort, mtu: 1380, peers: [] }, control.key)
        const configuration = { ...desired, signedTransport }
        const request = validateGatewayInstallationRequest({ task: { ...plan, componentHash: staged.manifestHash, observedStateHash: report.observedStateHash,
          configurationHash: gatewayTaskHash(configuration) }, configuration, expiresAt: now + 300000 }, control.publicKey)
        const preview = validateGatewayInstallationPreview(await run('gateway-install-plan.py', staged, request), request)
        return { request, preview }
      },
      async execute(input: unknown) {
        const request = validateGatewayInstallationRequest(input, control.publicKey)
        require(gatewayTaskHash(request.task) === gatewayTaskHash(plan), 'GATEWAY_TASK_PLAN_STALE')
        const { signedTransport: _signed, ...desired } = request.configuration
        // Recheck DNS before any installation write. Keep the original SSH pin;
        // a DNS record change cannot redirect the approved installation.
        if (plan.target.mode !== 'local') {
          const hostname = new URL(desired.consoleOrigin).hostname
          if (!isIPv4(hostname)) await verifyRemoteGatewayDomain(plan.target.ssh!.address, hostname)
        }
        const report = await inspect(desired)
        require(report.architecture === 'amd64' || report.architecture === 'arm64', 'GATEWAY_SYSTEM_UNSUPPORTED')
        const component = control.config.components[report.architecture]; require(component, 'GATEWAY_COMPONENT_UNAVAILABLE')
        const staged = await stage(component, report.architecture)
        require(staged.manifestHash === request.task.componentHash, 'GATEWAY_INSTALL_COMPONENT_CHANGED')
        const receipt = validateGatewayInstallationReceipt(await run('execute-gateway-install.py', staged, request), request)
        const bootstrapPath = '/var/lib/incudal-management-gateway/' + plan.gatewayId + '/bootstrap.json'
        const bootstrapRaw = client ? await remoteScript(`import sys\n` + (await readFile(join(scripts, 'verify-gateway-component-package.py'), 'utf8')).replace("if __name__ == '__main__':", "if False:") +
          `\nprint(protected_read(DATA['path'],8192,0o600).decode())\n`, { path: bootstrapPath }) : await readDiscoveryPrivateFile(bootstrapPath, 8192)
        return { receipt, bootstrap: validateGatewayBootstrapMaterial(JSON.parse(bootstrapRaw)) }
      },
      close() { signal.removeEventListener('abort', abort); client?.end() }
    }
  } catch (error) { signal.removeEventListener('abort', abort); client?.destroy(); throw error }
}
