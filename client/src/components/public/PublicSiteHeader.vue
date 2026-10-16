<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { useConfigStore } from '@/stores/config'
import { useThemeStore } from '@/stores/theme'
import { useBrand } from '@/composables/useBrand'
import { supportedLocales, setLocale, type Locale } from '@/locales'
import { dashboardPath, helpPath, loginPath, registerPath } from '@/utils/app-paths'

const route = useRoute()
const router = useRouter()
const { locale, t } = useI18n()
const authStore = useAuthStore()
const configStore = useConfigStore()
const themeStore = useThemeStore()
const brand = useBrand()

const langMenuOpen = ref(false)
const langMenuRef = ref<HTMLElement | null>(null)
const langMenuButton = ref<HTMLButtonElement | null>(null)

const navigation = computed(() => [
  { label: t('publicSite.nav.home'), compactLabel: t('publicSite.nav.overview'), to: '/' },
  { label: t('nav.purchase'), compactLabel: t('nav.purchase'), to: '/purchase' },
  { label: t('publicSite.nav.help'), compactLabel: t('publicSite.nav.help'), to: helpPath() }
])

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

const primaryActionCompactLabel = computed(() => {
  if (authStore.isAuthenticated) {
    return t('publicSite.actions.consoleCompact')
  }

  if (isLoginRoute.value && configStore.registrationEnabled) {
    return t('auth.register')
  }

  if (isRegisterRoute.value || isForgotPasswordRoute.value) {
    return t('auth.login')
  }

  return t('publicSite.actions.signIn')
})

const scrolled = ref(false)

function onScroll(): void {
  scrolled.value = window.scrollY > 4
}

function handleClickOutside(event: MouseEvent): void {
  if (langMenuRef.value && !langMenuRef.value.contains(event.target as Node)) {
    langMenuOpen.value = false
  }
}

function isActive(path: string): boolean {
  if (path === '/') {
    return route.path === '/'
  }

  return route.path.startsWith(path)
}

function toggleLangMenu(): void {
  langMenuOpen.value = !langMenuOpen.value
}

function changeLocale(nextLocale: Locale): void {
  setLocale(nextLocale)
  closeLangMenu()
}

function closeLangMenu(): void {
  langMenuOpen.value = false
  langMenuButton.value?.focus()
}

function getThemeTooltip(): string {
  switch (themeStore.mode) {
    case 'dark':
      return t('theme.dark')
    case 'light':
      return t('theme.light')
    default:
      return t('theme.system')
  }
}

function currentLocaleShort(): string {
  switch (locale.value) {
    case 'zh-CN':
      return '简'
    case 'zh-TW':
      return '繁'
    default:
      return 'EN'
  }
}

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

onMounted(() => {
  void configStore.loadPublicConfig()
  document.addEventListener('click', handleClickOutside)
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
  window.removeEventListener('scroll', onScroll)
})
</script>

