<script setup lang="ts">
import HostReplacementModal from './HostReplacementModal.vue'
import HostRecoveryModal from './HostRecoveryModal.vue'
import HostPublicIpModal from './HostPublicIpModal.vue'
import PublicIpv6Addresses from '@/components/PublicIpv6Addresses.vue'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/api/admin'
import { useToast } from '@/stores/toast'
import { availableFlagCountryCodes, getLocalizedCountryName } from '@/utils/countryDisplay'
import type { HostSshConnection } from '@/types/host-pool'
import type { ManagedHost, UpdateHostGroupsRequest, HostMachineGroup, HostStockCounts, HostRegionGroup, ResourcePreset } from '@/types/api'
import { presetLabel } from '@/utils/poolCatalog'

const { t, te, locale } = useI18n()
const toast = useToast()
const syncingIpv6Host = ref<number | null>(null)
async function syncIpv6(host: ManagedHost) {
  if (syncingIpv6Host.value !== null) return
  syncingIpv6Host.value = host.id
  try { host.publicIpv6Sync = await api.hostOnboarding.syncIpv6(host.id) }
  catch { toast.error(t('ipv6Delivery.status.failed')) }
  finally { syncingIpv6Host.value = null }
}
const hosts = ref<ManagedHost[]>([])
const total = ref(0)
const page = ref(1)
const pages = computed(() => Math.max(1, Math.ceil(total.value / 20)))
const search = ref('')
const machineGroup = ref<number | ''>('')
const regionGroup = ref<number | ''>('')
const stock = ref<ManagedHost['stock'] | ''>('')
const groups = ref<HostMachineGroup[]>([])
const regions = computed(() => groups.value.find(group => group.id === machineGroup.value)?.regions || [])
const summary = ref<HostStockCounts>({ total: 0, available: 0, assigned: 0, unavailable: 0 })
const ungrouped = ref<HostStockCounts>({ total: 0, available: 0, assigned: 0, unavailable: 0 })
const loading = ref(true)
const failed = ref(false)
const selected = ref<number[]>([])
const allSelected = computed({
  get: () => hosts.value.length > 0 && hosts.value.every(host => selected.value.includes(host.id)),
  set: (value: boolean) => { selected.value = value ? hosts.value.map(host => host.id) : [] }
})
const groupTargets = ref<ManagedHost[]>([])
const machineAction = ref<'keep' | 'set' | 'clear'>('keep')
const regionAction = ref<'keep' | 'set' | 'clear'>('keep')
const newMachineGroup = ref<number | ''>('')
const newRegionGroup = ref<number | ''>('')
const targetMachine = computed(() => machineAction.value === 'set' ? newMachineGroup.value :
  machineAction.value === 'keep' && new Set(groupTargets.value.map(host => host.machineGroupId)).size === 1 ? groupTargets.value[0]?.machineGroupId : null)
