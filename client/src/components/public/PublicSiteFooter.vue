<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { useConfigStore } from '@/stores/config'
import { useBrand } from '@/composables/useBrand'
import { dashboardPath, forgotPasswordPath, helpPath, loginPath, registerPath } from '@/utils/app-paths'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const authStore = useAuthStore()
const configStore = useConfigStore()
const brand = useBrand()

const isLoginRoute = computed(() => route.name === 'login')
const isRegisterRoute = computed(() => route.name === 'register')
const isForgotPasswordRoute = computed(() => route.name === 'forgot-password')
const consoleTarget = computed(() => dashboardPath())

const primaryActionLabel = computed(() => {
  if (authStore.isAuthenticated) {
    return t('publicSite.actions.console')
  }

  if (isLoginRoute.value && configStore.registrationEnabled) {
    return t('auth.register')
  }

  if (isRegisterRoute.value || isForgotPasswordRoute.value) {
    return t('auth.login')
  }

  return t('publicSite.actions.signIn')
})

const secondaryAction = computed(() => (
  route.name === 'pool-purchase'
    ? { to: '/', label: t('publicSite.nav.overview') }
    : { to: '/purchase', label: t('nav.purchase') }
))

const accountLinks = computed(() => {
  if (authStore.isAuthenticated) {
    return [{ label: t('publicSite.actions.consoleCompact'), to: consoleTarget.value }]
  }

  return [
    { label: t('auth.login'), to: loginPath() },
    ...(configStore.registrationEnabled ? [{ label: t('auth.register'), to: registerPath() }] : []),
    { label: t('auth.forgotPasswordLink'), to: forgotPasswordPath() }
  ]
})

function handlePrimaryAction(): void {
  if (authStore.isAuthenticated) {
    void router.push(consoleTarget.value)
    return
  }

  if (isLoginRoute.value && configStore.registrationEnabled) {
    void router.push(registerPath())
    return
  }

  if (isRegisterRoute.value || isForgotPasswordRoute.value) {
    void router.push(loginPath())
    return
  }

  void router.push(loginPath())
}

void configStore.loadPublicConfig()
</script>

<template>
  <footer class="public-footer">
    <div class="public-footer-inner">
      <div class="public-footer-main">
        <div class="public-footer-brand">
          <img :src="brand.brandLogoUrl" :alt="brand.brandName" width="28" height="28" />
          <span>{{ brand.brandName }}</span>
        </div>
        <p>{{ t('publicSite.footer.description') }}</p>
        <div class="public-footer-actions">
          <RouterLink :to="secondaryAction.to">{{ secondaryAction.label }}</RouterLink>
          <button type="button" @click="handlePrimaryAction">{{ primaryActionLabel }}</button>
        </div>
      </div>
      <div class="public-footer-links">
        <h2>{{ t('publicSite.footer.explore') }}</h2>
        <RouterLink to="/">{{ t('publicSite.nav.home') }}</RouterLink>
        <RouterLink to="/purchase">{{ t('nav.purchase') }}</RouterLink>
        <RouterLink :to="helpPath()">{{ t('publicSite.nav.help') }}</RouterLink>
      </div>
      <div class="public-footer-links">
        <h2>{{ t('publicSite.footer.account') }}</h2>
        <RouterLink v-for="link in accountLinks" :key="link.to" :to="link.to">{{ link.label }}</RouterLink>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.public-footer { border-top: 1px solid var(--border-color); color: var(--text-primary); background: var(--bg-elevated); }
.public-footer-inner { display: grid; grid-template-columns: minmax(0, 1fr) 140px 140px; gap: 48px; max-width: 1280px; margin: 0 auto; padding: 36px 32px; }
.public-footer-brand { display: flex; align-items: center; gap: 10px; font-size: 15px; font-weight: 600; }
.public-footer-brand img { object-fit: contain; }
.public-footer-main p { max-width: 50ch; margin-top: 14px; color: var(--text-secondary); font-size: 12px; line-height: 1.8; text-wrap: pretty; }
.public-footer-actions { display: flex; flex-wrap: wrap; gap: 20px; margin-top: 18px; font-size: 12px; font-weight: 550; }
.public-footer-links { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; font-size: 12px; }
.public-footer-links h2 { margin-bottom: 3px; font-weight: 600; }
.public-footer-links a { color: var(--text-secondary); }
.public-footer :is(a, button) { text-underline-offset: 4px; }
.public-footer :is(a, button):hover { color: var(--text-primary); text-decoration: underline; }
.public-footer :is(a, button):focus-visible { outline: 2px solid var(--text-secondary); outline-offset: 4px; border-radius: 3px; }
@media (max-width: 800px) {
  .public-footer-inner { padding: 32px 24px; grid-template-columns: minmax(0, 1fr) 100px 100px; gap: 28px; }
}
@media (max-width: 580px) {
  .public-footer-inner { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 28px; padding: 28px 20px; }
  .public-footer-main { grid-column: 1 / -1; }
}
</style>
