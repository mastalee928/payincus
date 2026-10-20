import '../config/env.js'
import { runPlatformBackupTask, readWorkerRequest } from '../services/platform-backup-worker.js'

// The fixed root helper validates the sealed application and holds the operation flock.
try {
  await runPlatformBackupTask(await readWorkerRequest(process.argv[2] || ''))
} catch {
  // Never print SDK errors, environment values or database utility output.
  process.stderr.write('Platform backup task could not start; inspect the protected task status.\n')
  process.exitCode = 1
}