const targetRegions = computed(() => groups.value.find(group => group.id === targetMachine.value)?.regions || [])
const showGroupManager = ref(false)
const groupEditor = ref<{ kind: 'machine' | 'region'; id?: number; parentId?: number; name: string; countryCode: string } | null>(null)
const removeGroup = ref<{ kind: 'machine' | 'region'; id: number; name: string } | null>(null)
const saving = ref(false)
const sshHost = ref<ManagedHost | null>(null)
const sshConnection = ref<HostSshConnection | null>(null)
const sshLoading = ref(false)
const sshForm = ref({ host: '', port: 22, username: 'root' })
const removeHost = ref<ManagedHost | null>(null)
const replacement = ref<{ id: number; name: string } | null>(null)
const recoveryHost = ref<ManagedHost | null>(null)
const publicIpHost = ref<ManagedHost | null>(null)
const protocolRequests = new Map<number, string>()
async function changeProtocol(host: ManagedHost, event: Event) {
  const protocol = (event.target as HTMLSelectElement).value as 'tcp' | 'tcp_udp'
  await applyProtocol(host, protocol)
}
async function applyProtocol(host: ManagedHost, protocol: 'tcp' | 'tcp_udp') {
  if (saving.value) return
  saving.value = true
  try {
    await api.hostOnboarding.setProtocol(host.id, protocol)
    protocolRequests.set(host.id, protocol)
    toast.success(t('hostPoolOps.protocolSubmitted'))
    await refresh()
  }
  catch { toast.error(t('hostPoolOps.protocolFailed')); await refresh() }
  finally { saving.value = false }
}
function sellReasonText(reason: string) {
  if (reason === 'ip-pending') return t('hostIpSync.status.pending')
  if (reason === 'quarantined') return t('hostPoolOps.quarantined')
  const keys: Record<string, string> = { 'no-spec': 'noSpec', 'not-single-tenant': 'notSingleTenant', 'not-ready': 'notReady', 'no-price': 'noPrice' }
  return t('hostInventory.sellReason.' + (keys[reason] || reason))
}
function protocolOffline(host: ManagedHost) {
  return !host.agentLastSeenAt || Date.parse(host.agentLastSeenAt) < Date.now() - 90000
}
async function openSsh(host: ManagedHost) {
  sshHost.value = host; sshConnection.value = null; sshLoading.value = true
  try {
    const connection = await api.hostOnboarding.getSsh(host.id)
    if (sshHost.value?.id !== host.id) return
    sshConnection.value = connection
    sshForm.value = { host: connection.host || '', port: connection.port || 22, username: connection.username || 'root' }
  } catch (error) { groupError(error) }
  finally { sshLoading.value = false }
}
async function saveSsh() {
  if (!sshHost.value || saving.value) return
  saving.value = true
  try {
    await api.hostOnboarding.setSsh(sshHost.value.id, sshForm.value)
    await openSsh(sshHost.value); toast.success(t('hostInventory.sshSaved'))
  } catch (error) { groupError(error) }
  finally { saving.value = false }
}
async function copySsh(command: string) {
  try { await navigator.clipboard.writeText(command); toast.success(t('hostInventory.sshCopied')) }
  catch { toast.error(t('hostInventory.sshCopyFailed')) }
}
async function deleteMachine() {
  if (!removeHost.value || saving.value) return
  saving.value = true
  try {
    await api.hostOnboarding.deleteHost(removeHost.value.id)
    removeHost.value = null; toast.success(t('hostInventory.deleteSuccess')); await refresh()
  } catch (error) { groupError(error) }
  finally { saving.value = false }
}
// 设置规格：机型/核心 + 磁盘档；配额按预设自动算。这是机器进入池子的前提。
const PRESETS: ResourcePreset[] = ['E2', 'ARM1C', 'ARM2C', 'ARM3C', 'ARM4C']
const DISK_TIERS = [30, 60, 90, 120]
const specTargets = ref<ManagedHost[]>([])
const specPreset = ref<ResourcePreset>('E2')
const specDisk = ref<number>(30)
const specArchMismatch = computed(() => specTargets.value.filter(host => host.architecture !== (specPreset.value.startsWith('ARM') ? 'aarch64' : 'x86_64')))
function hasSpec(host: ManagedHost) { return !!host.resourcePreset && host.customerDiskGiB !== null && host.cpuAllowanceMax > 0 }
function openSpec(targets: ManagedHost[]) {
  specTargets.value = targets
  const first = targets[0]
  specPreset.value = (first?.resourcePreset as ResourcePreset | null) || (first?.architecture === 'aarch64' ? 'ARM1C' : 'E2')
  specDisk.value = first?.customerDiskGiB && DISK_TIERS.includes(first.customerDiskGiB) ? first.customerDiskGiB : 30
}
function closeSpec() { if (!saving.value) specTargets.value = [] }
async function saveSpec() {
  if (saving.value || specArchMismatch.value.length) return
  saving.value = true
  try {
    await api.hostOnboarding.updateSpec({ hostIds: specTargets.value.map(host => host.id), resourcePreset: specPreset.value, customerDiskGiB: specDisk.value })
    specTargets.value = []; selected.value = []
    toast.success(t('hostInventory.specSaved'))
    await refresh()
  } catch (error) { groupError(error) }
  finally { saving.value = false }
}
let disposed = false
let sequence = 0
let timer: ReturnType<typeof setTimeout> | undefined

