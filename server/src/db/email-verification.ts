/**
 * Email verification code database operations
 */

import { prisma } from './prisma.js'
import crypto from 'crypto'
import type { Prisma } from '@prisma/client'
import { EMAIL_VERIFICATION_LOCK_NAMESPACE, advisoryTransactionLockString } from './advisory-locks.js'

export type EmailVerificationPurpose = 'register' | 'password_reset' | 'change_email'

// Verification code expiration time in minutes
const CODE_EXPIRATION_MINUTES = 10

// Rate limit: max codes per email per hour
const MAX_CODES_PER_HOUR = 5
const MAX_VERIFICATION_ATTEMPTS = 5

function purposeWhere(purpose: EmailVerificationPurpose) {
    // Legacy unscoped codes can finish registration only. They must never
    // authorize password resets or changing another account's address.
    return purpose === 'register' ? { in: [purpose, 'general'] } : purpose
}

/**
 * Generate a cryptographically secure random 6-digit verification code
 */
export function generateVerificationCode(): string {
    // Use crypto.randomInt for secure random number generation
    const min = 100000
    const max = 999999
    return crypto.randomInt(min, max + 1).toString()
}

function hashVerificationCode(code: string): string {
    return `sha256:${crypto.createHash('sha256').update(code).digest('hex')}`
}

function verificationCodeMatches(storedCode: string, inputCode: string): boolean {
    if (storedCode.startsWith('sha256:')) {
        return storedCode === hashVerificationCode(inputCode)
    }

    return storedCode === inputCode
}

/**
 * Create a new email verification code
 */
export async function createVerificationCode(
    email: string,
    purpose: EmailVerificationPurpose
): Promise<{ code: string; expiresAt: Date } | null> {
    const normalizedEmail = email.toLowerCase().trim()
    return prisma.$transaction(async tx => {
        await advisoryTransactionLockString(tx, EMAIL_VERIFICATION_LOCK_NAMESPACE, normalizedEmail)
        const now = new Date()
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)
        const recentCount = await tx.emailVerificationCode.count({
            where: {
                email: normalizedEmail,
                createdAt: { gte: oneHourAgo }
            }
        })

        if (recentCount >= MAX_CODES_PER_HOUR) {
            return null // Rate limited
        }

        // Expire existing pending codes so only the newest code works while recent rows remain for rate limiting.
        await tx.emailVerificationCode.updateMany({
            where: {
                email: normalizedEmail,
                purpose: purposeWhere(purpose),
                expiresAt: { gt: now }
            },
            data: { expiresAt: now }
        })

        // Generate new code
        const code = generateVerificationCode()
        const codeHash = hashVerificationCode(code)
        const expiresAt = new Date(now.getTime() + CODE_EXPIRATION_MINUTES * 60 * 1000)

        await tx.emailVerificationCode.create({
            data: {
                email: normalizedEmail,
                purpose,
                code: codeHash,
                expiresAt
            }
        })

        return { code, expiresAt }
    })
}

/**
 * Verify an email verification code
 */
export async function verifyCode(
    email: string,
    code: string,
    purpose: EmailVerificationPurpose
): Promise<boolean> {
    return prisma.$transaction(tx => verifyCodeInTransaction(tx, email, code, purpose))
}

/** Use the caller's transaction so an unsuccessful account write cannot consume the code. */
export async function verifyCodeInTransaction(
    tx: Prisma.TransactionClient,
    email: string,
    code: string,
    purpose: EmailVerificationPurpose
): Promise<boolean> {
    const normalizedEmail = email.toLowerCase().trim()
    await advisoryTransactionLockString(tx, EMAIL_VERIFICATION_LOCK_NAMESPACE, normalizedEmail)
    const now = new Date()
    const record = await tx.emailVerificationCode.findFirst({
        where: {
            email: normalizedEmail,
            purpose: purposeWhere(purpose),
            expiresAt: { gt: now },
            consumedAt: null,
            attempts: { lt: MAX_VERIFICATION_ATTEMPTS }
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
    })

    if (!record) {
        return false
    }
    if (!verificationCodeMatches(record.code, code)) {
        await tx.emailVerificationCode.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } })
        return false
    }

    // Claim the code atomically so repeated concurrent submissions fail cleanly.
    const claimed = await tx.emailVerificationCode.updateMany({
        where: { id: record.id, consumedAt: null, expiresAt: { gt: now }, attempts: { lt: MAX_VERIFICATION_ATTEMPTS } },
        data: { consumedAt: now }
    })

    return claimed.count === 1
}

/**
 * Delete expired verification codes (cleanup job)
 */
export async function cleanupExpiredCodes(): Promise<number> {
    const result = await prisma.emailVerificationCode.deleteMany({
        where: {
            expiresAt: { lt: new Date() },
            createdAt: { lt: new Date(Date.now() - 60 * 60 * 1000) }
        }
    })
    return result.count
}

/**
 * Check if an email has a valid pending verification code
 */
export async function hasPendingCode(
    email: string,
    purpose: EmailVerificationPurpose
): Promise<boolean> {
    const normalizedEmail = email.toLowerCase().trim()
    
    const count = await prisma.emailVerificationCode.count({
        where: {
            email: normalizedEmail,
            purpose: purposeWhere(purpose),
            consumedAt: null,
            attempts: { lt: MAX_VERIFICATION_ATTEMPTS },
            expiresAt: { gt: new Date() }
        }
    })

    return count > 0
}
