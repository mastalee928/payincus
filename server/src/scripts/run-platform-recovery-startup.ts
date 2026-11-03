import '../config/env.js'
import { recoverInterruptedActivation } from '../services/platform-recovery-activation.js'
import { recoverInterruptedMapping } from '../services/platform-recovery-mapping-journal.js'
import { closePrismaDatabase } from '../db/prisma.js'
import { assertRestoreStartupSafe } from '../services/platform-recovery-restore-journal.js'
try {
  await assertRestoreStartupSafe()
  await recoverInterruptedMapping(process.argv[2] === 'ready')
  await recoverInterruptedActivation(process.argv[2] === 'ready')
}
catch { process.stderr.write('Recovery activation is incomplete; backend startup remains blocked.\n'); process.exitCode = 1 }
finally { await closePrismaDatabase() }
