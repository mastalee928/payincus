import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = resolve(__dirname, '../..')

function readRepoFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

function sectionBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `missing end marker after ${startMarker}: ${endMarker}`)
  return source.slice(start, end)
}

function countOccurrences(source: string, needle: string): number {
  return source.split(needle).length - 1
}

const userRouterSource = readRepoFile('client/src/router/user.ts')
const adminRouterSource = readRepoFile('client/src/router/admin.ts')
const appSource = readRepoFile('client/src/App.vue')
const adminAppSource = readRepoFile('client/src/admin/AdminApp.vue')
const authStoreSource = readRepoFile('client/src/stores/auth.ts')
const hostImagesSource = readRepoFile('client/src/components/host/HostImagesTab.vue')
const hostCaddySource = readRepoFile('client/src/components/host/HostCaddyTab.vue')
const hostConfigSource = readRepoFile('client/src/components/host/MyHostConfigTab.vue')
assert.ok(hostConfigSource.includes('!saving.value && !dirty.value') && hostConfigSource.includes('const cleanDraft = ref(') &&
  hostConfigSource.includes('if (editingDisabled.value) return') && hostConfigSource.includes(':disabled="editingDisabled"') &&
  hostConfigSource.includes('identity === session.value') && hostConfigSource.includes('revision === draftGeneration') &&
  hostConfigSource.includes('onDeactivated(') && hostConfigSource.includes('data-host-config-error'),
  'Host config must preserve dirty drafts and isolate pending saves, obsolete receipts and persistent failures')
assert.ok(hostConfigSource.includes('hostApiPort(newHost.url') && hostConfigSource.includes('editedHostEndpoint(formEndpoint,') &&
  hostConfigSource.includes('url === undefined ? {} : { url }') && !hostConfigSource.includes('buildHostApiUrl(form.value'),
  'unrelated host edits must omit the URL and changed endpoints must preserve the original protocol and path')
assert.ok(hostConfigSource.includes('location: form.value.location,') && hostConfigSource.includes('ipv6Subnet: form.value.ipv6Subnet.trim(),') &&
  hostConfigSource.includes('ipv6ParentInterface: form.value.ipv6ParentInterface.trim(),') && hostConfigSource.includes('props.host.ipv6Mode === 1'),
  'host config must send explicit clears and preserve required parent-interface gates for routed IPv6')
assert.ok(hostCaddySource.includes('sequence === statusSequence') && hostCaddySource.includes('sequence === sitesSequence') &&
  hostCaddySource.includes('page === sitesPage.value') && hostCaddySource.includes('onDeactivated') &&
  hostCaddySource.includes('data-caddy-status-error') && hostCaddySource.includes('data-caddy-sites-error') &&
  hostCaddySource.includes('validSites(res, page)') && hostCaddySource.includes('actionsDisabled.value') &&
  !hostCaddySource.includes('watch(() => caddyStatus.value.enabled'),
  'Caddy reads must isolate status/page/session lifecycles, keep errors distinct from empty and load sites once')
assert.ok(hostCaddySource.includes('revision === commandGeneration') && hostCaddySource.includes('await navigator.clipboard.writeText(command)') &&
  hostCaddySource.includes('runCaddyAction') && hostCaddySource.includes('currentOperation?.()') && hostCaddySource.includes('data-caddy-action-error') &&
  hostCaddySource.includes('data-caddy-copy-error') && hostCaddySource.includes('clearInstallInfo()') && hostCaddySource.includes('trapInstallFocus') &&
  hostCaddySource.includes(':disabled="actionsDisabled || !installInfo.command"'),
  'Caddy operations must share pending locks, isolate credential/dialog receipts, await copy and keep failures available for retry')
assert.ok(hostImagesSource.includes('!policyReady.value') && hostImagesSource.includes('!!policyError.value') &&
  hostImagesSource.includes('sequence === readSequence') && hostImagesSource.includes('draft === draftGeneration') &&
  hostImagesSource.includes('validPolicy(response, target.hostId)') && hostImagesSource.includes('onDeactivated') &&
  hostImagesSource.includes('data-host-policy-error') && hostImagesSource.includes('data-host-policy-save-error') &&
  hostImagesSource.includes(':disabled="editingDisabled"') && !hostImagesSource.includes('await loadPolicy()'),
  'host image policy must gate unknown reads, retain target/draft ownership, show persistent retry and disable changes during writes')
const appLayoutSource = readRepoFile('client/src/components/layout/AppLayout.vue')
const notificationBellSource = readRepoFile('client/src/components/NotificationBell.vue')
const mainSource = readRepoFile('client/src/main.ts')
const adminMainSource = readRepoFile('client/src/admin/main.ts')
const indexHtmlSource = readRepoFile('client/index.html')
const staleAssetRecoverySource = readRepoFile('client/src/utils/staleAssetRecovery.ts')
const turnstileWidgetSource = readRepoFile('client/src/components/TurnstileWidget.vue')
const publicHeaderSource = readRepoFile('client/src/components/public/PublicSiteHeader.vue')
const publicFooterSource = readRepoFile('client/src/components/public/PublicSiteFooter.vue')
const publicHostOfferSource = readRepoFile('client/src/components/public/PublicHostOffer.vue')
const homepageMapSource = readRepoFile('client/src/components/public/HomepageMapDemo.vue')
const homepageAtlasSource = readRepoFile('client/src/components/public/HomeRegionAtlas.vue')
const homepageTargetsSource = readRepoFile('client/src/utils/homeRegionAtlas.ts')
const publicLayoutSource = readRepoFile('client/src/components/public/PublicSiteLayout.vue')
const sideNavSource = readRepoFile('client/src/components/layout/SideNav.vue')
const sideNavUserItemsSource = readRepoFile('client/src/config/side-nav-items-user.ts')
const sideNavAdminItemsSource = readRepoFile('client/src/config/side-nav-items-admin.ts')
const passwordSectionSource = readRepoFile('client/src/components/profile/PasswordSection.vue')
const adminUsersViewSource = readRepoFile('client/src/views/admin/UsersView.vue')
const adminBillingViewSource = readRepoFile('client/src/views/admin/BillingView.vue')
const adminHelpManageViewSource = readRepoFile('client/src/views/admin/HelpManageView.vue')
const adminMailViewSource = readRepoFile('client/src/views/admin/AdminMailView.vue')
const adminImagesViewSource = readRepoFile('client/src/views/admin/ImagesView.vue')
const extensionsViewSource = readRepoFile('client/src/views/ExtensionsView.vue')
const instancesViewSource = readRepoFile('client/src/views/InstancesView.vue')
const publicIpv6AddressesSource = readRepoFile('client/src/components/PublicIpv6Addresses.vue')
const instanceInfoTabSource = readRepoFile('client/src/components/instance/InstanceInfoTab.vue')
const destroyInstanceModalSource = readRepoFile('client/src/components/instance/modals/DestroyInstanceModal.vue')
const instanceCreateViewSource = readRepoFile('client/src/views/InstanceCreateView.vue')
assert.ok(instanceCreateViewSource.includes("watch(promoContextKey, invalidatePromoCode, { flush: 'sync' })") &&
  instanceCreateViewSource.includes('sequence === promoSequence && contextCurrent()') &&
  instanceCreateViewSource.includes('await api.aff.validateCode(code, planId)') &&
  instanceCreateViewSource.includes('if (!currentPromo()) return') &&
  instanceCreateViewSource.includes('!promoCodeVerifying.value &&') &&
  instanceCreateViewSource.includes('promoPageActive.value = false; invalidatePromoCode()'),
  'legacy create coupon quotes must belong to the current code/plan/session and stop stale submit continuations')
const instanceDetailViewSource = readRepoFile('client/src/views/InstanceDetailView.vue')
for (const required of ['function captureDetailRead(', 'generation === detailReadGeneration', 'sequence === readSequences[channel]',
  'session === detailSessionKey.value', 'rawId === String(route.params.id', 'watch([() => route.params.id, () => route.name, detailSessionKey]',
  'if (context.current() && !refreshInterval)', "captureDetailRead('instance', false)", "captureDetailRead('stats')",
  "captureDetailRead('traffic')", "captureDetailRead('task')", "captureDetailRead('cloud-init')",
  'if (read.current()) loading.value = false', 'if (received && received.id !== instanceId)']) {
  assert.ok(instanceDetailViewSource.includes(required), `detail read lifecycle must include ${required}`)
}
const trafficStatsSource = readRepoFile('client/src/components/instance/TrafficStats.vue')
const packageFormViewSource = readRepoFile('client/src/views/resources/PackageFormView.vue')
const ticketsViewSource = readRepoFile('client/src/views/TicketsView.vue')
assert.ok(ticketsViewSource.includes('generation === detailGeneration') && ticketsViewSource.includes('path === route.fullPath') &&
  ticketsViewSource.includes('session === sessionKey.value') && ticketsViewSource.includes('onDeactivated(deactivatePage)') &&
  ticketsViewSource.includes('await api.tickets.reply(ticketId, content, attachments)') &&
  ticketsViewSource.includes('revision === replyRevision') && ticketsViewSource.includes('if (!attached()) return') &&
  ticketsViewSource.includes('messagesPage.value = targetPage') && !ticketsViewSource.includes('messagesPage.value--') &&
  ticketsViewSource.includes(':disabled="!canReply"'),
  'ticket details, reply drafts, attachment URLs and pagination must stay with the current route/session/open attempt')
assert.ok(ticketsViewSource.includes('await api.tickets.close(ticketId)') && ticketsViewSource.includes("await api.tickets.updateStatus(ticketId, 'open')") &&
  ticketsViewSource.includes('await api.tickets.deleteMessage(ticketId, messageId)') &&
  ticketsViewSource.includes('revision === noteRevision') && ticketsViewSource.includes('revision === notifyRevision') &&
  ticketsViewSource.includes('revision === linkRevision') && ticketsViewSource.includes('revision === createRevision') &&
  ticketsViewSource.includes('refreshAfterDetailWrite(ticketId, current)') && ticketsViewSource.includes('statusSubmitting || replying'),
  'ticket writes must fix their targets, preserve later drafts, guard pending actions and ignore old navigation results')
const renewModalSource = readRepoFile('client/src/components/instance/modals/RenewModal.vue')
const portConflictModalSource = readRepoFile('client/src/components/instance/modals/PortConflictModal.vue')
assert.ok(portConflictModalSource.includes('if (!/^\\d+$/.test(normalized)) return null') &&
  portConflictModalSource.includes('const duplicates = new Set<number>()') &&
  portConflictModalSource.includes('if (!canConfirm.value) return') &&
  portConflictModalSource.includes('resolved: parsePort(resolvedPorts.value[c.publicPort])!') &&
  portConflictModalSource.includes(':disabled="!canConfirm"') && !portConflictModalSource.includes('parseInt('),
  'port conflict confirmation must validate whole numeric ports, normalized duplicates and current modal eligibility')
for (const name of ['RebuildModal', 'RecreateModal']) {
  const source = readRepoFile(`client/src/components/instance/modals/${name}.vue`)
  assert.ok(source.includes('props.availableImages.some(image => image.incusAlias === selectedImage.value)') &&
    source.includes('props.sshKeys.some(key => key.id === selectedSshKeyId.value)') &&
    source.includes("deep: true, flush: 'sync'") && source.includes(':disabled="!canSubmit"') &&
    source.includes('submitPending.value = true') && source.includes('[...customInitCommandIds.value]'),
    `${name} must validate current image/key membership, prevent duplicate emits and copy the submitted command selection`)
}
const changePlanModalSource = readRepoFile('client/src/components/instance/modals/ChangePlanModal.vue')
const terminalPageSource = readRepoFile('client/src/views/TerminalView.vue')
const terminalCommandsSource = readRepoFile('client/src/components/terminal/TerminalSavedCommandsSidebar.vue')
assert.ok(terminalCommandsSource.includes('revision === draftRevision') && terminalCommandsSource.includes('if (draftCurrent()) cancelEditor()') &&
  terminalCommandsSource.includes('session === sessionKey.value') && terminalCommandsSource.includes('currentGeneration === generation') &&
  terminalCommandsSource.includes('refreshAfterWrite(current)') && terminalCommandsSource.includes('onDeactivated(deactivate)') &&
  terminalCommandsSource.includes('v-else-if="loadError"'),
  'saved commands must preserve later drafts, isolate old account/cache responses and require refreshed command state')
assert.ok(terminalPageSource.includes('onActivated(activatePage)') && terminalPageSource.includes('onDeactivated(deactivatePage)') &&
  terminalPageSource.includes("window.removeEventListener('keydown', handleKeydown)") &&
  terminalPageSource.includes('generation === uiGeneration') && terminalPageSource.includes('tab.ws === socket') &&
  terminalPageSource.includes("target.closest('.xterm')") && terminalPageSource.includes(':aria-pressed="activeTabId === tab.id"'),
  'cached terminal must release global shortcuts and overlays, preserve current tab input and use independent tab buttons')
