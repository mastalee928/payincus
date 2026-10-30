import assert from 'node:assert/strict'
import { isValidRedirectUrl, getSafeRedirectUrl } from '../src/lib/redirect-validator.ts'

const validRedirects = ['/dashboard', '/a/b?x=1', '/a/b?x=1#details', ' /profile ']
const invalidRedirects = [
    '//evil.com',
    '/\\evil.com',
    '/%5cevil.com',
    '/%2f%2fevil.com',
    '/\\tevil',
    'javascript:alert(1)',
    'https://evil.com',
    '',
    '/path\\x',
    '/%5Cevil.com',
    '/%2Fevil.com',
    '/\t/evil.com',
    '/\n/evil.com',
    '/%0dLocation:evil',
    '/%0Aevil',
    '/javascript:alert(1)',
    '/data:text/plain,fixture',
    '/vbscript:fixture',
]

for (const redirect of validRedirects) {
    assert.equal(isValidRedirectUrl(redirect), true, `Expected redirect to be accepted: ${JSON.stringify(redirect)}`)
    assert.equal(getSafeRedirectUrl(redirect), redirect.trim())
    assert.equal(new URL(getSafeRedirectUrl(redirect), 'https://fixture.invalid').origin, 'https://fixture.invalid')
}

for (const redirect of invalidRedirects) {
    assert.equal(isValidRedirectUrl(redirect), false, `Expected redirect to be rejected: ${JSON.stringify(redirect)}`)
    assert.equal(getSafeRedirectUrl(redirect, '/profile'), '/profile')
}

console.log('Redirect validator guard checks passed')
