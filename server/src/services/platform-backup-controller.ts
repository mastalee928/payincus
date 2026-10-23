import { createPrivateKey, createPublicKey } from 'node:crypto'
import { ensure } from './platform-backup-core.js'
import { controllerSigningKeyId } from '../lib/controller-config.js'

export const CONTROLLER_BACKUP_FILES = ['controller/signing.pem', 'controller/identity.json', 'controller/enrollment.json'] as const
const root = '/var/lib/incudal-gateway-controller'
const object = (value: unknown, keys: string[]) => {
  ensure(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === keys.sort().join(','), 'OSS_CONTROLLER_IDENTITY_INVALID')
  return value as Record<string, any>
}
function canonical(value: string) {
  const result = JSON.parse(value)
  ensure(JSON.stringify(result) === value, 'OSS_CONTROLLER_IDENTITY_INVALID')
  return result
}
export function restoreControllerIdentity(privatePem: string, identityJson: string, enrollmentJson: string, destinationEnrollmentJson: string) {
  const identity = object(canonical(identityJson), ['schemaVersion', 'platformId', 'signingKeyId', 'packageSigningKey'])
  const enrolled = object(canonical(enrollmentJson), ['schemaVersion', 'platformId', 'signingKeyPath', 'signingKeyId', 'packageSigningKey', 'components'])
  const destination = object(canonical(destinationEnrollmentJson), ['schemaVersion', 'platformId', 'signingKeyPath', 'signingKeyId', 'packageSigningKey', 'components'])
  ensure(identity.schemaVersion === 1 && enrolled.schemaVersion === 2 && destination.schemaVersion === 2 &&
    typeof identity.platformId === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(identity.platformId) &&
    enrolled.signingKeyPath === `${root}/signing.pem` && destination.signingKeyPath === `${root}/signing.pem`, 'OSS_CONTROLLER_IDENTITY_INVALID')
  ensure(['platformId', 'signingKeyId', 'packageSigningKey'].every(name => identity[name] === enrolled[name]) &&
    destination.packageSigningKey === identity.packageSigningKey, 'OSS_CONTROLLER_TRUST_MISMATCH')
  ensure(typeof identity.packageSigningKey === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(identity.packageSigningKey), 'OSS_CONTROLLER_TRUST_MISMATCH')
  ensure(Buffer.from(identity.packageSigningKey, 'base64').length === 32 && Buffer.from(identity.packageSigningKey, 'base64').toString('base64') === identity.packageSigningKey &&
    Buffer.from(identity.packageSigningKey, 'base64').some(byte => byte !== 0), 'OSS_CONTROLLER_TRUST_MISMATCH')
  const privateKey = createPrivateKey(privatePem)
  ensure(privateKey.asymmetricKeyType === 'ed25519', 'OSS_CONTROLLER_IDENTITY_INVALID')
  const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).subarray(12).toString('base64')
  ensure(controllerSigningKeyId(publicKey) === identity.signingKeyId && publicKey !== identity.packageSigningKey, 'OSS_CONTROLLER_IDENTITY_INVALID')
  const components = destination.components
  ensure(components && typeof components === 'object' && !Array.isArray(components) && Object.keys(components).length > 0 &&
    Object.keys(components).every(name => ['amd64', 'arm64'].includes(name)), 'OSS_CONTROLLER_COMPONENTS_INVALID')
  for (const value of Object.values(components)) {
    const component = object(value, ['directory', 'version', 'sourceCommit'])
    ensure(typeof component.directory === 'string' && /^\/var\/lib\/incudal-gateway-components\/[a-f0-9]{64}$/.test(component.directory) &&
      typeof component.version === 'string' && /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(component.version) &&
      typeof component.sourceCommit === 'string' && /^[a-f0-9]{40}$/.test(component.sourceCommit), 'OSS_CONTROLLER_COMPONENTS_INVALID')
  }
  // No archived component directory or binary is restored. The caller verifies
  // B's destination enrollment/packages before preparing and after publishing.
  return { platformId: identity.platformId as string, enrollment: JSON.stringify({ ...enrolled, components }), identity: identityJson, privatePem }
}
