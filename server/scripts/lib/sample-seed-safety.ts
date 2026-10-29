import '../../src/config/env.js'

// Evaluate before importing database modules: sample seeds rewrite known users.
function assertSampleSeedAllowed(): void {
  const refuse = (): never => {
    throw new Error('Sample seed refused: use NODE_ENV=test or development, ALLOW_LOCAL_SAMPLE_SEED=1 and a loopback PostgreSQL database ending in _seed_test without URL parameters.')
  }
  if (!['test', 'development'].includes(process.env.NODE_ENV || '') || process.env.ALLOW_LOCAL_SAMPLE_SEED !== '1') refuse()

  let target: URL
  try { target = new URL(process.env.DATABASE_URL || '') } catch { return refuse() }
  if (!['postgres:', 'postgresql:'].includes(target.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) ||
    target.search || target.hash ||
    !/^\/[a-z][a-z0-9_]*_seed_test$/.test(target.pathname) || target.pathname.length > 64 ||
    (target.port && (!/^\d+$/.test(target.port) || Number(target.port) < 1 || Number(target.port) > 65535))) refuse()
}

assertSampleSeedAllowed()
