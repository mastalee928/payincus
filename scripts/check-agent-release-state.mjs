import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, appendFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function checkPublishedAgentRelease({ release, refs, version, commit, assets }) {
  assert.match(version, /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
  assert.match(commit, /^[a-f0-9]{40}$/)
  const tag = `agent-${version}`, ref = `refs/tags/${tag}`
  const resolved = refs[`${ref}^{}`] || refs[ref]
  if (!release) {
    assert.equal(resolved, undefined, 'Existing Agent tag without a complete release requires investigation')
    return false
  }
  assert.equal(release.tag_name, tag)
  assert.equal(release.draft, false)
  assert.equal(release.prerelease, version.includes('-'))
  assert.equal(resolved, commit, 'Stable Agent tag belongs to another source; increment the version')
  assert.deepEqual(release.assets.map(a => a.name).sort(), assets.map(a => a.name).sort())
  for (const asset of assets) {
    const published = release.assets.find(a => a.name === asset.name)
    assert.equal(published.size, asset.size, asset.name)
    assert.equal(published.digest, asset.digest, asset.name)
  }
  return true
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [version, commit, directory] = process.argv.slice(2)
  assert.match(version || '', /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
  assert.match(commit || '', /^[a-f0-9]{40}$/)
  const repository = process.env.GITHUB_REPOSITORY
  assert.match(repository || '', /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)
  const names = [`incudal-agent-x86_64-${version}`, `incudal-agent-aarch64-${version}`, 'LICENSE']
  const assets = names.map(name => {
    const data = readFileSync(resolve(directory, name))
    return { name, size: data.length, digest: 'sha256:' + createHash('sha256').update(data).digest('hex') }
  })
  const ref = `refs/tags/agent-${version}`
  const raw = execFileSync('git', ['ls-remote', 'origin', ref, `${ref}^{}`], { encoding: 'utf8' }).trim()
  const refs = Object.fromEntries(raw ? raw.split(/\r?\n/).map(line => { const [sha, name] = line.split(/\s+/); return [name, sha] }) : [])
  const response = await fetch(`https://api.github.com/repos/${repository}/releases/tags/agent-${version}`, {
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(30000)
  })
  if (response.status !== 404 && !response.ok) throw Error(`Agent release lookup failed: HTTP ${response.status}`)
  const exists = checkPublishedAgentRelease({ release: response.status === 404 ? null : await response.json(), refs, version, commit, assets })
  appendFileSync(process.env.GITHUB_OUTPUT, `exists=${exists}\n`)
  console.log(exists ? 'PASS existing Agent release has identical source and asset digests; publication skipped' : 'PASS Agent tag and release are unused; first publication allowed')
}