assert.ok(terminalPageSource.includes('generation === sessionGeneration') &&
  terminalPageSource.includes('cloudSequences.get(tabId) === sequence') && terminalPageSource.includes('watch(sessionKey, () => {') &&
  terminalPageSource.includes('if (!currentSocket()) return') && terminalPageSource.includes('onBeforeUnmount(() => {') &&
  terminalPageSource.includes('currentSocket() ? tab.terminal : null'),
  'terminal lists, cloud-init, tickets and socket callbacks must remain bound to the current authenticated session and tab')
assert.ok(changePlanModalSource.includes('session === sessionKey.value') &&
  changePlanModalSource.includes('currentGeneration === generation') && changePlanModalSource.includes('sequence === previewSequence') &&
  changePlanModalSource.includes('await api.billing.changePlan(approved.instanceId, approved.planId)') &&
  changePlanModalSource.includes('if (!canSubmit.value || !approved) return') && changePlanModalSource.includes(':disabled="!canSubmit"') &&
  !changePlanModalSource.includes('setTimeout('),
  'plan upgrade confirmation must bind the current modal/session/selection to its preview and ignore obsolete replies')
const initCommandSelectorSource = readRepoFile('client/src/components/extensions/InitCommandSelector.vue')
const initCommandDetailSource = readRepoFile('client/src/components/extensions/InitCommandDetailModal.vue')
const initCommandEditorSource = readRepoFile('client/src/components/extensions/InitCommandModal.vue')
const hostInstancesTabSource = readRepoFile('client/src/components/host/HostInstancesTab.vue')
const hostCreateInstanceTabSource = readRepoFile('client/src/components/host/HostCreateInstanceTab.vue')
const hostPublicIpv4TabSource = readRepoFile('client/src/components/host/HostPublicIpv4Tab.vue')
const ticketInstanceOwnerCardSource = readRepoFile('client/src/components/tickets/TicketInstanceOwnerCard.vue')
assert.ok(ticketInstanceOwnerCardSource.includes('currentGeneration === generation') &&
  ticketInstanceOwnerCardSource.includes('session === sessionKey.value') && ticketInstanceOwnerCardSource.includes('requestId === statsRequestId') &&
  ticketInstanceOwnerCardSource.includes('requestId === taskRequestId') && ticketInstanceOwnerCardSource.includes('onDeactivated(deactivate)') &&
  ticketInstanceOwnerCardSource.includes('await api.instances.delete(instanceId, reason || undefined)') &&
  ticketInstanceOwnerCardSource.includes('refreshAfterAction(current)') && ticketInstanceOwnerCardSource.includes(':key="terminalKey"'),
  'ticket instance card requests, actions, timers and terminal lifetime must stay with its active instance/session')
const myHostsViewSource = readRepoFile('client/src/views/resources/MyHostsView.vue')
const myPackagesViewSource = readRepoFile('client/src/views/resources/MyPackagesView.vue')
const instanceLogsTabSource = readRepoFile('client/src/components/instance/InstanceLogsTab.vue')
const configEditModalSource = readRepoFile('client/src/components/instance/modals/ConfigEditModal.vue')
const inboxHelperSource = readRepoFile('client/src/utils/inboxHelper.ts')
const dashboardViewSource = readRepoFile('client/src/views/DashboardView.vue')
const marketViewSource = readRepoFile('client/src/views/MarketView.vue')
const portalViewSource = readRepoFile('client/src/views/PortalView.vue')
const loginViewSource = readRepoFile('client/src/views/LoginView.vue')

assert.ok(
  packageFormViewSource.includes('function normalizeMoneyYuan(value: unknown): number | null') &&
    packageFormViewSource.includes('trafficResetPrice: Number(pkg.traffic_reset_price || 0),') &&
    packageFormViewSource.includes('trafficResetPrice: trafficResetPriceYuan,') &&
    !packageFormViewSource.includes('trafficResetPrice: Number(pkg.traffic_reset_price || 0) / 100') &&
    !packageFormViewSource.includes('trafficResetPrice: trafficResetPriceCents'),
  'package form traffic reset price must round-trip directly in yuan'
)

assert.ok(
  myPackagesViewSource.includes('function normalizeTrafficResetPriceYuan(value: unknown): number | null') &&
    myPackagesViewSource.includes('trafficResetPrice: trafficResetPriceYuan,') &&
    !myPackagesViewSource.includes('plan.trafficResetPrice / 100') &&
    !myPackagesViewSource.includes('trafficResetPrice: trafficResetPriceCents'),
  'package plan traffic reset price override must round-trip directly in yuan'
)

assert.ok(
  trafficStatsSource.includes("trafficHistory.length === 1 ? 50 : (label.index / (trafficHistory.length - 1)) * 100"),
  'TrafficStats must center the single-day X-axis label instead of dividing by zero'
)
const adminLoginViewSource = readRepoFile('client/src/views/admin/AdminLoginView.vue')
const registerViewSource = readRepoFile('client/src/views/RegisterView.vue')
const forgotPasswordViewSource = readRepoFile('client/src/views/ForgotPasswordView.vue')
const helpViewSource = readRepoFile('client/src/views/HelpView.vue')
const oauthAuthorizeViewSource = readRepoFile('client/src/views/OAuthAuthorizeView.vue')
const mailViewSource = readRepoFile('client/src/views/MailView.vue')
const mailDomainViewSource = readRepoFile('client/src/views/MailDomainView.vue')
const walletViewSource = readRepoFile('client/src/views/WalletView.vue')
const transfersViewSource = readRepoFile('client/src/views/TransfersView.vue')
const logsViewSource = readRepoFile('client/src/views/LogsView.vue')
const ordersViewSource = readRepoFile('client/src/views/OrdersView.vue')
const invitesViewSource = readRepoFile('client/src/views/InvitesView.vue')
const entertainmentViewSource = readRepoFile('client/src/views/EntertainmentView.vue')
const hostingWalletViewSource = readRepoFile('client/src/views/HostingWalletView.vue')
const userApiSource = readRepoFile('client/src/api/index.ts')
const adminApiSource = readRepoFile('client/src/api/admin.ts')
const appPathsSource = readRepoFile('client/src/utils/app-paths.ts')
const userAppPathsSource = readRepoFile('client/src/utils/app-paths-user.ts')
const adminAppPathsSource = readRepoFile('client/src/utils/app-paths-admin.ts')
const viteConfigSource = readRepoFile('client/vite.config.ts')

const adminEndpointMarkers = [
  '/admin',
  'mail/admin',
  'help/admin',
  'images/admin',
  'inbox/admin',
  'aff/admin',
  'balance/admin',
  'telegram/admin',
  'adminNotificationChannels'
]
const userApiAdminBoundarySource = userApiSource.replaceAll('/admin-password', '/mail-domain-password')

const customerApiForbiddenAdminMarkers = [
  "http.get('/users'",
  'updateRole:',
  "http.patch(`/users/${id}/role`",
  "http.patch(`/users/${id}/status`",
  "http.post(`/users/${id}/quota/recalculate`",
  "http.post(`/users/${id}/reset-password`",
  "http.post(`/users/${id}/disable-2fa`",
  "http.delete(`/users/${userId}/oauth/${provider}`",
  "http.get(`/users/${userId}/login-records`",
  "http.get('/users/detect-linked-accounts'",
  "http.get('/oauth/configs'",
  "http.put(`/oauth/configs/${provider}`",
  "http.delete(`/oauth/configs/${provider}`",
  "http.post('/system-config/smtp/test'",
  "http.post('/system-config/smtp/send-test'",
  "http.get('/system-config')",
  "http.put('/system-config'",
  "http.get(`/users/${userId}/traffic`",
  "http.put(`/users/${userId}/traffic/limit`",
  "http.put(`/instances/${instanceId}/traffic/limit`",
  "http.post('/traffic/collect'",
  "http.post('/traffic/sync-package-limits'"
]

const adminApiForbiddenCustomerAuthMarkers = [
  'RegisterRequest',
  'RegisterResponse',
  "http.post('/auth/register'",
  "http.post('/auth/send-verification-code'",
  "http.post('/auth/forgot-password/send-code'",
  "http.post('/auth/forgot-password/reset'",
  "requestUrl.startsWith('/auth/register')",
  "window.location.pathname.startsWith('/register')"
]

const adminApiForbiddenCustomerSelfServiceMarkers = [
  '\n  billing: {',
  '\n  resourcePool: {',
  '\n  vipLevels: {',
  '\n  vipBenefits: {',
  '\n  userInvites: {',
  '\n  friends: {',
  '\n  transfers: {',
  '\n  checkin: {',
  'UserInvite',
  'UserInviteSummary',
  "http.get('/user-invites",
  "http.get('/friends",
  "http.post('/friends",
  "http.delete(`/friends",
  "http.post(`/packages/${packageId}/share`",
  "http.delete(`/packages/${packageId}/share",
  "http.patch(`/packages/${packageId}/shares",
  "http.get(`/packages/${packageId}/shares`",
  "http.get('/packages/my-shares",
  'listPublic:',
  'getPublicRegions:',
  "http.get(queryString ? `/packages/public?",
  "http.get(queryString ? `/packages/public/regions?",
  "http.get('/packages/hosting-zones",
  "http.get(`/packages/${packageId}/owner-info`",
  "source?: 'official' | 'market' | 'friends' | 'zone'",
  'zoneId?: number',
  "http.get('/transfers",
  "http.post(`/transfers",
  "http.get('/checkin",
  "http.post('/checkin",
  "http.get('/resource-pool",
  "http.post('/resource-pool",
  "http.get('/balance/me",
  "http.get('/recharge/providers",
  "http.post('/recharge/orders",
  "http.get('/recharge/orders",
  "http.get('/recharge/stats",
  "http.post('/instances/batch/renew",
  "http.post('/instances/batch/destroy",
  "http.patch('/instances/batch/auto-renew",
  "http.get('/aff/me",
  "http.post('/aff/me",
  "http.get('/vip-levels/me",
  "http.get('/vip-benefits/me",
  "http.post('/vip-benefits",
  "http.get('/mail/subscription",
  "http.post('/mail/subscription",
  "http.get('/mail/domains",
  "http.post('/mail/domains",
  "http.get('/entertainment/points",
  "http.post('/entertainment/points",
  "http.get('/entertainment/badges",
  "http.post('/entertainment/badges",
  "http.get('/entertainment/lotteries",
  "http.post(`/entertainment/lotteries",
  "http.get('/entertainment/lottery-records",
  "http.get('/hosting/balance",
  "http.get('/hosting/stats",
  "http.get('/hosting/logs",
  "http.post('/hosting/withdraw",
  "http.get('/hosting/withdrawals",
  "http.get('/hosting/blocks",
  "http.post('/hosting/blocks",
  "http.delete(`/hosting/blocks",
  "http.get('/hosting/access-check"
]

const adminReachablePackageViewForbiddenCustomerShareMarkers = [
  'showShareModal',
  'showSharesModal',
  'showEditQuotaModal',
  'openShareModal',
  'sharePackage',
  'loadShares',
  'unsharePackage',
  'openEditQuotaModal',
  'saveEditQuota',
  'getUsagePercent',
  'availableFriends',
  'friendSearchQuery',
  'selectedFriendId',
  'shareLoading',
  'quotaMultiplierOptions',
  'maxInstancesOptions',
  'packageQuota',
  'editingShare',
  'api.packages.share',
  'api.packages.getShares',
  'api.packages.unshare',
  'api.packages.updateShareQuota',
  'resources.packages.shareToFriend',
  'resources.packages.sharesList',
  'resources.packages.editQuota'
]

function assertUniqueRouteNames(name: string, source: string): string[] {
  const routeNames = Array.from(source.matchAll(/^\s{4}name:\s*'([^']+)'/gm)).map(match => match[1])
  const duplicateNames = routeNames.filter((routeName, index) => routeNames.indexOf(routeName) !== index)
  assert.deepEqual(duplicateNames, [], `${name} Vue Router route names must be unique: ${duplicateNames.join(', ')}`)
  return routeNames
}

const userRouteNames = assertUniqueRouteNames('user', userRouterSource)
const adminRouteNames = assertUniqueRouteNames('admin', adminRouterSource)
const userAuthenticatedRoutesWithoutUserGuard = Array.from(
  userRouterSource.matchAll(/path:\s*'([^']+)'[\s\S]*?name:\s*'([^']+)'[\s\S]*?meta:\s*\{([^}]*)\}/g)
)
  .map(match => ({
    path: match[1],
    name: match[2],
    meta: match[3]
  }))
  .filter(route => route.meta.includes('requiresAuth: true') && !route.meta.includes('requiresUser: true'))
  .map(route => `${route.name}:${route.path}`)

