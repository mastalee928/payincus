<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowRight, Menu, Moon, Sun, X } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import PublicLanguageSwitch from './PublicLanguageSwitch.vue'
import api from '@/api'
import { useBrand } from '@/composables/useBrand'
import { useConfigStore } from '@/stores/config'
import { useAuthStore } from '@/stores/auth'
import { dashboardPath, helpPath, loginPath } from '@/utils/app-paths'
import type { PoolCatalogRegion } from '@/utils/poolCatalog'
import HomeRegionAtlas from './HomeRegionAtlas.vue'
import '@/styles/home-map-theme.css'

const props = withDefaults(defineProps<{ preview?: boolean }>(), { preview: true })
const brand = useBrand()
const config = useConfigStore()
const authStore = useAuthStore()
const router = useRouter()
const { t, locale } = useI18n()
function savedHomeTheme(): 'light' | 'dark' {
  try { return localStorage.getItem('homepage-theme') === 'light' ? 'light' : 'dark' }
  catch { return 'dark' }
}
const homeTheme = ref(savedHomeTheme())
function toggleHomeTheme() {
  homeTheme.value = homeTheme.value === 'dark' ? 'light' : 'dark'
  try { localStorage.setItem('homepage-theme', homeTheme.value) } catch { /* Still usable without persistence. */ }
}
const accountActionLabel = computed(() => authStore.isAuthenticated ? t('publicSite.actions.consoleCompact') : t('publicSite.actions.signIn'))
function goToConsole() {
  if (authStore.isAuthenticated) { void router.push(dashboardPath()); return }
  void router.push(loginPath())
}
function closeMenu() { menuOpen.value = false }
const catalog = ref<PoolCatalogRegion[]>([])
const loading = ref(true)
const failed = ref(false)
const menuOpen = ref(false)
const updatedAt = ref('')
const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
const motionEnabled = ref(!motionPreference.matches && (!props.preview || new URLSearchParams(window.location.search).get('motion') !== 'off'))
function syncMotionPreference() { motionEnabled.value = !motionPreference.matches && (!props.preview || new URLSearchParams(window.location.search).get('motion') !== 'off') }
watch(motionEnabled, enabled => { document.documentElement.dataset.homeDemoMotion = enabled ? 'full' : 'reduced' }, { immediate: true })
onBeforeUnmount(() => { motionPreference.removeEventListener('change', syncMotionPreference); delete document.documentElement.dataset.homeDemoMotion })
async function loadCatalog() {
  loading.value = true
  failed.value = false
  try { const response = await api.packages.getPublicCatalog(); catalog.value = response.regions; updatedAt.value = new Date().toISOString() }
  catch { failed.value = true }
  finally { loading.value = false }
}
watch([() => brand.brandName, locale], ([name]) => { if (props.preview) document.title = `${name} · ${t('homeMapDemo.pageTitle')}` }, { immediate: true })
watch(locale, value => { document.documentElement.lang = value }, { immediate: true })
onMounted(() => { motionPreference.addEventListener('change', syncMotionPreference); void config.loadPublicConfig(); void loadCatalog() })
</script>

