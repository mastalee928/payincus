#!/usr/bin/env node
// Build-time acquisition only. Production reads these local archives and has
// no URL fallback. Both architectures ship for mixed-controller/host setups.
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, open, stat, rm, rename, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const exec = promisify(execFile)
const root = fileURLToPath(new URL('..', import.meta.url)), output = join(root, 'server/images'), cache = join(root, '.cache/bundled-system-images')
const sources = {
  amd64: { size: 128196729, sha256: '7343b1d120bfadde3888c221d959501b9991ffaea81e60f977555c94775ab463' },
  arm64: { size: 126189063, sha256: '54fb35a5532b1c17c3102237b31fa4086166f09339aa723f44d8ed0846864831' }
}
async function hashFile(path) {
  const hash = createHash('sha256')
  for await (const data of createReadStream(path)) hash.update(data)
  return hash.digest('hex')
}
await mkdir(output, { recursive: true }); await mkdir(cache, { recursive: true })
const converter = join(root, 'server/templates/prepare-owner-debian11-image.py')
const revision = createHash('sha256').update(await readFile(converter)).update(await readFile(join(root, 'server/templates/owner-debian11-bootstrap.sh'))).digest('hex')
const images = {}
for (const [arch, source] of Object.entries(sources)) {
  const raw = join(cache, `debian11-${arch}.tar.gz`), converted = join(output, `debian11-cloud-${arch}.tar.gz`)
  let ready = false
  try { ready = (await stat(raw)).size === source.size && await hashFile(raw) === source.sha256 } catch { /* No verified build cache. */ }
  if (!ready) {
    const temporary = raw + '.download'
    const descriptor = await open(temporary, 'w', 0o600)
    try {
      const response = await fetch(`https://github.com/xkatld/zjmf-lxd-server/releases/download/images/debian11-${arch}.tar.gz`, { signal: AbortSignal.timeout(180000) })
      if (!response.ok || !response.body) throw Error('Bundled image source unavailable')
      let size = 0
      for await (const chunk of response.body) {
        size += chunk.length; if (size > source.size) throw Error('Bundled image source size mismatch')
        let offset = 0
        while (offset < chunk.length) { const result = await descriptor.write(chunk, offset, chunk.length - offset); if (!result.bytesWritten) throw Error('Bundled image write failed'); offset += result.bytesWritten }
      }
      await descriptor.close()
      if (size !== source.size || await hashFile(temporary) !== source.sha256) throw Error('Bundled image source hash mismatch')
      await rename(temporary, raw)
    } catch (error) { await descriptor.close().catch(() => {}); await rm(temporary, { force: true }); throw error }
  }
  const temporary = converted + '.build'
  await rm(temporary, { force: true })
  const result = await exec(process.platform === 'win32' ? 'python' : 'python3', [converter, raw, temporary, arch], { timeout: 180000, maxBuffer: 8192 })
  const metadata = JSON.parse(result.stdout)
  if (metadata.sourceSha256 !== source.sha256 || metadata.sha256 !== await hashFile(temporary)) throw Error('Bundled derivative was not verified')
  await rename(temporary, converted)
  images[arch] = metadata
  console.log(`PASS bundled Debian 11 ${arch}: ${metadata.size} bytes, ${metadata.sha256}`)
}
await writeFile(join(output, 'manifest.json'), JSON.stringify({ version: 1, preparationRevision: revision, images }, null, 2) + '\n')
