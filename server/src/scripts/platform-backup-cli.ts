import '../config/env.js'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { chown } from 'node:fs/promises'
import { ensure, normalizeConfig, readBackupConfig, sealSecret, statePath, taskResults, validateId, validatePrefix, writeBackupConfig, writeJson, type BackupTaskKind, type BackupTaskRequest } from '../services/platform-backup-core.js'
import { activeBackupTask } from '../services/platform-backup-scheduler.js'

// Root-only disaster recovery; input is stdin, never command-line credentials.
// Invoke the installed, sealed worker through the same systemd helper as the UI.
try {
  ensure(process.platform === 'linux' && process.getuid?.() === 0 && process.env.NODE_ENV === 'production', 'OSS_ROOT_HELPER_REQUIRED')
  const command = process.argv[2]
  if (command === 'status') {
    process.stdout.write(JSON.stringify(await taskResults(), null, 2) + '\n')
  } else {
    let input = ''
    for await (const chunk of process.stdin) { input += String(chunk); ensure(Buffer.byteLength(input) <= 16384, 'OSS_INPUT_TOO_LARGE') }
    const payload = input.trim() ? JSON.parse(input) as Record<string, unknown> : {}
    ensure(!await activeBackupTask(), 'OSS_TASK_BUSY')
    const config = await readBackupConfig()
    const exec = promisify(execFile)
    if (command === 'configure') {
      const normalized = normalizeConfig({ ...payload, enabled: false, revision: config?.revision }, config || undefined)
      await writeBackupConfig(normalized)
      await chown(statePath('inbox', 'config.json'), Number((await exec('/usr/bin/id', ['-u', 'incudal'])).stdout.trim()), Number((await exec('/usr/bin/id', ['-g', 'incudal'])).stdout.trim()))
      process.stdout.write('Backup configuration saved; scheduling remains disabled.\n')
    } else {
      ensure(command && ['backup', 'preview', 'restore', 'rollback', 'resume'].includes(command), 'OSS_COMMAND_INVALID')
      ensure(config, 'OSS_CONFIG_REQUIRED')
      const id = randomUUID()
      const request: BackupTaskRequest = { id, kind: command as BackupTaskKind, createdAt: new Date().toISOString(), createdBy: 0, config }
      if (command === 'preview') {
        request.sourcePrefix = validatePrefix(payload.prefix)
        ensure(typeof payload.password === 'string' && payload.password.length >= 12 && payload.password.length <= 256, 'OSS_PASSWORD_INVALID')
        request.password = sealSecret(payload.password)
      }
      if (command === 'restore') { request.previewId = validateId(payload.previewId); ensure(payload.confirmation === `RESTORE ${request.previewId}`, 'OSS_CONFIRMATION_REQUIRED'); request.confirmation = payload.confirmation }
      if (command === 'resume' || command === 'rollback') {
        const expected = command === 'resume' ? 'RESUME AFTER RECONCILIATION' : 'ROLLBACK RESTORE'
        ensure(payload.confirmation === expected, 'OSS_CONFIRMATION_REQUIRED'); request.confirmation = expected
      }
      await writeJson(statePath('inbox', `${id}.json`), request)
      await writeJson(statePath('inbox', 'active.json'), { id, kind: request.kind, status: 'pending', stage: 'queued', createdAt: request.createdAt, updatedAt: request.createdAt })
      await chown(statePath('inbox', 'active.json'), Number((await exec('/usr/bin/id', ['-u', 'incudal'])).stdout.trim()), Number((await exec('/usr/bin/id', ['-g', 'incudal'])).stdout.trim()))
      await exec('/usr/bin/systemctl', ['start', '--no-block', `incudal-platform-backup@${id}.service`], { timeout: 15000 })
      process.stdout.write(`Task submitted: ${id}\n`)
    }
  }
} catch {
  process.stderr.write('Operation failed. Check the command, protected input file and installed executor. No credential details are printed.\n')
  process.exitCode = 1
}