<template>
  <div class="homepage-map-demo" :data-home-theme="homeTheme">
    <header class="home-header">
      <div class="header-inner">
        <button class="mobile-menu" type="button" :aria-expanded="menuOpen" aria-controls="home-mobile-nav" :aria-label="t(menuOpen ? 'homeMapDemo.closeMenu' : 'homeMapDemo.openMenu')" @click="menuOpen = !menuOpen"><X v-if="menuOpen" :size="21" /><Menu v-else :size="21" /></button>
        <RouterLink to="/" class="brand"><img :src="brand.brandLogoUrl" :alt="brand.brandName" /><span><strong>{{ brand.brandName }}</strong><small>{{ brand.brandSubtitle }}</small></span></RouterLink>
        <nav class="desktop-nav" :aria-label="t('homeMapDemo.navigation')"><RouterLink to="/purchase">{{ t('homeMapDemo.products') }}</RouterLink><RouterLink :to="helpPath()">{{ t('homeMapDemo.solutions') }}</RouterLink><RouterLink :to="dashboardPath()">{{ t('homeMapDemo.console') }}</RouterLink></nav>
        <div class="header-actions"><button type="button" class="home-theme-toggle" :aria-label="t(homeTheme === 'dark' ? 'theme.light' : 'theme.dark')" :title="t(homeTheme === 'dark' ? 'theme.light' : 'theme.dark')" @click="toggleHomeTheme"><Sun v-if="homeTheme === 'dark'" :size="18" /><Moon v-else :size="18" /></button><PublicLanguageSwitch /><button type="button" class="header-login" @click="goToConsole">{{ accountActionLabel }} <ArrowRight :size="14" /></button></div>
      </div><nav v-if="menuOpen" id="home-mobile-nav" class="mobile-nav" :aria-label="t('homeMapDemo.navigation')" @keydown.esc="closeMenu"><RouterLink to="/purchase" @click="closeMenu">{{ t('homeMapDemo.products') }}</RouterLink><RouterLink :to="helpPath()" @click="closeMenu">{{ t('homeMapDemo.solutions') }}</RouterLink><RouterLink :to="dashboardPath()" @click="closeMenu">{{ t('homeMapDemo.console') }}</RouterLink></nav>
    </header>

    <main>
      <section class="home-intro content-width" aria-labelledby="home-title"><h1 id="home-title"><span>{{ t('homeMapDemo.titleFirst') }}</span><span>{{ t('homeMapDemo.titleSecond') }}</span></h1></section>
      <HomeRegionAtlas presentation="minimal" :catalog="catalog" :loading="loading" :failed="failed" :light="homeTheme === 'light'" @retry="loadCatalog" />
    </main>
    <footer class="home-footer content-width">
      <div class="footer-main"><div class="footer-brand"><strong>{{ brand.brandName }}</strong><span>{{ brand.brandSubtitle }}</span></div><nav class="footer-links" :aria-label="t('homeMapDemo.helpContact')"><RouterLink :to="helpPath()">{{ t('publicSite.nav.help') }}</RouterLink><a v-if="config.footerContactEmail" :href="`mailto:${config.footerContactEmail}`">{{ t('homeMapDemo.contact') }}</a><a v-if="config.footerTelegramLink" :href="config.footerTelegramLink" target="_blank" rel="noopener noreferrer">Telegram</a></nav></div>
      <details class="mobile-footer-contact"><summary>{{ t('homeMapDemo.helpContact') }}</summary><div><RouterLink :to="helpPath()">{{ t('publicSite.nav.help') }}</RouterLink><a v-if="config.footerContactEmail" :href="`mailto:${config.footerContactEmail}`">{{ t('homeMapDemo.contact') }}</a><a v-if="config.footerTelegramLink" :href="config.footerTelegramLink" target="_blank" rel="noopener noreferrer">Telegram</a></div></details>
      <!-- Map sources retained in code; owner requested hiding the footer credit.
      <span>{{ t('homeMapDemo.mapCredits') }} <a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener noreferrer">Natural Earth</a> · <a href="https://www.geonames.org/" target="_blank" rel="noopener noreferrer">GeoNames</a></span>
      -->
      <div v-if="props.preview" class="footer-bottom"><span class="preview-note"><span :title="updatedAt ? t('homeMapDemo.updatedAt', { time: new Date(updatedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) }) : undefined">{{ t('homeMapDemo.preview') }}</span><button type="button" :disabled="loading" @click="loadCatalog">{{ t('homeMapDemo.refresh') }}</button></span></div>
    </footer>
  </div>
</template>

