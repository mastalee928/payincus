import '../config/env.js'
import { closePrismaDatabase } from '../db/prisma.js'
import { runGatewayInstallationTask } from '../services/gateway-installation-worker.js'

try {
  if (process.argv.length !== 3) throw new Error('task id required')
  await runGatewayInstallationTask(process.argv[2])
} catch {
  process.stderr.write('Gateway installation task did not complete; inspect its protected task state.\n')
  process.exitCode = 1
} finally { await closePrismaDatabase() }
