import { decryptSensitiveDataStrict } from './security.js'
import { OnboardingError, validateCredentials, type OnboardingCredentials } from './host-onboarding.js'

export function readOnboardingCredentials(ciphertext: string): OnboardingCredentials {
  try {
    const plaintext = decryptSensitiveDataStrict(ciphertext)
    if (!plaintext) throw Error()
    const value: unknown = JSON.parse(plaintext)
    validateCredentials(value)
    return { password: value.password, privateKey: value.privateKey }
  } catch { throw new OnboardingError('SSH_CREDENTIALS_INVALID') }
}
