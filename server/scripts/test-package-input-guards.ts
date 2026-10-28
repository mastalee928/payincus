import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const source = readFileSync(resolve(__dirname, '../src/routes/packages.ts'), 'utf8')
const networkModesSource = readFileSync(resolve(__dirname, '../src/lib/network-modes.ts'), 'utf8')
const packageFormSource = readFileSync(resolve(__dirname, '../../client/src/views/resources/PackageFormView.vue'), 'utf8')

function includes(pattern: string, label: string): void {
  assert.ok(source.includes(pattern), `Missing ${label}: ${pattern}`)
}

function excludes(pattern: string, label: string): void {
  assert.ok(!source.includes(pattern), `Unexpected ${label}: ${pattern}`)
}

function routeSection(start: string, end: string): string {
  const startIndex = source.indexOf(start)
  assert.notEqual(startIndex, -1, `Missing section start: ${start}`)
  const endIndex = source.indexOf(end, startIndex + start.length)
  assert.notEqual(endIndex, -1, `Missing section end: ${end}`)
  return source.slice(startIndex, endIndex)
}

function sourceSection(input: string, start: string, end: string): string {
  const startIndex = input.indexOf(start)
  assert.notEqual(startIndex, -1, `Missing section start: ${start}`)
  const endIndex = input.indexOf(end, startIndex + start.length)
  assert.notEqual(endIndex, -1, `Missing section end: ${end}`)
  return input.slice(startIndex, endIndex)
}

includes('const MAX_PACKAGE_HOST_BINDINGS = 1000', 'package host binding cap')
includes('type NormalizedPackageInput = {', 'normalized package input type')
includes('function normalizePackageInput(input: unknown, options: { requireAll: boolean }): NormalizedPackageInput', 'package body normalizer')
includes('function normalizePackageHostIds(input: Record<string, unknown>, requireHostIds: boolean): number[] | undefined', 'host ID normalizer')
includes('!Number.isSafeInteger(hostId) || hostId <= 0 || uniqueIds.has(hostId)', 'host ID safe integer and duplicate guard')
includes('function normalizePackageHostStoragePools(input: Record<string, unknown>): Record<string, string | null> | undefined', 'host storage pool normalizer')
includes('!POSITIVE_ROUTE_ID_PATTERN.test(hostIdKey)', 'host mapping key strict parser')
includes('function normalizePackageHostTrafficMultipliers(input: Record<string, unknown>): Record<string, number> | undefined', 'host traffic multiplier normalizer')
includes('normalized[String(hostId)] = normalizeTrafficMultiplier(multiplier)', 'traffic multiplier route-boundary normalization')
includes('function normalizePackageRequiredId(value: unknown): number | null | undefined', 'required package ID normalizer')
includes('requirePackageInteger(value, \'前置套餐\', 1, Number.MAX_SAFE_INTEGER)', 'required package ID safe integer guard')
includes('input.globalQuotaMultiplier !== undefined', 'global quota multiplier must preserve absent field semantics')
includes('normalized.globalQuotaMultiplier = null', 'deprecated global quota multiplier remains nulled when submitted')

const createRoute = routeSection('// 创建套餐（管理员或满足准入条件的用户）', '// 更新套餐（管理员或套餐所有者）')
const updateRoute = routeSection('// 更新套餐（管理员或套餐所有者）', '// 删除套餐（管理员或套餐所有者）')

assert.ok(
  createRoute.includes('packageInput = normalizePackageInput(request.body, { requireAll: true })') &&
    createRoute.includes('const {') &&
    createRoute.includes('requiredPackageId') &&
    createRoute.includes('} = packageInput'),
  'package create route must normalize request body before use'
)

assert.ok(
  updateRoute.includes('packageInput = normalizePackageInput(request.body, { requireAll: false })') &&
    updateRoute.includes('const updateData: Parameters<typeof db.updatePackage>[1] = {}'),
  'package update route must normalize request body before use'
)

for (const forbiddenPattern of [
  'request.body as CreatePackageRequest & PackagePrerequisiteRequestFields',
  'PackagePrerequisiteRequestFields',
  '...restBody',
  'const updateData: Parameters<typeof db.updatePackage>[1] = { ...restBody }',
  'hostIds: hostIds!',
  'request.body.networkMode ||'
] as const) {
  excludes(forbiddenPattern, `legacy package body trust path ${forbiddenPattern}`)
}

