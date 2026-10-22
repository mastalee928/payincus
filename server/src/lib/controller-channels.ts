import { createHash, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';
import { ControllerConfigError, controllerSigningKeyId, parseControllerPrepareConfig, type ControllerConfigContext, type ControllerObservedState } from './controller-config.js';
const PREFIX = 'payincus/host-management-channels/v1\n';
export interface ManagementChannel {
    slot: 'a' | 'b';
    gatewayId: string;
    endpointHost: string;
    endpointPort: number;
    publicKey: string;
    nodeAddress: string;
    controlAddress: string;
    mtu: number;
}
export interface ManagementChannels {
    schemaVersion: 1;
    purpose: 'host-management-channels';
    platformId: string;
    nodeId: string;
    epoch: string;
    sequence: string;
    issuedAt: number;
    expiresAt: number;
    channels: ManagementChannel[];
}
function require(condition: unknown): asserts condition { if (!condition)
    throw new ControllerConfigError('CONTROLLER_CHANNELS_INVALID'); }
export function parseManagementChannels(input: unknown): ManagementChannels {
    require(input && typeof input === 'object' && !Array.isArray(input));
    const row = input as ManagementChannels;
    const fields = ['schemaVersion', 'purpose', 'platformId', 'nodeId', 'epoch', 'sequence', 'issuedAt', 'expiresAt', 'channels'];
    require(Object.keys(row).length === fields.length && fields.every(key => Object.hasOwn(row, key)) && row.schemaVersion === 1 && row.purpose === 'host-management-channels');
    require(Array.isArray(row.channels) && row.channels.length > 0 && row.channels.length <= 2);
    const addresses = new Set<string>(), gateways = new Set<string>(), keys = new Set<string>();
    const channels = row.channels.map((channel, index) => {
        require(channel && Object.keys(channel).length === 8 && ['slot', 'gatewayId', 'endpointHost', 'endpointPort', 'publicKey', 'nodeAddress', 'controlAddress', 'mtu'].every(key => Object.hasOwn(channel, key)));
        require((channel.slot === 'a' || channel.slot === 'b') && (index === 0 || channel.slot > row.channels[index - 1].slot) && Number.isInteger(channel.mtu) && channel.mtu >= 1280 && channel.mtu <= 1420);
        const { slot, mtu, ...gateway } = channel;
        const parsed = parseControllerPrepareConfig({ schemaVersion: 1, purpose: 'controller-prepare', platformId: row.platformId, nodeId: row.nodeId,
            controllerId: row.platformId, requestId: row.nodeId, epoch: row.epoch, sequence: row.sequence, issuedAt: row.issuedAt, expiresAt: row.expiresAt, panelBaseUrl: 'https://validation.example.com', gateway }).gateway;
        require(!addresses.has(parsed.nodeAddress) && !addresses.has(parsed.controlAddress) && !gateways.has(parsed.gatewayId) && !keys.has(parsed.publicKey));
        addresses.add(parsed.nodeAddress);
        addresses.add(parsed.controlAddress);
        gateways.add(parsed.gatewayId);
        keys.add(parsed.publicKey);
        return { slot, ...parsed, mtu };
    });
    return { schemaVersion: 1, purpose: 'host-management-channels', platformId: row.platformId, nodeId: row.nodeId, epoch: row.epoch, sequence: row.sequence, issuedAt: row.issuedAt, expiresAt: row.expiresAt, channels };
}
export function signManagementChannels(input: ManagementChannels, key: KeyObject): string {
    require(key.type === 'private' && key.asymmetricKeyType === 'ed25519');
    const publicKey = createPublicKey(key).export({ type: 'spki', format: 'der' }).subarray(12).toString('base64'), keyId = controllerSigningKeyId(publicKey);
    const payload = Buffer.from(JSON.stringify(parseManagementChannels(input))).toString('base64');
    return JSON.stringify({ schemaVersion: 1, keyId, payload, signature: sign(null, Buffer.from(PREFIX + keyId + '\n' + payload), key).toString('base64') });
}
export function verifyManagementChannels(encoded: string, context: ControllerConfigContext): {
    config: ManagementChannels;
    observed: ControllerObservedState;
    duplicate: boolean;
} {
    require(typeof encoded === 'string' && Buffer.byteLength(encoded) <= 12288 && Number.isSafeInteger(context.now) && context.now > 0);
    const env = JSON.parse(encoded) as {
        schemaVersion: number;
        keyId: string;
        payload: string;
        signature: string;
    };
    require(env && env.schemaVersion === 1 && Object.keys(env).length === 4 && encoded === JSON.stringify({ schemaVersion: 1, keyId: env.keyId, payload: env.payload, signature: env.signature }) && Object.hasOwn(context.trustedKeys, env.keyId));
    const publicKey = context.trustedKeys[env.keyId];
    require(controllerSigningKeyId(publicKey) === env.keyId);
    const raw = Buffer.from(env.payload, 'base64'), signature = Buffer.from(env.signature, 'base64');
    require(raw.length <= 6144 && raw.toString('base64') === env.payload && signature.length === 64 && signature.toString('base64') === env.signature);
    require(verify(null, Buffer.from(PREFIX + env.keyId + '\n' + env.payload), createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(publicKey, 'base64')]), type: 'spki', format: 'der' }), signature));
    const config = parseManagementChannels(JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(raw)));
    require(raw.equals(Buffer.from(JSON.stringify(config))) && config.platformId === context.platformId && config.nodeId === context.nodeId && config.issuedAt <= context.now + 5000 && config.expiresAt > context.now);
    const observed: ControllerObservedState = { schemaVersion: 1, platformId: config.platformId, nodeId: config.nodeId, epoch: config.epoch, sequence: config.sequence, payloadSha256: createHash('sha256').update(raw).digest('hex') };
    let duplicate = false;
    if (context.previous) {
        const old = context.previous;
        require(old.schemaVersion === 1 && old.platformId === config.platformId && old.nodeId === config.nodeId && /^[a-f0-9]{64}$/.test(old.payloadSha256));
        for (const value of [old.epoch, old.sequence])
            require(/^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n);
        require(BigInt(config.epoch) > BigInt(old.epoch) || (config.epoch === old.epoch && BigInt(config.sequence) >= BigInt(old.sequence)));
        if (config.epoch === old.epoch && config.sequence === old.sequence) {
            require(observed.payloadSha256 === old.payloadSha256);
            duplicate = true;
        }
    }
    return { config, observed, duplicate };
}