assert.ok(!userRouterSource.includes("path: '/admin"), 'customer router must not expose /admin routes')
assert.ok(!userRouterSource.includes('@/views/admin/'), 'customer router must not import admin views')
assert.ok(!userRouterSource.includes('requiresAdmin'), 'customer router must not carry admin-only route metadata')
assert.ok(
  userRouterSource.includes("path: '/forgot-password'") &&
    userRouterSource.includes("name: 'forgot-password'") &&
    userRouterSource.includes('@/views/ForgotPasswordView.vue') &&
    userRouterSource.includes('meta: { guest: true }') &&
    appSource.includes("const noLayoutRoutes: string[] = ['login', 'register', 'forgot-password']") &&
    appSource.includes("!noLayoutRoutes.some(name => route.name === name)"),
  'forgot-password must remain a guest auth page without customer app layout or stale-session redirects'
)
assert.deepEqual(
  userAuthenticatedRoutesWithoutUserGuard,
  [],
  'customer authenticated routes must require non-admin users so admin accounts cannot enter the customer panel'
)
assert.ok(adminRouterSource.includes("path: '/admin/users'"), 'admin router must expose admin users route')
assert.ok(adminRouterSource.includes('@/views/admin/UsersView.vue'), 'admin router must import admin views')
assert.ok(adminRouterSource.includes('@/views/admin/AdminLoginView.vue'), 'admin router must import the admin-only login view')
assert.ok(adminRouterSource.includes("from '@/api/admin'"), 'admin router must use the admin API client')
assert.ok(!adminRouterSource.includes("from '@/api'"), 'admin router must not use the customer API client')
assert.ok(
  adminRouterSource.includes("path: '/admin/tickets'") &&
    adminRouterSource.includes("path: '/admin/logs'") &&
    adminRouterSource.includes("path: '/admin/profile'") &&
    adminRouterSource.includes("path: '/admin/inbox'") &&
    adminRouterSource.includes("path: '/admin/instances'") &&
    adminRouterSource.includes("path: '/admin/instances/:id'") &&
    adminRouterSource.includes("path: '/admin/resources/hosts'") &&
    adminRouterSource.includes("path: '/admin/resources/packages'"),
  'admin router must keep shared admin features under the /admin namespace'
)
assert.ok(
  userRouterSource.includes("name: 'instance-detail'") &&
    adminRouterSource.includes("name: 'admin-instance-detail'") &&
    instanceDetailViewSource.includes("'instance-detail'") &&
    instanceDetailViewSource.includes("'admin-instance-detail'") &&
    instanceDetailViewSource.includes('isInstanceDetailRouteName(route.name)') &&
    !instanceDetailViewSource.includes("route.name !== 'instance-detail'"),
  'shared instance detail view must accept both customer and admin detail route names before loading data'
)
assert.ok(
  !adminRouterSource.includes("path: '/tickets'") &&
    !adminRouterSource.includes("path: '/logs'") &&
    !adminRouterSource.includes("path: '/profile'") &&
    !adminRouterSource.includes("path: '/inbox'") &&
    !adminRouterSource.includes("path: '/resources/hosts'") &&
    !adminRouterSource.includes("path: '/resources/packages'"),
  'admin router must not expose customer URL paths for shared pages'
)
assert.ok(!adminRouterSource.includes('@/views/RegisterView.vue'), 'admin router must not expose registration')
assert.ok(!adminRouterSource.includes('@/views/LoginView.vue'), 'admin router must not reuse the customer login view')
assert.ok(!adminRouterSource.includes('@/views/PortalView.vue'), 'admin router must not expose the public portal')
assert.ok(!adminRouterSource.includes('@/views/MarketView.vue'), 'admin router must not expose the public market')
assert.ok(!adminRouteNames.includes('dashboard'), 'admin router must not expose the customer dashboard route')

const portalRoute = sectionBetween(
  userRouterSource,
  "path: '/'",
  "path: '/dashboard'"
)
assert.ok(
  portalRoute.includes("name: 'portal'") &&
    portalRoute.includes("component: () => import('@/views/PortalView.vue')") &&
    portalRoute.includes("titleKey: 'publicSite.nav.overview'"),
  'public / route must render PortalView directly'
)
assert.ok(
  !portalRoute.includes('redirect:'),
  'public / route must not redirect guests to the authenticated dashboard'
)

const marketRoute = sectionBetween(
  userRouterSource,
  "path: '/market'",
  "path: '/instances'"
)

assert.ok(
  marketRoute.includes("name: 'market'") &&
    marketRoute.includes("component: () => import('@/views/MarketView.vue')") &&
    marketRoute.includes("titleKey: 'publicSite.market.title'"),
  'public /market route must render MarketView directly'
)
assert.ok(
  !marketRoute.includes('redirect:'),
  'public /market route must not redirect to authenticated instance creation'
)
assert.equal(
  userRouteNames.filter(name => name === 'instance-create').length,
  1,
  'authenticated instance creation route name must not be duplicated by public market routing'
)