<style scoped>
.homepage-map-demo {
  min-height: 100vh;
  background: #080b10;
  color: #f5f5f7;
  font-family: 'Inter Variable',Inter,-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;
  --bg-primary: #080b10;
  --bg-elevated: #111111;
  --bg-secondary: #1a1a1a;
  --border-color: #262626;
  --text-primary: #f5f5f7;
  --text-secondary: #a1a7b3;
}
.content-width {
  width: min(1120px,calc(100% - 64px));
  margin-inline: auto;
}
a {
  text-decoration: none;
  color: inherit;
}
button {
  font: inherit;
  cursor: pointer;
}
button:focus-visible,a:focus-visible,select:focus-visible {
  outline: 2px solid #00f2fe;
  outline-offset: 5px;
}
.home-header {
  position: sticky;
  top: 0;
  z-index: 50;
  background: rgba(18,21,28,.95);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid #262b34;
}
.header-inner {
  width: min(1120px,calc(100% - 64px));
  height: 66px;
  margin: auto;
  display: flex;
  align-items: center;
  gap: 34px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 0;
}
.brand img {
  width: 26px;
  height: 26px;
  object-fit: contain;
}
.brand>span {
  display: grid;
  gap: 4px;
}
.brand strong {
  font-size: 14px;
  font-weight: 650;
}
.brand small {
  font-size: 10px;
  color: #a1a7b3;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.desktop-nav {
  display: flex;
  gap: 5px;
  align-items: center;
}
.desktop-nav a {
  font-size: 12px;
  padding: 10px 14px;
  border-radius: 6px;
  color: #b8bec9;
  transition: background .2s,color .2s;
}
.desktop-nav .current {
  color: #f5f5f7;
  background: #20242c;
}
.desktop-nav a:hover {
  color: #f5f5f7;
  background: #282e38;
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 23px;
  margin-left: auto;
}
.dark-mode {
  color: #a1a7b3;
  display: flex;
}
.header-login {
  border: 0;
  display: flex;
  align-items: center;
  gap: 13px;
  font-size: 12px;
  padding: 10px 16px;
  border-radius: 7px;
  background: #f5f5f7;
  color: #14171e;
  min-height: 36px;
}
.header-login:hover {
  background: #e1ffff;
}
.mobile-menu,.mobile-nav {
  display: none;
}
.home-intro {
  display: block;
  align-items: center;
  gap: 70px;
  padding-top: 40px;
  padding-bottom: 20px;
}
.home-intro h1 {
  font-size: 48px;
  font-weight: 650;
  line-height: 1.25;
  letter-spacing: -1.8px;
  margin: 0;
  animation: home-title .7s cubic-bezier(.2,.8,.2,1) both;
}
.home-intro h1 span {
  display: block;
}
.home-guide {
  border-top: 1px solid #2a303b;
  padding-top: 35px;
  padding-bottom: 52px;
  position: relative;
}
.guide-heading {
  display: flex;
  align-items: center;
  gap: 12px;
}
.guide-heading h2 {
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -.3px;
  margin: 0;
}
.home-guide ol {
  display: grid;
  grid-template-columns: repeat(3,1fr);
  gap: 35px;
  list-style: none;
  margin: 30px 0 0;
  padding: 0;
}
.home-guide li {
  min-width: 0;
}
.home-guide h3 {
  font-size: 14px;
  margin: 0 0 9px;
  font-weight: 550;
}
.home-guide p {
  color: #a1a7b3;
  font-size: 12px;
  margin: 0;
  line-height: 1.8;
}
.guide-help {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: #c1c8d4;
  position: absolute;
  right: 0;
  top: 38px;
}
.guide-help:hover {
  color: #00f2fe;
}
.home-footer {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  align-items: center;
  border-top: 1px solid #262c35;
  padding: 24px 0;
  font-size: 11px;
  color: #a1a7b3;
}
.home-footer b {
  font-weight: 400;
  margin: 0 8px;
  color: #687385;
}
.preview-note {
  display: flex;
  align-items: center;
  gap: 12px;
}
.preview-note button {
  background: none;
  border: 0;
  color: #c5d0dd;
  padding: 6px;
  font-size: 11px;
}
.preview-note button:hover {
  color: #00f2fe;
}
@keyframes home-title {
  from {
    opacity: 0;
    transform: translateY(16px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@media(max-width:1050px) {
  .content-width,.header-inner {
    width: calc(100% - 48px);
  }
  .header-inner {
    gap: 20px;
  }
  .home-intro {
    gap: 35px;
    padding-top: 52px;
  }
  .home-intro h1 {
    font-size: 40px;
    letter-spacing: -1.4px;
  }
  .desktop-nav a {
    padding-inline: 10px;
  }
}
@media(max-width:767px) {
  .content-width,.header-inner {
    width: calc(100% - 36px);
  }
  .header-inner {
    height: 60px;
    display: grid;
    grid-template-columns: 44px minmax(0,1fr) auto;
    gap: 10px;
  }
  .mobile-menu {
    display: grid;
    place-items: center;
    min-width: 44px;
    min-height: 44px;
    border: 0;
    background: none;
    color: #e2e6ee;
    margin-left: -9px;
  }
  .brand {
    gap: 8px;
    width: 44px;
    height: 44px;
    justify-content: center;
    justify-self: center;
  }
  .brand img {
    width: 25px;
    height: 25px;
  }
  .brand>span {
    display: none;
  }
  .header-actions {
    margin-left: 0;
    gap: 0;
    justify-self: end;
  }
  .dark-mode,.desktop-nav {
    display: none;
  }
  .header-login {
    background: none;
    color: #e3e8f1;
    padding: 12px 0;
    font-size: 12px;
    min-height: 44px;
    min-width: 44px;
    justify-content: center;
  }
  .header-login svg {
    display: none;
  }
  .mobile-nav {
    display: flex;
    flex-direction: column;
    padding: 12px 18px 18px;
    gap: 5px;
    background: #151b25;
    border-top: 1px solid #303947;
  }
  .mobile-nav a {
    font-size: 14px;
    padding: 12px;
    min-height: 44px;
  }
  .home-intro {
    display: block;
    padding-top: 24px;
    padding-bottom: 16px;
  }
  .home-intro h1 {
    font-size: 32px;
    letter-spacing: -1px;
    line-height: 1.35;
  }
  .home-guide {
    padding-top: 28px;
    padding-bottom: 35px;
  }
  .guide-heading h2 {
    font-size: 16px;
  }
  .home-guide ol {
    grid-template-columns: 1fr;
    gap: 24px;
    margin-top: 28px;
  }
  .home-guide h3 {
    font-size: 13px;
  }
  .home-guide p {
    font-size: 12px;
  }
  .guide-help {
    position: static;
    margin-top: 28px;
    min-height: 44px;
  }
  .home-footer {
    align-items: flex-start;
    flex-direction: column;
    padding: 24px 0;
    gap: 12px;
    font-size: 10px;
  }
  .preview-note {
    font-size: 10px;
  }
}
@media(max-width:370px) {
  .home-intro h1 {
    font-size: 24px;
  }
  .home-footer>span:first-child {
    font-size: 10px;
  }
}
.motion-toggle {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 44px;
  padding: 8px 0;
  border: 0;
  background: none;
  color: #a1a7b3;
  font-size: 11px;
}
.motion-toggle[aria-pressed=true] {
  color: #bce8e9;
}
:global(html[data-home-demo-motion=reduced] *) {
  animation: none!important;
  transition: none!important;
  scroll-behavior: auto!important;
}
@media(max-width:767px) {
  .motion-toggle {
    min-width: 44px;
    justify-content: center;
  }
  .motion-toggle>span {
    display: none;
  }
  .preview-note button {
    min-width: 44px;
    min-height: 44px;
  }
}
@media(prefers-reduced-motion:reduce) {
  :global(html:not([data-home-demo-motion=full]) *),:global(html:not([data-home-demo-motion=full]) *::before),:global(html:not([data-home-demo-motion=full]) *::after) {
    animation: none!important;
    transition: none!important;
    scroll-behavior: auto!important;
  }
}
</style>

<style scoped>
@media (max-width: 370px) {
  .homepage-map-demo .home-intro { padding-top: 10px; padding-bottom: 8px; }
  .homepage-map-demo .home-intro h1 { font-size: 24px; }
}
</style>

<style scoped>
.home-footer { display: block; margin-top: 80px; padding: 28px 0 22px; }
.footer-main { display: flex; align-items: center; justify-content: space-between; gap: 28px; }
.footer-brand { display: grid; gap: 8px; }
.footer-brand strong { color: #edf0f5; font-size: 16px; font-weight: 600; }
.footer-brand > span { color: #a1a7b3; font-size: 12px; }
.footer-links { display: flex; align-items: center; flex-wrap: wrap; gap: 24px; font-size: 12px; color: #ccd2dd; }
.footer-links a { display: inline-flex; align-items: center; min-height: 44px; }
.footer-links a:hover { color: #f5f5f7; }
.footer-bottom { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-top: 24px; font-size: 10px; color: #9ca6b5; }
.mobile-footer-contact { display: none; }
@media (min-width: 768px) {
  .homepage-map-demo {
    --home-map-width: min(100%, 2160px, max(960px, calc((100svh - 360px) * 2.88)));
    --home-content-width: min(1920px, calc(100% - 48px), calc(var(--home-map-width) * .92));
  }
  .content-width, .header-inner { width: var(--home-content-width); }
  .home-intro h1 { font-size: clamp(40px, min(3.4vw, 5svh), 72px); }
  .home-footer { margin-top: 32px; padding: 20px 0 16px; }
  .footer-bottom { margin-top: 12px; }
}
@media (max-width: 767px) {
  .home-intro { padding-top: 12px; padding-bottom: 10px; }
  .home-intro h1 { font-size: 26px; line-height: 1.25; }
  .mobile-menu { width: 44px; justify-self: start; }
  .home-footer { position: relative; margin-top: 28px; padding: 18px 0 12px; }
  .footer-main { display: block; min-height: 44px; padding-right: 120px; }
  .footer-brand { gap: 4px; }
  .footer-brand strong { font-size: 12px; }
  .footer-brand > span { font-size: 10px; line-height: 1.5; }
  .footer-main .footer-links { display: none; }
  .mobile-footer-contact { display: block; font-size: 11px; color: #d0dce7; }
  .mobile-footer-contact > summary { position: absolute; right: 0; top: 18px; display: flex; align-items: center; justify-content: flex-end; min-width: 100px; min-height: 44px; cursor: pointer; list-style: none; }
  .mobile-footer-contact > summary::after { content: '+'; margin-left: 8px; font-size: 16px; }
  .mobile-footer-contact[open] > summary::after { content: '−'; }
  .mobile-footer-contact > div { display: flex; flex-wrap: wrap; gap: 8px 20px; padding-top: 12px; }
  .mobile-footer-contact a { display: flex; align-items: center; min-height: 44px; }
  .footer-bottom { flex-wrap: wrap; gap: 4px 16px; margin-top: 10px; font-size: 9px; }
  .footer-bottom .preview-note { gap: 5px; }
}
.brand small, .desktop-nav a, .header-login, .footer-brand > span, .footer-links,
.footer-bottom, .mobile-footer-contact, .preview-note, .preview-note button { font-size: 13px; }
</style>
