import { createApp, ref } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import i18n, { setLocale } from '@/locales/index'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import MyHostsView from '@/views/resources/MyHostsView.vue'
import MyHostDetailView from '@/views/resources/MyHostDetailView.vue'
import HostOnboardingView from '@/views/admin/HostOnboardingView.vue'
import HostPublicIpModal from '@/components/host/HostPublicIpModal.vue'
import InstanceNetworkTab from '@/components/instance/InstanceNetworkTab.vue'
import { formatLogContent } from '@/utils/log-format'
import { pending, state } from './api.js'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@/styles/main.css'
const timers = new Map(), originalSet = window.setInterval.bind(window), originalClear = window.clearInterval.bind(window)
window.setInterval = (callback, delay, ...args) => { if (![10000,15000].includes(delay)) return originalSet(callback, delay, ...args); const id = originalSet(() => {}, 3600000); timers.set(id, { delay, callback: () => callback(...args) }); return id }
window.clearInterval = id => { timers.delete(id); originalClear(id) }
const empty = { template: '<div/>' }, router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/hosts/:id', name: 'my-host-detail', component: empty }, { path: '/list', component: empty }] })
await router.push('/hosts/11')
createApp({ components: { MyHostsView, MyHostDetailView, HostOnboardingView, HostPublicIpModal, InstanceNetworkTab }, setup() {
 const component = ref(), screen = ref('list'), modal = ref(false), instance = ref({ id: 1, name: 'OCI test customer', status: 'stopped', dedicatedIpv4: true, publicIpUpdating: true, observedPublicIp: '1.1.1.2', natPublicIp: null, ipv4: null, ipv6: null, network_mode: 'nat', port_mappings: [] }), auth = useAuthStore(), theme = useThemeStore()
 function session(sid = 'ip-test', id = 1, role = 'admin') { auth.user = { id, username: 'isolated-operator', role }; auth.token = 'fixture.' + btoa(JSON.stringify({ id, role, sid })) + '.fixture'; localStorage.setItem('token', auth.token) }
 session();const params = new URLSearchParams(location.search);
 if(params.has('inspect')) { const sync = {hostId:11,supported:true,currentIp:'1.1.1.2',confirmedIp:'8.8.8.1',observedIp:'1.1.1.2',blocked:true,status:'pending',error:'IP_INSTANCE_STOPPED',settings:{mode:'auto',publicIp:null,bindIp:null,sshPort:22},bindAddresses:['10.0.0.13'],nextCheckAt:'2026-11-04T10:01:00Z'};
 state.hosts = [{id:11,name:'OCI us-ashburn',countryCode:'us',status:'online',stock:'assigned',isInstalled:true,url:'https://10.253.240.2:8443',location:'OCI',publicIp:'1.1.1.2',architecture:'x86_64',singleTenant:true,resourcePreset:'E2',cpuAllowanceMax:200,memoryMax:768,customerDiskGiB:30,storageSize:34,resources:{diskTotal:34816},instanceCount:1,agentLastSeenAt:new Date().toISOString(),portProtocol:{status:'applied'},publicIpSync:sync,natConfig:{publicIp:'8.8.8.1',publicIpSync:sync,portRangeStart:1,portRangeEnd:65535}}] }
setLocale(params.get('locale') || 'zh-CN');theme.setTheme(params.has('dark') ? 'dark' : 'light');if(params.has('inspect')) screen.value = params.get('inspect')
 window.ipHarness = { state, pending, timers, screen, modal, instance, session, auth, theme, setLocale, router, formatLogContent, t: (...args) => i18n.global.t(...args), view: () => component.value?.$?.setupState, tick: delay => [...timers.values()].filter(t => t.delay === delay).forEach(t => t.callback()) }
 return { component, screen, modal, instance }
}, template: '<main class="max-w-6xl mx-auto p-4"><MyHostsView v-if="screen === \'list\'" ref="component"/><MyHostDetailView v-else-if="screen === \'detail\'" ref="component"/><HostOnboardingView v-else-if="screen === \'pool\'" ref="component"/><h1 v-if="screen === \'network\'" class="page-title mb-4">{{ instance.name }}</h1><InstanceNetworkTab v-if="screen === \'network\'" :instance="instance" copied="" :is-instance-owner="true"/><HostPublicIpModal v-if="modal" :host-id="11" host-name="OCI us-ashburn" @close="modal=false" /></main>' }).use(createPinia()).use(i18n).use(router).mount('#app')
