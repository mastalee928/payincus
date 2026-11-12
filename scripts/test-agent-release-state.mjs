import assert from 'node:assert/strict'
import { checkPublishedAgentRelease as check } from './check-agent-release-state.mjs'
const commit = 'a'.repeat(40), version = 'v1.0.5', ref = 'refs/tags/agent-v1.0.5'
const assets = ['incudal-agent-x86_64-v1.0.5', 'incudal-agent-aarch64-v1.0.5', 'LICENSE'].map((name, i) => ({ name, size: i + 1, digest: 'sha256:' + String(i).repeat(64) }))
const release = { tag_name: 'agent-v1.0.5', draft: false, prerelease: false, assets }
const valid = { release, refs: { [ref]: commit }, version, commit, assets }
assert.equal(check({ ...valid, release: null, refs: {} }), false)
assert.equal(check(valid), true)
assert.equal(check({ ...valid, refs: { [ref]: 'b'.repeat(40), [`${ref}^{}`]: commit } }), true)
assert.equal(check({ ...valid, commit: 'b'.repeat(40), identicalPublishedSource: commit }), true,
  'verified identical build inputs and asset digests may reuse the immutable published source after a panel-only commit')
assert.throws(() => check({ ...valid, commit: 'b'.repeat(40), identicalPublishedSource: 'c'.repeat(40) }))
for (const change of [
  { release: null }, { refs: {} }, { refs: { [ref]: 'b'.repeat(40) } },
  { release: { ...release, draft: true } }, { release: { ...release, prerelease: true } },
  { release: { ...release, assets: assets.slice(1) } },
  { release: { ...release, assets: [...assets, assets[0]] } },
  { release: { ...release, assets: assets.map((a, i) => i ? a : { ...a, digest: null }) } },
  { release: { ...release, assets: assets.map((a, i) => i ? a : { ...a, size: 99 }) } },
]) assert.throws(() => check({ ...valid, ...change }))
console.log('PASS Agent first publication, immutable source/assets, annotated tags and incomplete release rejection')
