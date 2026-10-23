import assert from 'node:assert/strict'
import { createCipheriv, createPublicKey, generateKeyPairSync, randomBytes, randomUUID, scryptSync } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import { ZipFile } from 'yazl'
import { openPromise } from 'yauzl'
import { BackupError, normalizeConfig, openSecret, sealSecret, publicConfig, recoveryRequestAllowed, validatePrefix, nextScheduledTime } from '../src/services/platform-backup-core.js'
import { decryptBackup, encryptBackup, hashFile, validAssetName, validateManifest } from '../src/services/platform-backup-archive.js'
import { AliyunOssClient, sanitizedOssError } from '../src/services/aliyun-oss-client.js'
import { assertDatabaseIntegrity, normalizedDumpHash, type DatabaseIntegrity } from '../src/services/platform-backup-database.js'
import { createReadableZip, readableZipName, verifyReadableZip } from '../src/services/platform-backup-readable.js'
import { retainGatewayEndpoints } from '../src/services/platform-backup-gateway.js'
import { mergeBackupEnvironment } from '../src/services/platform-backup-environment.js'
import { parse as parseEnv } from 'dotenv'
import { restoreControllerIdentity } from '../src/services/platform-backup-controller.js'
import { controllerSigningKeyId } from '../src/lib/controller-config.js'
import { assertBackupVersion, assertMigrationHistory, normalizedReleaseSchema, releaseMigrationHash, releaseMigrations } from '../src/services/platform-backup-compatibility.js'