async function refresh() {
  clearTimeout(timer)
  const current = ++sequence
  try {
    const result = await api.hostOnboarding.inventory({ page: page.value, search: search.value.trim(),
      machineGroupId: machineGroup.value === '' ? undefined : machineGroup.value,
      regionGroupId: regionGroup.value === '' ? undefined : regionGroup.value, stock: stock.value || undefined })
    if (disposed || current !== sequence) return
    hosts.value = result.hosts; total.value = result.total
    for (const host of result.hosts) {
      if (!host.portProtocol || protocolRequests.get(host.id) !== host.portProtocol.requested) continue
      if (host.portProtocol.status === 'applied') {
        toast.success(t(host.portProtocol.applied === 'tcp' ? 'hostPoolOps.udpClosed' : 'hostPoolOps.udpOpen'))
        protocolRequests.delete(host.id)
      } else if (host.portProtocol.status === 'failed') {
        toast.error(t('hostPoolOps.protocolFailed')); protocolRequests.delete(host.id)
      }
    }
    groups.value = result.groups; summary.value = result.summary; ungrouped.value = result.ungrouped
    selected.value = selected.value.filter(id => result.hosts.some(host => host.id === id))
    failed.value = false
    if (page.value > pages.value) { page.value = pages.value; void refresh() }
  } catch { if (!disposed && current === sequence) failed.value = true }
  finally {
    if (!disposed && current === sequence) { loading.value = false; timer = setTimeout(() => void refresh(), hosts.value.some(host => host.portProtocol?.status === 'pending') ? 3000 : 15000) }
  }
}
function filter() { page.value = 1; selected.value = []; void refresh() }
function selectGroup(machine: number | '', region: number | '' = '') { machineGroup.value = machine; regionGroup.value = region; filter() }
function changePage(value: number) { page.value = value; selected.value = []; void refresh() }
function openGroups(targets: ManagedHost[]) {
  groupTargets.value = targets
  machineAction.value = targets.length === 1 && targets[0].machineGroupId ? 'set' : 'keep'
  regionAction.value = targets.length === 1 && targets[0].regionGroupId ? 'set' : 'keep'
  newMachineGroup.value = targets.length === 1 ? targets[0].machineGroupId || '' : ''
  newRegionGroup.value = targets.length === 1 ? targets[0].regionGroupId || '' : ''
}
function closeGroups() { if (!saving.value) groupTargets.value = [] }
async function saveGroups() {
  if (saving.value) return
  const data: UpdateHostGroupsRequest = { hostIds: groupTargets.value.map(host => host.id) }
  if (machineAction.value !== 'keep') data.machineGroupId = machineAction.value === 'clear' ? null : Number(newMachineGroup.value)
  if (regionAction.value !== 'keep') data.regionGroupId = regionAction.value === 'clear' ? null : Number(newRegionGroup.value)
  saving.value = true
  try {
    await api.hostOnboarding.updateGroups(data)
    groupTargets.value = []; selected.value = []
    toast.success(t('hostInventory.groupsSaved'))
    await refresh()
  } catch (error) { groupError(error) }
  finally { saving.value = false }
}
function groupError(error: unknown) {
  const data = (error as any)?.response?.data ?? error
  const code = data && typeof data === 'object' && 'code' in data ? String(data.code) : ''
  toast.error(te('hostInventory.actionErrors.' + code) ? t('hostInventory.actionErrors.' + code) : te('onboarding.errors.' + code) ? t('onboarding.errors.' + code) : t('hostInventory.groupsFailed'))
}
function editMachine(group?: HostMachineGroup) { groupEditor.value = { kind: 'machine', id: group?.id, name: group?.name || '', countryCode: '' } }
function editRegion(parentId: number, group?: HostRegionGroup) { groupEditor.value = { kind: 'region', parentId, id: group?.id, name: group?.name || '', countryCode: group?.countryCode || '' } }
async function saveGroupDefinition() {
  if (!groupEditor.value || saving.value) return
  saving.value = true
  try {
    const group = groupEditor.value
    if (group.kind === 'machine') {
      if (group.id) await api.hostOnboarding.renameMachineGroup(group.id, group.name.trim())
      else await api.hostOnboarding.createMachineGroup(group.name.trim())
    } else {
      const data = { name: group.name.trim(), countryCode: group.countryCode || null }
      if (group.id) await api.hostOnboarding.renameRegionGroup(group.id, data)
      else await api.hostOnboarding.createRegionGroup({ ...data, machineGroupId: group.parentId! })
    }
    groupEditor.value = null; toast.success(t('hostInventory.groupsSaved')); await refresh()
  } catch (error) { groupError(error) }
  finally { saving.value = false }
}
async function deleteGroupDefinition() {
  if (!removeGroup.value || saving.value) return
  saving.value = true
  try {
    if (removeGroup.value.kind === 'machine') await api.hostOnboarding.deleteMachineGroup(removeGroup.value.id)
    else await api.hostOnboarding.deleteRegionGroup(removeGroup.value.id)
    removeGroup.value = null; machineGroup.value = ''; regionGroup.value = ''; page.value = 1
    toast.success(t('common.deleteSuccess')); await refresh()
  } catch (error) { groupError(error) }
  finally { saving.value = false }
}
function status(host: ManagedHost) { return te(`onboarding.hostStatus.${host.status}`) ? t(`onboarding.hostStatus.${host.status}`) : host.status }
onMounted(() => void refresh())
onUnmounted(() => { disposed = true; clearTimeout(timer) })
defineExpose({ refresh })
</script>

