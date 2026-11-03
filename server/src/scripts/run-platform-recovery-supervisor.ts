import '../config/env.js'
import { superviseRecovery } from '../services/platform-recovery-supervisor.js'
import { closePrismaDatabase } from '../db/prisma.js'
try { await superviseRecovery() }
catch(error) {
  const code=String((error as {code?:unknown})?.code||'OSS_RECOVERY_SUPERVISOR_FAILED')
  process.stderr.write(`Recovery continuation: ${/^[A-Z0-9_]{1,100}$/.test(code)?code:'OSS_RECOVERY_SUPERVISOR_FAILED'}\n`)
  process.exitCode=1
}
finally { try { await closePrismaDatabase() } catch { process.exitCode = 1 } }
process.exit(process.exitCode || 0)
