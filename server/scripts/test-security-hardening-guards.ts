import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { hardeningFailure, hardeningSchedule, hardeningReason, hardeningUpdateBudget, hardeningDiagnostic, hardeningNeedsReadOnlyRecovery } from '../src/lib/security-hardening.js'
import { safeCustomerRuntime, validateHostSecurityRuntime, hardeningPreflightCheck } from '../src/services/host-security-inspection.js'
import { readAlpineSshPreflight } from '../src/lib/alpine-ssh-preflight.js'
import { hardeningPublicView } from '../src/lib/hardening-view.js'
import { hostMaintenanceBlocked } from '../src/lib/host-maintenance-gate.js'
import { hardeningIdentityHash, hardeningReceiptMatches } from '../src/lib/hardening-identity.js'
import { customerBootIdentity, customerBootRecoveryAction, nextMaintenanceAction, readHostMaintenanceIntent, automaticMaintenanceRecipeAllowed } from '../src/lib/host-maintenance-plan.js'
import { maintenanceWireOperation } from '../src/services/host-maintenance-channel.js'
const check = { instanceId: 1, pid: 100, uidMap: '0 1000000 1000000000', gidMap: '0 1000000 1000000000', seccomp: 2, apparmor: 'incus-fixture (enforce)' }
assert.ok(safeCustomerRuntime(check))
for (const delta of [{ uidMap: '0 0 4294967295' }, { gidMap: '0 0 65536' }, { uidMap: 'invalid' }, { uidMap: null },
  { uidMap: '1 1000000 65536' }, { seccomp: 0 }, { seccomp: null }]) assert.equal(safeCustomerRuntime({ ...check, ...delta }), false)
const preflight = { architecture: 'aarch64', bootId: '11111111-1111-4111-8111-111111111111', pageSize: 65536,
  memoryAvailableKiB: 262144, memoryPressure: 0, rootAvailableBytes: 268435456, rootAvailableInodes: 1024,
  rootReadonly: false, packageBusy: false, apparmorKernelSupport:true,apparmorBootDisabled:false,apparmorActive:true,bootloader:'grub' as const }
