import assert from 'node:assert/strict';
import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { controllerSigningKeyId } from '../src/lib/controller-config.js';
import { signGatewayTransport, verifyGatewayTransport, type GatewayTransport } from '../src/lib/gateway-transport.js';
const root = generateKeyPairSync('ed25519'), other = generateKeyPairSync('ed25519'), now = Date.now();
const publicKey = createPublicKey(root.privateKey).export({ type: 'spki', format: 'der' }).subarray(12).toString('base64'), keyId = controllerSigningKeyId(publicKey);
const platformId = '11111111-1111-4111-8111-111111111111', gatewayId = '22222222-2222-4222-8222-222222222222';
const config: GatewayTransport = { schemaVersion: 1, purpose: 'gateway-transport', platformId, gatewayId, epoch: '2', sequence: '1', issuedAt: now, expiresAt: now + 600000,
    slot: 'a', address: '10.250.1.1', listenPort: 51971, mtu: 1380, peers: [{ nodeId: '33333333-3333-4333-8333-333333333333', publicKey: Buffer.alloc(32, 7).toString('base64'), address: '10.250.1.2', enabled: true }] };
const encoded = signGatewayTransport(config, root.privateKey), trust = { platformId, gatewayId, now, trustedKeys: { [keyId]: publicKey } }, first = verifyGatewayTransport(encoded, trust);
assert.equal(first.config.peers.length, 1);
for (const changed of [{ slot: 'x' }, { address: '8.8.8.8' }, { listenPort: 0 }, { mtu: 9000 }, { peers: [{ ...config.peers[0], command: 'run' }] }, { peers: [{ ...config.peers[0], address: config.address }] }, { peers: [{ ...config.peers[0], enabled: 'false' }] }]) {
    assert.throws(() => signGatewayTransport({ ...config, ...changed } as GatewayTransport, root.privateKey));
}
const path = new URL('../../agent/internal/controllerconfig/testdata/gateway-vectors.json', import.meta.url);
if (process.argv.includes('--write-fixtures')) {
    const cases = [{ name: 'valid gateway transport', encoded, accept: true }, { name: 'permanent tombstone', encoded: signGatewayTransport({ ...config, peers: [{ ...config.peers[0], enabled: false }] }, root.privateKey), accept: true },
        { name: 'empty first gateway', encoded: signGatewayTransport({ ...config, peers: [] }, root.privateKey), accept: true },
        { name: 'wrong signing identity', encoded: signGatewayTransport(config, other.privateKey), accept: false },
        { name: 'wrong gateway', encoded, accept: false, gatewayId: platformId }, { name: 'expired', encoded, accept: false, now: config.expiresAt },
        { name: 'noncanonical envelope', encoded: encoded + '\n', accept: false }, { name: 'lower epoch', encoded, accept: false, previous: { ...first.observed, epoch: '3' } },
        { name: 'same generation replay', encoded, accept: true, previous: first.observed }, { name: 'same generation conflict', encoded: signGatewayTransport({ ...config, peers: [] }, root.privateKey), accept: false, previous: first.observed }];
    await writeFile(path, JSON.stringify({ platformId, gatewayId, now, publicKey, keyId, cases }, null, 2) + '\n');
}
const fixtures = JSON.parse(await readFile(path, 'utf8'));
for (const item of fixtures.cases) {
    const check = () => verifyGatewayTransport(item.encoded, { platformId: fixtures.platformId, gatewayId: item.gatewayId || fixtures.gatewayId, now: item.now || fixtures.now, trustedKeys: { [fixtures.keyId]: fixtures.publicKey }, previous: item.previous });
    if (item.accept)
        check();
    else
        assert.throws(check, undefined, item.name);
}
console.log(`Gateway transport guards passed: ${fixtures.cases.length} shared Node/Go signature/identity/expiry/generation cases`);