assert.ok(
  publicHeaderSource.includes("import { dashboardPath, helpPath, loginPath, registerPath } from '@/utils/app-paths'") &&
    publicHeaderSource.includes("to: '/'") &&
    publicHeaderSource.includes("to: '/purchase'") &&
    !publicHeaderSource.includes('marketPath()') &&
    publicHeaderSource.includes('to: helpPath()') &&
    publicHeaderSource.includes('const consoleTarget = computed(() => dashboardPath())') &&
    publicHeaderSource.includes('router.push(registerPath())') &&
    publicHeaderSource.includes('router.push(loginPath())') &&
    !publicHeaderSource.includes("router.push('/register')") &&
    !publicHeaderSource.includes("router.push('/login')") &&
    publicFooterSource.includes("{ to: '/', label: t('publicSite.nav.overview') }") &&
    publicFooterSource.includes("import { dashboardPath, forgotPasswordPath, helpPath, loginPath, registerPath } from '@/utils/app-paths'") &&
    publicFooterSource.includes("to: '/purchase'") &&
    !publicFooterSource.includes('marketPath()') &&
    publicFooterSource.includes(':to="helpPath()"') &&
    publicFooterSource.includes("to: loginPath()") &&
    publicFooterSource.includes("to: registerPath()") &&
    publicFooterSource.includes("to: forgotPasswordPath()") &&
    publicFooterSource.includes('const consoleTarget = computed(() => dashboardPath())') &&
    !publicFooterSource.includes("router.push('/register')") &&
    !publicFooterSource.includes("router.push('/login')") &&
    !publicFooterSource.includes("to: '/forgot-password'") &&
    portalViewSource.includes("name: 'PortalView'") &&
    marketViewSource.includes("name: 'MarketView'"),
  'public navigation must expose one pooled purchase entry while keeping customer account and help routes'
)
assert.ok(
  portalViewSource.includes('<HomepageMapDemo :preview="false" />') &&
    homepageMapSource.includes("import { dashboardPath, helpPath, loginPath } from '@/utils/app-paths'") &&
    homepageMapSource.includes('to="/purchase"') &&
    homepageMapSource.includes('void router.push(dashboardPath())') &&
    homepageMapSource.includes('void router.push(loginPath())') &&
    homepageMapSource.includes('authStore.isAuthenticated') &&
    homepageMapSource.includes('v-if="props.preview" class="preview-note"') &&
    !homepageMapSource.includes('class="motion-toggle"') &&
    homepageMapSource.includes("motionPreference.addEventListener('change', syncMotionPreference)") &&
    !homepageMapSource.includes('https://vm.oci.ee') &&
    !homepageMapSource.includes('openAdminConsole') &&
    !homepageMapSource.includes("void router.push('/dashboard')") &&
    !homepageMapSource.includes("void router.push('/login')") &&
    !homepageMapSource.includes("path: '/market'") &&
    publicLayoutSource.includes('route.name === \'portal\'') &&
    !portalViewSource.includes('openAdminConsole'),
  'the formal homepage must render the confirmed map once, hide preview controls, and retain real customer login/console destinations'
)
assert.ok(
  homepageMapSource.includes('api.packages.getPublicCatalog()') &&
    !homepageMapSource.includes('api.packages.listPublic()') &&
    homepageMapSource.includes('presentation="minimal"') &&
    homepageAtlasSource.includes("touchMode.value && route.query.mobile !== 'map'") &&
    homepageTargetsSource.includes('buildPoolPurchaseRegions(catalog)') &&
    homepageTargetsSource.includes('regionId: group.id') &&
    homepageTargetsSource.includes("path: '/purchase', query: { region: String(group.id) }") &&
    homepageAtlasSource.includes('selected.stock > 0 && !loading && !failed') &&
    publicHostOfferSource.includes("path: '/purchase'") &&
    publicHostOfferSource.includes('region: String(props.regionId), product: String(props.product.id)') &&
    publicHostOfferSource.includes('v-if="product.idle > 0"') &&
    publicHostOfferSource.includes('class="host-offer-action" disabled') &&
    publicHostOfferSource.includes('product.cpu / 100'),
  'the homepage must use the real catalog and numeric purchase identifiers, default to the mobile globe, and disable unknown or sold-out inventory'
)
assert.ok(
  oauthAuthorizeViewSource.includes("import { dashboardPath } from '@/utils/app-paths'") &&
    oauthAuthorizeViewSource.includes('router.push(dashboardPath())') &&
    !oauthAuthorizeViewSource.includes("router.push('/dashboard')"),
  'OAuth authorize page must return to the customer console through app path helpers'
)
assert.ok(
  !userRouterSource.includes('openAdminLogin') &&
    userRouterSource.includes("next({ name: 'login', query: { adminOnly: '1' } })") &&
    userRouterSource.includes('if ((to.meta.requiresAuth || to.meta.requiresUser) && authStore.isAdmin)') &&
    !loginViewSource.includes('isAdminEntry') &&
    !loginViewSource.includes('后台管理系统') &&
    !loginViewSource.includes('/admin/users') &&
    loginViewSource.includes("import { forgotPasswordPath, registerPath } from '@/utils/app-paths'") &&
    loginViewSource.includes(':to="registerPath()"') &&
    loginViewSource.includes(':to="forgotPasswordPath()"') &&
    !loginViewSource.includes('to="/register"') &&
    !loginViewSource.includes('to="/forgot-password"') &&
    loginViewSource.includes('authStore.isAdmin') &&
    loginViewSource.includes('管理员账号请使用独立管理后台登录') &&
    adminLoginViewSource.includes('后台管理系统') &&
    adminLoginViewSource.includes('该入口仅限管理员登录') &&
    adminLoginViewSource.includes('仅限管理员账号登录') &&
    adminLoginViewSource.includes("'/admin/users'") &&
    adminLoginViewSource.includes("from '@/api/admin'") &&
    adminRouterSource.includes("path: '/admin/login'") &&
    adminRouterSource.includes("path: '/login'") &&
    adminRouterSource.includes("path: '/admin/login',") &&
    adminRouterSource.includes('query: to.query') &&
    adminAppSource.includes("const adminLoginPath = '/admin/login'") &&
    adminAppSource.includes('window.location.href = adminLoginPath') &&
    !adminAppSource.includes("window.location.href = '/login'") &&
    adminApiSource.includes("const ADMIN_LOGIN_PATH = '/admin/login'") &&
    adminApiSource.includes('window.location.href = ADMIN_LOGIN_PATH') &&
    !adminApiSource.includes("window.location.href = '/login'") &&
    !adminLoginViewSource.includes('to="/register"') &&
    !adminLoginViewSource.includes('to="/forgot-password"') &&
    !loginViewSource.includes('openAdminLogin') &&
    !registerViewSource.includes('openAdminLogin') &&
    !publicHeaderSource.includes('getAdminConsoleUrl') &&
    !publicFooterSource.includes('getAdminConsoleUrl') &&
    !publicHeaderSource.includes('window.location.href = consoleTarget.value') &&
    !publicFooterSource.includes('window.location.href = consoleTarget.value'),
  'customer frontend must not cross-redirect to the admin host, while the admin frontend still rejects non-admin users'
)
assert.deepEqual(
  adminEndpointMarkers.filter(marker => userApiAdminBoundarySource.includes(marker)),
  [],
  'customer API client must not contain admin endpoint strings or admin API namespaces'
)
assert.deepEqual(
  customerApiForbiddenAdminMarkers.filter(marker => userApiSource.includes(marker)),
  [],
  'customer API client must not expose admin-only account, system, OAuth config, or traffic-management methods'
)
assert.ok(
  adminEndpointMarkers.some(marker => adminApiSource.includes(marker)) &&
    adminApiSource.includes("admin: {") &&
    adminApiSource.includes("adminNotificationChannels:"),
  'admin API client must retain admin endpoints separately from the customer API client'
)
assert.ok(
  adminApiSource.includes('CreateInstanceResponse') &&
    adminApiSource.includes('create: (data: CreateInstanceRequest): Promise<CreateInstanceResponse>'),
  'admin API instance create must use the shared create response contract with nested instance details'
)
assert.deepEqual(
  adminApiForbiddenCustomerAuthMarkers.filter(marker => adminApiSource.includes(marker)),
  [],
  'admin API client must not expose customer registration or forgot-password self-service methods'
)
assert.deepEqual(
  adminApiForbiddenCustomerSelfServiceMarkers.filter(marker => adminApiSource.includes(marker)),
  [],
  'admin API client must not expose customer-only invite, friend, transfer, check-in, billing, VIP, resource-pool, AFF, mail, entertainment, or hosting-balance self-service modules'
)
assert.deepEqual(
  adminReachablePackageViewForbiddenCustomerShareMarkers.filter(marker => myPackagesViewSource.includes(marker)),
  [],
  'admin-reachable package view must not retain disabled customer friend-share UI, state, or package share API calls'
)
assert.ok(
  !authStoreSource.includes('RegisterRequest') &&
    !authStoreSource.includes('async function register(') &&
    !authStoreSource.includes('api.auth.register') &&
    registerViewSource.includes("import { dashboardPath, loginPath } from '@/utils/app-paths'") &&
    registerViewSource.includes('api.auth.register') &&
    registerViewSource.includes('authStore.syncToken()') &&
    registerViewSource.includes('authStore.fetchCurrentUser()') &&
    loginViewSource.includes('await router.replace(safeRedirect)') &&
    registerViewSource.includes('await router.replace(dashboardPath())') &&
    registerViewSource.includes('router.push(loginPath())') &&
    registerViewSource.includes(':to="loginPath()"') &&
    userRouterSource.includes("next({ name: 'dashboard', replace: true })") &&
    !registerViewSource.includes("router.push('/dashboard')") &&
    !registerViewSource.includes("router.push('/login')") &&
    !registerViewSource.includes('to="/login"'),
  'shared auth store must not expose customer registration; registration belongs only to RegisterView in the customer entry'
)
assert.ok(
  forgotPasswordViewSource.includes("import { loginPath } from '@/utils/app-paths'") &&
    forgotPasswordViewSource.includes("import { translateError } from '@/utils/errorHandler'") &&
    countOccurrences(forgotPasswordViewSource, 'error.value = translateError(err)') >= 2 &&
    forgotPasswordViewSource.includes('router.push(loginPath())') &&
    forgotPasswordViewSource.includes(':to="loginPath()"') &&
    !forgotPasswordViewSource.includes('error.value = err?.message') &&
    !forgotPasswordViewSource.includes("router.push('/login')") &&
    !forgotPasswordViewSource.includes('to="/login"'),
  'ForgotPasswordView must route back to customer login through the shared path helper and localize API failure states'
)
assert.ok(
    registerViewSource.includes('function resetTurnstileChallenge(): void') &&
    registerViewSource.includes('turnstileRef.value?.reset?.()') &&
    registerViewSource.includes('resetTurnstileChallenge()') &&
    registerViewSource.includes('error.value = translateError(err)\n    resetTurnstileChallenge()'),
  'RegisterView must reset only the Turnstile challenge after register failures so invite-code correction keeps the filled form'
)
for (const [viewName, source, helperName] of [
  ['LoginView', loginViewSource, 'getLoginTurnstileToken'],
  ['RegisterView', registerViewSource, 'getRegisterTurnstileToken'],
  ['ForgotPasswordView', forgotPasswordViewSource, 'getForgotPasswordTurnstileToken']
] as const) {
  assert.ok(
    source.includes("from '@/utils/turnstile'") &&
      source.includes('const turnstileSectionRef = ref<HTMLElement | null>(null)') &&
      source.includes(`function ${helperName}`) &&
      source.includes('const isTurnstileChallengeAvailable = computed<boolean>(() => turnstileEnabled.value && Boolean(turnstileSiteKey.value))') &&
      source.includes('if (!isTurnstileChallengeAvailable.value) return undefined') &&
      source.includes('v-if="isTurnstileChallengeAvailable"') &&
      source.includes('readTurnstileToken(turnstileRef.value, turnstileToken.value)') &&
      source.includes('focusTurnstileSection(turnstileSectionRef.value)') &&
      source.includes('ref="turnstileSectionRef"') &&
      source.includes('tabindex="-1"'),
    `${viewName} must read Turnstile tokens from the widget/hidden input and focus the visible challenge when missing`
  )
}
assert.ok(
  walletViewSource.includes('const providersLoading = ref(false)') &&
    walletViewSource.includes('function resetRechargeProviderSelection()') &&
    walletViewSource.includes('providers.value = []') &&
    walletViewSource.includes('selectedProvider.value = null') &&
    walletViewSource.includes('providersLoading.value = true') &&
    walletViewSource.includes('v-if="providersLoading"') &&
    walletViewSource.includes('v-else-if="providers.length === 0"') &&
    walletViewSource.includes(':disabled="providersLoading || rechargeLoading || !selectedProvider') &&
    walletViewSource.includes('if (providersLoading.value)'),
  'wallet recharge modal must clear stale payment providers, show a loading state, and block order creation while providers load'
)
assert.ok(
  mainSource.includes("import clientPackage from '../package.json'") &&
    mainSource.includes('const serviceWorkerUrl = `/sw.js?v=${encodeURIComponent(clientPackage.version)}`') &&
    mainSource.includes('shouldReloadForServiceWorkerControllerChange(clientPackage.version)') &&
    mainSource.includes("navigator.serviceWorker.register(serviceWorkerUrl, { updateViaCache: 'none' })") &&
    adminMainSource.includes("import clientPackage from '../../package.json'") &&
    adminMainSource.includes('const serviceWorkerUrl = `/sw.js?v=${encodeURIComponent(clientPackage.version)}`') &&
    adminMainSource.includes('shouldReloadForServiceWorkerControllerChange(clientPackage.version)') &&
    adminMainSource.includes("navigator.serviceWorker.register(serviceWorkerUrl, { updateViaCache: 'none' })"),
  'user and admin entries must register a versioned Service Worker URL with updateViaCache disabled and avoid repeated controllerchange reloads'
)
assert.ok(
  staleAssetRecoverySource.includes("window.addEventListener('vite:preloadError'") &&
    staleAssetRecoverySource.includes("window.addEventListener('unhandledrejection'") &&
    staleAssetRecoverySource.includes("window.addEventListener('error'") &&
    staleAssetRecoverySource.includes("cacheName.startsWith('incudal-cache-')") &&
    staleAssetRecoverySource.includes("const STALE_ASSET_RELOAD_SIGNATURE_KEY = 'incudal:stale-asset-reload-signature'") &&
    staleAssetRecoverySource.includes("window.sessionStorage.getItem(STALE_ASSET_RELOAD_SIGNATURE_KEY) === signature") &&
    staleAssetRecoverySource.includes("const SERVICE_WORKER_RELOAD_KEY_PREFIX = 'incudal:service-worker-controller-reloaded:'") &&
    staleAssetRecoverySource.includes('window.location.reload()') &&
    mainSource.includes('installStaleAssetRecovery()') &&
    adminMainSource.includes('installStaleAssetRecovery()') &&
    userRouterSource.includes("scheduleStaleAssetReload('user-router-error'") &&
    adminRouterSource.includes("scheduleStaleAssetReload('admin-router-error'") &&
    appSource.includes("scheduleStaleAssetReload('app-error-captured'") &&
    adminAppSource.includes("scheduleStaleAssetReload('admin-app-error-captured'"),
  'user and admin frontends must recover from stale Vite chunks/preload failures without entering reload loops'
)
assert.ok(
  !indexHtmlSource.includes('https://mcp.figma.com/mcp/html-to-design/capture.js'),
  'production index.html must not load the Figma capture script'
)
assert.ok(
  turnstileWidgetSource.includes("verificationState = ref<'pending' | 'verified' | 'expired' | 'error'>('pending')") &&
    turnstileWidgetSource.includes("t('common.turnstileStatusTitle')") &&
    turnstileWidgetSource.includes("t('common.turnstileUnverified')") &&
    turnstileWidgetSource.includes("t('common.turnstileVerified')") &&
    turnstileWidgetSource.includes('class="turnstile-status-row"') &&
    turnstileWidgetSource.includes('class="turnstile-status-pill"') &&
    turnstileWidgetSource.includes("verificationState.value = 'verified'") &&
    turnstileWidgetSource.includes("verificationState.value = 'pending'"),
  'TurnstileWidget must show a fixed verification status row so users can distinguish unverified and verified states'
)
assert.ok(
  adminUsersViewSource.includes('import.meta.env.VITE_CUSTOMER_BASE_URL') &&
    adminUsersViewSource.includes('window.location.origin') &&
    adminUsersViewSource.includes('return `${customerBaseUrl.value}/register/${newInviteCode.value}`') &&
    !adminUsersViewSource.includes('return `${window.location.origin}/register/${newInviteCode.value}`'),
  'admin generated invite links must point to the configured customer frontend origin, not the admin origin'
)
assert.ok(
  helpViewSource.includes('function isHelpArticleNotFoundError(err: unknown): boolean') &&
    helpViewSource.includes("maybeError.code === 'ARTICLE_NOT_FOUND'") &&
    helpViewSource.includes("articleError.value = isHelpArticleNotFoundError(err) ? t('help.articleNotFound') : t('help.loadFailed')"),
  'Help article detail must render ARTICLE_NOT_FOUND as a not-found empty state instead of a generic load failure'
)
assert.ok(
  oauthAuthorizeViewSource.includes('function describeConsentError(err: unknown): { message: string; hint: string }') &&
    oauthAuthorizeViewSource.includes("apiError?.code === 'OAUTH_CONSENT_FAILED'") &&
    oauthAuthorizeViewSource.includes('授权应用不可用') &&
    oauthAuthorizeViewSource.includes('errorHint.value = friendlyError.hint') &&
    oauthAuthorizeViewSource.includes('v-if="errorHint"'),
  'OAuth authorize must show a clear unavailable-app hint for invalid or disabled OAuth client consent failures'
)
assert.ok(
  appSource.includes("import PublicSiteLayout from '@/components/public/PublicSiteLayout.vue'") &&
    appSource.includes("const publicSiteRouteNames = new Set(['portal', 'market', 'help', 'help-article'])") &&
    appSource.includes('const showPublicSiteLayout = computed<boolean>') &&
    appSource.includes('!showPublicSiteLayout.value') &&
    appSource.includes('<PublicSiteLayout v-else-if="showPublicSiteLayout">'),
  'App shell must wrap public portal, market, and help routes with the public site header/footer layout'
)
const authenticatedAppShell = sectionBetween(
  appSource,
  '<AppLayout v-if="showLayout">',
  '<PublicSiteLayout v-else-if="showPublicSiteLayout">'
)
assert.ok(
  authenticatedAppShell.includes('<Transition name="kawaii-route">') &&
    !authenticatedAppShell.includes('mode="out-in"') &&
    authenticatedAppShell.includes("'InstancesView'") &&
    authenticatedAppShell.includes("'InstanceCreateView'"),
  'authenticated App shell must not out-in transition cached route switches, and InstancesView must stay outside KeepAlive so create-instance submit returns to a rendered list instead of a blank workspace'
)
assert.ok(
  adminMainSource.includes("import App from './AdminApp.vue'") &&
    adminAppSource.includes("const noLayoutRoutes: string[] = ['login']") &&
    !adminAppSource.includes('PublicSiteLayout') &&
    !adminAppSource.includes('PopupAnnouncementModal') &&
    !adminAppSource.includes("window.location.pathname.startsWith('/register')"),
  'admin app shell must be separate from the public/customer app shell'
)
assert.ok(
  appLayoutSource.includes("const isAdminEntry = import.meta.env.VITE_APP_ENTRY === 'admin'") &&
    appLayoutSource.includes("import { instancesPath, loginPath, profilePath, terminalPath } from '@/utils/app-paths'") &&
    appLayoutSource.includes('const accountProfilePath = profilePath()') &&
    appLayoutSource.includes('const accountTerminalPath = terminalPath()') &&
    appLayoutSource.includes('const accountInstancesPath = instancesPath()') &&
    appLayoutSource.includes('const accountLoginPath = loginPath()') &&
    appLayoutSource.includes('router.push(accountLoginPath)') &&
    !appLayoutSource.includes("router.push('/login')") &&
    appLayoutSource.includes('v-if="!isAdminEntry"') &&
    appLayoutSource.includes('@click="router.push(accountTerminalPath)"') &&
    !appLayoutSource.includes("@click=\"router.push('/terminal')\"") &&
    appLayoutSource.includes('@click="navigateTo(accountInstancesPath)"') &&
    !appLayoutSource.includes("navigateTo('/instances')"),
  'shared authenticated layout must hide customer-only terminal and instance shortcuts in the admin entry'
)
assert.ok(
  sideNavSource.includes("from '@/config/side-nav-items'") &&
    sideNavSource.includes("import { dashboardPath } from '@/utils/app-paths'") &&
    sideNavSource.includes('const navDashboardPath = dashboardPath()') &&
    sideNavSource.includes("if (item.name === 'dashboard') return route.path === navDashboardPath") &&
    sideNavSource.includes(':to="navDashboardPath"') &&
    !sideNavSource.includes("return route.path === '/dashboard'") &&
    !sideNavSource.includes('RouterLink to="/"') &&
    sideNavSource.includes('let baseItems = [...navMenuItems]') &&
    sideNavUserItemsSource.includes("path: '/resources/hosts'") &&
    sideNavUserItemsSource.includes("path: '/resources/packages'") &&
    !sideNavUserItemsSource.includes('/admin/') &&
    sideNavAdminItemsSource.includes("path: '/admin/tickets'") &&
    sideNavAdminItemsSource.includes("path: '/admin/profile'") &&
    sideNavAdminItemsSource.includes("path: '/admin/resources/hosts'"),
  'shared SideNav menu tables must be build-time aliased so customer bundles do not keep admin navigation entries'
)
assert.ok(
  viteConfigSource.includes("name: 'payincus-admin-locale-prune'") &&
    viteConfigSource.includes('stripAdminOnlyLocaleMessages(code)') &&
    viteConfigSource.includes('userOnlyTopLevelKeys') &&
    viteConfigSource.includes('disabledPackageShareKeys'),
  'admin builds must prune user-only locale messages so customer text tables are not bundled into the admin entry'
)
assert.ok(
  viteConfigSource.includes("name: 'payincus-user-locale-prune'") &&
    viteConfigSource.includes('stripUserOnlyLocaleMessages(code)') &&
    viteConfigSource.includes('adminOnlyTopLevelKeys') &&
    viteConfigSource.includes('adminOnlyNavKeys') &&
    viteConfigSource.includes('sharedUserKeys'),
  'customer builds must prune admin-only locale messages while preserving shared host/package text used by customer-reachable pages'
)
assert.ok(
    appPathsSource.includes('export const isAdminEntry = false') &&
    appPathsSource.includes("return '/login'") &&
    !appPathsSource.includes('/admin/') &&
    userAppPathsSource.includes("return '/login'") &&
    userAppPathsSource.includes('export function registerPath(inviteCode?: string): string') &&
    userAppPathsSource.includes("`/register/${encodeURIComponent(inviteCode)}` : '/register'") &&
    userAppPathsSource.includes("return '/forgot-password'") &&
    userAppPathsSource.includes("return '/market'") &&
    userAppPathsSource.includes("return '/resources/hosts'") &&
    userAppPathsSource.includes("return '/resources/packages'") &&
    userAppPathsSource.includes("return '/wallet'") &&
    userAppPathsSource.includes("return '/help'") &&
    userAppPathsSource.includes("return '/inbox'") &&
    userAppPathsSource.includes("return '/mail'") &&
    userAppPathsSource.includes('return `/mail/domains/${encodeURIComponent(String(id))}`') &&
    userAppPathsSource.includes("return '/terminal'") &&
    userAppPathsSource.includes("return '/extensions'") &&
    userAppPathsSource.includes("return '/entertainment'") &&
    userAppPathsSource.includes("return '/instances'") &&
    userAppPathsSource.includes("return '/instances/create'") &&
    adminAppPathsSource.includes("return '/admin/login'") &&
    adminAppPathsSource.includes("return '/admin/resources/packages'") &&
    adminAppPathsSource.includes("return '/admin/profile'") &&
    adminAppPathsSource.includes("return '/admin/billing'") &&
    adminAppPathsSource.includes("return '/admin/help'") &&
    adminAppPathsSource.includes("return '/admin/inbox'") &&
    adminAppPathsSource.includes("return '/admin/mail'") &&
    adminAppPathsSource.includes('export function mailDomainPath(_id?: number | string): string') &&
    adminAppPathsSource.includes("return '/admin/entertainment'") &&
    adminAppPathsSource.includes("return '/admin/instances'") &&
    adminAppPathsSource.includes('return null') &&
    adminAppPathsSource.includes("return '/admin/instances'") &&
    adminAppPathsSource.includes("return '/admin/instances/create'") &&
    adminAppPathsSource.includes("return '/admin/resources/hosts'") &&
    adminAppPathsSource.includes("return '/admin/resources/packages'"),
  'shared views must use build-time aliased app path helpers for customer/admin URL separation'
)
assert.ok(
  passwordSectionSource.includes("import { loginPath } from '@/utils/app-paths'") &&
    passwordSectionSource.includes('const reauthLoginPath = loginPath()') &&
    passwordSectionSource.includes('window.location.href = reauthLoginPath') &&
    !passwordSectionSource.includes("window.location.href = '/login'"),
  'shared profile password section must redirect reauth to the build-specific login path'
)
assert.ok(
  adminUsersViewSource.includes("import { instancesPath } from '@/utils/app-paths'") &&
    adminUsersViewSource.includes('path: instancesPath()') &&
    adminBillingViewSource.includes("import { instanceDetailPath } from '@/utils/app-paths'") &&
    !adminBillingViewSource.includes('`/instances/${inst.id}`') &&
    instancesViewSource.includes('instanceCreatePath') &&
    instancesViewSource.includes('instanceDetailPath') &&
    !instancesViewSource.includes('router.push(`/instances/${instanceId}`)') &&
    !instancesViewSource.includes('to="/instances/create"') &&
    instanceDetailViewSource.includes('instancesPath()') &&
    myHostsViewSource.includes("import { hostCreatePath, hostDetailPath, isAdminEntry } from '@/utils/app-paths'") &&
    myHostsViewSource.includes("if (isAdminEntry || authStore.user?.role === 'admin')") &&
    hostInstancesTabSource.includes('instanceDetailPath(id)') &&
    hostCreateInstanceTabSource.includes('instanceDetailPath(result.instance.id)') &&
    ticketInstanceOwnerCardSource.includes('instanceDetailPath(props.instanceSummary.id)') &&
    myPackagesViewSource.includes("import { instanceCreatePath, isAdminEntry, packageCreatePath, packageEditPath } from '@/utils/app-paths'") &&
    myPackagesViewSource.includes('if (isAdminEntry) return') &&
    myPackagesViewSource.includes('${window.location.origin}${instanceCreatePath()}?source=${source}&package=${pkg.id}') &&
    myPackagesViewSource.includes('v-if="!isAdminEntry"') &&
    myPackagesViewSource.includes('class="space-y-3 p-4 lg:hidden"') &&
    myPackagesViewSource.includes('class="hidden overflow-hidden lg:block"') &&
    myPackagesViewSource.includes('class="w-full table-fixed text-sm"') &&
    myPackagesViewSource.includes('class="rounded-lg border border-themed bg-themed-surface p-4 shadow-sm"') &&
    myPackagesViewSource.includes('class="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-themed pt-3"') &&
    myPackagesViewSource.includes('@click="copyShareLink(pkg)"') &&
    myPackagesViewSource.includes('@click="openPlansModal(pkg)"') &&
    myPackagesViewSource.includes('@click="openQuotaReleaseModal(pkg)"') &&
    myPackagesViewSource.includes('@click="openEdit(pkg)"') &&
    myPackagesViewSource.includes('@click="togglePackageActive(pkg)"') &&
    myPackagesViewSource.includes('@click="deletePackage(pkg)"') &&
    !myPackagesViewSource.includes('class="w-full min-w-[1120px] table-fixed text-sm"') &&
    !myPackagesViewSource.includes('<table class="w-full text-sm"'),
  'admin-reachable shared instance pages must use app path helpers and MyPackagesView must render mobile package cards plus a fixed desktop table without PC horizontal overflow'
)
assert.ok(
  countOccurrences(adminBillingViewSource, 'class="space-y-3 p-4 lg:hidden"') >= 2 &&
    countOccurrences(adminBillingViewSource, 'table class="w-full table-fixed text-sm"') >= 3 &&
    adminBillingViewSource.includes('table class="hidden w-full table-fixed text-sm lg:table"') &&
    adminBillingViewSource.includes('@change="toggleSelectAllCurrentPage"') &&
    adminBillingViewSource.includes('@click="openBatchPriceModal"') &&
    adminBillingViewSource.includes('@click="openPriceModal(inst)"') &&
    adminBillingViewSource.includes("@click=\"openActionModal('unsuspend', inst)\"") &&
    adminBillingViewSource.includes("@click=\"openActionModal('extend', inst)\"") &&
    adminBillingViewSource.includes('@click="openUpgradeModal(inst)"') &&
    adminBillingViewSource.includes("@click=\"openActionModal('applyDiscount', inst)\"") &&
    adminBillingViewSource.includes("@click=\"openActionModal('deleteRefund', inst)\"") &&
    adminBillingViewSource.includes('@click="submitBatchUpdatePrice"') &&
    adminBillingViewSource.includes('@click="syncRechargeRecord(rec)"') &&
    adminBillingViewSource.includes('batchPricePreviewHasVersionSnapshot') &&
    !adminBillingViewSource.includes('<div class="overflow-x-auto">') &&
    !adminBillingViewSource.includes('class="hidden overflow-x-auto md:block"') &&
    !adminBillingViewSource.includes('table class="w-full min-w-[720px] text-sm"') &&
    !adminBillingViewSource.includes('table class="w-full text-sm"') &&
    !adminBillingViewSource.includes('class="grid min-w-[520px]'),
  'admin billing instance, record, recharge, and batch price preview lists must use responsive cards/fixed tables while preserving selection, payment sync, price, upgrade, and guarded submit actions'
)
assert.ok(
  instancesViewSource.includes('walletPath()') &&
    !instancesViewSource.includes('to="/wallet"') &&
    instanceDetailViewSource.includes('helpPath()') &&
    !instanceDetailViewSource.includes('to="/help"') &&
    instanceCreateViewSource.includes('profilePath()') &&
    !instanceCreateViewSource.includes('to="/profile"') &&
    helpViewSource.includes("import { helpPath } from '@/utils/app-paths'") &&
    helpViewSource.includes('router.push(helpPath())') &&
    !helpViewSource.includes("router.push('/help')") &&
    ticketsViewSource.includes("import { ticketsPath } from '@/utils/app-paths'") &&
    ticketsViewSource.includes('path: ticketsPath()') &&
    !ticketsViewSource.includes("name: 'tickets'") &&
    renewModalSource.includes('walletPath()') &&
    !renewModalSource.includes('href="/wallet"') &&
    changePlanModalSource.includes('walletPath()') &&
    !changePlanModalSource.includes('href="/wallet"') &&
    walletViewSource.includes("import { instanceDetailPath, walletPath } from '@/utils/app-paths'") &&
    walletViewSource.includes('router.replace({ path: walletPath() })') &&
    walletViewSource.includes('router.push(instanceDetailPath(log.instanceId))') &&
    !walletViewSource.includes("router.replace({ path: '/wallet' })") &&
    !walletViewSource.includes('router.push(`/instances/${log.instanceId}`)'),
  'admin-reachable shared pages must not hardcode customer-only wallet/help/ticket routes'
)
assert.ok(
  myHostsViewSource.includes('class="grid gap-3 lg:hidden"') &&
    myHostsViewSource.includes('role="button"') &&
    myHostsViewSource.includes('@keydown.enter.prevent="goToDetail(host)"') &&
    myHostsViewSource.includes('class="card hidden overflow-hidden lg:block"') &&
    myHostsViewSource.includes('class="w-full table-fixed"') &&
    !myHostsViewSource.includes('<div class="overflow-x-auto">') &&
    !myHostsViewSource.includes('class="w-full min-w-[800px]"'),
  'MyHostsView must use mobile host cards and a fixed desktop table without PC horizontal overflow'
)
assert.ok(
  hostPublicIpv4TabSource.includes('class="w-full table-fixed text-sm"') &&
    hostPublicIpv4TabSource.includes('@click="addAddresses(pool.id)"') &&
    hostPublicIpv4TabSource.includes('@click="toggleAddress(address)"') &&
    hostPublicIpv4TabSource.includes('@click="deleteAddress(address)"') &&
    !hostPublicIpv4TabSource.includes('<div class="overflow-x-auto">'),
  'HostPublicIpv4Tab must render IPv4 pools without table horizontal overflow while preserving add, toggle, and delete actions'
)
assert.ok(
  instanceLogsTabSource.includes('class="card overflow-hidden hidden sm:block"') &&
    instanceLogsTabSource.includes('class="w-full table-fixed"') &&
    instanceLogsTabSource.includes('@click="toggleContent(log.id)"') &&
    instanceLogsTabSource.includes('@click="handleSearch"') &&
    instanceLogsTabSource.includes('@click="resetFilters"') &&
    !instanceLogsTabSource.includes('<div class="overflow-x-auto">') &&
    !instanceLogsTabSource.includes('class="w-full min-w-[600px]"'),
  'InstanceLogsTab must keep desktop logs in a fixed table without horizontal overflow while preserving search, reset, and expand actions'
)
assert.ok(instanceLogsTabSource.includes('sequence === requestSequence && session === sessionKey.value') &&
  instanceLogsTabSource.includes('instanceId === props.instanceId && instanceName === props.instanceName') &&
  instanceLogsTabSource.includes('if (!current()) return') && instanceLogsTabSource.includes('pageActive.value = false; resetLogContext()') &&
  instanceLogsTabSource.includes('log.instance_id !== instanceId') && instanceLogsTabSource.includes('v-else-if="loadError" role="alert"'),
  'instance logs must discard stale query/session/instance results and distinguish failed reads from empty results')