<template>
  <section class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="text-sm text-themed">{{ t('hostInventory.stockSummary', summary) }}</p>
      <button class="btn-secondary whitespace-nowrap" @click="showGroupManager = true">{{ t('hostInventory.manageGroups') }}</button>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
      <section v-for="group in groups" :key="group.id" class="card p-3 min-w-0" :class="machineGroup === group.id ? 'ring-2 ring-primary-500' : ''">
        <button class="text-left w-full" @click="selectGroup(group.id)"><span class="text-sm font-semibold text-themed break-words">{{ group.name }}</span><span v-if="group.counts" class="block mt-1 text-xs text-themed-muted">{{ t('hostInventory.stockSummary', group.counts) }}</span></button>
        <div class="mt-2 space-y-1">
          <button v-for="region in group.regions" :key="region.id" class="w-full rounded px-2 py-1.5 text-left text-xs flex flex-wrap items-center justify-between gap-1" :class="regionGroup === region.id ? 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300' : 'bg-themed-secondary text-themed'" @click="selectGroup(group.id, region.id)"><span class="break-words">{{ region.name }}</span><span v-if="region.counts" class="text-themed-muted">{{ t('hostInventory.regionStock', region.counts) }}</span></button>
        </div>
      </section>
    </div>
    <div class="flex flex-wrap gap-2"><button class="btn-secondary text-xs" @click="selectGroup('')">{{ t('hostInventory.allMachines') }}</button><button class="btn-secondary text-xs" @click="selectGroup(0)">{{ t('hostInventory.ungroupedCount', { count: ungrouped.total }) }}</button></div>
    <form class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-[minmax(12rem,1fr)_10rem_10rem_9rem_auto] gap-2" @submit.prevent="filter">
      <input v-model="search" type="search" class="input w-full min-w-0" maxlength="100" :aria-label="t('common.search')" :placeholder="t('hostInventory.search')" />
      <select v-model="machineGroup" class="input w-full min-w-0" :aria-label="t('hostInventory.machineGroup')" @change="regionGroup = ''; filter()"><option value="">{{ t('hostInventory.allMachines') }}</option><option :value="0">{{ t('hostInventory.machineUnset') }}</option><option v-for="group in groups" :key="group.id" :value="group.id">{{ group.name }}</option></select>
      <select v-model="regionGroup" class="input w-full min-w-0" :aria-label="t('hostInventory.regionGroup')" @change="filter"><option value="">{{ t('hostInventory.allRegions') }}</option><option :value="0">{{ t('hostInventory.regionUnset') }}</option><option v-for="region in regions" :key="region.id" :value="region.id">{{ region.name }}</option></select>
      <select v-model="stock" class="input w-full min-w-0" :aria-label="t('hostInventory.stockLabel')" @change="filter"><option value="">{{ t('hostInventory.allStock') }}</option><option v-for="value in ['available', 'assigned', 'unavailable']" :key="value" :value="value">{{ t('hostInventory.stock.' + value) }}</option></select>
      <button class="btn-secondary whitespace-nowrap" type="submit">{{ t('common.search') }}</button>
    </form>
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex flex-wrap items-center gap-3">
        <label class="flex items-center gap-2 text-sm text-themed"><input v-model="allSelected" type="checkbox" :disabled="!hosts.length" />{{ t('hostInventory.selectPage') }}</label>
        <button type="button" class="btn-secondary text-xs whitespace-nowrap" :disabled="!selected.length" @click="openGroups(hosts.filter(host => selected.includes(host.id)))">{{ t('hostInventory.batchGroups', { count: selected.length }) }}</button>
        <button type="button" class="btn-secondary text-xs whitespace-nowrap" :disabled="!selected.length" @click="openSpec(hosts.filter(host => selected.includes(host.id)))">{{ t('hostInventory.batchSpec', { count: selected.length }) }}</button>
      </div>
      <span class="text-xs text-themed-muted">{{ t('hostInventory.total', { count: total }) }}</span>
    </div>
    <p v-if="failed" class="card p-4 text-sm text-red-600 dark:text-red-400" role="alert">{{ t('hostInventory.loadFailed') }}</p>
    <div v-if="loading" class="card p-8 text-sm text-themed-muted text-center">{{ t('common.loading') }}</div>
    <div v-else-if="!hosts.length && !failed" class="card p-8 text-sm text-themed-muted text-center">{{ t('hostInventory.empty') }}</div>
    <div v-if="hosts.length" class="card divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
      <article v-for="host in hosts" :key="host.id" class="p-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-3 xl:grid-cols-[auto_minmax(13rem,1.4fr)_minmax(9rem,1fr)_minmax(8rem,1fr)_auto] xl:items-center">
        <input v-model="selected" type="checkbox" :value="host.id" class="mt-1 xl:mt-0" :aria-label="t('hostInventory.selectHost', { name: host.name })" />
        <div class="min-w-0">
          <RouterLink :to="`/admin/resources/hosts/${host.id}`" class="text-sm font-semibold text-blue-600 dark:text-blue-400 break-all">{{ host.name }}</RouterLink>
          <span class="ml-2 text-xs text-themed-muted">#{{ host.id }}</span>
          <dl class="mt-2 text-xs space-y-1">
            <div class="flex flex-wrap gap-x-2"><dt class="text-themed-muted">{{ t('hostInventory.publicIp') }}</dt><dd class="font-mono text-themed break-all">{{ host.publicIp || '—' }}</dd></div>
            <p v-if="host.publicIpSync?.supported" class="text-xs" :class="host.publicIpSync.blocked || host.publicIpSync.status === 'failed' ? 'text-amber-600 dark:text-amber-400' : 'text-themed-muted'">{{ t('hostIpSync.status.' + host.publicIpSync.status) }}</p>
            <div class="flex flex-wrap gap-x-2"><dt class="text-themed-muted">{{ t('hostInventory.managementIp') }}</dt><dd class="font-mono text-themed break-all">{{ host.managementAddress || '—' }}</dd></div>
            <div v-if="host.publicIpv6Sync?.supported" class="pt-2 space-y-1">
              <dt class="text-themed-muted">{{ t('ipv6Delivery.title') }}</dt>
              <dd><PublicIpv6Addresses :addresses="host.publicIpv6Sync.addresses" show-empty /></dd>
              <dd v-if="host.publicIpv6Sync.status !== 'synced'" class="text-amber-700 dark:text-amber-300">{{ t('ipv6Delivery.status.' + host.publicIpv6Sync.status) }}</dd>
            </div>
          </dl>
        </div>
        <div class="col-start-2 xl:col-start-auto min-w-0">
          <div class="flex flex-wrap gap-1.5 text-xs">
            <span class="px-2 py-1 rounded bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 break-all">{{ host.machineGroup || t('hostInventory.machineUnset') }}</span>
            <span class="px-2 py-1 rounded bg-themed-secondary text-themed break-all">{{ host.regionGroup || t('hostInventory.regionUnset') }}</span>
          </div>
          <p v-if="host.accountLabel" class="text-xs text-themed-muted mt-2 break-words">{{ t('onboarding.accountLabel') }}: {{ host.accountLabel }}</p>
          <p class="text-xs mt-2" :class="hasSpec(host) ? 'text-themed' : 'text-amber-600 dark:text-amber-400 font-medium'">
            <template v-if="hasSpec(host)">{{ presetLabel(host.resourcePreset!) }} · {{ host.cpuAllowanceMax / 100 }} CPU · {{ host.memoryMax }} MiB · {{ host.customerDiskGiB }} GiB</template>
            <template v-else>{{ t('hostInventory.specMissing') }}</template>
          </p>
          <p v-if="host.resourceSnapshot" class="text-xs text-themed-muted mt-1">{{ t('hostInventory.detectedMemory', { memory: host.resourceSnapshot.probe.memoryMiB, pool: host.storageSize }) }}</p>
        </div>
        <div class="col-start-2 xl:col-start-auto min-w-0 space-y-2">
          <p class="flex flex-wrap items-center gap-2 text-xs"><span class="h-2 w-2 rounded-full" :class="host.status === 'online' ? 'bg-green-500' : 'bg-gray-400'"></span><span class="text-themed">{{ host.status === 'online' ? t('hostPoolOps.managementOnline') : status(host) }}</span><span class="text-themed-muted">{{ host.architecture }}</span></p>
          <p class="text-xs text-themed-muted">{{ t('hostPoolOps.assignedInstances', { count: host.instanceCount }) }}</p>
          <p class="text-xs font-medium" :class="host.stock === 'available' ? 'text-green-600 dark:text-green-400' : 'text-themed-muted'">{{ t('hostInventory.stock.' + host.stock) }}</p>
          <p v-if="host.sellReason" class="text-xs font-medium text-amber-600 dark:text-amber-400">{{ sellReasonText(host.sellReason) }}</p>
          <p v-if="host.poolFaulted" class="text-xs text-themed-muted">{{ t('hostPoolOps.quarantineHint') }}</p>
          <p v-for="instance in host.instances" :key="instance.id" class="text-xs text-themed break-words">{{ instance.user.username }} · {{ instance.name }} (#{{ instance.id }})</p>
        </div>
        <div class="col-start-2 xl:col-start-auto flex flex-wrap gap-2 xl:max-w-48 xl:justify-end">
          <RouterLink :to="`/admin/resources/hosts/${host.id}`" class="btn-primary text-xs whitespace-nowrap">{{ t('hostInventory.manage') }}</RouterLink>
          <button type="button" class="btn-secondary text-xs whitespace-nowrap" @click="openGroups([host])">{{ t('hostInventory.groups') }}</button>
          <button type="button" class="text-xs whitespace-nowrap" :class="hasSpec(host) ? 'btn-secondary' : 'btn-primary'" @click="openSpec([host])">{{ t('hostInventory.spec') }}</button>
          <label class="flex items-center gap-2 text-xs text-themed-muted">{{ t('dedicated.protocol') }}<select :value="host.portProtocol?.requested || 'tcp_udp'" class="input text-xs py-1" :disabled="saving" @change="changeProtocol(host, $event)"><option value="tcp_udp">TCP+UDP</option><option value="tcp">TCP</option></select></label>
          <div class="w-full space-y-1 xl:text-right" aria-live="polite">
            <p v-if="host.portProtocol?.status === 'applied'" class="text-xs text-green-600 dark:text-green-400">{{ t(host.portProtocol.applied === 'tcp' ? 'hostPoolOps.udpClosed' : 'hostPoolOps.udpOpen') }}</p>
            <template v-else>
              <p class="text-xs" :class="host.portProtocol?.status === 'failed' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'">{{ t(host.portProtocol?.status === 'failed' ? 'hostPoolOps.protocolFailed' : protocolOffline(host) ? 'hostPoolOps.protocolOffline' : 'hostPoolOps.protocolApplying') }}</p>
              <p class="text-xs text-themed-muted">{{ t('hostPoolOps.protocolAutoHint') }}</p>
              <button type="button" class="btn-secondary text-xs" :disabled="saving" @click="applyProtocol(host, host.portProtocol?.requested || 'tcp_udp')">{{ t('hostPoolOps.protocolRetry') }}</button>
            </template>
          </div>
          <button v-if="host.poolFaulted" type="button" class="btn-secondary text-xs whitespace-nowrap" @click="recoveryHost = host">{{ t('hostPoolOps.recovery.title') }}</button>
          <button v-if="host.publicIpSync?.supported" type="button" class="btn-secondary text-xs whitespace-nowrap" @click="publicIpHost = host">{{ t('hostIpSync.title') }}</button>
          <button v-if="host.publicIpv6Sync?.supported" type="button" class="btn-secondary text-xs" :disabled="syncingIpv6Host !== null" @click="syncIpv6(host)">{{ t(syncingIpv6Host === host.id ? 'ipv6Delivery.checking' : 'ipv6Delivery.sync') }}</button>
          <button type="button" class="btn-secondary text-xs whitespace-nowrap" @click="openSsh(host)">SSH</button>
          <button v-if="host.instances.length === 1" type="button" class="btn-secondary text-xs whitespace-nowrap" @click="replacement = host.instances[0]">{{ t('dedicated.replacement.title') }}</button>
          <button type="button" class="btn-danger text-xs whitespace-nowrap" :disabled="host.instanceCount > 0" :title="host.instanceCount > 0 ? t('hostInventory.deleteBusy') : t('common.delete')" @click="removeHost = host">{{ t('common.delete') }}</button>
        </div>
      </article>
    </div>
    <div v-if="pages > 1" class="flex flex-wrap items-center justify-end gap-3">
      <button class="btn-secondary" :disabled="page <= 1" @click="changePage(page - 1)">{{ t('common.prevPage') }}</button><span class="text-sm text-themed-muted">{{ page }} / {{ pages }}</span><button class="btn-secondary" :disabled="page >= pages" @click="changePage(page + 1)">{{ t('common.nextPage') }}</button>
    </div>

    <HostReplacementModal v-if="replacement" :instance-id="replacement.id" :instance-name="replacement.name" @close="replacement = null" @changed="refresh" />
    <HostPublicIpModal v-if="publicIpHost" :host-id="publicIpHost.id" :host-name="publicIpHost.name" @close="publicIpHost = null" @changed="refresh" />
    <HostRecoveryModal v-if="recoveryHost" :host-id="recoveryHost.id" :host-name="recoveryHost.name" @close="recoveryHost = null" @changed="refresh" @ssh="openSsh(recoveryHost); recoveryHost = null" />
    <Teleport to="body">
      <div v-if="groupTargets.length" class="modal-overlay" @keydown.esc="closeGroups">
        <div class="modal-backdrop" @click="closeGroups"></div>
        <form class="modal-content max-w-xl max-h-[90dvh] flex flex-col overflow-hidden" role="dialog" aria-modal="true" aria-labelledby="host-groups-title" @submit.prevent="saveGroups">
          <div class="modal-header"><h2 id="host-groups-title" class="modal-title">{{ t('hostInventory.editGroups') }}</h2></div>
          <div class="modal-body min-h-0 overflow-y-auto">
            <fieldset class="space-y-4 min-w-0" :disabled="saving">
              <p class="text-sm text-themed break-words">{{ groupTargets.length === 1 ? `${groupTargets[0].name} · ${groupTargets[0].publicIp || groupTargets[0].managementAddress}` : t('hostInventory.selectedCount', { count: groupTargets.length }) }}</p>
              <div>
                <label class="block text-sm text-themed" for="host-machine-action">{{ t('hostInventory.machineGroup') }}</label>
                <select id="host-machine-action" v-model="machineAction" class="input w-full mt-1"><option value="keep">{{ t('hostInventory.keepGroup') }}</option><option value="set">{{ t('hostInventory.setGroup') }}</option><option value="clear">{{ t('hostInventory.clearGroup') }}</option></select>
                <select v-if="machineAction === 'set'" v-model="newMachineGroup" required class="input w-full mt-2" :aria-label="t('hostInventory.machineGroup')" @change="newRegionGroup = ''; regionAction = 'clear'"><option value="" disabled>{{ t('hostInventory.selectGroup') }}</option><option v-for="group in groups" :key="group.id" :value="group.id">{{ group.name }}</option></select>
              </div>
              <div>
                <label class="block text-sm text-themed" for="host-region-action">{{ t('hostInventory.regionGroup') }}</label>
                <select id="host-region-action" v-model="regionAction" class="input w-full mt-1"><option value="keep">{{ t('hostInventory.keepGroup') }}</option><option value="set" :disabled="!targetMachine">{{ t('hostInventory.setGroup') }}</option><option value="clear">{{ t('hostInventory.clearGroup') }}</option></select>
                <select v-if="regionAction === 'set'" v-model="newRegionGroup" required class="input w-full mt-2" :aria-label="t('hostInventory.regionGroup')"><option value="" disabled>{{ t('hostInventory.selectGroup') }}</option><option v-for="region in targetRegions" :key="region.id" :value="region.id">{{ region.name }}</option></select>
              </div>
            </fieldset>
          </div>
          <div class="modal-footer gap-2"><button type="button" class="btn-secondary" :disabled="saving" @click="closeGroups">{{ t('common.cancel') }}</button><button class="btn-primary" type="submit" :disabled="saving || (machineAction === 'keep' && regionAction === 'keep')">{{ t(saving ? 'common.saving' : 'common.save') }}</button></div>
        </form>
      </div>
      <div v-if="specTargets.length" class="modal-overlay" @keydown.esc="closeSpec">
        <div class="modal-backdrop" @click="closeSpec"></div>
        <form class="modal-content max-w-xl max-h-[90dvh] flex flex-col overflow-hidden" role="dialog" aria-modal="true" aria-labelledby="host-spec-title" @submit.prevent="saveSpec">
          <div class="modal-header"><h2 id="host-spec-title" class="modal-title">{{ t('hostInventory.specTitle') }}</h2></div>
          <div class="modal-body min-h-0 overflow-y-auto">
            <fieldset class="space-y-4 min-w-0" :disabled="saving">
              <p class="text-sm text-themed break-words">{{ specTargets.length === 1 ? `${specTargets[0].name} · ${specTargets[0].architecture}` : t('hostInventory.selectedCount', { count: specTargets.length }) }}</p>
              <p class="text-xs text-themed-muted">{{ t('hostInventory.specHint') }}</p>
              <div>
                <label class="block text-sm text-themed" for="host-spec-preset">{{ t('hostPools.specPreset') }}</label>
                <select id="host-spec-preset" v-model="specPreset" class="input w-full mt-1"><option v-for="preset in PRESETS" :key="preset" :value="preset">{{ presetLabel(preset) }}</option></select>
                <p v-if="specArchMismatch.length" class="mt-1 text-xs text-red-600 dark:text-red-400">{{ t('hostInventory.specArchMismatch', { names: specArchMismatch.map(host => host.name).join(', ') }) }}</p>
              </div>
              <div>
                <label class="block text-sm text-themed" for="host-spec-disk">{{ t('hostPools.specDisk') }}</label>
                <select id="host-spec-disk" v-model.number="specDisk" class="input w-full mt-1"><option v-for="tier in DISK_TIERS" :key="tier" :value="tier">{{ tier }} GiB</option></select>
              </div>
            </fieldset>
          </div>
          <div class="modal-footer gap-2"><button type="button" class="btn-secondary" :disabled="saving" @click="closeSpec">{{ t('common.cancel') }}</button><button class="btn-primary" type="submit" :disabled="saving || specArchMismatch.length > 0">{{ t(saving ? 'common.saving' : 'common.save') }}</button></div>
        </form>
      </div>
      <div v-if="showGroupManager && !groupEditor && !removeGroup" class="modal-overlay" @keydown.esc="showGroupManager = false">
        <div class="modal-backdrop" @click="showGroupManager = false"></div>
        <section class="modal-content max-w-xl flex flex-col" role="dialog" aria-modal="true" aria-labelledby="inventory-group-manager-title">
          <div class="modal-header gap-2"><h2 id="inventory-group-manager-title" class="modal-title">{{ t('hostInventory.manageGroups') }}</h2><button class="btn-secondary text-xs whitespace-nowrap" @click="editMachine()">{{ t('hostInventory.addMachine') }}</button></div>
          <div class="modal-body overflow-y-auto space-y-3">
            <p v-if="!groups.length" class="text-sm text-themed-muted">{{ t('hostInventory.noGroups') }}</p>
            <section v-for="group in groups" :key="group.id" class="border border-themed rounded-lg p-3 space-y-2">
              <div class="flex flex-wrap items-center gap-2"><strong class="text-sm text-themed break-words mr-auto">{{ group.name }}</strong><button class="btn-secondary text-xs" @click="editMachine(group)">{{ t('common.edit') }}</button><button class="btn-secondary text-xs text-red-600 dark:text-red-400" @click="removeGroup = { kind: 'machine', id: group.id, name: group.name }">{{ t('common.delete') }}</button></div>
              <div v-for="region in group.regions" :key="region.id" class="flex flex-wrap items-center gap-2 border-t border-themed pt-2"><span class="text-sm text-themed break-words mr-auto">{{ region.name }}</span><button class="btn-secondary text-xs" @click="editRegion(group.id, region)">{{ t('common.edit') }}</button><button class="btn-secondary text-xs text-red-600 dark:text-red-400" @click="removeGroup = { kind: 'region', id: region.id, name: region.name }">{{ t('common.delete') }}</button></div>
              <button class="btn-secondary text-xs" @click="editRegion(group.id)">{{ t('hostInventory.addRegion') }}</button>
            </section>
          </div>
          <div class="modal-footer"><button class="btn-secondary" @click="showGroupManager = false">{{ t('common.close') }}</button></div>
        </section>
      </div>
      <div v-if="groupEditor" class="modal-overlay" @keydown.esc="!saving && (groupEditor = null)">
        <div class="modal-backdrop" @click="!saving && (groupEditor = null)"></div>
        <form class="modal-content" role="dialog" aria-modal="true" aria-labelledby="inventory-group-edit-title" @submit.prevent="saveGroupDefinition">
          <div class="modal-header"><h2 id="inventory-group-edit-title" class="modal-title">{{ t(groupEditor.kind === 'machine' ? 'hostInventory.machineGroup' : 'hostInventory.regionGroup') }}</h2></div>
          <div class="modal-body space-y-3"><label class="block text-sm text-themed">{{ t('common.name') }}<input v-model="groupEditor.name" required maxlength="60" :disabled="saving" class="input w-full mt-1" /></label><label v-if="groupEditor.kind === 'region'" class="block text-sm text-themed">{{ t('onboarding.country') }}<select v-model="groupEditor.countryCode" :disabled="saving" class="input w-full mt-1"><option value="">{{ t('common.notSet') }}</option><option v-for="code in availableFlagCountryCodes" :key="code" :value="code">{{ getLocalizedCountryName(code, locale) }}</option></select></label></div>
          <div class="modal-footer gap-2"><button type="button" class="btn-secondary" :disabled="saving" @click="groupEditor = null">{{ t('common.cancel') }}</button><button class="btn-primary" :disabled="saving">{{ t('common.save') }}</button></div>
        </form>
      </div>
      <div v-if="removeGroup" class="modal-overlay" @keydown.esc="!saving && (removeGroup = null)">
        <div class="modal-backdrop" @click="!saving && (removeGroup = null)"></div>
        <section class="modal-content" role="dialog" aria-modal="true" aria-labelledby="inventory-group-delete-title">
          <div class="modal-header"><h2 id="inventory-group-delete-title" class="modal-title">{{ t('hostInventory.deleteGroup') }}</h2></div>
          <div class="modal-body text-sm text-themed break-words">{{ t('hostInventory.deleteGroupHint', { name: removeGroup.name }) }}</div>
          <div class="modal-footer gap-2"><button class="btn-secondary" :disabled="saving" @click="removeGroup = null">{{ t('common.cancel') }}</button><button class="btn-danger" :disabled="saving" @click="deleteGroupDefinition">{{ t('common.delete') }}</button></div>
        </section>
      </div>
      <div v-if="sshHost" class="modal-overlay" @keydown.esc="!saving && (sshHost = null)">
        <div class="modal-backdrop" @click="!saving && (sshHost = null)"></div>
        <section class="modal-content" role="dialog" aria-modal="true" aria-labelledby="inventory-ssh-title">
          <div class="modal-header"><h2 id="inventory-ssh-title" class="modal-title">{{ t('hostInventory.sshTitle') }} · {{ sshHost.name }}</h2></div>
          <div class="modal-body space-y-4">
            <p v-if="sshLoading" class="text-sm text-themed-muted">{{ t('common.loading') }}</p>
            <template v-else-if="sshConnection">
              <p class="text-xs text-themed-muted">{{ t(sshConnection.viaGateway ? 'hostInventory.sshGatewayHint' : 'hostInventory.sshHint') }}</p>
              <div v-if="sshConnection.gatewayCommand" class="space-y-2">
                <p class="text-xs text-themed-muted">1. {{ t('hostInventory.sshGatewayStep') }}</p>
                <code class="block text-xs break-all p-3 rounded-lg bg-themed-secondary text-themed">{{ sshConnection.gatewayCommand }}</code>
                <button type="button" class="btn-secondary text-xs" @click="copySsh(sshConnection.gatewayCommand)">{{ t('hostInventory.sshCopy') }}</button>
              </div>
              <div v-if="sshConnection.command" class="space-y-2">
                <p class="text-xs text-themed-muted">{{ sshConnection.viaGateway ? '2. ' : '' }}{{ t('hostInventory.sshHostStep') }}</p>
                <code class="block text-xs break-all p-3 rounded-lg bg-themed-secondary text-themed">{{ sshConnection.command }}</code>
                <button type="button" class="btn-secondary text-xs" @click="copySsh(sshConnection.command)">{{ t('hostInventory.sshCopy') }}</button>
              </div>
              <p v-else class="text-sm text-amber-600 dark:text-amber-400">{{ t('hostInventory.sshUnavailable') }}</p>
              <form v-if="!sshConnection.viaGateway" class="space-y-3 border-t border-themed pt-3" @submit.prevent="saveSsh">
                <label class="block text-sm text-themed">{{ t('hostInventory.sshAddress') }}<input v-model.trim="sshForm.host" class="input w-full mt-1" required maxlength="253" autocomplete="off" /></label>
                <div class="grid grid-cols-2 gap-3">
                  <label class="block text-sm text-themed">{{ t('onboarding.sshPort') }}<input v-model.number="sshForm.port" class="input w-full mt-1" required type="number" min="1" max="65535" /></label>
                  <label class="block text-sm text-themed">{{ t('hostInventory.sshUser') }}<input v-model.trim="sshForm.username" class="input w-full mt-1" required maxlength="32" /></label>
                </div>
                <button class="btn-secondary" :disabled="saving">{{ t('common.save') }}</button>
              </form>
            </template>
          </div>
          <div class="modal-footer"><button class="btn-secondary" :disabled="saving" @click="sshHost = null">{{ t('common.close') }}</button></div>
        </section>
      </div>
      <div v-if="removeHost" class="modal-overlay" @keydown.esc="!saving && (removeHost = null)">
        <div class="modal-backdrop" @click="!saving && (removeHost = null)"></div>
        <section class="modal-content" role="dialog" aria-modal="true" aria-labelledby="inventory-remove-title">
          <div class="modal-header"><h2 id="inventory-remove-title" class="modal-title">{{ t('hostInventory.deleteTitle') }}</h2></div>
          <div class="modal-body text-sm text-themed">{{ t('hostInventory.deleteHint', { name: removeHost.name }) }}</div>
          <div class="modal-footer gap-2"><button class="btn-secondary" :disabled="saving" @click="removeHost = null">{{ t('common.cancel') }}</button><button class="btn-danger" :disabled="saving" @click="deleteMachine">{{ t('common.delete') }}</button></div>
        </section>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.modal-content { max-width: 36rem; max-height: 90dvh; overflow: hidden; }
.modal-header, .modal-footer { flex-shrink: 0; }
.modal-body { min-height: 0; overflow-y: auto; }
</style>