const report = { apparmor: true, alpine: true, fixed: true, branch: '3.22', guests: [check], preflight }
assert.deepEqual(validateHostSecurityRuntime(report, [{ instanceId: 1, pid: 100 }]), report)
for (const value of [{ ...report, apparmor: 'true' }, { ...report, guests: [] }, { ...report, guests: [{ ...check, pid: 101 }] },
  { ...report, branch: 'shell value' }, { ...report, guests: [{ ...check, seccomp: '2' }] }]) {
  assert.throws(() => validateHostSecurityRuntime(value, [{ instanceId: 1, pid: 100 }]), /UNSUPPORTED/)
}
const now = 1000000
assert.equal(hardeningSchedule([{ status: 'verified' }, { status: 'not-applicable' }], 1, now).status, 'verified')
assert.equal(hardeningSchedule([{ status: 'needs-maintenance' }, { status: 'retry' }], 1, now).status, 'retry')
assert.equal(hardeningSchedule([{ status: 'needs-maintenance' }], 1, now).status, 'needs-maintenance')
assert.equal(Date.parse(hardeningSchedule([{ status: 'retry' }], 1, now).nextCheckAt) - now, 30000)
assert.equal(Date.parse(hardeningSchedule([{ status: 'retry' }], 1000000, now).nextCheckAt) - now, 1800000)
for (const code of ['CUSTOMER_PRIVILEGE_FORBIDDEN', 'CUSTOMER_ISOLATION_UNSAFE']) {
  assert.equal(hardeningFailure(Object.assign(new Error('unsafe private config'), { code })).status, 'needs-maintenance')
  assert.equal(hardeningFailure(new Error(code)).status, 'needs-maintenance')
}
assert.equal(hardeningFailure(new Error('HARDENING_IDENTITY_CHANGED')).status, 'needs-maintenance')
assert.deepEqual(hardeningFailure(new Error('secret connection payload')), { status: 'retry', reason: 'HARDENING_CHECK_FAILED' })
assert.equal(hardeningFailure(Object.assign(new Error('private description'), { code: 'SSH_HOST_KEY_CHANGED' })).status, 'needs-maintenance')
assert.ok(!hardeningReason('secret connection payload').includes('secret'))
assert.equal(hardeningPreflightCheck(preflight).status,'verified')
for (const [delta,reason] of [[{ architecture: 'riscv64' },'HARDENING_ARCH_UNSUPPORTED'], [{ memoryAvailableKiB: 1 },'HARDENING_MEMORY_LOW'],
  [{ memoryPressure: 5 },'HARDENING_MEMORY_PRESSURE'], [{ rootAvailableBytes: 0 },'HARDENING_DISK_LOW'],
  [{ rootReadonly: true },'HARDENING_FILESYSTEM_READONLY'], [{ packageBusy: true },'HARDENING_PACKAGE_BUSY']] as const) {
  assert.equal(hardeningPreflightCheck({ ...preflight, ...delta }).reason,reason)
}
for (const delta of [{ preflight: undefined }, { preflight: { ...preflight, bootId: 'different' } },
  { preflight: { ...preflight, memoryAvailableKiB: NaN } }, { preflight: { ...preflight, rootReadonly: 'false' } }]) {
  assert.throws(() => validateHostSecurityRuntime({ ...report, ...delta },[{ instanceId: 1, pid: 100 }]),/UNSUPPORTED/)
}
assert.equal(hardeningUpdateBudget({ updateAttempts: 6, error: 'HARDENING_BUSY' }),6)
assert.equal(hardeningUpdateBudget({ updateAttempts: -1 }),0)
assert.equal(hardeningDiagnostic('SSH_COMMAND_TIMEOUT','host-inspection').action,'inspect')
assert.equal(hardeningDiagnostic('HARDENING_MEMORY_LOW','host-inspection').action,'wait')
assert.equal(hardeningDiagnostic('secret payload','inventory').reason,'HARDENING_CHECK_FAILED')
assert.equal(hardeningNeedsReadOnlyRecovery({ leaseToken:'expired-original-lease' }),true)
assert.equal(hardeningNeedsReadOnlyRecovery({ error:'SSH_COMMAND_TIMEOUT' }),true)
assert.equal(hardeningNeedsReadOnlyRecovery({ instances:[{ instanceId:1,isolation:{status:'verified'},ssh:{status:'retry',reason:'ALPINE_SSH_UPDATE_FAILED'} }] }),true)
assert.equal(hardeningNeedsReadOnlyRecovery({ error:'HARDENING_BUSY' }),false)
assert.equal(hardeningNeedsReadOnlyRecovery({ instances:'malformed' } as never),false)
const identityTarget={url:'https://127.0.0.1:8443',serverCertificate:null,serverFingerprint:null,managementSshHost:null,managementSshPort:null,managementSshUser:null,onboardingNode:null}
assert.equal(hardeningReceiptMatches({...identityTarget,securityHardening:null}),true)
assert.equal(hardeningReceiptMatches({...identityTarget,securityHardening:{identityHash:hardeningIdentityHash(identityTarget)}}),true)
assert.equal(hardeningReceiptMatches({...identityTarget,url:'https://127.0.0.2:8443',securityHardening:{identityHash:hardeningIdentityHash(identityTarget)}}),false)
for(const phase of ['prepared','reboot-intent','waiting-boot','restoring','blocked','unknown'])assert.equal(hostMaintenanceBlocked({maintenance:{revision:'host-maintenance-v1',phase,requestId:preflight.bootId}}),true)
assert.equal(hostMaintenanceBlocked({maintenance:{revision:'host-maintenance-v1',phase:'verified',requestId:preflight.bootId}}),true,'an incomplete terminal receipt never releases stock')
assert.equal(hostMaintenanceBlocked({maintenance:'malformed'}),true)
const baseline={id:1,hostId:2,userId:3,incusId:'original-customer',uuid:preflight.bootId,attempt:preflight.bootId,state:'running' as const,identityHash:''}
baseline.identityHash=customerBootIdentity(baseline)
const latest={...baseline,status:'running',deletionIntent:null,cleanupPending:false,pendingOperation:false,expired:false,remoteState:'Stopped'}
assert.equal(customerBootRecoveryAction(baseline,latest),'start')
for(const delta of [{deletionIntent:{}},{pendingOperation:true},{expired:true},{status:'deleted'},{status:'suspended'}]) {
  assert.equal(customerBootRecoveryAction(baseline,{...latest,...delta}),'keep')
  assert.equal(customerBootRecoveryAction(baseline,{...latest,...delta,remoteState:'Running'}),'stop')
}
assert.equal(customerBootRecoveryAction(baseline,{...latest,status:'stopped'}),'keep')
assert.equal(customerBootRecoveryAction({...baseline,state:'stopped'},latest),'keep')
assert.equal(customerBootRecoveryAction({...baseline,state:'suspended'},{...latest,remoteState:'Stopped'}),'keep')
assert.equal(customerBootRecoveryAction({...baseline,state:'suspended'},{...latest,remoteState:'Frozen'}),'blocked')
assert.equal(customerBootRecoveryAction(baseline,{...latest,userId:4}),'blocked')
const intent=readHostMaintenanceIntent({revision:'host-maintenance-v1',requestId:preflight.bootId,bootId:preflight.bootId,
  identityHash:'a'.repeat(64),prepareHash:'b'.repeat(64),recipe:'alpine-apparmor-extlinux-v1',architecture:'aarch64',phase:'prepared',rebootIssued:false,
  startedAt:new Date(now).toISOString(),deadline:new Date(now+120000).toISOString(),customers:[baseline],secret:'private raw payload'})
