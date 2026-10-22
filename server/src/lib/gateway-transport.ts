import { createHash, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';
import { isIPv4 } from 'node:net';
import { ControllerConfigError, controllerSigningKeyId, type ControllerObservedState } from './controller-config.js';
const PREFIX = 'payincus/gateway-transport/v1\n';
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
export interface GatewayTransportPeer {
    nodeId: string;
    publicKey: string;
    address: string;
    enabled: boolean;
}
export interface GatewayTransport {
    schemaVersion: 1;
    purpose: 'gateway-transport';
    platformId: string;
    gatewayId: string;
    epoch: string;
    sequence: string;
    issuedAt: number;
    expiresAt: number;
    slot: 'a' | 'b';
    address: string;
    listenPort: number;
    mtu: number;
    peers: GatewayTransportPeer[];
}
function require(condition: unknown): asserts condition { if (!condition)
    throw new ControllerConfigError('GATEWAY_TRANSPORT_INVALID'); }
function address(value: string): boolean { return typeof value === 'string' && isIPv4(value) && value.startsWith('10.') && !/^10\.10\.[0-3]\./.test(value); }
function parse(value: unknown): GatewayTransport {
    require(value && typeof value === 'object' && !Array.isArray(value));
    const row = value as GatewayTransport;
    const fields = ['schemaVersion', 'purpose', 'platformId', 'gatewayId', 'epoch', 'sequence', 'issuedAt', 'expiresAt', 'slot', 'address', 'listenPort', 'mtu', 'peers'];
    require(Object.keys(row).length === fields.length && fields.every(key => Object.hasOwn(row, key)) && row.schemaVersion === 1 && row.purpose === 'gateway-transport' && UUID.test(row.platformId) && UUID.test(row.gatewayId));
    for (const counter of [row.epoch, row.sequence])
        require(typeof counter === 'string' && /^[1-9][0-9]{0,18}$/.test(counter) && BigInt(counter) <= 9223372036854775807n);
    require(Number.isSafeInteger(row.issuedAt) && row.issuedAt > 0 && Number.isSafeInteger(row.expiresAt) && row.expiresAt > row.issuedAt && row.expiresAt - row.issuedAt <= 900000);
    require((row.slot === 'a' || row.slot === 'b') && address(row.address) && Number.isInteger(row.listenPort) && row.listenPort > 0 && row.listenPort <= 65535 && Number.isInteger(row.mtu) && row.mtu >= 1280 && row.mtu <= 1420 && Array.isArray(row.peers) && row.peers.length <= 256);
    const addresses = new Set([row.address]), keys = new Set<string>();
    const peers = row.peers.map((peer, index) => {
        require(peer && Object.keys(peer).length === 4 && ['nodeId', 'publicKey', 'address', 'enabled'].every(key => Object.hasOwn(peer, key)) && UUID.test(peer.nodeId) && (index === 0 || peer.nodeId > row.peers[index - 1].nodeId));
        require(address(peer.address) && !addresses.has(peer.address) && typeof peer.enabled === 'boolean' && typeof peer.publicKey === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(peer.publicKey) && Buffer.from(peer.publicKey, 'base64').toString('base64') === peer.publicKey && Buffer.from(peer.publicKey, 'base64').some(byte => byte !== 0) && !keys.has(peer.publicKey));
        addresses.add(peer.address);
        keys.add(peer.publicKey);
        return { nodeId: peer.nodeId, publicKey: peer.publicKey, address: peer.address, enabled: peer.enabled };
    });
    return { schemaVersion: 1, purpose: 'gateway-transport', platformId: row.platformId, gatewayId: row.gatewayId, epoch: row.epoch, sequence: row.sequence, issuedAt: row.issuedAt, expiresAt: row.expiresAt, slot: row.slot, address: row.address, listenPort: row.listenPort, mtu: row.mtu, peers };
}
export function signGatewayTransport(config: GatewayTransport, key: KeyObject): string {
    require(key.type === 'private' && key.asymmetricKeyType === 'ed25519');
    const publicKey = createPublicKey(key).export({ type: 'spki', format: 'der' }).subarray(12).toString('base64'), keyId = controllerSigningKeyId(publicKey), payload = Buffer.from(JSON.stringify(parse(config))).toString('base64');
    return JSON.stringify({ schemaVersion: 1, keyId, payload, signature: sign(null, Buffer.from(PREFIX + keyId + '\n' + payload), key).toString('base64') });
}
export function verifyGatewayTransport(encoded: string, trust: {
    platformId: string;
    gatewayId: string;
    now: number;
    trustedKeys: Readonly<Record<string, string>>;
    previous?: ControllerObservedState;
}): {
    config: GatewayTransport;
    observed: ControllerObservedState;
} {
    require(typeof encoded === 'string' && Buffer.byteLength(encoded) <= 65536 && Number.isSafeInteger(trust.now) && trust.now > 0);
    const env = JSON.parse(encoded) as {
        schemaVersion: number;
        keyId: string;
        payload: string;
        signature: string;
    };
    require(env && Object.keys(env).length === 4 && env.schemaVersion === 1 && encoded === JSON.stringify({ schemaVersion: 1, keyId: env.keyId, payload: env.payload, signature: env.signature }) && Object.hasOwn(trust.trustedKeys, env.keyId));
    const publicKey = trust.trustedKeys[env.keyId];
    require(controllerSigningKeyId(publicKey) === env.keyId);
    const raw = Buffer.from(env.payload, 'base64'), signature = Buffer.from(env.signature, 'base64');
    require(raw.length <= 40000 && raw.toString('base64') === env.payload && signature.length === 64 && signature.toString('base64') === env.signature && verify(null, Buffer.from(PREFIX + env.keyId + '\n' + env.payload), createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(publicKey, 'base64')]), type: 'spki', format: 'der' }), signature));
    const config = parse(JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(raw)));
    require(raw.equals(Buffer.from(JSON.stringify(config))) && config.platformId === trust.platformId && config.gatewayId === trust.gatewayId && config.issuedAt <= trust.now + 5000 && config.expiresAt > trust.now);
    const observed: ControllerObservedState = { schemaVersion: 1, platformId: config.platformId, nodeId: config.gatewayId, epoch: config.epoch, sequence: config.sequence, payloadSha256: createHash('sha256').update(raw).digest('hex') };
    if (trust.previous) {
        const old = trust.previous;
        require(old.schemaVersion === 1 && old.platformId === config.platformId && old.nodeId === config.gatewayId && /^[a-f0-9]{64}$/.test(old.payloadSha256));
        for (const counter of [old.epoch, old.sequence])
            require(/^[1-9][0-9]{0,18}$/.test(counter) && BigInt(counter) <= 9223372036854775807n);
        require(BigInt(config.epoch) > BigInt(old.epoch) || (config.epoch === old.epoch && BigInt(config.sequence) >= BigInt(old.sequence)));
        if (config.epoch === old.epoch && config.sequence === old.sequence)
            require(observed.payloadSha256 === old.payloadSha256);
    }
    return { config, observed };
}