assert.ok(
  configEditModalSource.includes('class="overflow-hidden"') &&
    configEditModalSource.includes('class="w-full table-fixed"') &&
    configEditModalSource.includes('@click="handleClose"') &&
    configEditModalSource.includes('@input="handleCpuInput(($event.target as HTMLInputElement).value)"') &&
    configEditModalSource.includes('@input="handleMemoryInput(($event.target as HTMLInputElement).value)"') &&
    configEditModalSource.includes('@input="handleDiskInput(($event.target as HTMLInputElement).value)"') &&
    configEditModalSource.includes('@input="handleTrafficInput(($event.target as HTMLInputElement).value)"') &&
    !configEditModalSource.includes('<div class="overflow-x-auto">'),
  'ConfigEditModal must use fixed resource rows without horizontal overflow while preserving close and resource input handlers'
)
assert.ok(
  transfersViewSource.includes('class="space-y-3 lg:hidden"') &&
    transfersViewSource.includes('class="card hidden overflow-hidden lg:block"') &&
    transfersViewSource.includes('class="w-full table-fixed"') &&
    transfersViewSource.includes('class="truncate font-medium"') &&
    transfersViewSource.includes('class="flex flex-wrap items-center justify-end gap-2"') &&
    transfersViewSource.includes('@click="openConfigModal(transfer)"') &&
    transfersViewSource.includes('@click="handleAccept(transfer)"') &&
    transfersViewSource.includes('@click="handleCancel(transfer)"') &&
    transfersViewSource.includes('@click="handlePush(transfer)"') &&
    !transfersViewSource.includes('<div class="overflow-x-auto">') &&
    !transfersViewSource.includes('class="w-full min-w-[960px] table-fixed"'),
  'TransfersView must provide compact mobile cards and a fixed-layout desktop table without PC horizontal overflow while preserving all transfer actions'
)
assert.ok(
  logsViewSource.includes('class="space-y-3 lg:hidden"') &&
    logsViewSource.includes('class="card hidden overflow-hidden lg:block"') &&
    logsViewSource.includes('class="w-full table-fixed"') &&
    logsViewSource.includes('class="rounded-lg border border-themed bg-themed-surface p-4 shadow-sm"') &&
    logsViewSource.includes('class="max-w-full"') &&
    logsViewSource.includes('@click="toggleContent(log.id)"') &&
    !logsViewSource.includes('<div class="overflow-x-auto">') &&
    !logsViewSource.includes('class="card overflow-x-auto"') &&
    !logsViewSource.includes('class="w-full min-w-[980px] table-fixed"') &&
    !logsViewSource.includes('class="w-full min-w-[920px]"'),
  'LogsView must use mobile log cards and a fixed-layout audit table without PC horizontal overflow'
)
assert.ok(
  ordersViewSource.includes('class="space-y-3 p-4 lg:hidden"') &&
    ordersViewSource.includes('class="hidden overflow-hidden lg:block"') &&
    ordersViewSource.includes('class="w-full table-fixed divide-y divide-themed"') &&
    ordersViewSource.includes('class="rounded-lg border border-themed bg-themed-surface p-4 shadow-sm"') &&
    ordersViewSource.includes('@click="openDetail(order)"') &&
    ordersViewSource.includes('class="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:flex"') &&
    !ordersViewSource.includes('<div class="overflow-x-auto">') &&
    !ordersViewSource.includes('class="w-full min-w-[960px] table-fixed divide-y divide-themed"') &&
    !ordersViewSource.includes('<table class="min-w-full divide-y divide-themed"'),
  'OrdersView must render mobile order cards and a fixed-layout desktop table without PC horizontal overflow while preserving detail access'
)
assert.ok(
  ordersViewSource.includes('<Teleport to="body">') &&
    ordersViewSource.includes('class="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm"'),
  'the orders detail drawer must teleport to body so the console header cannot cover its header'
)
assert.ok(
  ordersViewSource.includes("$t('orders.title')") &&
    ordersViewSource.includes("t('orders.loadFailed')") &&
    !ordersViewSource.includes('订单中心') &&
    !ordersViewSource.includes('暂无订单记录') &&
    !ordersViewSource.includes('全部类型'),
  'the customer order center must render every label through the orders i18n namespace instead of hardcoded Chinese'
)
assert.ok(
  walletViewSource.includes('const affTabVisible: boolean = false') &&
    walletViewSource.includes("...(affTabVisible ? [{ key: 'aff' as WalletTab, label: t('aff.title') }] : [])") &&
    walletViewSource.includes("if (!affTabVisible && tab === 'aff')") &&
    walletViewSource.includes('v-if="affTabVisible && !configStore.freeSiteMode"'),
  'wallet referral tab must stay hidden: no tab entry, switchTab fallback and gated render'
)
assert.ok(
  invitesViewSource.includes("import { dashboardPath } from '@/utils/app-paths'") &&
    invitesViewSource.includes(':to="dashboardPath()"') &&
    !invitesViewSource.includes('to="/dashboard"') &&
    invitesViewSource.includes('class="space-y-3 p-4 lg:hidden"') &&
    invitesViewSource.includes('class="hidden overflow-hidden lg:block"') &&
    invitesViewSource.includes('class="w-full table-fixed divide-y divide-themed"') &&
    invitesViewSource.includes('class="rounded-lg border border-themed bg-themed-surface p-4 shadow-sm"') &&
    invitesViewSource.includes("@click=\"copyText(invite.code, t('invites.codeCopied'))\"") &&
    invitesViewSource.includes("@click=\"copyText(getInviteLink(invite), t('invites.linkCopied'))\"") &&
    invitesViewSource.includes('class="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:flex"') &&
    !invitesViewSource.includes('<div class="overflow-x-auto">') &&
    !invitesViewSource.includes('class="w-full min-w-[960px] table-fixed divide-y divide-themed"') &&
    !invitesViewSource.includes('<table class="min-w-full divide-y divide-themed"') &&
    !invitesViewSource.includes('min-w-[220px]'),
  'InvitesView must use path helpers, mobile invite cards, and a fixed-layout desktop table without PC horizontal overflow while preserving copy actions'
)
const entertainmentRecordsSection = sectionBetween(
  entertainmentViewSource,
  '<!-- 抽奖记录 TAB -->',
  '<!-- 积分明细 TAB -->'
)
const entertainmentPointsSection = sectionBetween(
  entertainmentViewSource,
  '<!-- 积分明细 TAB -->',
  '<!-- 抽奖功能区域结束 -->'
)
const entertainmentPoolLogsSection = sectionBetween(
  entertainmentViewSource,
  '<!-- 签到子TAB: 记录 -->',
  '<BadgeRewardModal'
)
assert.ok(
  entertainmentRecordsSection.includes('class="space-y-3 p-4 lg:hidden"') &&
    entertainmentRecordsSection.includes('class="hidden overflow-hidden lg:block"') &&
    entertainmentRecordsSection.includes('class="w-full table-fixed"') &&
    entertainmentRecordsSection.includes('class="rounded-lg border border-themed bg-themed-surface p-4 shadow-sm"') &&
    entertainmentRecordsSection.includes('recordsPage--; loadRecords()') &&
    entertainmentRecordsSection.includes('recordsPage++; loadRecords()') &&
    !entertainmentRecordsSection.includes('class="w-full min-w-[900px] table-fixed"') &&
    !entertainmentRecordsSection.includes('v-else class="overflow-x-auto"'),
  'Entertainment lottery records must render mobile cards and a fixed-layout desktop table without PC horizontal overflow while preserving pagination'
)
assert.ok(
  entertainmentPointsSection.includes('class="space-y-3 p-4 lg:hidden"') &&
    entertainmentPointsSection.includes('class="hidden overflow-hidden lg:block"') &&
    entertainmentPointsSection.includes('class="w-full table-fixed"') &&
    entertainmentPointsSection.includes('class="rounded-lg border border-themed bg-themed-surface p-4 shadow-sm"') &&
    entertainmentPointsSection.includes('pointsLogsPage--; loadPointsLogs()') &&
    entertainmentPointsSection.includes('pointsLogsPage++; loadPointsLogs()') &&
    entertainmentPointsSection.includes('class="grid grid-cols-[1fr_auto_1fr] items-center gap-2 p-4 border-t border-themed sm:flex sm:justify-center"') &&
    !entertainmentPointsSection.includes('class="w-full min-w-[900px] table-fixed"') &&
    !entertainmentPointsSection.includes('v-else class="overflow-x-auto"'),
  'Entertainment points logs must render mobile cards and a fixed-layout desktop table without PC horizontal overflow while preserving pagination'
)
assert.ok(
  entertainmentPoolLogsSection.includes('class="space-y-3 p-4 lg:hidden"') &&
    entertainmentPoolLogsSection.includes('class="hidden overflow-hidden lg:block"') &&
    entertainmentPoolLogsSection.includes('class="w-full table-fixed"') &&
    entertainmentPoolLogsSection.includes('class="rounded-lg border border-themed bg-themed-surface p-4 shadow-sm"') &&
    entertainmentPoolLogsSection.includes('poolLogsPage--; loadPoolLogs()') &&
    entertainmentPoolLogsSection.includes('poolLogsPage++; loadPoolLogs()') &&
    entertainmentPoolLogsSection.includes('class="grid grid-cols-[1fr_auto_1fr] items-center gap-2 p-4 border-t border-themed sm:flex sm:justify-center"') &&
    !entertainmentPoolLogsSection.includes('class="w-full min-w-[900px] table-fixed"') &&
    !entertainmentPoolLogsSection.includes('v-else class="overflow-x-auto"'),
  'Entertainment resource pool logs must render mobile cards and a fixed-layout desktop table without PC horizontal overflow while preserving pagination'
)
assert.ok(
  countOccurrences(hostingWalletViewSource, 'class="w-full table-fixed"') >= 2 &&
    hostingWalletViewSource.includes('class="p-4 space-y-2 lg:hidden"') &&
    hostingWalletViewSource.includes('class="p-4 space-y-3 lg:hidden"') &&
    hostingWalletViewSource.includes('class="grid grid-cols-1 gap-3 p-4 border-t border-themed sm:grid-cols-[auto_1fr] sm:items-center"') &&
    hostingWalletViewSource.includes('class="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:flex sm:justify-center"') &&
    hostingWalletViewSource.includes('@click="loadLogs(logsPage - 1)"') &&
    hostingWalletViewSource.includes('@click="loadLogs(logsPage + 1)"') &&
    hostingWalletViewSource.includes('@click="loadWithdrawals(withdrawalsPage - 1)"') &&
    hostingWalletViewSource.includes('@click="loadWithdrawals(withdrawalsPage + 1)"') &&
    !hostingWalletViewSource.includes('class="w-full min-w-[1040px] table-fixed"') &&
    !hostingWalletViewSource.includes('class="w-full min-w-[860px] table-fixed"') &&
    !hostingWalletViewSource.includes('class="hidden md:block overflow-x-auto"') &&
    !hostingWalletViewSource.includes('class="md:hidden p-4'),
  'HostingWalletView must keep mobile wallet cards until lg and render fixed-layout desktop log/withdrawal tables without PC horizontal overflow'
)
assert.ok(
  instanceDetailViewSource.includes("import { helpPath, hostDetailPath, instancesPath, isAdminEntry } from '@/utils/app-paths'") &&
    instanceDetailViewSource.includes('interface CustomerSelfServiceApi') &&
    instanceDetailViewSource.includes('const customerSelfServiceApi = api as typeof api & CustomerSelfServiceApi') &&
    instanceDetailViewSource.includes('isAdminEntry ? Promise.resolve() : checkPendingTransfer()') &&
    instanceDetailViewSource.includes('if (isAdminEntry) return') &&
    instanceDetailViewSource.includes('!isAdminEntry && Boolean') &&
    instanceDetailViewSource.includes('customerSelfServiceApi.billing.setAutoRenew') &&
    instanceDetailViewSource.includes('customerSelfServiceApi.billing.getDestroyInfo') &&
    instanceDetailViewSource.includes('customerSelfServiceApi.billing.destroyInstance') &&
    instanceDetailViewSource.includes('v-if="!isAdminEntry && canTransfer') &&
    instanceDetailViewSource.includes(':enable-resource-pool="!isAdminEntry') &&
    instanceDetailViewSource.includes('v-if="!isAdminEntry && showRedeemModal"') &&
    instanceDetailViewSource.includes('v-if="!isAdminEntry && showAutoRenewModal && instance"') &&
    instanceDetailViewSource.includes('v-if="!isAdminEntry && instance"') &&
    !instanceDetailViewSource.includes('api.checkin.redeem') &&
    !instanceDetailViewSource.includes('api.transfers.list') &&
    !instanceDetailViewSource.includes('api.billing.'),
  'admin-reachable instance detail must guard customer transfer, redeem, subscription, billing-destroy, and badge self-service features'
)
assert.ok(
  instanceDetailViewSource.includes("if (tab.key === 'config') return isAdminEntry") &&
    instanceDetailViewSource.includes('v-if="isAdminEntry && activeTab === \'config\' && instance"') &&
    instanceDetailViewSource.includes('const InstanceConfigTab = isAdminEntry') &&
    !instanceDetailViewSource.includes("import InstanceConfigTab from"),
  'customer instance details must omit both the advanced config tab and its component, even with a forced active tab'
)
assert.ok(
  !instanceDetailViewSource.includes('failureReason') &&
    !instanceDetailViewSource.includes('instance.errorBanner.reasonLabel'),
  'InstanceDetailView must not render an unavailable instance failure reason'
)
const errorDestroyHandler = instanceDetailViewSource.slice(instanceDetailViewSource.indexOf('async function handleErrorDestroy()'),
  instanceDetailViewSource.indexOf('// 任务状态轮询', instanceDetailViewSource.indexOf('async function handleErrorDestroy()')))
