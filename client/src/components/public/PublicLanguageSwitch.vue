<script setup lang="ts">
import { onMounted, onUnmounted, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { supportedLocales, setLocale, type Locale } from '@/locales'

// Shared from PublicSiteHeader: retain the site's existing language menu and behavior.
const { locale, t } = useI18n()
const langMenuOpen = ref(false)
const langMenuRef = ref<HTMLElement | null>(null)
const langMenuButton = ref<HTMLButtonElement | null>(null)
const optionsId = `public-language-options-${useId()}`
function handleClickOutside(event: MouseEvent): void {
  if (langMenuRef.value && !langMenuRef.value.contains(event.target as Node)) langMenuOpen.value = false
}
function toggleLangMenu(): void { langMenuOpen.value = !langMenuOpen.value }
function changeLocale(nextLocale: Locale): void { setLocale(nextLocale); closeLangMenu() }
function closeLangMenu(): void { langMenuOpen.value = false; langMenuButton.value?.focus() }
function currentLocaleShort(): string {
  switch (locale.value) { case 'zh-CN': return '简'; case 'zh-TW': return '繁'; default: return 'EN' }
}
onMounted(() => document.addEventListener('click', handleClickOutside))
onUnmounted(() => document.removeEventListener('click', handleClickOutside))
</script>

<template>
  <div ref="langMenuRef" class="public-language-switch relative" @keydown.esc.prevent.stop="closeLangMenu">
    <button ref="langMenuButton" type="button" class="public-header-icon rounded-lg px-3 py-2 text-xs font-semibold sm:px-3.5" :aria-label="t('nav.toggleLanguage')" :aria-expanded="langMenuOpen" :aria-controls="optionsId" @click.stop="toggleLangMenu">{{ currentLocaleShort() }}</button>
    <Transition enter-active-class="transition ease-out duration-100" enter-from-class="transform opacity-0 scale-95" enter-to-class="transform opacity-100 scale-100" leave-active-class="transition ease-in duration-75" leave-from-class="transform opacity-100 scale-100" leave-to-class="transform opacity-0 scale-95">
      <div v-if="langMenuOpen" :id="optionsId" class="public-language-menu absolute right-0 mt-2 w-36 overflow-hidden rounded-xl border p-1 shadow-lg">
        <button v-for="lang in supportedLocales" :key="lang.code" type="button" class="public-language-option flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm" :class="locale === lang.code ? 'is-active' : ''" :aria-pressed="locale === lang.code" :lang="lang.code" @click="changeLocale(lang.code)">
          <span>{{ lang.name }}</span><svg v-if="locale === lang.code" class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.public-header-icon { color: var(--text-secondary); transition: background 150ms, color 150ms; }
.public-header-icon:hover { color: var(--text-primary); background: var(--bg-secondary); }
.public-language-menu { z-index: 60; color: var(--text-primary); background: var(--bg-elevated); border-color: var(--border-color); }
.public-language-option:hover, .public-language-option.is-active { background: var(--bg-secondary); }
button:focus-visible { outline: 2px solid var(--text-secondary); outline-offset: 3px; }
@media (max-width: 767px) { .public-header-icon { min-width: 44px; min-height: 44px; } .public-language-option { min-height: 44px; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
</style>
