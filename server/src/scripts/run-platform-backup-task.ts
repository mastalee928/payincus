import '../config/env.js'
import { runPlatformBackupTask, readWorkerRequest } from '../services/platform-backup-worker.js'
import { closePrismaDatabase } from '../db/prisma.js'

// The fixed root helper validates the sealed application and holds the operation flock.
try {
  await runPlatformBackupTask(await readWorkerRequest(process.argv[2] || ''))
} catch {
  // Never print SDK errors, environment values or database utility output.
  process.stderr.write('Platform backup task could not start; inspect the protected task status.\n')
  process.exitCode = 1
}
finally { try { await closePrismaDatabase() } catch { process.exitCode = 1 } }
// Imported authentication modules own periodic timers. This is a completed
// oneshot, not a backend: release its operation lock after awaited work/cleanup.
process.exit(process.exitCode || 0)