assert.ok(errorDestroyHandler.includes('showDestroyModal.value = true') && !errorDestroyHandler.includes('billing.destroyInstance'),
  'error-state destruction must use the same preview, irreversible confirmation and required email-code dialog')
assert.ok(
  instanceDetailViewSource.includes('localizePoolRegionName') &&
    instanceDetailViewSource.includes('ociMachineShape') &&
    !instanceDetailViewSource.includes('{{ (instance as any).planName }}') &&
    !instanceDetailViewSource.includes('{{ (instance as any).packageName }}') &&
    instancesViewSource.includes('getInstanceMachineLabel(instance)'),
  'instance pages must show the localized region name (without the disk suffix) and the OCI machine shape instead of the raw shadow package strings'
)
assert.ok(
  !destroyInstanceModalSource.includes('destroyInfo.instance.hostName') &&
    !destroyInstanceModalSource.includes('instance.destroy.rulesTitle') &&
    !destroyInstanceModalSource.includes('instance.destroy.refundInfo') &&
    !instanceInfoTabSource.includes("emit('edit-config')") &&
    instanceDetailViewSource.includes('openResetPasswordModal') &&
    instancesViewSource.includes('localizePoolRegionName'),
  'destroy dialog hides node/rules/refund, the info tab drops the config-edit entry, and the customer instance pages expose password reset plus the localized region label'
)
assert.ok(
  !instancesViewSource.includes('instance.card.network') &&
    !instancesViewSource.includes('getInstanceNetworkSummary') &&
    !instancesViewSource.includes('getInstanceBandwidthSummary') &&
    !instancesViewSource.includes('formatNetworkRate') &&
    instancesViewSource.includes('getInstanceTrafficUsage(resetTrafficTarget)'),
  'customer instance cards must drop the network and traffic rows (the traffic usage helper survives only for the admin reset-traffic dialog)'
)
assert.ok(
  publicIpv6AddressesSource.includes('<div class="min-w-0 py-1">') &&
    !publicIpv6AddressesSource.includes('min-w-0 flex-1'),
  'IPv6 rows must keep the copy button hugging the address (no flex-1 spacer pushing it to the row edge)'
)
assert.ok(
  instancesViewSource.includes("import { instanceCreatePath, instanceDetailPath, isAdminEntry, walletPath } from '@/utils/app-paths'") &&
    instancesViewSource.includes('interface CustomerBillingApi') &&
    instancesViewSource.includes('const customerBillingApi = api as typeof api & CustomerBillingApi') &&
    instancesViewSource.includes('const canUseCustomerBillingActions = computed<boolean>(() => !isAdminEntry && !isViewingAnotherUsersInstances.value)') &&
    instancesViewSource.includes('v-if="!isAdminEntry && showBatchRenewModal"') &&
    instancesViewSource.includes('v-if="!isAdminEntry && showBatchDestroyModal"') &&
    instancesViewSource.includes('customerBillingApi.billing.setAutoRenewBatch') &&
    instancesViewSource.includes('customerBillingApi.billing.previewBatchRenew') &&
    instancesViewSource.includes('customerBillingApi.billing.destroyInstancesBatch') &&
    instancesViewSource.includes('class="hidden overflow-hidden sm:block card"') &&
    instancesViewSource.includes('class="w-full table-fixed"') &&
    instancesViewSource.includes('@click="toggleSelectAll"') &&
    instancesViewSource.includes('@change="toggleSelect(instance.id)"') &&
    instancesViewSource.includes('@click="openInstanceDetail(instance.id)"') &&
    instancesViewSource.includes('@reorder="reorderInstance(instance, $event)"') &&
    instancesViewSource.includes("@click.stop=\"handleAction(instance, 'start')\"") &&
    instancesViewSource.includes("@click.stop=\"handleAction(instance, 'stop')\"") &&
    instancesViewSource.includes("@click.stop=\"handleAction(instance, 'restart')\"") &&
    !instancesViewSource.includes('class="hidden sm:block card overflow-x-auto"') &&
    !instancesViewSource.includes('class="w-full min-w-[1180px]"') &&
    !instancesViewSource.includes('api.billing.'),
  'admin-reachable instance list must guard customer batch renewal, auto-renew, billing destroy self-service features, and keep the desktop list free of PC horizontal overflow'
)
assert.ok(
  instancesViewSource.includes("import TransferModal from '@/components/instance/modals/TransferModal.vue'") &&
    instancesViewSource.includes('transferTarget.value = instance') &&
    instancesViewSource.includes('v-if="transferTarget"') &&
    instancesViewSource.includes(':instance="transferTarget"') &&
    !instancesViewSource.includes('transfersPath('),
  'instance-list PUSH must open the selected instance transfer form directly, rather than navigating to a transfer list or admin inbox'
)
const adminTransferModalSource = readRepoFile('client/src/components/instance/modals/AdminTransferModal.vue')
assert.ok(instancesViewSource.includes('const instanceIds = batchRenewEligibleItems.value.map(item => item.id)') &&
  instancesViewSource.includes('const instanceIds = batchDestroyEligibleItems.value.map(item => item.id)') &&
  instancesViewSource.includes('previewMatchesTargets(batchRenewPreview.value, renewTargetIds.value)') &&
  instancesViewSource.includes('previewMatchesTargets(batchDestroyPreview.value, destroyTargetIds.value)') &&
  instancesViewSource.includes('session === billingSessionKey.value') && instancesViewSource.includes('path === route.fullPath') &&
  instancesViewSource.includes('revision === selectionRevision') && instancesViewSource.includes('renewPreviewReady.value && !batchRenewLoading.value') &&
  instancesViewSource.includes('destroyPreviewReady.value && !batchDestroyLoading.value'),
  'batch billing must bind confirmation to the ready preview target and isolate stale session/modal results and later selections')
