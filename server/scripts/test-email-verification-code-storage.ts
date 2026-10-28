import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const dbSource = readFileSync(resolve(__dirname, '../src/db/email-verification.ts'), 'utf8')
const authSource = readFileSync(resolve(__dirname, '../src/routes/auth.ts'), 'utf8')
const userSource = readFileSync(resolve(__dirname, '../src/routes/users.ts'), 'utf8')
const schemaSource = readFileSync(resolve(__dirname, '../prisma/schema.prisma'), 'utf8')
const migrationSource = readFileSync(
  resolve(__dirname, '../prisma/migrations/20260622000000_add_email_verification_purpose_hash/migration.sql'),
  'utf8'
)

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex + start.length)

  assert.ok(startIndex >= 0, `missing source section start: ${start}`)
  assert.ok(endIndex > startIndex, `missing source section end: ${end}`)

  return source.slice(startIndex, endIndex)
}

const createVerificationCodeSource = sourceBetween(
  dbSource,
  'export async function createVerificationCode(',
  '/**\n * Verify an email verification code'
)

assert.ok(
  dbSource.includes("export type EmailVerificationPurpose = 'register' | 'password_reset' | 'change_email'"),
  'email verification codes must use an explicit purpose type'
)

assert.ok(
  dbSource.includes("return `sha256:${crypto.createHash('sha256').update(code).digest('hex')}`"),
  'email verification codes must be hashed with sha256 before storage'
)

assert.ok(
  dbSource.includes('const codeHash = hashVerificationCode(code)') &&
    dbSource.includes('purpose,') &&
    dbSource.includes('code: codeHash'),
  'new email verification records must store purpose and hashed code'
)

assert.ok(
  createVerificationCodeSource.indexOf('const recentCount = await tx.emailVerificationCode.count({') <
    createVerificationCodeSource.indexOf('await tx.emailVerificationCode.updateMany({') &&
    createVerificationCodeSource.includes('await advisoryTransactionLockString(tx, EMAIL_VERIFICATION_LOCK_NAMESPACE, normalizedEmail)') &&
    createVerificationCodeSource.includes('expiresAt: { gt: now }') &&
    createVerificationCodeSource.includes('expiresAt: now'),
  'creating a new verification code must preserve recent rows for rate limiting while expiring older pending codes'
)

assert.ok(
  !createVerificationCodeSource.includes('await prisma.emailVerificationCode.deleteMany({'),
  'creating a new verification code must not delete recent rows before hourly rate limiting can count them'
)

assert.ok(
  dbSource.includes("purpose === 'register' ? { in: [purpose, 'general'] } : purpose") &&
    dbSource.includes("if (storedCode.startsWith('sha256:'))") &&
    dbSource.includes('return storedCode === inputCode'),
  'verification must scope purposes, restricting legacy general codes to registration while preserving plaintext compatibility'
)

assert.ok(
  dbSource.includes('const record = await tx.emailVerificationCode.findFirst({') &&
    dbSource.includes('attempts: { lt: MAX_VERIFICATION_ATTEMPTS }') &&
    !dbSource.includes('code,\n            expiresAt: { gt: new Date() }'),
  'verification lookup must not filter by raw code in Prisma'
)

assert.ok(
  dbSource.includes('const claimed = await tx.emailVerificationCode.updateMany({') &&
    dbSource.includes('data: { consumedAt: now }') &&
    dbSource.includes('consumedAt: null') &&
    dbSource.includes('return claimed.count === 1'),
  'verification consumption must conditionally mark the row used and preserve hourly send history'
)
assert.ok(
  !dbSource.includes('await prisma.emailVerificationCode.delete({\n        where: { id: record.id }'),
  'verification code consumption must not use delete(), which can throw on concurrent duplicate submissions'
)

assert.ok(
  authSource.includes("createVerificationCode(email, 'register')") &&
    authSource.includes('emailCode: smtpEnabled ? emailCode : undefined') &&
    readFileSync(resolve(__dirname, '../src/db/users.ts'), 'utf8').includes("verifyCodeInTransaction(tx, normalizedEmail, input.emailCode, 'register')") &&
    authSource.includes("createVerificationCode(email, 'password_reset')") &&
    authSource.includes('db.resetPasswordWithEmailVerification(resetState, code, passwordHash)'),
  'auth routes must isolate register and password-reset verification purposes'
)

assert.ok(
  userSource.includes("createVerificationCode(validationResult.normalizedEmail, 'change_email')") &&
    userSource.includes('db.updateUserProfileIfCurrent(profileState, updates, request.user, emailCode)') &&
    readFileSync(resolve(__dirname, '../src/db/users.ts'), 'utf8').includes("verifyCodeInTransaction(tx, data.email!, emailCode || '', 'change_email')"),
  'change-email routes must use the change_email verification purpose'
)

assert.ok(
  schemaSource.includes('purpose   String   @default("general")') &&
    schemaSource.includes('@@index([email, purpose, code])'),
  'Prisma schema must persist verification purpose and index purpose-aware lookups'
)

assert.ok(
  migrationSource.includes('ADD COLUMN IF NOT EXISTS "purpose" TEXT NOT NULL DEFAULT') &&
    migrationSource.includes('"email_verification_codes_email_purpose_code_idx"'),
  'migration must add purpose and purpose-aware lookup index'
)

console.log('email verification code storage checks passed')
