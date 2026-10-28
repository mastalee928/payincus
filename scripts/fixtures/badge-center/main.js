import { createApp, ref, watch } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import i18n, { setLocale } from '@/locales/index'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/stores/toast'
import BadgeCenter from '@/components/entertainment/BadgeCenter.vue'
import InstanceBadgeModal from '@/components/instance/InstanceBadgeModal.vue'
import { pending } from './api.js'
import '@/styles/main.css'
const shown = ref(true), initialTab = ref('draw'), updates = ref(0)
const modalVisible = ref(true), instanceId = ref(1), modalMounted = ref(true), badgeUpdates = ref([])
const parentBadge = ref('ignition')
const ModalShell = { components: { InstanceBadgeModal }, setup: () => ({ modalVisible, instanceId, modalMounted, badgeUpdates, parentBadge }),
  template: '<InstanceBadgeModal v-if="modalMounted" :visible="modalVisible" :instance-id="instanceId" :instance-name="`Instance ${instanceId}`" :badge-id="parentBadge" @close="modalVisible = false" @updated="badgeUpdates.push({ instanceId, badgeId: $event }); parentBadge = $event"/>' }
const Shell = { components: { BadgeCenter }, setup: () => ({ shown, initialTab, updates }),
  template: '<BadgeCenter v-if="shown" :initial-tab="initialTab" @points-updated="updates++"/>' }
const router = createRouter({ history: createMemoryHistory(), routes: [
  { path: '/badges', name: 'badges', component: Shell },
  { path: '/other', name: 'other', component: { template: '<p>Other page</p>' } },
  { path: '/instance', name: 'instance', component: ModalShell },
] })
const jwt = (sid, generation = 1) => `fixture.${btoa(JSON.stringify({ sid, generation }))}.fixture`
const app = createApp({ setup() {
  const auth = useAuthStore(), theme = useThemeStore(), toast = useToast()
  const toastEvents = [], seenToasts = new Set()
  watch(() => toast.toasts.value.map(item => ({ id: item.id, type: item.type, message: item.message })), items => {
    for (const item of items) if (!seenToasts.has(item.id)) { seenToasts.add(item.id); toastEvents.push(item) }
  }, { flush: 'sync' })
  auth.user = { id: 1, username: 'fixture', role: 'user', avatarBadgeId: null }; auth.token = jwt('a')
  setLocale('zh-CN'); theme.setTheme('light')
  window.badgeCenterHarness = { pending, shown, initialTab, updates, router, auth, toast, toastEvents, theme, setLocale, modalVisible, instanceId, modalMounted, badgeUpdates, parentBadge,
    session(sid, generation) { auth.token = jwt(sid, generation) }, t: (...args) => i18n.global.t(...args) }
}, template: '<main class="p-4 sm:p-6"><RouterView v-slot="{ Component, route }"><KeepAlive><component :is="Component" :key="route.name"/></KeepAlive></RouterView></main>' })
app.use(createPinia()); app.use(i18n); app.use(router)
await router.push(new URLSearchParams(location.search).has('instance') ? '/instance' : '/badges'); await router.isReady(); app.mount('#app')