assert.ok(!JSON.stringify(intent).includes('private raw'))
const proof={identityHash:intent.identityHash,prepareHash:intent.prepareHash,bootId:intent.bootId,remotePhase:'prepared',recoveryHeld:false}
assert.equal(nextMaintenanceAction(intent,proof,now),'reboot')
assert.equal(nextMaintenanceAction({...intent,rebootIssued:true,phase:'reboot-intent'},proof,now),'reboot','resume only the same request when remote journal proves it is still prepared')
assert.equal(nextMaintenanceAction(intent,{...proof,remotePhase:'reboot-intent'},now),'wait')
assert.equal(nextMaintenanceAction({...intent,rebootIssued:true,phase:'waiting-boot'},{...proof,bootId:'different',remotePhase:'reboot-intent'},now),'restore')
assert.equal(nextMaintenanceAction(intent,{...proof,bootId:'different'},now),'blocked')
assert.equal(nextMaintenanceAction(intent,{...proof,recoveryHeld:true},now),'wait')
assert.equal(nextMaintenanceAction(intent,proof,now+120001),'rollback')
assert.equal(nextMaintenanceAction(intent,{...proof,remotePhase:'reboot-intent'},now+120001),'blocked')
assert.equal(nextMaintenanceAction(intent,{...proof,remotePhase:'rolled-back'},now),'aborted')
assert.equal(automaticMaintenanceRecipeAllowed(intent.recipe,'aarch64'),false,'native evidence is required before activation')
const wire=maintenanceWireOperation({...intent,action:'reboot'},preflight.bootId,now+59000)
assert.deepEqual(Object.keys(wire).sort(),['action','architecture','bootId','customers','expiresAt','identityHash','nodeId','prepareHash','recipe','requestId'])
assert.equal(hostMaintenanceBlocked({maintenance:{...intent,phase:'verified',rebootIssued:true}}),false)
assert.equal(hostMaintenanceBlocked({maintenance:{...intent,phase:'verified',rebootIssued:false}}),true)
assert.equal(nextMaintenanceAction({...intent,rebootIssued:true,phase:'blocked'},{...proof,bootId:'new',remotePhase:'reboot-intent'},now+120001),'restore','late proven boot allows verification, never another reboot')
for (const value of [null,'malformed',[],{instances:'private-token'},{instances:[null,4,{instanceId:'secret'}]},
  {host:[],diagnostic:{phase:'secret-phase',reason:'secret-raw',action:'private'},environment:{architecture:'private-key',memoryAvailableKiB:'secret'}}]) {
  const view=hardeningPublicView(value)
  assert.equal(view.status,'pending')
  assert.doesNotMatch(JSON.stringify(view),/private-token|secret-raw|secret-phase|private-key/)
}
assert.equal(hardeningPublicView({revision:'old',status:'verified',phase:'finished',nextCheckAt:new Date(Date.now()+60000).toISOString()}).status,'pending')
assert.equal(readAlpineSshPreflight('INCUDAL_SSH_PREFLIGHT aarch64 262144 0.00 262144 1024 0 0\n').status,'verified')
assert.equal(readAlpineSshPreflight('INCUDAL_SSH_PREFLIGHT x86_64 131071 none 262144 1024 0 0\n').reason,'HARDENING_MEMORY_LOW')
assert.equal(readAlpineSshPreflight('INCUDAL_SSH_PREFLIGHT aarch64 262144 5.00 262144 1024 0 0\n').reason,'HARDENING_MEMORY_PRESSURE')
assert.equal(readAlpineSshPreflight('INCUDAL_SSH_PREFLIGHT aarch64 262144 0.00 262144 1024 0 1\n').reason,'HARDENING_PACKAGE_BUSY')
assert.throws(() => readAlpineSshPreflight('INCUDAL_SSH_PREFLIGHT aarch64 NaN 0.00 0 0 0 0\n'),/UNSUPPORTED/)
const source = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const host = source('src/services/host-security-inspection.ts')
assert.ok(host.includes('fingerprint === process.env.ONBOARDING_GATEWAY_FINGERPRINT') && host.includes('await allowed()'))
assert.ok(host.includes('`security-hardening ${node.id}`') && !host.includes('/root/.ssh/incudal-host-management'))
const gateway = source('../scripts/onboarding-gateway.py')
assert.ok(gateway.includes("request['managementIp'] != str(address)") && gateway.includes("request['nodePublicKey'] != peer"))
assert.ok(gateway.includes("alpine_ssh_security_update update") && gateway.includes("all(safe(guest)") && gateway.includes("command + ['id -u']"))
assert.doesNotMatch(host, /rc-service incus|reboot|security\.privileged.*true|--allow-untrusted|chpasswd/)
const queue = source('src/services/security-hardening-queue.ts')
assert.ok(queue.includes('INSTANCE_OPERATION_LOCK_NAMESPACE') && queue.includes('hasActiveTransferWorkflow') && queue.includes('assertNoPendingSnapshotOperations'))
assert.ok(queue.includes('saved.uuid !== uuid') && queue.includes('saved.endpointHash !== managedCleanupEndpointHash(client)'))
assert.ok(queue.includes('currentState(host.securityHardening).leaseToken !== leaseToken'))
assert.ok(queue.includes('take: 50') && queue.includes('state.nextCheckAt'))
const onboarding=source('src/workers/hostOnboardingWorker.ts')
assert.ok(onboarding.includes("checkpoint('hardening')") && onboarding.includes('finishSecureOnboarding'))
assert.ok(onboarding.includes("if (node.step === 'hardening'") && onboarding.includes('hardeningResume'))
assert.ok(queue.includes('state.updateAttempts! >= 6') && queue.includes('state.error = \'HARDENING_RETRY_EXHAUSTED\''))
assert.doesNotMatch(queue, /restartInstance\(|stopInstance\(|deleteInstance\(|prisma\.instance\.update/)
const app = source('src/app.ts')
assert.ok(app.indexOf('startSecurityHardeningWorker()', app.indexOf('await initPrismaDatabase')) > app.indexOf('await initPrismaDatabase'))
for (const script of ['install-onboarding-gateway.sh', 'refresh-onboarding-gateway.sh']) assert.ok(source('../scripts/' + script).includes('/usr/local/libexec/incudal-onboarding-dns/alpine-ssh-security.sh'))
assert.ok(source('src/services/gateway-dns-channel.ts').includes("'alpine-ssh-security.sh'"))
const python = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['../scripts/test-host-security-hardening.py'], { encoding: 'utf8', windowsHide: true })
assert.equal(python.status, 0, python.stdout + python.stderr)
const maintenancePython=spawnSync(process.platform==='win32'?'python':'python3',['../scripts/test-host-maintenance-plan.py'],{encoding:'utf8',windowsHide:true})
assert.equal(maintenancePython.status,0,maintenancePython.stdout+maintenancePython.stderr)
console.log('PASS automatic hardening: runtime UID/GID/Seccomp, exact reports, redaction, retry schedule, original pins, no host/guest restart or privilege conversion, durable lease and lifecycle gates')