assert.ok(
  updateRoute.includes('if (packageInput.name !== undefined) updateData.name = packageInput.name') &&
    updateRoute.includes('if (packageInput.description !== undefined) updateData.description = packageInput.description') &&
    updateRoute.includes('if (packageInput.cpuMax !== undefined) updateData.cpuMax = packageInput.cpuMax') &&
    updateRoute.includes('if (packageInput.active !== undefined) updateData.active = packageInput.active'),
  'package update route must allowlist normalized update fields'
)

includes('parseNullablePostgresBigIntInput(monthlyTrafficLimit)', 'normalized package monthly traffic parsing')
includes('hostTrafficMultipliers', 'normalized host traffic multipliers threaded into DB update')

const activeNetworkModeSection = sourceSection(
  networkModesSource,
  'export const ACTIVE_PACKAGE_NETWORK_MODES: NetworkMode[] = [',
  ']\n\nexport const LEGACY_IPV6_NAT_NETWORK_MODES'
)

assert.ok(
  source.includes('ACTIVE_PACKAGE_NETWORK_MODES') &&
    source.includes("networkMode: { type: 'string', enum: ACTIVE_PACKAGE_NETWORK_MODES }") &&
    activeNetworkModeSection.includes("'public_ipv4'") &&
    activeNetworkModeSection.includes("'public_ipv4_ipv6'") &&
    !activeNetworkModeSection.includes("'nat_ipv6_nat'") &&
    !activeNetworkModeSection.includes("'ipv6_nat'"),
  'new package network mode enum must expose public IPv4 modes and exclude legacy IPv6 NAT modes'
)

assert.ok(
  packageFormSource.includes("{ value: 'public_ipv4', labelKey: 'common.networkMode.public_ipv4' }") &&
    packageFormSource.includes("{ value: 'public_ipv4_ipv6', labelKey: 'common.networkMode.public_ipv4_ipv6' }") &&
    !packageFormSource.includes("{ value: 'nat_ipv6_nat'") &&
    !packageFormSource.includes("{ value: 'ipv6_nat'"),
  'package form network selector must expose public IPv4 modes and hide legacy IPv6 NAT modes'
)

console.log('package input guard tests passed')

assert.ok(
  packageFormSource.includes("watch(() => [route.name, route.params.id, sessionKey.value], reloadContext, { immediate: true, flush: 'sync' })") &&
    packageFormSource.includes('context.sequence === contextSequence') &&
    packageFormSource.includes('context.id === packageId.value') &&
    packageFormSource.includes('context.session === sessionKey.value') &&
    packageFormSource.includes('api.packages.get(id, controller.signal)') &&
    packageFormSource.includes('if (pkg.id !== id) throw new Error') &&
    packageFormSource.includes('!detailReady.value') &&
    packageFormSource.includes('onBeforeUnmount(() =>'),
  'package editor must bind reads and editable data to the active route/session, reject mismatched IDs and invalidate on unmount'
)
assert.ok(
  packageFormSource.includes('await Promise.all(requestedHostIds.map(hostId => loadHostStoragePools(hostId, context)))') &&
    packageFormSource.includes('sequence !== selectionSequence') &&
    packageFormSource.includes('sequence !== hostsSequence') &&
    packageFormSource.includes('v-else-if="loadError" role="alert"') &&
    packageFormSource.includes('@click="reloadContext"'),
  'package editor auxiliary requests must not mutate new contexts and detail failures must offer an in-place retry'
)
assert.ok(
  packageFormSource.includes('saving.value || saved.value || loading.value || !detailReady.value') &&
    packageFormSource.includes('hostIds: [...form.value.hostIds]') &&
    packageFormSource.includes('await api.packages.update(context.id, data as UpdatePackageRequest)') &&
    packageFormSource.includes('if (!isCurrent(context)) return\n  saved.value = true') &&
    packageFormSource.includes('if (isCurrent(context)) saving.value = false') &&
    packageFormSource.includes(':disabled="saving || saved"'),
  'package saves must reject duplicate submissions, snapshot the target/host IDs, freeze inputs and ignore obsolete completions'
)