process.env.ENCRYPTION_KEY = 'local-test-encryption-key-not-a-real-credential'
const workspace = await mkdtemp(join(tmpdir(), 'payincus-oss-test-'))
assert.ok(resolve(workspace).startsWith(resolve(tmpdir(), 'payincus-oss-test-')))
try {
  const replacement = 'DATABASE_URL=target-fixture\nENCRYPTION_KEY=target-fixture-key\nJWT_SECRET=target-session-fixture\nONBOARDING_GATEWAY_HOST=127.0.0.1\nONBOARDING_GATEWAY_FINGERPRINT=SHA256:' + 'A'.repeat(43) + '\nONBOARDING_WG_ENDPOINT=gateway.example.com:51820\n'
  const oldEnvironment = 'DATABASE_URL=old-fixture\nENCRYPTION_KEY=original-fixture-key\nJWT_SECRET=old-session-fixture\nONBOARDING_GATEWAY_FINGERPRINT=SHA256:' + 'B'.repeat(43) + '\n'
  const mapped = parseEnv(mergeBackupEnvironment(replacement, oldEnvironment, '[Interface]\nListenPort = 51999\n[Peer]\nPublicKey = fixture\n'))
  assert.equal(mapped.ONBOARDING_WG_ENDPOINT, 'gateway.example.com:51999')
  assert.equal(mapped.ONBOARDING_GATEWAY_FINGERPRINT, 'SHA256:' + 'A'.repeat(43), 'B must retain its own verified SSH host identity')
  assert.equal(mapped.JWT_SECRET, 'target-session-fixture'); assert.equal(mapped.DATABASE_URL, 'target-fixture')
  assert.equal(mapped.ENCRYPTION_KEY, 'original-fixture-key')
  assert.throws(() => mergeBackupEnvironment(replacement, oldEnvironment, '[Interface]\nListenPort = 0\n'), /OSS_GATEWAY_CONFIG_UNSUPPORTED/)
  assert.throws(() => mergeBackupEnvironment(replacement, oldEnvironment, '[Peer]\nListenPort = 51999\n'), /OSS_GATEWAY_CONFIG_UNSUPPORTED/)
  assert.throws(() => mergeBackupEnvironment(replacement.replace('127.0.0.1', 'gateway.example.com'), oldEnvironment, '[Interface]\nListenPort = 51999\n'), /OSS_GATEWAY_MAPPING_REQUIRED/)
  const signing = generateKeyPairSync('ed25519'), signingPem = signing.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const signingPublic = createPublicKey(signing.privateKey).export({ type: 'spki', format: 'der' }).subarray(12).toString('base64')
  const platform = randomUUID(), packageSigningKey = Buffer.alloc(32, 7).toString('base64')
  const identity = { schemaVersion: 1, platformId: platform, signingKeyId: controllerSigningKeyId(signingPublic), packageSigningKey }
  const oldController = { schemaVersion: 2, platformId: platform, signingKeyPath: '/var/lib/incudal-gateway-controller/signing.pem',
    signingKeyId: identity.signingKeyId, packageSigningKey, components: { arm64: { directory: '/old-source-package', version: '1.7.1', sourceCommit: 'a'.repeat(40) } } }
  const replacementController = { ...oldController, platformId: randomUUID(), components: { arm64: { directory: '/var/lib/incudal-gateway-components/' + 'b'.repeat(64), version: '1.7.1', sourceCommit: 'b'.repeat(40) } } }
  const preparedController = restoreControllerIdentity(signingPem, JSON.stringify(identity), JSON.stringify(oldController), JSON.stringify(replacementController))
  assert.equal(preparedController.privatePem, signingPem); assert.equal(preparedController.platformId, platform)
  assert.deepEqual(JSON.parse(preparedController.enrollment).components, replacementController.components, 'only verified replacement component paths may survive recovery')
  assert.equal(parseEnv(mergeBackupEnvironment(replacement, oldEnvironment + 'GATEWAY_PLATFORM_ID=' + platform + '\n', undefined, platform)).GATEWAY_PLATFORM_ID, platform)
  assert.throws(() => mergeBackupEnvironment(replacement, oldEnvironment, undefined, platform), /OSS_CONTROLLER_PLATFORM_MISMATCH/)
  assert.throws(() => restoreControllerIdentity(signingPem, JSON.stringify({ ...identity, signingKeyId: 'key_' + 'f'.repeat(64) }), JSON.stringify(oldController), JSON.stringify(replacementController)), /OSS_CONTROLLER_TRUST_MISMATCH/)
  assert.throws(() => restoreControllerIdentity(signingPem, JSON.stringify(identity), JSON.stringify(oldController), JSON.stringify({ ...replacementController, packageSigningKey: Buffer.alloc(32, 9).toString('base64') })), /OSS_CONTROLLER_TRUST_MISMATCH/)
  assert.throws(() => restoreControllerIdentity(signingPem, JSON.stringify(identity), JSON.stringify(oldController), JSON.stringify({ ...replacementController, components: { arm64: { ...replacementController.components.arm64, directory: '/tmp/untrusted' } } })), /OSS_CONTROLLER_COMPONENTS_INVALID/)
  assertBackupVersion('1.6.8', '1.7.1')
  assertBackupVersion('v1.7.1', '1.7.1')
  assertBackupVersion('preview-abcdef1', 'preview-abcdef1')
  assert.throws(() => assertBackupVersion('preview-abcdef1', 'preview-abcdef2'), /OSS_APP_VERSION_UNSUPPORTED/)
  assert.throws(() => assertBackupVersion('1.7.2', '1.7.1'), /OSS_BACKUP_VERSION_NEWER/)
  for (const source of ['2.0.0', '1.7.1-rc.1', 'unknown', '1.9007199254740993.0']) assert.throws(() => assertBackupVersion(source, '1.7.1'), /OSS_APP_VERSION_UNSUPPORTED/)
  assert.throws(() => assertBackupVersion('0.6.1', '0.7.1'), /OSS_APP_VERSION_UNSUPPORTED/)
  const migrationFixture = join(workspace, 'migration-app/server/prisma/migrations/202610150001_fixture')
  await import('node:fs/promises').then(fs => fs.mkdir(migrationFixture, { recursive: true }))
  const migrationSql = 'CREATE FUNCTION example() RETURNS void LANGUAGE plpgsql AS $$\nBEGIN\n  RETURN;\nEND;\n$$;\n'
  await writeFile(join(migrationFixture, 'migration.sql'), migrationSql)
  const releaseRows = await releaseMigrations(join(workspace, 'migration-app'))
  assert.equal(releaseRows[0].acceptedChecksums.length, 2)
  for (const checksum of releaseRows[0].acceptedChecksums) assertMigrationHistory([{ migration_name: releaseRows[0].name, checksum }], releaseRows, true)
  assertMigrationHistory([], releaseRows)
  assert.throws(() => assertMigrationHistory([], releaseRows, true), /OSS_MIGRATION_HISTORY_MISMATCH/)
  assert.throws(() => assertMigrationHistory([{ migration_name: releaseRows[0].name, checksum: 'f'.repeat(64) }], releaseRows), /OSS_MIGRATION_HISTORY_MISMATCH/)
  assert.throws(() => assertMigrationHistory([{ migration_name: 'unknown', checksum: releaseRows[0].checksum }], releaseRows), /OSS_MIGRATION_HISTORY_MISMATCH/)
  assert.equal(normalizedReleaseSchema(migrationSql.replace(/\n/g, '\r\n'), releaseRows).replace(/\r\n/g, '\n'), migrationSql)
  const unknownBody = "SELECT $$unknown\r\nvalue$$;"
  assert.equal(normalizedReleaseSchema(unknownBody, releaseRows), unknownBody, 'unknown SQL or literal bytes must remain unchanged')
  assert.equal(releaseMigrationHash(releaseRows), releaseMigrationHash(releaseRows.map(r => ({ ...r, acceptedChecksums: r.acceptedChecksums.slice().reverse() }))))
  const realRelease = await releaseMigrations(resolve(import.meta.dirname, '../..'))
  assert.ok(realRelease.length > 200, 'release migration catalog must include the full historical schema')
  const newlineMigration = realRelease.find(row => row.name === '202610150001_host_pool_checkout')!
  assert.ok(newlineMigration.acceptedChecksums.includes('2917406bac0323defb81c040c3813bd39ad32cce77874e64b6e1dca4b0afee6f'))
  assert.ok(newlineMigration.acceptedChecksums.includes('5b6ad43ac8e41c1080633c7d501e765a7f83f7b0030a47048361400cbab089a8'))
  const peerKey = 'a'.repeat(43) + '=', otherKey = 'b'.repeat(43) + '='
  const gatewayConfig = `[Interface]\nPrivateKey = test-controller-identity\nAddress = 10.253.240.1/24\n[Peer]\nPublicKey = ${peerKey}\nAllowedIPs = 10.253.240.2/32\n`
  assert.ok(retainGatewayEndpoints(gatewayConfig, gatewayConfig, `${peerKey}\t192.0.2.1:51820\n`).includes('Endpoint = 192.0.2.1:51820'))
  assert.ok(retainGatewayEndpoints(gatewayConfig, gatewayConfig, `${peerKey}\t[2001:db8::1]:51820\n`).includes('Endpoint = [2001:db8::1]:51820'))
  for (const endpoint of ['(none)', '999.0.0.1:51820', '192.0.2.1:65536', '192.0.2.1:0', 'malicious;command:22']) assert.equal(retainGatewayEndpoints(gatewayConfig, gatewayConfig, `${peerKey}\t${endpoint}\n`), gatewayConfig)
  assert.equal(retainGatewayEndpoints(gatewayConfig, gatewayConfig.replace('test-controller-identity', 'other-identity'), `${peerKey}\t192.0.2.1:51820\n`), gatewayConfig.replace('test-controller-identity', 'other-identity'))
  assert.equal(retainGatewayEndpoints(gatewayConfig, gatewayConfig.replace(peerKey, otherKey), `${peerKey}\t192.0.2.1:51820\n`), gatewayConfig.replace(peerKey, otherKey))
  const fixedGateway = gatewayConfig + 'Endpoint = 192.0.2.2:51820\n'
  assert.equal(retainGatewayEndpoints(gatewayConfig, fixedGateway, `${peerKey}\t192.0.2.1:51820\n`), fixedGateway)
  const secret = sealSecret('test-password-123')
  assert.equal(openSecret(secret), 'test-password-123')
  assert.throws(() => openSecret('plaintext'), /OSS_SECRET_DECRYPT_FAILED/)
  const config = normalizeConfig({ enabled: false, region: 'oss-cn-hangzhou', bucket: 'test-backup-bucket', prefix: 'backups/', accessKeyId: 'TestAccessKeyId', accessKeySecret: 'TestSecretValue', backupPassword: 'test-password-123', intervalHours: 72, retention: 1 })
  assert.equal(config.nextRunAt, null)
  assert.ok(!JSON.stringify(publicConfig(config)).includes('TestSecretValue'))
  assert.ok(!('backupPassword' in publicConfig(config)))
  assert.throws(() => normalizeConfig({ ...config, enabled: true, accessKeySecret: '', backupPassword: '' }, config))
  // Connection settings can be saved before a bucket or encryption password is chosen.
  const credentialsInput = { enabled: false, region: 'oss-cn-hangzhou', bucket: '', prefix: 'backups/', accessKeyId: 'TestAccessKeyId', accessKeySecret: 'TestSecretValue', backupPassword: '', intervalHours: 24, retention: 3 }
  const credentials = normalizeConfig(credentialsInput)
  assert.equal(credentials.bucket, '')
  assert.equal(credentials.backupPassword, '')
  assert.equal(publicConfig(credentials).hasAccessKeySecret, true)
  assert.equal(publicConfig(credentials).hasBackupPassword, false)
  assert.throws(() => normalizeConfig({ ...credentialsInput, accessKeySecret: '' }), /OSS_CREDENTIAL_REQUIRED/)
  credentials.testedRevision = credentials.revision
  const retainedCredentials = normalizeConfig({ ...credentialsInput, revision: credentials.revision, accessKeySecret: '' }, credentials)
  assert.equal(openSecret(retainedCredentials.accessKeySecret), 'TestSecretValue')
  assert.throws(() => normalizeConfig({ ...credentialsInput, revision: credentials.revision, enabled: true, accessKeySecret: '' }, credentials), /OSS_BUCKET_REQUIRED/)
  const bucketSettings = normalizeConfig({ ...credentialsInput, revision: credentials.revision, bucket: config.bucket, accessKeySecret: '' }, credentials)
  assert.equal(bucketSettings.testedRevision, null, 'choosing a bucket invalidates the account-only test')
  bucketSettings.testedRevision = bucketSettings.revision
  assert.throws(() => normalizeConfig({ ...credentialsInput, revision: bucketSettings.revision, bucket: config.bucket, enabled: true, accessKeySecret: '' }, bucketSettings), /OSS_BACKUP_PASSWORD_REQUIRED/)
  const passwordSettings = normalizeConfig({ ...credentialsInput, revision: bucketSettings.revision, bucket: config.bucket, accessKeySecret: '', backupPassword: 'test-password-123' }, bucketSettings)
  assert.equal(passwordSettings.testedRevision, null)
  passwordSettings.testedRevision = passwordSettings.revision
  const enabledSettings = normalizeConfig({ ...credentialsInput, revision: passwordSettings.revision, bucket: config.bucket, enabled: true, accessKeySecret: '', backupPassword: '' }, passwordSettings)
  assert.equal(enabledSettings.testedRevision, enabledSettings.revision)
  assert.ok(enabledSettings.nextRunAt)
  const credentialsTransport = new AliyunOssClient(credentials)
  let accountTests = 0
  credentialsTransport.listBuckets = async () => { accountTests++; return { buckets: [], nextCursor: null } }
  credentialsTransport.assertBackupBucket = async () => { throw new Error('account test must not probe a bucket') }
  try {
    await credentialsTransport.test(credentials)
    assert.equal(accountTests, 1)
    await assert.rejects(credentialsTransport.listObjects(''), /OSS_BUCKET_REQUIRED/)
    await assert.rejects(credentialsTransport.backups('backups/'), /OSS_BUCKET_REQUIRED/)
  } finally { credentialsTransport.close() }
  const bucketTransport = new AliyunOssClient(bucketSettings)
  bucketTransport.listBuckets = async () => { throw new Error('selected bucket must not use account-only test') }
  bucketTransport.assertBackupBucket = async () => { throw new BackupError('OSS_AccessDenied') }
  try { await assert.rejects(bucketTransport.test(bucketSettings), /OSS_AccessDenied/) } finally { bucketTransport.close() }
  for (const [code, expected] of [['ENOENT', 'OSS_STATE_NOT_INITIALIZED'], ['EACCES', 'OSS_STATE_PERMISSION_DENIED'], ['EROFS', 'OSS_STATE_PERMISSION_DENIED'], ['ENOSPC', 'OSS_STATE_DISK_FULL'], ['ENOTFOUND', 'OSS_NETWORK_FAILED'], ['ETIMEDOUT', 'OSS_NETWORK_FAILED'], ['AccessDenied', 'OSS_AccessDenied']]) {
    const failure = sanitizedOssError({ code, message: 'sensitive fixture details' })
    assert.equal(failure.code, expected)
    assert.ok(!failure.message.includes('sensitive fixture details'))
  }
  assert.equal(sanitizedOssError({}).code, 'OSS_OPERATION_FAILED')
  // Keep the installed SDK's V4 signer and replace only its outbound HTTP transport.
  // Empty prefix= fails against OSS V4; browsing the root must omit that query key.
  const listingTransport = new AliyunOssClient(config)
  const listingRequests: URL[] = []
  ;(listingTransport.client as any).urllib = { request: async (url: string, options: any) => {
    const requestUrl = new URL(url)
    assert.ok(options.headers.authorization.startsWith('OSS4-HMAC-SHA256 '))
    assert.ok(!requestUrl.searchParams.has('prefix') || requestUrl.searchParams.get('prefix') !== '')
    listingRequests.push(requestUrl)
    return { status: 200, headers: {}, data: Buffer.from('<ListBucketResult><IsTruncated>false</IsTruncated><KeyCount>0</KeyCount></ListBucketResult>') }
  } }
  try {
    assert.deepEqual(await listingTransport.listObjects(''), { directories: [], objects: [], nextCursor: null })
    assert.equal(listingRequests[0].searchParams.has('prefix'), false)
    assert.equal(listingRequests[0].searchParams.get('list-type'), '2')
    assert.equal(listingRequests[0].searchParams.get('delimiter'), '/')
    await listingTransport.listObjects('nested', 'fixture+cursor/=')
    assert.equal(listingRequests[1].searchParams.get('prefix'), 'nested/')
    assert.equal(listingRequests[1].searchParams.get('continuation-token'), 'fixture+cursor/=')
  } finally { listingTransport.close() }
  for (const prefix of ['../escape', '/absolute', 'a/../b', 'a\\b', 'a//b', 'a%2fb', 'a\0b']) assert.throws(() => validatePrefix(prefix))
  assert.equal(validatePrefix('backups'), 'backups/')
  assert.equal(nextScheduledTime('2026-01-30T08:00:00Z', 72, Date.parse('2026-01-30T08:00:00Z')), '2026-02-02T08:00:00.000Z')
  assert.equal(nextScheduledTime('2026-01-30T08:00:00Z', 72, Date.parse('2026-02-08T09:00:00Z')), '2026-02-11T08:00:00.000Z')
  for (const url of ['/api/health', '/api/auth/me', '/api/system-config/public?login=1', '/api/oauth/providers']) assert.equal(recoveryRequestAllowed('GET', url), true)
  assert.equal(recoveryRequestAllowed('POST', '/api/auth/check-2fa'), true)
  assert.equal(recoveryRequestAllowed('POST', '/api/auth/login'), true)
  for (const url of ['/api/instances', '/api/users', '/api/host-onboarding/inventory', '/api/admin/system-update/version', '/api/oauth/github/callback', '/api/agent/heartbeat', '/api/auth/register', '/api/ws', '/api/admin/system-update/start']) {
    for (const method of ['GET', 'POST', 'PUT', 'DELETE']) assert.equal(recoveryRequestAllowed(method, url), false)
  }
  assert.equal(recoveryRequestAllowed('POST', '/api/system-config/public'), false)
  assert.equal(validAssetName('certs/onboarding-gateway.key.pub'), true)
  assert.equal(validAssetName('certs/../../authorized_keys.pub'), false)
  assert.equal(validAssetName('database-globals.sql'), true)
  assert.equal(validAssetName('database-integrity.json'), true)
  const firstDump = '\\restrict RandomKey1\nCREATE ROLE example;\n\\unrestrict RandomKey1\n'
  const nextDump = '\\restrict RandomKey2\nCREATE ROLE example;\n\\unrestrict RandomKey2\n'
  assert.equal(normalizedDumpHash(firstDump), normalizedDumpHash(nextDump))
  assert.notEqual(normalizedDumpHash(firstDump), normalizedDumpHash(nextDump.replace('CREATE ROLE example;', 'CREATE ROLE different;')))
  const databaseIntegrity: DatabaseIntegrity = { format: 1, dataEncoding: 'postgres-record-text-v1', database: { encoding: 6, datcollate: 'C.UTF-8', datctype: 'C.UTF-8', datlocprovider: 'c' }, schemaSha256: 'b'.repeat(64), tables: [{ schema: 'public', name: 'orders', kind: 'r', rows: '3', sha256: 'c'.repeat(64) }], sequences: [{ schema: 'public', name: 'orders_id_seq', reference: 'public.orders_id_seq', lastValue: '9007199254740993', isCalled: true }], largeObjects: { objects: '1', pages: '2', sha256: 'd'.repeat(64) } }
  assertDatabaseIntegrity(databaseIntegrity, structuredClone(databaseIntegrity))
  for (const changed of [
    { ...databaseIntegrity, tables: [] },
    { ...databaseIntegrity, tables: [{ ...databaseIntegrity.tables[0], rows: '2' }] },
    { ...databaseIntegrity, tables: [{ ...databaseIntegrity.tables[0], sha256: 'e'.repeat(64) }] },
    { ...databaseIntegrity, schemaSha256: 'e'.repeat(64) },
    { ...databaseIntegrity, sequences: [{ ...databaseIntegrity.sequences[0], lastValue: '9007199254740992' }] },
    { ...databaseIntegrity, largeObjects: { ...databaseIntegrity.largeObjects, sha256: 'e'.repeat(64) } }
  ]) assert.throws(() => assertDatabaseIntegrity(databaseIntegrity, changed), /OSS_DATABASE_INTEGRITY_MISMATCH/)
  assert.throws(() => assertDatabaseIntegrity(databaseIntegrity, { ...databaseIntegrity, database: { ...databaseIntegrity.database, datcollate: 'C' } }), /OSS_DATABASE_LOCALE_MISMATCH/)

  const dump = join(workspace, 'db'), env = join(workspace, 'env'), encrypted = join(workspace, 'payload.enc')
  await writeFile(dump, Buffer.alloc(256 * 1024, 61)); await writeFile(env, 'ENCRYPTION_KEY=test-archive-key\n')
  const metadata = { format: 1 as const, id: randomUUID(), installationId: randomUUID(), version: '1.6.7', createdAt: new Date().toISOString(), migrationHash: 'a'.repeat(64), postgresMajor: 16, databaseBytes: 1024 * 1024 }
  const previewVersion = 'preview-' + 'a'.repeat(7)
  validateManifest({ ...metadata, version: previewVersion, files: [{ name: 'database.dump', size: 1, sha256: 'a'.repeat(64) }, { name: 'runtime.env', size: 1, sha256: 'b'.repeat(64) }] })
  for (const version of ['preview-', 'preview-' + 'a'.repeat(6), 'preview-not-a-commit', 'preview-' + 'a'.repeat(41)]) {
    assert.throws(() => validateManifest({ ...metadata, version, files: [{ name: 'database.dump', size: 1, sha256: 'a'.repeat(64) }, { name: 'runtime.env', size: 1, sha256: 'b'.repeat(64) }] }), /OSS_ARCHIVE_INVALID/)
  }
  assertBackupVersion(previewVersion, previewVersion)
  assert.throws(() => assertBackupVersion(previewVersion, 'preview-' + 'b'.repeat(7)), /OSS_APP_VERSION_UNSUPPORTED/)
  const previewPath = join(workspace, 'preview.enc')
  await encryptBackup([{ name: 'database.dump', path: dump }, { name: 'runtime.env', path: env }], { ...metadata, version: previewVersion }, 'test-password-123', previewPath)
  const previewBackup = await decryptBackup(previewPath, 'test-password-123', join(workspace, 'preview-restored'))
  assert.equal(previewBackup.manifest.version, previewVersion, 'release preview archive must survive authenticated round trip')
  const manifest = await encryptBackup([{ name: 'database.dump', path: dump }, { name: 'runtime.env', path: env }], metadata, 'test-password-123', encrypted)
  const gatewayAsset = join(workspace, 'source-gateway.conf'), environmentAsset = join(workspace, 'source-runtime.env'), mappingArchive = join(workspace, 'mapping.enc')
  await writeFile(gatewayAsset, '[Interface]\nListenPort = 51999\n')
  await writeFile(environmentAsset, oldEnvironment)
  await encryptBackup([{ name: 'database.dump', path: dump }, { name: 'runtime.env', path: environmentAsset }, { name: 'gateway.conf', path: gatewayAsset }], metadata, 'test-password-123', mappingArchive)
  const mappingDecoded = await decryptBackup(mappingArchive, 'test-password-123', join(workspace, 'mapping-restored'))
  const mappedArchive = parseEnv(mergeBackupEnvironment(replacement, await readFile(mappingDecoded.files.get('runtime.env')!, 'utf8'), await readFile(mappingDecoded.files.get('gateway.conf')!, 'utf8')))
  assert.equal(mappedArchive.ONBOARDING_WG_ENDPOINT, 'gateway.example.com:51999')
  assert.equal(mappedArchive.ONBOARDING_GATEWAY_FINGERPRINT, 'SHA256:' + 'A'.repeat(43))
  const controllerKey = join(workspace, 'controller.pem'), controllerIdentity = join(workspace, 'controller-identity.json'), controllerEnrollment = join(workspace, 'controller-enrollment.json')
  await writeFile(controllerKey, signingPem); await writeFile(controllerIdentity, JSON.stringify(identity)); await writeFile(controllerEnrollment, JSON.stringify(oldController))
  const controllerArchive = join(workspace, 'controller.enc')
  await encryptBackup([{ name: 'database.dump', path: dump }, { name: 'runtime.env', path: env }, { name: 'controller/signing.pem', path: controllerKey },
    { name: 'controller/identity.json', path: controllerIdentity }, { name: 'controller/enrollment.json', path: controllerEnrollment }], metadata, 'test-password-123', controllerArchive)
  const controllerDecoded = await decryptBackup(controllerArchive, 'test-password-123', join(workspace, 'controller-restored'))
  assert.equal(restoreControllerIdentity(await readFile(controllerDecoded.files.get('controller/signing.pem')!, 'utf8'),
    await readFile(controllerDecoded.files.get('controller/identity.json')!, 'utf8'), await readFile(controllerDecoded.files.get('controller/enrollment.json')!, 'utf8'),
    JSON.stringify(replacementController)).privatePem, signingPem)
  assert.equal(readableZipName('2026-10-21T02:03:04.567Z'), 'payincus-backup-20261021-020304-UTC.zip')
  const readablePath = join(workspace, 'readable.zip')
  const readableSources = [{ name: 'database.dump', path: dump }, { name: 'tables/public/orders.sql', path: env }]
  const readableMeta = await createReadableZip(readableSources, metadata.createdAt, 'test-password-123', readablePath)
  assert.ok(readableMeta.name.endsWith('-UTC.zip'))
  const expectedReadable = await Promise.all(readableSources.map(async f => ({ name: f.name, size: (await readFile(f.path)).length, sha256: await hashFile(f.path) })))
  await verifyReadableZip(readablePath, 'test-password-123', expectedReadable)
  await assert.rejects(verifyReadableZip(readablePath, 'wrong-password', expectedReadable), /OSS_READABLE_ZIP_INVALID/)
  await assert.rejects(verifyReadableZip(readablePath, 'test-password-123', expectedReadable.map(f => ({ ...f, sha256: 'f'.repeat(64) }))), /OSS_READABLE_ZIP_INVALID/)
  const corruptedReadable = join(workspace, 'readable-corrupt.zip'); const rawReadable = await readFile(readablePath); rawReadable[rawReadable.indexOf(Buffer.from('database.dump')) + 70] ^= 1; await writeFile(corruptedReadable, rawReadable)
  await assert.rejects(verifyReadableZip(corruptedReadable, 'test-password-123', expectedReadable), /OSS_READABLE_ZIP_INVALID/)
  const decoded = await decryptBackup(encrypted, 'test-password-123', join(workspace, 'decoded'))
  assert.deepEqual(decoded.manifest, manifest)
  assert.ok(decoded.zipPath)
  const inspectedZip = await openPromise(decoded.zipPath!)
  const zipNames: string[] = []
  for await (const entry of inspectedZip.eachEntry()) zipNames.push(entry.fileName)
  assert.deepEqual(zipNames.sort(), ['database.dump', 'manifest.json', 'runtime.env'])
  assert.equal(await hashFile(decoded.files.get('database.dump')!), await hashFile(dump))
  const wrap = async (plaintext: Buffer, magic: 'PICBKP01' | 'PICBKP02', name: string) => {
    const salt = randomBytes(16), nonce = randomBytes(12), header = Buffer.concat([Buffer.from(magic), salt, nonce])
    const key = scryptSync('test-password-123', salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 ** 2 })
    const cipher = createCipheriv('aes-256-gcm', key, nonce); cipher.setAAD(header)
    const path = join(workspace, name)
    await writeFile(path, Buffer.concat([header, cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]))
    key.fill(0); return path
  }
  const manifestBytes = Buffer.from(JSON.stringify(manifest)), length = Buffer.alloc(4); length.writeUInt32BE(manifestBytes.length)
  const legacy = await wrap(Buffer.concat([length, manifestBytes, await readFile(dump), await readFile(env)]), 'PICBKP01', 'legacy.enc')
  const legacyDecoded = await decryptBackup(legacy, 'test-password-123', join(workspace, 'legacy-decoded'))
  assert.deepEqual(legacyDecoded.manifest, manifest)
  assert.equal(await hashFile(legacyDecoded.files.get('database.dump')!), await hashFile(dump))
  const buildZip = async (extra: 'duplicate' | 'missing' | 'symlink' | 'oversized' | 'hash-mismatch') => {
    const zip = new ZipFile(), chunks: Buffer[] = []
    const collected = (async () => { for await (const chunk of zip.outputStream as Readable) chunks.push(Buffer.from(chunk)); return Buffer.concat(chunks) })()
    zip.addBuffer(manifestBytes, 'manifest.json')
    if (extra !== 'missing') zip.addBuffer(await readFile(dump), 'database.dump', extra === 'symlink' ? { mode: 0o120777 } : {})
    const contents = await readFile(env)
    zip.addBuffer(extra === 'oversized' ? Buffer.alloc(2 * 1024 * 1024) : extra === 'hash-mismatch' ? Buffer.alloc(contents.length, 1) : contents, 'runtime.env')
    if (extra === 'duplicate') zip.addBuffer(contents, 'runtime.env')
    zip.end({ forceZip64Format: true, comment: '' }); return collected
  }
  for (const malformed of ['duplicate', 'missing', 'symlink', 'oversized', 'hash-mismatch'] as const) {
    const file = await wrap(await buildZip(malformed), 'PICBKP02', `${malformed}.enc`)
    const directory = join(workspace, `zip-${malformed}`)
    await assert.rejects(decryptBackup(file, 'test-password-123', directory), /OSS_ARCHIVE_/)
    assert.deepEqual(await readdir(directory), [], 'malformed ZIPs must leave no extracted files')
  }
  await assert.rejects(decryptBackup(encrypted, 'incorrect-password', join(workspace, 'wrong')), /OSS_ARCHIVE_AUTH_FAILED/)
  assert.deepEqual(await readdir(join(workspace, 'wrong')), [])
  const changed = await readFile(encrypted); changed[45] ^= 1
  const corrupt = join(workspace, 'corrupt.enc'); await writeFile(corrupt, changed)
  await assert.rejects(decryptBackup(corrupt, 'test-password-123', join(workspace, 'tampered')), /OSS_ARCHIVE_AUTH_FAILED/)
  assert.deepEqual(await readdir(join(workspace, 'tampered')), [])
  assert.throws(() => validateManifest({ ...manifest, files: [...manifest.files, { name: '../../etc/shadow', size: 0, sha256: 'a'.repeat(64) }] }), /OSS_ARCHIVE_PATH_INVALID/)
  assert.throws(() => validateManifest({ ...manifest, files: [manifest.files[0], manifest.files[0]] }), /OSS_ARCHIVE_PATH_INVALID/)

  // Execute the installed SDK's small PUT and multipart paths. Only the HTTP
  // boundary is replaced; SDK completion callbacks retain their real null shape.
  for (const bytes of [64, 256 * 1024]) {
    const upload = new AliyunOssClient(config), payload = join(workspace, `upload-${bytes}`)
    await writeFile(payload, Buffer.alloc(bytes, 37))
    const requests: Array<{ method: string; object: string }> = []
    ;(upload.client as any).request = async (params: any) => {
      if (params.stream) for await (const _chunk of params.stream) { /* consume local SDK stream */ }
      requests.push({ method: params.method, object: params.object })
      return { res: { status: 200, headers: { etag: 'fixture-etag' } }, data: { UploadId: 'fixture-upload-id' } }
    }
    upload.client.getStream = async () => ({ stream: Readable.from([await readFile(payload)]) } as never)
    let checkpoints = 0
    try {
      const prefix = await upload.upload(config, payload, { ...metadata, bytes, sha256: await hashFile(payload) }, join(workspace, `verify-${bytes}`), async checkpoint => {
        assert.equal(checkpoint.uploadId, 'fixture-upload-id'); checkpoints++
      })
      assert.equal(checkpoints > 0, bytes >= 100 * 1024)
      assert.equal(requests.at(-1)?.object, `${prefix}complete.json`)
      assert.equal(await hashFile(join(workspace, `verify-${bytes}`)), await hashFile(payload))
      // A damaged readback must not publish a completed backup marker.
      requests.length = 0
      upload.client.getStream = async () => ({ stream: Readable.from([Buffer.from('corrupt')]) } as never)
      await assert.rejects(upload.upload(config, payload, { ...metadata, bytes, sha256: await hashFile(payload) }, join(workspace, `bad-verify-${bytes}`)), /OSS_VERIFY_FAILED/)
      assert.ok(!requests.some(r => r.object?.endsWith('/complete.json')))
    } finally { upload.close() }
  }

  const transport = new AliyunOssClient(config)
  const companion = new AliyunOssClient(config)
  const published: string[] = []
  companion.client.multipartUpload = async (name: string) => { published.push(name); return {} as never }
  companion.client.put = async (name: string) => { published.push(name); return {} as never }
  companion.client.getStream = async (name: string) => ({ stream: Readable.from([await readFile(name.endsWith('.zip') ? readablePath : encrypted)]) } as never)
  try {
    await companion.upload(config, encrypted, { ...metadata, bytes: (await readFile(encrypted)).length, sha256: await hashFile(encrypted), readableZip: readableMeta }, join(workspace, 'both-verify'), undefined, readablePath)
    assert.deepEqual(published.map(name => name.split('/').at(-1)), ['payload.enc', readableMeta.name, 'complete.json'])
    published.length = 0
    companion.client.getStream = async (name: string) => ({ stream: Readable.from([name.endsWith('.zip') ? Buffer.from('bad zip') : await readFile(encrypted)]) } as never)
    await assert.rejects(companion.upload(config, encrypted, { ...metadata, bytes: (await readFile(encrypted)).length, sha256: await hashFile(encrypted), readableZip: readableMeta }, join(workspace, 'both-bad'), undefined, readablePath), /OSS_VERIFY_FAILED/)
    assert.ok(!published.some(name => name.endsWith('/complete.json')), 'ZIP readback failure must never publish success')
  } finally { companion.close() }
  const deleted: string[] = []
  const root = `${config.prefix}${config.installationId}/`
  const entries = [0, 1, 2, 3, 4, 5].map(i => ({ ...metadata, id: randomUUID(), installationId: config.installationId, prefix: `${root}${i}/`, bytes: 1, sha256: 'a'.repeat(64) }))
  // Exercise the real pruning loop with a controlled remote transport.
  transport.assertBackupBucket = async () => {}
  transport.backups = async () => entries
  transport.client.listV2 = async () => ({ objects: [], isTruncated: false } as never)
  transport.client.put = async () => ({} as never)
  transport.client.delete = async name => { deleted.push(name); return {} as never }
  for (const count of [1, 3, 5]) {
    deleted.length = 0
    await transport.retain({ ...config, retention: count }, new Set())
    assert.equal(deleted.length, (entries.length - count) * 3)
    assert.ok(deleted.every(key => key.startsWith(root)))
    assert.ok(deleted[0].endsWith('/complete.json'))
  }
  deleted.length = 0
  await transport.retain(config, new Set(entries.slice(1).map(b => b.prefix)))
  assert.equal(deleted.length, 0)
  transport.assertBackupBucket = async () => { throw new BackupError('OSS_AccessDenied') }
  await assert.rejects(transport.retain(config, new Set()), /OSS_AccessDenied/)
  assert.equal(deleted.length, 0)
  transport.close()
  const prune = new AliyunOssClient(config)
  const oldPrefix = `${root}${randomUUID()}/`
  const pruneDeleted: string[] = []
  prune.assertBackupBucket = async () => {}
  prune.backups = async () => [{ ...metadata, prefix: `${root}${metadata.id}/`, installationId: config.installationId, bytes: 1, sha256: 'a'.repeat(64) }, { ...metadata, prefix: oldPrefix, installationId: config.installationId, bytes: 1, sha256: 'a'.repeat(64) }]
  prune.client.listV2 = async (options: any) => ({ objects: options.prefix === oldPrefix ? [{ name: `${oldPrefix}${readableMeta.name}` }, { name: `${oldPrefix}unrelated.txt` }] : [], isTruncated: false } as never)
  prune.client.put = async () => ({} as never)
  prune.client.delete = async name => { pruneDeleted.push(name); return {} as never }
  try {
    await prune.retain({ ...config, retention: 1 }, new Set())
    assert.ok(pruneDeleted.includes(`${oldPrefix}${readableMeta.name}`))
    assert.ok(!pruneDeleted.includes(`${oldPrefix}unrelated.txt`))
  } finally { prune.close() }

  // Route authorization is checked on every endpoint, including read-only ones.
  process.env.DATABASE_URL = 'postgresql://localhost:5432/payincus_oss_test'
  process.env.PLATFORM_BACKUP_STATE_DIR = join(workspace, 'route-state')
  const { default: Fastify } = await import('fastify')
  const { default: routes } = await import('../src/routes/admin-aliyun-oss.js')
  const appServer = Fastify()
  appServer.decorate('authenticateAdmin', async (request: any, reply: any) => {
    if (!request.headers['x-test-user']) return reply.code(401).send({ error: 'Unauthorized' })
    request.user = { id: 1, role: 'admin', username: String(request.headers['x-test-user']) }
  })
  await appServer.register(routes, { prefix: '/api/admin/aliyun-oss' })
  try {
    for (const path of ['/config', '/regions', '/tasks', '/buckets', '/objects', '/backups']) {
      assert.equal((await appServer.inject({ url: `/api/admin/aliyun-oss${path}` })).statusCode, 401)
      assert.equal((await appServer.inject({ url: `/api/admin/aliyun-oss${path}`, headers: { 'x-test-user': 'ordinary-admin' } })).statusCode, 403)
      assert.equal((await appServer.inject({ url: `/api/admin/aliyun-oss${path}`, headers: { 'x-test-user': 'admin', host: 'demoadmin.payincus.com' } })).statusCode, 403)
    }
    const state = await appServer.inject({ url: '/api/admin/aliyun-oss/config', headers: { 'x-test-user': 'admin' } })
    assert.equal(state.statusCode, 200)
    assert.equal(state.json().config, null)
    process.env.PLATFORM_BACKUP_ALLOWED_ADMIN_IDS = 'invalid'
    assert.equal((await appServer.inject({ url: '/api/admin/aliyun-oss/config', headers: { 'x-test-user': 'admin' } })).statusCode, 403)
    delete process.env.PLATFORM_BACKUP_ALLOWED_ADMIN_IDS
  } finally { await appServer.close() }

  const source = await readFile(resolve(import.meta.dirname, '../src/services/platform-backup-worker.ts'), 'utf8')
  assert.ok(source.includes('CONTROLLER_BACKUP_FILES.every(name => files.has(name))'), 'partial controller identity must not be restored')
  assert.ok(source.includes('await verifyControllerEnrollment()') && source.includes("'OSS_CONTROLLER_PLATFORM_MISMATCH'"), 'controller identity and environment must be checked before backup')
  assert.ok(source.includes("files.set('controller/enrollment.json', enrollment)"), 'restore must use prepared replacement component catalog')
  assert.ok(source.indexOf("await client.upload(") < source.indexOf('await client.retain('), 'retention must follow verified upload')
  assert.ok(source.indexOf('await verifyDatabaseBackup(') < source.indexOf('await encryptBackup('), 'a backup must restore and match every source table before encryption or publication')
  const databaseSource = await readFile(resolve(import.meta.dirname, '../src/services/platform-backup-database.ts'), 'utf8')
  const dumpSource = databaseSource.slice(databaseSource.indexOf('export async function dumpDatabase('), databaseSource.indexOf('export async function restoreDatabase('))
  assert.ok(dumpSource.includes('--snapshot=') && dumpSource.includes('--large-objects') && !dumpSource.includes('--no-privileges') && !dumpSource.includes('--no-owner'), 'full dump must preserve ownership, grants and large objects under the shared snapshot')
  assert.ok(databaseSource.includes('--globals-only') && databaseSource.includes('OSS_DATABASE_FOREIGN_TABLE_UNSUPPORTED'), 'cluster authorization must be archived and silently omitted foreign data rejected')
  assert.ok(source.includes('rollbackJournal(directory)') && source.includes('protectedHealth()'), 'restore needs rollback and protected health verification')
  assert.equal((source.match(/await verifyBackupCompatibility\(/g) || []).length, 2, 'preview and final restore must both verify target compatibility')
  assert.ok(source.includes('raw.migrationHash === manifest.migrationHash') && source.includes('JSON.stringify(expected) === JSON.stringify(compatibility)'), 'authenticated raw history and preview destination identity must be pinned')
  assert.ok(source.indexOf('await verifyRestoredDatabase(staging, expected, directory, \'restore\')') < source.lastIndexOf('await verifyBackupCompatibility(plan.manifest'), 'verify archive data before isolated migrations change restored records')
  assert.ok(databaseSource.includes("/^incudal_(check|restore)_[a-f0-9]{32}$/") && databaseSource.includes("'server/node_modules/prisma/build/index.js'"), 'migration tooling must be trusted and restricted to isolated restore databases')
  assert.equal((source.match(/await createBackupRestoreDatabase\(staging/g) || []).length, 2, 'preview and restore must create staging databases with the authenticated backup locale')
  assert.ok(databaseSource.includes('LC_COLLATE ${quoteLiteral(properties.datcollate)} LC_CTYPE ${quoteLiteral(properties.datctype)}'), 'new-machine recovery must preserve the backup collation instead of inheriting destination defaults')
  assert.ok(source.includes("before-authorized-keys") && source.includes("await chmod(`${INSTALL}/server/certs/onboarding-gateway.key`, 0o640)"), 'gateway recovery must save local authorization and preserve backend key access')
  const app = await readFile(resolve(import.meta.dirname, '../src/app.ts'), 'utf8')
  assert.equal((source.match(/await refreshRestoredGateway\(gatewayBefore/g) || []).length, 2, 'restore and rollback must preserve unchanged live management tunnels')
  const gateway = await readFile(resolve(import.meta.dirname, '../src/services/platform-backup-gateway.ts'), 'utf8')
  assert.ok(gateway.includes('if (active && previous === next) return') && gateway.includes("['syncconf', 'incudal-mgmt', input]"), 'unchanged gateway state must avoid restart and changed peer configuration must synchronize live endpoints')
  const layout = await readFile(resolve(import.meta.dirname, '../../client/src/components/layout/AppLayout.vue'), 'utf8')
  assert.ok(layout.includes("fetch(buildApiUrl('/health')") && layout.includes('state.recoveryHeld === true'), 'layout must check the public protection state without loading privileged settings')
  assert.ok(layout.includes('<section v-if="recoveryHeld"') && layout.includes('oss.protectionMessage') && layout.includes('<slot v-if="!recoveryHeld || (isAdminEntry && route.name === \'admin-aliyun-oss\')"'), 'held business pages must show recovery guidance instead of misleading empty lists while keeping recovery controls reachable')
  assert.ok(app.indexOf('if (recoveryHeld()) {') < app.indexOf('await initPrismaDatabase('), 'recovery gate precedes initialization and background jobs')
  const helper = await readFile(resolve(import.meta.dirname, '../../deploy/incudal-online-task.sh.example'), 'utf8')
  assert.ok(helper.includes('flock -n 9') && helper.includes('verify_manifest'), 'privileged workers must serialize with OTA and verify code')
  const recoveryWorker = await readFile(resolve(import.meta.dirname, '../src/services/platform-backup-worker.ts'), 'utf8')
  assert.ok(recoveryWorker.includes('await pgQuery(QUARANTINE_RESTORED_GATEWAY_TASKS_SQL, [], staging)') &&
    recoveryWorker.indexOf('await pgQuery(QUARANTINE_RESTORED_GATEWAY_TASKS_SQL, [], staging)') < recoveryWorker.indexOf("journal.stage = 'switching'"),
  'restored text-status gateway tasks and bootstrap grants must be quarantined in staging before activation')
  const installer = await readFile(resolve(import.meta.dirname, '../../scripts/install-platform-backup.sh'), 'utf8')
  assert.ok(installer.includes('/usr/bin/systemctl daemon-reload') && !/^systemctl daemon-reload$/m.test(installer), 'startup installer must bypass the restricted task wrapper using the real systemctl path')
  const release = await readFile(resolve(import.meta.dirname, '../../.github/workflows/release.yml'), 'utf8')
  assert.ok(release.includes('cp scripts/install-platform-backup.sh release/scripts/'), 'release artifacts must include the backup executor installer')
  assert.ok(release.includes('cp scripts/platform-backup-recovery.py scripts/platform-backup-recovery-guide.md release/scripts/'), 'release must carry offline recovery instructions and tool')
  const freshInstall = await readFile(resolve(import.meta.dirname, '../../scripts/smoke-fresh-install.sh'), 'utf8')
  assert.ok(freshInstall.includes('RUN_BACKUP_COMPATIBILITY_DRILL=1') && freshInstall.includes('smoke-platform-backup-compatibility.mjs'), 'both release architectures must run isolated migration compatibility acceptance')
  for (const [sourcePath, publicPath] of [['scripts/platform-backup-recovery.py', 'client/public/recovery/payincus-recovery.py'], ['scripts/platform-backup-recovery-guide.md', 'client/public/recovery/恢复说明.md']]) assert.equal(await readFile(resolve(import.meta.dirname, '../..', sourcePath), 'utf8'), await readFile(resolve(import.meta.dirname, '../..', publicPath), 'utf8'))
  console.log('Platform backup guards passed: authenticated archive, tampering, paths, schedule, retention and restore boundaries.')
} finally {
  await rm(workspace, { recursive: true, force: true })
}