const transferModalSource = readRepoFile('client/src/components/instance/modals/TransferModal.vue')
const sensitiveVerificationSource = readRepoFile('client/src/components/SensitiveVerificationModal.vue')
assert.ok(transferModalSource.includes('session === sessionKey.value') &&
  transferModalSource.includes('currentGeneration === generation') && transferModalSource.includes('sequence === searchSequence') &&
  transferModalSource.includes('await api.transfers.create(draft.instanceId, draft.username, draft.remark)') &&
  transferModalSource.includes('pendingTransfers.value--') && transferModalSource.includes('verificationAttempt.value !== attempt') &&
  transferModalSource.includes(':key="verificationAttempt.key"'),
  'transfer responses and verification retry must stay on the submitted instance, session and draft')
assert.ok(sensitiveVerificationSource.includes('currentGeneration === generation') &&
  sensitiveVerificationSource.includes('session === sessionKey.value') && sensitiveVerificationSource.includes('onBeforeUnmount') &&
  sensitiveVerificationSource.includes('if (!context.current()) return') &&
  sensitiveVerificationSource.includes('response.verified !== true'),
  'sensitive verification must reject stale modal/session responses and require confirmed verification')
assert.ok(
  adminTransferModalSource.includes("from '@/api/admin'") &&
    adminTransferModalSource.includes('api.adminInstancePush.create') &&
    adminTransferModalSource.includes('expectedOwnerId: report.value.owner.id') &&
    adminTransferModalSource.includes('expectedFee: report.value.fee') &&
    adminTransferModalSource.includes('SensitiveVerificationModal') &&
    !adminTransferModalSource.includes('api.transfers.'),
  'admin PUSH must use its dedicated admin API and confirm the source owner, fee and administrator verification'
)
assert.ok(
  initCommandDetailSource.includes('sequence === requestSequence') &&
    initCommandDetailSource.includes('id === props.command.id && session === sessionKey.value') &&
    initCommandDetailSource.includes('if (!current()) return') &&
    initCommandDetailSource.includes('clearTimeout(copyTimer)') &&
    initCommandDetailSource.includes('clearTimeout(closeTimer)') &&
    initCommandDetailSource.includes('requestController?.abort()') &&
    initCommandDetailSource.includes("flush: 'sync'") &&
    initCommandDetailSource.includes('onBeforeUnmount') &&
    initCommandDetailSource.includes('detail?.name ?? command.name'),
  'init command details, clipboard feedback and close callbacks must stay bound to their target/session lifetime'
)
assert.ok(
  initCommandEditorSource.includes('sequence === requestSequence') &&
    initCommandEditorSource.includes('session === sessionKey.value') &&
    initCommandEditorSource.includes('if (!isValid.value || saving.value || saved.value || loadingDetail.value || loadingDistros.value') &&
    initCommandEditorSource.includes('if (saving.value || !visible.value || disposed) return') &&
    initCommandEditorSource.includes('distros: [...form.value.distros]') &&
    initCommandEditorSource.includes('saved.value = true') &&
    initCommandEditorSource.includes('clearTimeout(closeTimer)') &&
    initCommandEditorSource.includes('onBeforeUnmount') &&
    extensionsViewSource.includes('async function onModalSave(): Promise<void> {\n  onModalClose()\n  await loadCommands()'),
  'init command saves must reject duplicate/closing/loading submissions, snapshot the target/data and close before list refresh'
)
assert.ok(
  extensionsViewSource.includes('api.initCommands.update(id, { enabled })') &&
    extensionsViewSource.includes('currentCommand.enabled = enabled') &&
    !extensionsViewSource.includes('cmd.enabled = !cmd.enabled') &&
    extensionsViewSource.includes('pendingCommands.value.get(id) === operation') &&
    extensionsViewSource.includes('sequence === listSequence') &&
    extensionsViewSource.includes('session === sessionKey.value') &&
    extensionsViewSource.includes('v-else-if="!loadFailed"') &&
    extensionsViewSource.includes('onBeforeUnmount'),
  'init command state changes must serialize per row, apply the captured state and discard obsolete list/session replies'
)
assert.ok(
  initCommandSelectorSource.includes("import { extensionsPath } from '@/utils/app-paths'") &&
    initCommandSelectorSource.includes('const manageExtensionsPath = extensionsPath()') &&
    initCommandSelectorSource.includes('v-if="manageExtensionsPath"') &&
    initCommandSelectorSource.includes(':to="manageExtensionsPath"') &&
    !initCommandSelectorSource.includes('to="/extensions"') &&
    initCommandSelectorSource.includes('sequence === requestSequence') &&
    initCommandSelectorSource.includes('session === sessionKey.value') &&
    initCommandSelectorSource.includes('if (!current()) return') &&
    initCommandSelectorSource.includes('requestController?.abort()') &&
    initCommandSelectorSource.includes('v-else-if="loadFailed"') &&
    viteConfigSource.includes('AdminTransferModal.vue') &&
    viteConfigSource.includes('RenewModalAdminStub.vue') &&
    viteConfigSource.includes('ApplyAffCodeModalAdminStub.vue') &&
    viteConfigSource.includes('ChangePlanModalAdminStub.vue') &&
    viteConfigSource.includes('DestroyInstanceModalAdminStub.vue') &&
    viteConfigSource.includes('InstanceBadgeModalAdminStub.vue') &&
    viteConfigSource.includes("find: /^@\\/components\\/instance\\/modals\\/TransferModal\\.vue$/") &&
    viteConfigSource.includes("find: /^@\\/components\\/instance\\/modals\\/RenewModal\\.vue$/") &&
    viteConfigSource.includes("find: /^@\\/components\\/instance\\/InstanceBadgeModal\\.vue$/"),
  'admin builds must alias user-only transfer, billing, badge, and extension-management links out of admin-reachable shared components'
)
assert.ok(
  inboxHelperSource.includes('instanceDetailPath(String(data.instanceId))') &&
    inboxHelperSource.includes('isAdminEntry ? null : transfersPath()') &&
    inboxHelperSource.includes('isAdminEntry ? null : dashboardPath()') &&
    !inboxHelperSource.includes('return `/instances/${data.instanceId}`') &&
    !inboxHelperSource.includes("return '/transfers'") &&
    !inboxHelperSource.includes("return '/dashboard'") &&
    notificationBellSource.includes("import { inboxPath } from '@/utils/app-paths'") &&
    notificationBellSource.includes('router.push(inboxPath())') &&
    !notificationBellSource.includes("router.push('/inbox')"),
  'shared inbox notification routing must use app path helpers and avoid customer-only paths in the admin entry'
)
assert.ok(
  mailViewSource.includes("import { mailDomainPath } from '@/utils/app-paths'") &&
    mailViewSource.includes('router.push(mailDomainPath(id))') &&
    !mailViewSource.includes('router.push(`/mail/domains/${id}`)') &&
    mailDomainViewSource.includes("import { helpPath, mailPath } from '@/utils/app-paths'") &&
    mailDomainViewSource.includes('router.push(mailPath())') &&
    mailDomainViewSource.includes(':to="`${helpPath()}/mail`"') &&
    !mailDomainViewSource.includes("router.push('/mail')") &&
    !mailDomainViewSource.includes('to="/help/mail"'),
  'mail views must route through app path helpers so customer mail links do not leak into the admin build'
)
assert.ok(
  marketViewSource.includes("import { instanceCreatePath, loginPath } from '@/utils/app-paths'") &&
    marketViewSource.includes('path: instanceCreatePath()') &&
    marketViewSource.includes('const redirect = `${instanceCreatePath()}?${new URLSearchParams(query).toString()}`') &&
    marketViewSource.includes('path: loginPath()') &&
    marketViewSource.includes("query: { redirect }") &&
    !marketViewSource.includes("path: '/instances/create'") &&
    !marketViewSource.includes("path: '/login'") &&
    dashboardViewSource.includes("import { instanceCreatePath, instanceDetailPath, instancesPath, isAdminEntry } from '@/utils/app-paths'") &&
    dashboardViewSource.includes(":to=\"isAdminEntry ? instanceCreatePath() : '/purchase'\"") &&
    dashboardViewSource.includes(':to="instancesPath()"') &&
    dashboardViewSource.includes(':to="instanceDetailPath(instance.id)"') &&
    !dashboardViewSource.includes('to="/instances/create"') &&
    !dashboardViewSource.includes('to="/instances"') &&
    !dashboardViewSource.includes('to="/checkin"') &&
    !dashboardViewSource.includes(':to="`/instances/${instance.id}`"'),
  'MarketView CTA must send authenticated users to instance creation and guests through login with a redirect'
)
assert.ok(
  dashboardViewSource.includes("import { localizePoolRegionName } from '@/utils/poolRegionCatalog'") &&
    dashboardViewSource.includes('getInstanceRegionLabel(instance)') &&
    dashboardViewSource.includes('getInstanceRegionCode(instance)') &&
    dashboardViewSource.includes('<FlagIcon :code="getInstanceRegionCode(instance)" size="xs" />'),
  'dashboard instance rows must show the flag and the localized region name in front of the IP'
)
assert.ok(
  adminHelpManageViewSource.includes('class="card overflow-hidden"') &&
    adminHelpManageViewSource.includes('class="space-y-3 p-4 lg:hidden"') &&
    adminHelpManageViewSource.includes('class="hidden overflow-hidden lg:block"') &&
    adminHelpManageViewSource.includes('table class="w-full table-fixed"') &&
    adminHelpManageViewSource.includes('@click="openEdit(article)"') &&
    adminHelpManageViewSource.includes('@click="togglePublished(article)"') &&
    adminHelpManageViewSource.includes('@click="deleteArticle(article)"') &&
    !adminHelpManageViewSource.includes('class="card overflow-x-auto"') &&
    !adminHelpManageViewSource.includes('table class="w-full min-w-[800px]"'),
  'admin help article list must keep mobile cards, a fixed desktop table, and edit/publish/delete actions'
)
assert.ok(
  countOccurrences(adminMailViewSource, 'class="space-y-3 lg:hidden"') >= 4 &&
    countOccurrences(adminMailViewSource, 'class="card hidden overflow-hidden lg:block"') >= 4 &&
    adminMailViewSource.includes('table class="w-full table-fixed"') &&
    adminMailViewSource.includes('table class="w-full table-fixed"') &&
    adminMailViewSource.includes('table class="w-full table-fixed"') &&
    adminMailViewSource.includes('table class="w-full table-fixed"') &&
    adminMailViewSource.includes('@click="openEditSourceModal(source)"') &&
    adminMailViewSource.includes('@click="deleteSource(source)"') &&
    adminMailViewSource.includes('@click="openEditPlanModal(plan)"') &&
    adminMailViewSource.includes('@click="deletePlan(plan)"') &&
    adminMailViewSource.includes('@click="openUnsubModal(sub)"') &&
    !adminMailViewSource.includes('class="card overflow-x-auto"') &&
    !adminMailViewSource.includes('table-auto w-full min-w-[640px]') &&
    !adminMailViewSource.includes('table-auto w-full min-w-[800px]'),
  'admin mail lists must render mobile cards and fixed desktop tables while preserving edit/delete/unsubscribe actions'
)
assert.ok(
  adminImagesViewSource.includes('class="space-y-3 lg:hidden"') &&
    adminImagesViewSource.includes('class="card hidden overflow-hidden lg:block"') &&
    adminImagesViewSource.includes('table class="w-full table-fixed"') &&
    adminImagesViewSource.includes('@click="toggleHidden(image)"') &&
    adminImagesViewSource.includes('@click="openEditModal(image)"') &&
    adminImagesViewSource.includes('@click="deleteImage(image)"') &&
    adminImagesViewSource.includes('v-if="filteredImages.length === 0"') &&
    !adminImagesViewSource.includes('class="card overflow-x-auto"') &&
    !adminImagesViewSource.includes('table-auto w-full min-w-[640px]'),
  'admin image list must render mobile cards and a fixed desktop table while preserving visibility/edit/delete actions'
)
const gatewayInstallationPanelSource = readRepoFile('client/src/components/host/GatewayInstallationPanel.vue')
const gatewayManagementPanelSource = readRepoFile('client/src/components/host/ManagementGatewayPanel.vue')
const gatewayAdminApiSource = readRepoFile('client/src/api/admin.ts')
const gatewayExtensionSource = readRepoFile('client/src/components/host/GatewayExtensionEntrypoints.vue')
const gatewaysViewSource = readRepoFile('client/src/views/admin/GatewaysView.vue')
assert.match(gatewaysViewSource, /<h1 class="page-title">\{\{ t\('nav\.gateways'\) \}\}<\/h1>/)
assert.match(gatewaysViewSource, /<ManagementGatewayPanel \/>/)
const gatewayRoute = sectionBetween(adminRouterSource, "path: '/admin/gateways'", "path: '/admin/host-onboarding'")
assert.ok(gatewayRoute.includes('requiresAuth: true, requiresAdmin: true') && gatewayRoute.includes("import('@/views/admin/GatewaysView.vue')"))
assert.doesNotMatch(userRouterSource + sideNavUserItemsSource, /\/admin\/gateways|GatewaysView/)
assert.match(sideNavAdminItemsSource, /name: 'admin-gateways'[^\n]+\n\s*\{ name: 'admin-host-onboarding'/, 'gateway navigation must immediately precede the machine pool')
assert.match(gatewayManagementPanelSource, /<GatewayExtensionEntrypoints :purpose=/)
assert.match(gatewayManagementPanelSource, /const selected = ref<'local' \| 'independent' \| 'backup' \| null>\(null\)/)
assert.match(gatewayManagementPanelSource, /gatewayEndpoint\.flow\.current/)
assert.match(gatewayManagementPanelSource, /gatewayEndpoint\.flow\.choose/)
assert.match(gatewayManagementPanelSource, /gateway\.value\?\.local === false/)
assert.match(gatewayExtensionSource, /v-model\.trim="hostname" required/)
assert.match(gatewayExtensionSource, /name: name\.value\.trim\(\) \|\| hostname\.value\.trim\(\)/)
assert.match(gatewayExtensionSource, /api\.hostOnboarding\.restartGatewayCandidate\(gateway\.id\)/)
assert.match(gatewayExtensionSource, /preparations\.value = result\.preparations \|\| \[\]/)
assert.match(gatewayExtensionSource, /\['independent', 'backup'\]/)
assert.match(gatewayExtensionSource, /:aria-expanded="selected === role"/)
assert.doesNotMatch(gatewayExtensionSource, /configureControllerGateway|confirmControllerGateway/)
assert.match(gatewayExtensionSource, /api\.hostOnboarding\.prepareRemoteGateway\(/)
assert.match(gatewayExtensionSource, /password\.value = ''/)
assert.match(gatewayExtensionSource, /<GatewayInstallationPanel :gateway="record\.gateway" managed/)
assert.doesNotMatch(gatewayExtensionSource, /v-model="(?:fingerprint|configuration\.(?:network|address|listenPort|consolePort))"/)
assert.match(gatewayManagementPanelSource, /api\.hostOnboarding\.configureControllerGateway\(/)
assert.match(gatewayManagementPanelSource, /api\.hostOnboarding\.confirmControllerGateway\(/)
assert.doesNotMatch(gatewayManagementPanelSource, /v-model="(?:sshAddress|password|managementAddress|sshPort|listenPort|fingerprint)"|<GatewayInstallationPanel/)
assert.match(gatewayManagementPanelSource, /configureControllerGateway\(\{ requestId: crypto\.randomUUID\(\) \}\)/)
assert.match(gatewayManagementPanelSource, /gatewayEndpoint\.setup\.targetLocal/)
assert.doesNotMatch(gatewayManagementPanelSource, /console\.(?:log|debug)|localStorage|sessionStorage\.setItem\([^\n]*(?:password|secret|credential)/)
for (const action of ['gatewayTask', 'prepareGatewayInstallation', 'confirmGatewayInstallation', 'cancelGatewayInstallation', 'retrieveGatewayBootstrap']) {
  assert.match(gatewayInstallationPanelSource, new RegExp(`api\\.hostOnboarding\\.${action}\\(`), `gateway installation action ${action} must reach the admin API`)
}
for (const endpoint of ['/management-gateways/installations', '/confirm', '/cancel', '/bootstrap']) assert.ok(gatewayAdminApiSource.includes(endpoint))
assert.match(gatewayInstallationPanelSource, /preview\.value\.planHash === task\.value\.planHash/)
assert.match(gatewayInstallationPanelSource, /selected\.planHash !== task\.value\.planHash/)
assert.match(gatewayInstallationPanelSource, /preview\.value\.expiresAt > now\.value/)
assert.match(gatewayInstallationPanelSource, /dialog\.value\?\.showModal\(\)/)
assert.match(gatewayInstallationPanelSource, /returnFocus\?\.focus\(\)/)
assert.match(gatewayInstallationPanelSource, /credential\.value = ''; material\.value = null/)
assert.doesNotMatch(gatewayInstallationPanelSource, /localStorage|sessionStorage|console\.(?:log|debug)|navigator\.clipboard/)
assert.match(gatewayInstallationPanelSource, /bootstrapExpiresAt: null/)
assert.match(gatewayInstallationPanelSource, /const \{ slot, network, address, listenPort, consolePort \} = inspection\.request/)
assert.doesNotMatch(gatewayInstallationPanelSource, /\.\.\.inspection\.request/)
assert.match(gatewayInstallationPanelSource, /if \(dialog\.value\?\.open\) return/)
const expiryPanel = readRepoFile('client/src/components/admin/ExpiryEnforcementPanel.vue')
const endpointPanel = readRepoFile('client/src/components/host/GatewayEndpointPanel.vue')
assert.ok(gatewayManagementPanelSource.includes('<GatewayEndpointPanel :manage-domain="false" />'), 'local setup owns the single domain field; host synchronization remains available')
assert.ok(gatewayManagementPanelSource.includes('v-model.trim="hostname"') && gatewayManagementPanelSource.includes('api.hostOnboarding.saveGatewayEndpoint'))
assert.ok(endpointPanel.includes('v-if="manageDomain"'), 'standalone domain editor must remain available outside local setup')
assert.ok(endpointPanel.includes('@submit.prevent="save"') && endpointPanel.includes('api.hostOnboarding.saveGatewayEndpoint'))
assert.ok(endpointPanel.includes('onUnmounted') && endpointPanel.includes('clearTimeout(timer)'))
assert.ok(endpointPanel.includes('api.hostOnboarding.installGatewayDnsHost') && endpointPanel.includes('@click="synchronize(false, host)"'))
assert.ok(endpointPanel.includes('api.hostOnboarding.synchronizeGatewayDnsHosts') && endpointPanel.includes('host.updatedAt') && endpointPanel.includes('reason(host.error)'))
assert.ok(endpointPanel.includes(' / 20') && endpointPanel.includes('state(host)') && endpointPanel.includes('if (initial) hostname.value'))
assert.doesNotMatch(endpointPanel, /v-model="port"|v-model="managementIp"/)
assert.ok(adminBillingViewSource.includes('<ExpiryEnforcementPanel :active="activeTab === \'overview\'" />'), 'hidden billing tabs must pause the patrol panel')
for (const action of ['expiryEnforcementStatus', 'startExpiryEnforcement', 'runExpiryEnforcement']) assert.ok(expiryPanel.includes(`api.admin.${action}(`))
assert.ok(expiryPanel.includes('status.running || status.recoveryHeld') && expiryPanel.includes('clearTimeout(timer)'))
console.log('frontend route guard tests passed')
assert.ok(readRepoFile('client/src/views/InstancesView.vue').includes('if (option.months === 1) options.add(option.months)'), 'instance list and batch renewal must offer only one month')
