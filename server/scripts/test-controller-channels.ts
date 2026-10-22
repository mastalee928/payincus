import assert from 'node:assert/strict';
import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { controllerSigningKeyId } from '../src/lib/controller-config.js';
import { signManagementChannels, verifyManagementChannels, type ManagementChannels } from '../src/lib/controller-channels.js';
const root = generateKeyPairSync('ed25519'), attacker = generateKeyPairSync('ed25519');
const publicKey = createPublicKey(root.privateKey).export({ type: 'spki', format: 'der' }).subarray(12).toString('base64');
const now = Date.now(), platformId = '11111111-1111-4111-8111-111111111111', nodeId = '22222222-2222-4222-8222-222222222222';
const config: ManagementChannels = { schemaVersion: 1, purpose: 'host-management-channels', platformId, nodeId, epoch: '2', sequence: '1', issuedAt: now, expiresAt: now + 600000,
    channels: [{ slot: 'a', gatewayId: '33333333-3333-4333-8333-333333333333', endpointHost: 'gateway-a.example.com', endpointPort: 51820, publicKey: Buffer.alloc(32, 7).toString('base64'), nodeAddress: '10.250.1.2', controlAddress: '10.250.1.1', mtu: 1380 },
        { slot: 'b', gatewayId: '44444444-4444-4444-8444-444444444444', endpointHost: 'gateway-b.example.com', endpointPort: 51821, publicKey: Buffer.alloc(32, 8).toString('base64'), nodeAddress: '10.250.2.2', controlAddress: '10.250.2.1', mtu: 1380 }] };
const keyId = controllerSigningKeyId(publicKey), trust = { platformId, nodeId, now, trustedKeys: { [keyId]: publicKey } };
const encoded = signManagementChannels(config, root.privateKey), first = verifyManagementChannels(encoded, trust);
assert.equal(first.config.channels.length, 2);
assert.equal(verifyManagementChannels(encoded, { ...trust, previous: first.observed }).duplicate, true);
for (const changed of [
    { channels: [{ ...config.channels[0], slot: 'c' }] }, { channels: [config.channels[1], config.channels[0]] },
    { channels: [config.channels[0], { ...config.channels[1], nodeAddress: config.channels[0].nodeAddress }] },
    { channels: [config.channels[0], { ...config.channels[1], publicKey: config.channels[0].publicKey }] },
    { channels: [{ ...config.channels[0], allowedIPs: '0.0.0.0/0' }] }, { channels: [{ ...config.channels[0], mtu: 9000 }] },
    { channels: [{ ...config.channels[0], endpointHost: '127.0.0.1' }] }, { channels: [] }
])
    assert.throws(() => signManagementChannels({ ...config, ...changed } as ManagementChannels, root.privateKey));
assert.throws(() => verifyManagementChannels(signManagementChannels(config, attacker.privateKey), trust));
assert.throws(() => verifyManagementChannels(encoded, { ...trust, nodeId: platformId }));
assert.throws(() => verifyManagementChannels(encoded, { ...trust, now: config.expiresAt }));
assert.throws(() => verifyManagementChannels(encoded, { ...trust, previous: { ...first.observed, epoch: '3' } }));
assert.throws(() => verifyManagementChannels(signManagementChannels({ ...config, channels: [config.channels[0]] }, root.privateKey), { ...trust, previous: first.observed }));
const path = new URL('../../agent/internal/controllerconfig/testdata/channel-vectors.json', import.meta.url);
if (process.argv.includes('--write-fixtures')) {
    const cases = [{ name: 'dual channels', encoded, accept: true },
        { name: 'single degraded channel', encoded: signManagementChannels({ ...config, channels: [config.channels[0]] }, root.privateKey), accept: true },
        { name: 'only backup remains', encoded: signManagementChannels({ ...config, channels: [config.channels[1]] }, root.privateKey), accept: true },
        { name: 'expiry', encoded, accept: false, now: config.expiresAt },
        { name: 'wrong node', encoded, accept: false, nodeId: platformId },
        { name: 'wrong signature', encoded: signManagementChannels(config, attacker.privateKey), accept: false },
        { name: 'noncanonical envelope', encoded: encoded + '\n', accept: false },
        { name: 'rollback', encoded, accept: false, previous: { ...first.observed, epoch: '3' } },
        { name: 'duplicate', encoded, accept: true, previous: first.observed },
        { name: 'conflicting same generation', encoded: signManagementChannels({ ...config, channels: [config.channels[0]] }, root.privateKey), accept: false, previous: first.observed }];
    await writeFile(path, JSON.stringify({ platformId, nodeId, now, publicKey, keyId, cases }, null, 2) + '\n');
}
const fixtures = JSON.parse(await readFile(path, 'utf8'));
for (const item of fixtures.cases) {
    const check = () => verifyManagementChannels(item.encoded, { platformId: fixtures.platformId, nodeId: item.nodeId || fixtures.nodeId, now: item.now || fixtures.now, trustedKeys: { [fixtures.keyId]: fixtures.publicKey }, previous: item.previous });
    if (item.accept)
        check();
    else
        assert.throws(check, undefined, item.name);
}
console.log(`Management channel guards passed: ${fixtures.cases.length} shared Node/Go signature/identity/generation cases; no writer authority`);