<template>
  <header
    class="public-header sticky top-0 z-50 border-b"
    :class="scrolled ? 'is-scrolled' : ''"
  >
    <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <div class="flex h-16 items-center justify-between gap-3 sm:gap-4">
        <div class="flex min-w-0 items-center gap-3 sm:gap-6">
          <RouterLink to="/" class="flex items-center gap-2 sm:gap-3">
            <div
              class="public-brand-mark flex h-10 w-10 items-center justify-center rounded-xl"
            >
              <img :src="brand.brandLogoUrl" :alt="brand.brandName" class="h-6 w-6 rounded-xl object-contain" />
            </div>
            <div class="min-w-0">
              <div class="truncate text-sm font-semibold tracking-normal text-themed">
                {{ brand.brandName }}
              </div>
              <div class="hidden truncate text-xs text-themed-muted sm:block">
                {{ t('publicSite.brandTagline') }}
              </div>
            </div>
          </RouterLink>

          <nav class="hidden items-center gap-1 md:flex">
            <RouterLink
              v-for="item in navigation"
              :key="item.to"
              :to="item.to"
              class="public-header-nav rounded-lg px-4 py-2 text-sm font-medium"
              :class="isActive(item.to) ? 'is-active' : ''"
              :aria-current="isActive(item.to) ? 'page' : undefined"
            >
              {{ item.label }}
            </RouterLink>
          </nav>
        </div>

        <div class="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <button
            class="public-header-icon group relative rounded-lg p-2.5"
            :title="getThemeTooltip()"
            :aria-label="t('nav.toggleTheme')"
            @click="themeStore.toggleTheme"
          >
            <svg v-if="themeStore.mode === 'dark'" class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
            <svg v-else-if="themeStore.mode === 'light'" class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
            <svg v-else class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </button>

          <div ref="langMenuRef" class="relative" @keydown.esc.prevent.stop="closeLangMenu">
            <button
              ref="langMenuButton"
              class="public-header-icon rounded-lg px-3 py-2 text-xs font-semibold sm:px-3.5"
              :aria-label="t('nav.toggleLanguage')"
              :aria-expanded="langMenuOpen"
              aria-controls="public-language-options"
              @click.stop="toggleLangMenu"
            >
              {{ currentLocaleShort() }}
            </button>

            <Transition
              enter-active-class="transition ease-out duration-100"
              enter-from-class="transform opacity-0 scale-95"
              enter-to-class="transform opacity-100 scale-100"
              leave-active-class="transition ease-in duration-75"
              leave-from-class="transform opacity-100 scale-100"
              leave-to-class="transform opacity-0 scale-95"
            >
              <div
                v-if="langMenuOpen"
                id="public-language-options"
                class="public-language-menu absolute right-0 mt-2 w-36 overflow-hidden rounded-xl border p-1 shadow-lg"
              >
                <button
                  v-for="lang in supportedLocales"
                  :key="lang.code"
                  class="public-language-option flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm"
                  :class="locale === lang.code ? 'is-active' : ''"
                  @click="changeLocale(lang.code)"
                >
                  <span>{{ lang.name }}</span>
                  <svg v-if="locale === lang.code" class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                  </svg>
                </button>
              </div>
            </Transition>
          </div>

          <button
            class="public-header-action inline-flex h-10 min-w-0 shrink-0 items-center gap-1.5 rounded-lg px-4 text-sm font-medium sm:gap-2"
            @click="handlePrimaryAction"
          >
            <span class="sm:hidden">{{ primaryActionCompactLabel }}</span>
            <span class="hidden sm:inline">{{ primaryActionLabel }}</span>
            <svg class="hidden h-4 w-4 sm:block" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13.5 4.5l6 6m0 0l-6 6m6-6h-15" />
            </svg>
          </button>
        </div>
      </div>

      <nav class="flex items-center gap-2 overflow-x-auto pb-3 md:hidden">
        <RouterLink
          v-for="item in navigation"
          :key="item.to"
          :to="item.to"
          class="public-header-nav inline-flex min-w-0 items-center rounded-lg px-3.5 py-2 text-xs font-semibold"
          :class="isActive(item.to) ? 'is-active' : ''"
          :aria-current="isActive(item.to) ? 'page' : undefined"
        >
          {{ item.compactLabel }}
        </RouterLink>
      </nav>
    </div>
  </header>
</template>

<style scoped>
.public-header { color: var(--text-primary); background: var(--bg-elevated); border-color: var(--border-color); }
.public-brand-mark { border: 1px solid var(--border-color); }
.public-header-nav, .public-header-icon { color: var(--text-secondary); transition: background 150ms, color 150ms; }
.public-header-nav:hover, .public-header-icon:hover { color: var(--text-primary); background: var(--bg-secondary); }
.public-header-nav.is-active { color: var(--text-primary); background: var(--bg-secondary); }
.public-header-action { color: var(--bg-elevated); background: var(--text-primary); transition: opacity 150ms; }
.public-header-action:hover { opacity: 0.85; }
.public-language-menu { color: var(--text-primary); background: var(--bg-elevated); border-color: var(--border-color); }
.public-language-option:hover, .public-language-option.is-active { background: var(--bg-secondary); }
.public-header :is(a, button):focus-visible { outline: 2px solid var(--text-secondary); outline-offset: 3px; }
@media (prefers-reduced-motion: reduce) {
  .public-header *, .public-header *::before, .public-header *::after { animation: none !important; transition: none !important; }
}
</style>
