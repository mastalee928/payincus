import { createApp, ref } from 'vue'
import { createPinia } from 'pinia'
import { useBadgeStore } from '@/stores/badges'
import { useThemeStore } from '@/stores/theme'
import BadgeImage from '@/components/BadgeImage.vue'
import { pending } from './api.js'
const badgeId = ref('late-catalog')
const app = createApp({ components: { BadgeImage }, setup() {
  const badges = useBadgeStore(), theme = useThemeStore()
  theme.setTheme('light')
  window.badgeHarness = { badges, theme, badgeId, pending }
  return { badgeId }
}, template: '<BadgeImage :badge-id="badgeId" :size="96" alt="Fixture badge" />' })
app.use(createPinia()); app.mount('#app')
