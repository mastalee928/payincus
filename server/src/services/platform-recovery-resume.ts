// The hold remains the authority through every failure, including a failed stop.
// Runtime injection exercises the actual orchestration without touching systemd.
export interface RecoveryResumeRuntime {
  check: (phase: 'protected' | 'stopped') => Promise<void>
  stop: () => Promise<void>
  start: () => Promise<void>
  health: (held: boolean) => Promise<void>
  release: () => Promise<void>
  commit: () => Promise<void>
  committed: () => Promise<boolean>
  finish: () => Promise<void>
  restore: () => Promise<void>
  removeHold: () => Promise<void>
  restoreHold: () => Promise<void>
}
export async function resumeReviewedRecovery(runtime: RecoveryResumeRuntime) {
  await runtime.check('protected')
  let committed = false
  try {
    await runtime.stop()
    await runtime.check('stopped')
    await runtime.release()
    await runtime.start()
    await runtime.health(true)
    await runtime.commit()
    committed = true
    await runtime.removeHold()
    await runtime.health(false)
    await runtime.finish()
  } catch (error) {
    // After the durable commit, normal work may have started. Startup will
    // finish this committed activation; never roll business data backwards.
    // A rename may succeed before its directory fsync reports failure. Read the
    // durable journal before deciding whether restoring pre-release data is safe.
    if (committed || await runtime.committed()) throw error
    // Write the protection first, so even a running backend rejects new work.
    await runtime.restoreHold()
    await runtime.stop()
    try { await runtime.restore() }
    finally { await runtime.start(); await runtime.health(true) }
    throw error
  }
}
