import { spawn } from 'node:child_process'

export class SystemUpdateCommandNotStopped extends Error {}
export async function runSystemUpdateCommand(command: string, args: string[], options: {
  cwd: string; env: NodeJS.ProcessEnv; timeoutMs?: number; capture?: boolean
  label?: string
  stdout?: (data: Buffer) => void; stderr?: (data: Buffer) => void
}): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const description = options.label || `${command} ${args.join(' ')}`
    const grouped = process.platform !== 'win32'
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, detached: grouped, stdio: ['ignore', 'pipe', 'pipe'] })
    let timedOut = false, output = '', errors = ''
    let deadline: ReturnType<typeof setTimeout> | undefined, force: ReturnType<typeof setTimeout> | undefined
    const signal = (value: NodeJS.Signals) => {
      try { if (grouped && child.pid) process.kill(-child.pid, value); else child.kill(value) }
      catch { /* Exit can race signal delivery; verify quiescence below. */ }
    }
    const groupExists = () => {
      if (!grouped || !child.pid) return false
      try { process.kill(-child.pid, 0); return true }
      catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH' }
    }
    if (options.timeoutMs) deadline = setTimeout(() => {
      timedOut = true; signal('SIGTERM'); force = setTimeout(() => signal('SIGKILL'), 2000)
    }, options.timeoutMs)
    child.stdout.on('data', (data: Buffer) => { if (options.capture) output += String(data); options.stdout?.(data) })
    child.stderr.on('data', (data: Buffer) => { if (options.capture) errors += String(data); options.stderr?.(data) })
    child.once('error', error => { clearTimeout(deadline); clearTimeout(force); reject(error) })
    child.once('close', async code => {
      clearTimeout(deadline); clearTimeout(force)
      const leftover = groupExists()
      if (timedOut || leftover) signal('SIGKILL')
      const stopDeadline = Date.now() + 5000
      while (groupExists() && Date.now() < stopDeadline) await new Promise(done => setTimeout(done, 50))
      if (groupExists()) { reject(new SystemUpdateCommandNotStopped('Update command children have not stopped; automatic rollback is unsafe')); return }
      if (timedOut) reject(new Error(`Command timed out: ${description}`))
      else if (leftover) reject(new Error(`Command exited with unfinished child processes: ${command}`))
      else if (code !== 0) reject(new Error(`Command failed with exit code ${code}: ${description}${errors ? '\n' + errors : ''}`))
      else resolve(output)
    })
  })
}
