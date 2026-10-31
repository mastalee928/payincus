<script setup lang="ts">
import { computed, defineAsyncComponent, h, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ArrowDown, ArrowUpRight, Check, ChevronDown, Globe2, Minus, Plus, RotateCcw, Search, X } from 'lucide-vue-next'
import FlagIcon from '@/components/FlagIcon.vue'
import HomeMapLabels from './HomeMapLabels.vue'
import type { MapLabelPoint } from '@/utils/homeMapLabels'
import { homeMapCityName } from '@/utils/homeMapCityNames'
import { buildAtlasRegions, atlasPurchaseTarget, atlasRegionPurchaseTarget, atlasRegionFromQuery, type AtlasRegion } from '@/utils/homeRegionAtlas'
import { formatMemoryMiB, formatPublicPrice, presetLabel, type PoolCatalogRegion } from '@/utils/poolCatalog'

const { t, locale } = useI18n()
const props = defineProps<{ catalog: PoolCatalogRegion[]; loading?: boolean; failed?: boolean; light?: boolean; presentation?: 'catalog' | 'minimal' }>()
const emit = defineEmits<{ retry: [] }>()
const minimal = computed(() => props.presentation === 'minimal')
const route = useRoute()
const router = useRouter()
const MobileRegionGlobe = defineAsyncComponent({
  loader: () => import('./MobileRegionGlobe.vue'),
  delay: 150,
  loadingComponent: { setup: () => () => h('div', { class: 'globe-loading', role: 'status' }, t('homeMapDemo.globeLoading')) },
  errorComponent: { setup: () => () => h('div', { class: 'globe-loading', role: 'alert' }, t('homeMapDemo.globeFailed')) }
})
const globeTrial = computed(() => minimal.value && touchMode.value && route.query.mobile !== 'map')
const mobileGlobe = ref<{ focusRegion: (region: AtlasRegion) => void; focusContinent: (value: string) => void; reset: () => void }>()
const regions = computed(() => buildAtlasRegions(props.catalog))
const selectedSlug = ref('')
const activeRegionSlug = ref('')
const continent = ref('all')
const search = ref('')
const onlyAvailable = ref(false)
const visibleCount = ref(10)
const hoverSlug = ref('')
const tooltipPinned = ref(false)
const mapFrame = ref<HTMLElement>()
const svg = ref<SVGSVGElement>()
const mapGroup = ref<SVGGElement>()
const catalogElement = ref<HTMLElement>()
const zoom = ref(1)
const pan = ref({ x: 0, y: 0 })
const mapWidth = ref(1440)
const isGesturing = ref(false)
const touchMode = ref(false)
const expandedSlug = ref('')
const mobileStrip = ref<HTMLElement>()
const mobileCardIndex = ref(0)
const mobileCandidateSlugs = ref<string[]>([])
const mobileBubbleSlug = ref('')
const mobileBubblePoint = ref({ x: 12, y: 12 })
let mobileCandidatePressSlug = ''
let mobileFeedbackTimer: ReturnType<typeof setTimeout> | undefined
const selected = computed(() => regions.value.find(region => region.slug === selectedSlug.value))
const activeRegion = computed(() => regions.value.find(region => region.slug === activeRegionSlug.value))
const hovered = computed(() => regions.value.find(region => region.slug === hoverSlug.value))
const availableCount = computed(() => regions.value.filter(region => region.stock > 0).length)
const filterOptions = computed(() => [
  { value: 'all', label: t('homeMapDemo.all') }, { value: 'north-america', label: t('homeMapDemo.northAmerica') }, { value: 'europe', label: t('homeMapDemo.europe') },
  { value: 'asia-pacific', label: t('homeMapDemo.asiaPacific') }, { value: 'south-america', label: t('homeMapDemo.southAmerica') }, { value: 'middle-east-africa', label: t('homeMapDemo.middleEastAfrica') }
])
const sortedRegions = computed(() => [...regions.value].sort((a, b) => Number(b.stock > 0) - Number(a.stock > 0)
  || Number(b.products.length > 0) - Number(a.products.length > 0)))
const mobileRegionChoices = computed(() => sortedRegions.value.filter(region => continent.value === 'all' || region.continent === continent.value))
const mobileCandidates = computed(() => mobileCandidateSlugs.value.map(slug => regions.value.find(region => region.slug === slug)).filter((region): region is AtlasRegion => !!region))
const mobileBubbleRegion = computed(() => regions.value.find(region => region.slug === mobileBubbleSlug.value))
const mobileFeedbackStyle = computed(() => ({ left: `${mobileBubblePoint.value.x}px`, top: `${mobileBubblePoint.value.y}px` }))
function matchesControls(region: AtlasRegion) {
  return (!activeRegionSlug.value || region.slug === activeRegionSlug.value)
    && (continent.value === 'all' || region.continent === continent.value)
    && (!onlyAvailable.value || region.stock > 0)
    && [region.name, region.nameEn, region.geography?.code].some(value => value?.toLowerCase().includes(search.value.trim().toLowerCase()))
}
const filtered = computed(() => sortedRegions.value.filter(matchesControls))
const visible = computed(() => filtered.value.slice(0, visibleCount.value))
const mapRegions = computed(() => regions.value.filter(region => region.displayX !== null))
const statusText = (region: AtlasRegion) => region.status === 'available' ? t('homeMapDemo.available', { count: region.stock }) : region.status === 'sold-out' ? t('homeMapDemo.soldOut') : t('homeMapDemo.unlisted')
const regionName = (region: AtlasRegion) => region.geography?.code === 'eu-madrid-3' ? t('homeMapDemo.madrid') : region.geography?.code === 'ap-kulai-2' ? t('homeMapDemo.kulai') : locale.value === 'en' ? region.nameEn : locale.value === 'zh-TW' ? region.nameZhTW : region.name
const transform = computed(() => `translate(${pan.value.x} ${pan.value.y}) translate(720 250) scale(${zoom.value}) translate(-720 -250)`)
const hitRadius = computed(() => touchMode.value ? 22 * 1440 / Math.max(1, mapWidth.value) / zoom.value : 14 / zoom.value)
const labelPoints = computed<MapLabelPoint[]>(() => mapRegions.value.map(region => {
  const active = region.slug === selectedSlug.value || region.slug === hoverSlug.value
  const available = region.stock > 0 && !props.loading && !props.failed
  return {
    id: region.slug, x: region.displayX!, y: region.displayY!,
    text: region.geography?.city ? homeMapCityName(region.geography.city, locale.value) : regionName(region) ?? region.name,
    priority: active ? (region.slug === hoverSlug.value ? 3 : 2) : !matchesControls(region) ? -1 : available ? 1 : continent.value !== 'all' || zoom.value >= 1.6 ? 0 : -1,
    selected: region.slug === selectedSlug.value
  }
}))
function selectLabel(slug: string) {
  const region = mapRegions.value.find(item => item.slug === slug)
  if (region) void selectRegion(region, 'map')
}
const nearHovered = computed(() => {
  if (!hovered.value) return []
  const target = hovered.value
  return mapRegions.value.filter(region => region.slug !== target.slug && Math.hypot((region.displayX! - target.displayX!), (region.displayY! - target.displayY!)) * zoom.value * mapWidth.value / 1440 < 20)
})
const tooltipStyle = computed(() => {
  const region = hovered.value
  if (!region || !mapFrame.value) return {}
  const scale = mapWidth.value / 1440
  const x = ((region.displayX! - 720) * zoom.value + 720 + pan.value.x) * scale
  const y = ((region.displayY! - 250) * zoom.value + 250 + pan.value.y) * scale
  // Flip at the right edge so the tooltip does not cover the node being clicked.
  const left = x + 22 + 280 <= mapWidth.value - 12 ? x + 22 : x - 22 - 280
  return { left: `${Math.max(12, Math.min(mapWidth.value - 292, left))}px`, top: `${Math.max(12, Math.min(mapFrame.value.clientHeight - 260, y - 110))}px` }
})
watch([continent, search, onlyAvailable, activeRegionSlug], () => { visibleCount.value = 10 })
watch([search, onlyAvailable, () => props.catalog], () => {
  if (search.value.trim() || onlyAvailable.value) focusMatchingRegions()
  else if (!activeRegionSlug.value && !globeTrial.value && !(minimal.value && touchMode.value && continent.value !== 'all')) resetView()
})
watch(() => route.query.region, query => {
  // Our own URL synchronization must not reopen a card the user just collapsed.
  if (query !== selectedSlug.value) restoreRegion()
})
watch(regions, () => restoreRegion(), { immediate: true })
watch([mobileRegionChoices, selectedSlug, touchMode], async () => {
  if (!minimal.value || !touchMode.value) return
  const index = Math.max(0, mobileRegionChoices.value.findIndex(region => region.slug === selectedSlug.value))
  await nextTick()
  const card = mobileStrip.value?.children[index] as HTMLElement | undefined
  if (card) mobileStrip.value?.scrollTo({ left: card.offsetLeft - (mobileStrip.value?.firstElementChild as HTMLElement).offsetLeft, behavior: reducedMotion() ? 'instant' : 'smooth' })
  mobileCardIndex.value = index
})

function restoreRegion() {
  const query = typeof route.query.region === 'string' ? route.query.region : null
  const found = atlasRegionFromQuery(regions.value, query)
  if (found) {
    selectedSlug.value = found.slug
    activeRegionSlug.value = minimal.value ? '' : found.slug
    expandedSlug.value = found.slug
    if (!(minimal.value && touchMode.value) || (continent.value !== 'all' && continent.value !== found.continent)) continent.value = 'all'
    search.value = ''
    onlyAvailable.value = false
    const index = filtered.value.findIndex(region => region.slug === found.slug)
    visibleCount.value = Math.max(visibleCount.value, index + 1)
  } else if (!query) {
    selectedSlug.value = ''
    activeRegionSlug.value = ''
    expandedSlug.value = ''
  } else { selectedSlug.value = ''; activeRegionSlug.value = ''; expandedSlug.value = '' }
}

async function selectRegion(region: AtlasRegion, source: 'map' | 'list' | 'tooltip' = 'list') {
  const wasExpanded = expandedSlug.value === region.slug
  selectedSlug.value = region.slug
  activeRegionSlug.value = minimal.value ? '' : region.slug
  expandedSlug.value = source === 'list' && wasExpanded ? '' : region.slug
  tooltipPinned.value = false
  hoverSlug.value = ''
  if (!(minimal.value && touchMode.value) || (continent.value !== 'all' && continent.value !== region.continent)) continent.value = 'all'
  search.value = ''
  onlyAvailable.value = false
  const index = filtered.value.findIndex(item => item.slug === region.slug)
  visibleCount.value = Math.max(visibleCount.value, index + 1)
  await router.push({ query: { ...route.query, region: region.slug } })
  if (source === 'list' && region.displayX !== null) focusRegion(region)
  await nextTick()
  if (minimal.value && touchMode.value && !globeTrial.value) {
    clearTimeout(mobileFeedbackTimer)
    mobileCandidateSlugs.value = []
    if (source === 'list') mobileFeedbackTimer = setTimeout(() => showMobileRegion(region), reducedMotion() ? 0 : 720)
    else showMobileRegion(region)
  }
  if (!minimal.value && (source === 'tooltip' || (source === 'map' && touchMode.value))) {
    document.getElementById(`atlas-${region.slug}`)?.scrollIntoView({ behavior: reducedMotion() ? 'instant' : 'smooth', block: 'center' })
  }
}

function reducedMotion() { return document.documentElement.dataset.homeDemoMotion === 'full' ? false : document.documentElement.dataset.homeDemoMotion === 'reduced' || window.matchMedia('(prefers-reduced-motion: reduce)').matches }
function boundedZoom(value: number) { return Math.min(4, Math.max(1, value)) }
function limitPan() {
  const maxX = 720 * (zoom.value - 1)
  const maxY = 250 * (zoom.value - 1)
  pan.value = { x: Math.max(-maxX, Math.min(maxX, pan.value.x)), y: Math.max(-maxY, Math.min(maxY, pan.value.y)) }
}
function focusRegion(region: AtlasRegion) {
  if (globeTrial.value) { mobileGlobe.value?.focusRegion(region); return }
  zoom.value = touchMode.value ? minimal.value ? Math.max(2.8, zoom.value) : 1.7 : 1.25
  pan.value = { x: (720 - region.displayX!) * zoom.value, y: (250 - region.displayY!) * zoom.value }
  limitPan()
}
function focusMatchingRegions() {
  const points = mapRegions.value.filter(matchesControls)
  if (!points.length) { resetView(); return }
  const xs = points.map(region => region.displayX!), ys = points.map(region => region.displayY!)
  if (Math.max(...xs) - Math.min(...xs) > 700 || Math.max(...ys) - Math.min(...ys) > 280) { resetView(); return }
  zoom.value = touchMode.value ? 1.8 : 1.35
  pan.value = { x: (720 - xs.reduce((sum, x) => sum + x, 0) / xs.length) * zoom.value,
    y: (250 - ys.reduce((sum, y) => sum + y, 0) / ys.length) * zoom.value }
  limitPan()
}
function setContinent(value: string) {
  closeMobileFeedback()
  activeRegionSlug.value = ''
  selectedSlug.value = ''
  expandedSlug.value = ''
  removeRegionQuery()
  continent.value = value
  search.value = ''
  hoverSlug.value = ''
  if (globeTrial.value) { void nextTick(() => mobileGlobe.value?.focusContinent(value)); return }
  if (value === 'all') { resetView(); return }
  const points = mapRegions.value.filter(region => region.continent === value)
  if (!points.length) return
  const x = points.reduce((sum, region) => sum + region.displayX!, 0) / points.length
  const y = points.reduce((sum, region) => sum + region.displayY!, 0) / points.length
  const spanX = Math.max(...points.map(region => region.displayX!)) - Math.min(...points.map(region => region.displayX!))
  const spanY = Math.max(...points.map(region => region.displayY!)) - Math.min(...points.map(region => region.displayY!))
  const scale = mapWidth.value / 1440
  zoom.value = touchMode.value && minimal.value
    ? boundedZoom(Math.max(2.4, Math.min((mapWidth.value - 64) / Math.max(1, spanX * scale), 170 / Math.max(1, spanY * scale))))
    : touchMode.value ? 1.8 : 1.35
  pan.value = { x: (720 - x) * zoom.value, y: (250 - y) * zoom.value }
  limitPan()
}
function resetView() { zoom.value = 1; pan.value = { x: 0, y: 0 }; hoverSlug.value = ''; closeMobileFeedback(); if (globeTrial.value) mobileGlobe.value?.reset() }
function changeZoom(delta: number) { zoom.value = boundedZoom(zoom.value + delta); limitPan(); hoverSlug.value = '' }
function handleMapWheel(event: WheelEvent) {
  if (touchMode.value || !svg.value || event.deltaY === 0) return
  event.preventDefault()
  const matrix = svg.value.getScreenCTM()
  if (!matrix) return
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
  const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? svg.value.clientHeight : 1)
  const previous = zoom.value
  const next = boundedZoom(previous * Math.exp(-Math.max(-200, Math.min(200, pixels)) * 0.002))
  pan.value = { x: point.x - 720 - (point.x - 720 - pan.value.x) * next / previous,
    y: point.y - 250 - (point.y - 250 - pan.value.y) * next / previous }
  zoom.value = next
  limitPan()
  hoverSlug.value = ''
}
function browseRegions() {
  activeRegionSlug.value = ''
  selectedSlug.value = ''
  expandedSlug.value = ''
  removeRegionQuery()
  continent.value = 'all'
  search.value = ''
  onlyAvailable.value = false
  visibleCount.value = 10
  resetView()
  catalogElement.value?.scrollIntoView({ behavior: reducedMotion() ? 'instant' : 'smooth', block: 'start' })
}
function removeRegionQuery() {
  if (!route.query.region) return
  const query = { ...route.query }
  delete query.region
  void router.push({ query })
}
function clearRegionFilter() {
  activeRegionSlug.value = ''
  selectedSlug.value = ''
  expandedSlug.value = ''
  continent.value = 'all'
  search.value = ''
  onlyAvailable.value = false
  resetView()
  removeRegionQuery()
}
function handleSearch() {
  activeRegionSlug.value = ''
  selectedSlug.value = ''
  expandedSlug.value = ''
  continent.value = 'all'
  removeRegionQuery()
}
async function showSelectedConfigurations() {
  const region = selected.value
  if (!region || !region.products.length) return
  if (continent.value !== 'all' && continent.value !== region.continent) continent.value = region.continent
  search.value = ''
  onlyAvailable.value = false
  expandedSlug.value = region.slug
  await nextTick()
  const index = filtered.value.findIndex(item => item.slug === region.slug)
  visibleCount.value = Math.max(visibleCount.value, index + 1)
  await nextTick()
  const element = document.getElementById(`atlas-${region.slug}`)
  element?.scrollIntoView({ behavior: reducedMotion() ? 'instant' : 'smooth', block: 'center' })
  element?.querySelector<HTMLButtonElement>('.region-summary')?.focus({ preventScroll: true })
}
let hideTimer: ReturnType<typeof setTimeout> | undefined
function showTooltip(region: AtlasRegion) {
  if (touchMode.value || isGesturing.value) return
  clearTimeout(hideTimer)
  hoverSlug.value = region.slug
}
function hideTooltip() {
  if (tooltipPinned.value) return
  hideTimer = setTimeout(() => { hoverSlug.value = '' }, 180)
}
function keepTooltip() { clearTimeout(hideTimer) }
function closeMobileFeedback() { clearTimeout(mobileFeedbackTimer); mobileCandidateSlugs.value = []; mobileBubbleSlug.value = ''; mobileCandidatePressSlug = '' }
function chooseMobileCandidate(region: AtlasRegion, event: MouseEvent) {
  if (event.detail !== 0 && mobileCandidatePressSlug !== region.slug) return
  mobileCandidatePressSlug = ''
  void selectRegion(region, 'map')
}
function placeMobileFeedback(x: number, y: number, candidates = false) {
  const frame = mapFrame.value
  if (!frame) return
  mobileBubblePoint.value = { x: Math.max(12, Math.min(frame.clientWidth - 252, x - 115)),
    y: Math.max(12, Math.min(frame.clientHeight - (candidates ? 195 : 80), y - 78)) }
}
function showMobileRegion(region: AtlasRegion) {
  if (selectedSlug.value !== region.slug || isGesturing.value || region.displayX === null || region.displayY === null) return
  mobileBubbleSlug.value = region.slug
  const matrix = svg.value?.getScreenCTM(), frame = mapFrame.value?.getBoundingClientRect()
  if (!matrix || !frame || region.displayX === null) return
  const point = new DOMPoint((region.displayX - 720) * zoom.value + 720 + pan.value.x,
    (region.displayY! - 250) * zoom.value + 250 + pan.value.y).matrixTransform(matrix)
  placeMobileFeedback(point.x - frame.x, point.y - frame.y)
}
function onMobileCardScroll() {
  const strip = mobileStrip.value, first = strip?.firstElementChild as HTMLElement | undefined
  if (strip && first) mobileCardIndex.value = Math.min(mobileRegionChoices.value.length - 1, Math.max(0, Math.round(strip.scrollLeft / (first.offsetWidth + 12))))
}
const pointers = new Map<number, { x: number; y: number }>()
let pointerOrigin = { x: 0, y: 0 }
let initialPan = { x: 0, y: 0 }
let initialDistance = 0
let initialZoom = 1
let dragged = false
function pointerDown(event: PointerEvent) {
  if (event.button !== 0) return
  closeMobileFeedback()
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
  svg.value?.setPointerCapture(event.pointerId)
  pointerOrigin = { x: event.clientX, y: event.clientY }
  initialPan = { ...pan.value }
  initialZoom = zoom.value
  dragged = false
  hoverSlug.value = ''
  if (pointers.size === 2) {
    const values = [...pointers.values()]
    initialDistance = Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y)
    isGesturing.value = true
    dragged = true
  }
}
function pointerMove(event: PointerEvent) {
  if (!pointers.has(event.pointerId)) return
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
  if (pointers.size === 2) {
    const values = [...pointers.values()]
    const distance = Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y)
    zoom.value = boundedZoom(initialZoom * distance / Math.max(1, initialDistance))
    limitPan()
  } else {
    const dx = event.clientX - pointerOrigin.x, dy = event.clientY - pointerOrigin.y
    if (Math.hypot(dx, dy) > 5) { dragged = true; isGesturing.value = true }
    if (dragged) {
      pan.value = { x: initialPan.x + dx * 1440 / mapWidth.value, y: initialPan.y + dy * 1440 / mapWidth.value }
      limitPan()
    }
  }
}
function pointerUp(event: PointerEvent) {
  const wasDrag = dragged
  pointers.delete(event.pointerId)
  if (!pointers.size) isGesturing.value = false
  else { pointerOrigin = [...pointers.values()][0]; initialPan = { ...pan.value }; dragged = true }
  if (wasDrag || event.type === 'pointercancel') return
  // Hit testing in CSS pixels keeps the touch radius >=22px regardless of zoom or SVG letterboxing.
  const matrix = mapGroup.value?.getScreenCTM()
  if (!matrix) return
  const ranked = mapRegions.value.filter(region => !(minimal.value && touchMode.value) || continent.value === 'all' || region.continent === continent.value).map(region => {
    const point = new DOMPoint(region.displayX!, region.displayY!).matrixTransform(matrix)
    return { region, distance: Math.hypot(point.x - event.clientX, point.y - event.clientY) }
  })
    .sort((a, b) => a.distance - b.distance)
  const nearest = ranked[0]
  if (minimal.value && touchMode.value) {
    const nearby = ranked.filter(item => item.distance <= 22)
    if (nearby.length > 1) {
      mobileCandidateSlugs.value = nearby.map(item => item.region.slug)
      const frame = mapFrame.value?.getBoundingClientRect()
      if (frame) placeMobileFeedback(event.clientX - frame.x, event.clientY - frame.y, true)
      return
    }
  }
  if (nearest && nearest.distance <= (touchMode.value ? 22 : 14)) void selectRegion(nearest.region, 'map')
}
let resize: ResizeObserver | undefined
let mobileQuery: MediaQueryList | undefined
function updateMobile() { touchMode.value = mobileQuery?.matches ?? false; resetView() }
onMounted(() => {
  mobileQuery = window.matchMedia('(max-width: 767px)')
  touchMode.value = mobileQuery.matches
  mobileQuery.addEventListener('change', updateMobile)
  resize = new ResizeObserver(entries => { mapWidth.value = entries[0]?.contentRect.width ?? 1440 })
  if (mapFrame.value) resize.observe(mapFrame.value)
})
onBeforeUnmount(() => { resize?.disconnect(); mobileQuery?.removeEventListener('change', updateMobile); clearTimeout(hideTimer); clearTimeout(mobileFeedbackTimer) })
</script>

<template>
  <section class="region-atlas" :class="minimal ? 'minimal-atlas' : ''" :aria-label="t('homeMapDemo.regionSelector')">
    <div class="atlas-toolbar content-width">
      <div class="continent-tabs" role="group" :aria-label="t('homeMapDemo.continentFilter')">
        <button v-for="filter in filterOptions" :key="filter.value" type="button" :aria-pressed="continent === filter.value" :class="continent === filter.value ? 'active' : ''" @click="setContinent(filter.value)">{{ filter.label }}</button>
      </div>
      <RouterLink v-if="minimal" to="/purchase" class="all-regions-link">{{ t('homeMapDemo.allConfigurations') }} <ArrowUpRight :size="15" /></RouterLink>
      <button v-else type="button" class="all-regions-link" @click="browseRegions">{{ t('homeMapDemo.allRegions', { count: regions.length }) }} <ArrowUpRight :size="15" /></button>
    </div>
    <div ref="mapFrame" class="atlas-map" :class="[isGesturing ? 'is-gesturing' : '', globeTrial ? 'globe-trial-frame' : '']">
      <MobileRegionGlobe v-if="globeTrial" ref="mobileGlobe" :regions="regions" :selected-slug="selectedSlug" :continent="continent" :loading="loading" :failed="failed" @choose="selectRegion($event, 'map')" />
      <template v-else>
        <div class="globe-atmosphere" aria-hidden="true"></div>
        <svg ref="svg" class="map-svg" viewBox="0 0 1440 500" preserveAspectRatio="xMidYMid meet" role="group" :aria-label="minimal ? t('homeMapDemo.mapLabel') : t('homeMapDemo.catalogMapLabel')" @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="pointerUp" @wheel="handleMapWheel" @dblclick.prevent="changeZoom(0.6)">
          <defs>
            <filter id="atlas-neon" x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur stdDeviation="3.2" /><feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge></filter>
            <radialGradient id="atlas-pool"><stop offset="0" stop-color="#00f2fe" stop-opacity="0.14" /><stop offset="1" stop-color="#00f2fe" stop-opacity="0" /></radialGradient>
          </defs>
          <g ref="mapGroup" class="map-transformation" :transform="transform">
            <image :href="light ? '/maps/home-world-light.svg' : '/maps/home-world.svg'" width="1440" height="500" class="world-outline" />
            <g v-for="(region, index) in mapRegions" :key="region.slug" class="map-marker" :class="[region.stock > 0 && !props.loading && !props.failed ? 'available' : '', selectedSlug === region.slug ? 'selected' : '', !matchesControls(region) ? 'dimmed' : '']" :style="{ '--pulse-delay': `${-(index % 7) * 0.21}s` }" :transform="`translate(${region.displayX} ${region.displayY})`" role="button" tabindex="0" :aria-label="`${regionName(region)}，${props.loading ? t('homeMapDemo.stockLoading') : props.failed ? t('homeMapDemo.stockFailed') : statusText(region)}`" :aria-pressed="selectedSlug === region.slug" @pointerenter="showTooltip(region)" @pointerleave="hideTooltip" @focus="showTooltip(region)" @blur="hideTooltip" @keydown.enter.prevent="selectRegion(region, 'map')" @keydown.space.prevent="selectRegion(region, 'map')" @keydown.esc="hoverSlug = ''">
              <circle class="node-hit" :r="hitRadius" fill="transparent" />
              <circle v-if="region.stock > 0 && !loading && !failed" class="node-pool" r="48" fill="url(#atlas-pool)" pointer-events="none" />
              <circle class="node-ring" r="12" pointer-events="none" />
              <circle class="node-ping" r="9" pointer-events="none" />
              <circle class="node-core" :r="region.stock > 0 ? 4.8 : 3.4" pointer-events="none" />
            </g>
          </g>
        </svg>
        <HomeMapLabels v-if="!touchMode" :frame="mapFrame" :map-group="mapGroup" :points="labelPoints" :view-transform="transform" :hover-slug="hoverSlug" @select="selectLabel" />
        <p v-if="!minimal" class="mobile-map-hint">{{ t('homeMapDemo.mapHint') }}</p>
        <div class="map-controls" role="group" :aria-label="t('homeMapDemo.zoomControls')">
          <button v-if="!(minimal && touchMode)" type="button" :disabled="zoom >= 4" :aria-label="t('homeMapDemo.zoomIn')" @click="changeZoom(0.4)"><Plus :size="16" /></button>
          <button v-if="!(minimal && touchMode)" type="button" :disabled="zoom <= 1" :aria-label="t('homeMapDemo.zoomOut')" @click="changeZoom(-0.4)"><Minus :size="16" /></button>
          <button type="button" :aria-label="t('homeMapDemo.resetMap')" @click="resetView"><RotateCcw :size="14" /></button>
        </div>
        <div v-if="minimal && touchMode && mobileCandidates.length" class="mobile-node-feedback candidate-feedback" :style="mobileFeedbackStyle"><div class="feedback-heading"><strong>{{ t('homeMapDemo.nearby') }}</strong><button type="button" :aria-label="t('homeMapDemo.closeNearby')" @click="closeMobileFeedback"><X :size="14" /></button></div><div class="candidate-list"><button v-for="region in mobileCandidates" :key="region.slug" type="button" @pointerdown="mobileCandidatePressSlug = region.slug" @click="chooseMobileCandidate(region, $event)"><span>{{ regionName(region) }}</span><small>{{ loading ? t('homeMapDemo.loading') : failed ? t('homeMapDemo.stockUnknown') : statusText(region) }}</small></button></div></div>
        <div v-else-if="minimal && touchMode && mobileBubbleRegion" class="mobile-node-feedback" :style="mobileFeedbackStyle" role="status"><div class="feedback-heading"><span><strong>{{ regionName(mobileBubbleRegion) }}</strong><small>{{ loading ? t('homeMapDemo.stockLoading') : failed ? t('homeMapDemo.stockUnknown') : statusText(mobileBubbleRegion) }}</small></span><button type="button" :aria-label="t('homeMapDemo.closeFeedback')" @click="closeMobileFeedback"><X :size="14" /></button></div></div>
        <Transition name="tooltip">
          <div v-if="hovered && !touchMode" class="map-tooltip" :style="tooltipStyle" @pointerenter="keepTooltip" @pointerleave="hideTooltip" @focusin="tooltipPinned = true" @focusout="tooltipPinned = false; hideTooltip()" @keydown.esc="hoverSlug = ''; tooltipPinned = false">
            <div class="tooltip-title"><FlagIcon v-if="hovered.countryCode" :code="hovered.countryCode" class="atlas-flag" aria-hidden="true" /><strong>{{ regionName(hovered) }}</strong><button type="button" :aria-label="t('homeMapDemo.closeDetails')" @click="hoverSlug = ''"><X :size="14" /></button></div>
            <p v-if="!minimal" class="tooltip-code">{{ hovered.geography?.code ?? t('homeMapDemo.missingCode') }}</p>
            <div class="tooltip-availability" :class="hovered.stock > 0 ? 'available' : ''"><span></span>{{ props.loading ? t('homeMapDemo.stockLoading') : props.failed ? t('homeMapDemo.stockFailed') : statusText(hovered) }}</div>
            <div class="tooltip-price">
              <span v-if="hovered.products.length">¥<strong>{{ formatPublicPrice(hovered.products[0].monthlyPrice) }}</strong><small>{{ t('homeMapDemo.perMonthFrom') }}</small></span><span v-else>{{ t('homeMapDemo.comingSoon') }}</span>
              <RouterLink v-if="hovered.stock > 0 && !props.failed && !props.loading" :to="minimal ? atlasRegionPurchaseTarget(hovered) : atlasPurchaseTarget(hovered.products[0])" class="small-action">{{ minimal ? t('homeMapDemo.goBuy') : t('homeMapDemo.buy') }} <ArrowUpRight :size="13" /></RouterLink>
              <button v-else type="button" class="small-action secondary" @click="selectRegion(hovered, 'tooltip')">{{ t('homeMapDemo.details') }} <ArrowUpRight :size="13" /></button>
            </div>
            <div v-if="nearHovered.length" class="nearby-regions"><span>{{ t('homeMapDemo.nearbyRegions') }}</span><button v-for="region in nearHovered.slice(0, 5)" :key="region.slug" type="button" @click="selectRegion(region, 'tooltip')">{{ regionName(region) }} <ArrowUpRight :size="12" /></button></div>
          </div>
        </Transition>
        <div class="map-bottom content-width">
          <div class="atlas-legend"><span><i class="available-dot"></i>{{ t('homeMapDemo.saleLegend') }}</span><span><i></i>{{ t('homeMapDemo.unlistedLegend') }}</span><small>{{ props.loading ? t('homeMapDemo.loadingRegions') : props.failed ? t('homeMapDemo.stockFailed') : t('homeMapDemo.regionCount', { available: availableCount, total: regions.length }) }}</small></div>
          <Transition name="selection" mode="out-in">
            <div v-if="selected && minimal" :key="selected.slug" class="map-selection minimal-selection">
              <FlagIcon v-if="selected.countryCode" :code="selected.countryCode" class="atlas-flag" aria-hidden="true" /><span><strong>{{ regionName(selected) }}</strong><small>{{ loading ? t('homeMapDemo.stockLoading') : failed ? t('homeMapDemo.stockUnknown') : statusText(selected) }}</small></span>
              <RouterLink v-if="selected.stock > 0 && !loading && !failed" :to="atlasRegionPurchaseTarget(selected)" class="selection-action">{{ t('homeMapDemo.goBuy') }} <ArrowUpRight :size="14" /></RouterLink><button v-else type="button" class="selection-action" disabled>{{ loading ? t('homeMapDemo.loading') : failed ? t('homeMapDemo.unconfirmed') : selected.status === 'unlisted' ? t('homeMapDemo.unlisted') : t('homeMapDemo.noStock') }}</button>
            </div>
            <button v-else-if="selected" :key="selected.slug" type="button" class="map-selection" :disabled="!selected.products.length || loading || failed" @click="showSelectedConfigurations">
              <FlagIcon v-if="selected.countryCode" :code="selected.countryCode" class="atlas-flag" aria-hidden="true" /><span><strong>{{ regionName(selected) }}</strong><small>{{ props.loading ? t('homeMapDemo.stockLoading') : props.failed ? t('homeMapDemo.stockUnknown') : selected.products.length ? t('homeMapDemo.selectedConfigurations', { count: selected.products.length }) : t('homeMapDemo.selectedNoConfigurations') }}</small></span><span class="selection-action">{{ selected.products.length ? t('homeMapDemo.viewConfigurations') : t('homeMapDemo.notOpen') }} <ArrowDown v-if="selected.products.length" :size="14" /></span>
            </button>
          </Transition>
        </div>
      </template>
    </div>
    <div v-if="minimal && touchMode" class="mobile-region-preview content-width">
      <div class="mobile-preview-heading"><span>{{ t('homeMapDemo.swipe') }}</span><span>{{ mobileRegionChoices.length ? mobileCardIndex + 1 : 0 }} / {{ mobileRegionChoices.length }}</span></div>
      <div ref="mobileStrip" class="mobile-region-strip" :aria-label="t('homeMapDemo.previewRegions')" @scroll.passive="onMobileCardScroll">
        <article v-for="(region, index) in mobileRegionChoices" :key="region.slug" class="mobile-region-card" :class="selectedSlug === region.slug ? 'is-current' : ''">
          <template v-if="Math.abs(index - mobileCardIndex) <= 2">
            <button type="button" class="mobile-card-location" :aria-label="t('homeMapDemo.locateRegion', { region: regionName(region) })" @click="selectRegion(region, 'list')"><FlagIcon v-if="region.countryCode" :code="region.countryCode" class="atlas-flag" aria-hidden="true" /><span><strong>{{ regionName(region) }}</strong><small>{{ loading ? t('homeMapDemo.stockLoading') : failed ? t('homeMapDemo.stockUnknown') : statusText(region) }}</small></span></button>
            <div class="mobile-card-action"><RouterLink v-if="region.stock > 0 && !loading && !failed" :to="atlasRegionPurchaseTarget(region)" class="small-action">{{ t('homeMapDemo.buy') }} <ArrowUpRight :size="14" /></RouterLink><button v-else type="button" class="small-action" disabled>{{ loading ? t('homeMapDemo.loading') : failed ? t('homeMapDemo.unconfirmed') : region.status === 'unlisted' ? t('homeMapDemo.unlisted') : t('homeMapDemo.noStock') }}</button></div>
          </template>
        </article>
      </div>
    </div>
    <div v-if="minimal && failed" class="minimal-load-error content-width" role="alert"><span>{{ t('homeMapDemo.regionsFailed') }}</span><button type="button" @click="emit('retry')">{{ t('homeMapDemo.retry') }}</button></div>
  </section>

  <section v-if="!minimal" id="atlas-catalog" ref="catalogElement" class="atlas-catalog content-width" aria-labelledby="atlas-catalog-title" :aria-busy="loading">
    <div class="catalog-heading"><div><h2 id="atlas-catalog-title">全域节点与库存分布</h2><p>点击地图节点或下方搜索，快速锁定可用实例。</p></div><div class="catalog-context" :class="activeRegion ? 'has-selection' : ''"><span v-if="activeRegion" class="active-region-filter"><span>已筛选：<strong>{{ regionName(activeRegion) }}</strong></span><button type="button" aria-label="清除地区筛选" @click="clearRegionFilter"><X :size="14" />清除筛选</button></span><span class="catalog-total">{{ filtered.length }} 个地区</span></div></div>
    <div class="catalog-filters"><label class="region-search"><Search :size="17" /><input v-model="search" type="search" placeholder="搜索城市、地区或区域代码" aria-label="搜索城市、地区或区域代码" @input="handleSearch" /></label><label class="availability-toggle"><input v-model="onlyAvailable" type="checkbox" /><span>只看可售</span></label><span class="filter-note">{{ activeRegion ? '已锁定地区' : filterOptions.find(filter => filter.value === continent)?.label + '地区' }}</span></div>
    <div v-if="loading" class="catalog-state" role="status"><Globe2 :size="26" /><p>正在读取地区配置与库存…</p></div>
    <div v-else-if="failed" class="catalog-state" role="alert"><p>地区配置读取失败，请重试。</p><button type="button" class="small-action" @click="emit('retry')">{{ t('homeMapDemo.retry') }}</button></div>
    <template v-else>
      <div class="region-table-heading" aria-hidden="true"><span>地区 / 配置</span><span>计算资源</span><span>存储</span><span>月价</span><span>操作</span></div>
      <div class="region-rows">
        <article v-for="region in visible" :id="`atlas-${region.slug}`" :key="region.slug" class="region-row" :class="[selectedSlug === region.slug ? 'is-selected' : '', expandedSlug === region.slug ? 'is-expanded' : '', region.status === 'unlisted' ? 'is-unlisted' : '']">
          <button type="button" class="region-summary" :aria-expanded="expandedSlug === region.slug" :aria-controls="`configs-${region.slug}`" @click="selectRegion(region, 'list')">
            <span class="region-identity"><FlagIcon v-if="region.countryCode" :code="region.countryCode" class="atlas-flag" aria-hidden="true" /><Globe2 v-else :size="24" /><span><strong>{{ regionName(region) }}</strong><small>{{ region.geography?.code ?? '平台自定义地区' }}</small></span></span>
            <span class="row-compute"><template v-if="region.products.length"><strong>{{ presetLabel(region.products[0].resourcePreset) }}</strong><small>{{ region.products[0].cpu / 100 }} 核 · {{ formatMemoryMiB(region.products[0].memoryMiB) }}</small></template><span v-else>—</span></span>
            <span class="row-storage"><template v-if="region.products.length"><strong>{{ region.products[0].diskGiB }} GiB</strong><small>系统磁盘</small></template><span v-else>—</span></span>
            <span class="row-price"><template v-if="region.products.length"><span>¥<strong>{{ formatPublicPrice(region.products[0].monthlyPrice) }}</strong><small> / 月{{ region.products.length > 1 ? '起' : '' }}</small></span></template><span v-else class="coming-soon">—</span></span>
            <span class="row-state" :class="region.stock > 0 ? 'available' : ''"><i></i>{{ statusText(region) }}<ChevronDown :size="15" class="expand-chevron" /></span>
            <Check v-if="selectedSlug === region.slug" :size="13" class="selection-check" />
          </button>
          <div v-if="expandedSlug === region.slug" :id="`configs-${region.slug}`" class="region-configs">
            <div v-if="region.products.length === 1" class="single-configuration">
              <div class="single-configuration-info"><p class="mobile-resource-summary">{{ presetLabel(region.products[0].resourcePreset) }} · {{ region.products[0].cpu / 100 }} 核 CPU · {{ formatMemoryMiB(region.products[0].memoryMiB) }} 内存 · {{ region.products[0].diskGiB }} GiB 磁盘</p><p class="configuration-next-step">{{ region.products[0].idle > 0 ? '下一步：选择系统，设置实例名称。' : '该配置当前无库存，暂不可部署。' }}</p><small v-if="region.products[0].setupFee">一次性开通费 ¥{{ formatPublicPrice(region.products[0].setupFee) }}</small></div>
              <RouterLink v-if="region.products[0].idle > 0" :to="atlasPurchaseTarget(region.products[0])" class="configuration-action">配置主机 <ArrowUpRight :size="15" /></RouterLink><button v-else type="button" class="configuration-action" disabled>{{ t('homeMapDemo.noStock') }}</button>
            </div>
            <template v-else-if="region.products.length"><div v-for="product in region.products" :key="product.id" class="configuration-row"><div class="configuration-label"><strong>{{ presetLabel(product.resourcePreset) }}</strong><span>{{ product.cpu / 100 }} 核 CPU · {{ formatMemoryMiB(product.memoryMiB) }} 内存 · {{ product.diskGiB }} GiB 磁盘</span><small v-if="product.setupFee">一次性开通费 ¥{{ formatPublicPrice(product.setupFee) }}</small></div><div class="configuration-price"><strong>¥{{ formatPublicPrice(product.monthlyPrice) }}</strong><span> / 月</span></div><RouterLink v-if="product.idle > 0" :to="atlasPurchaseTarget(product)" class="configuration-action">配置主机 <ArrowUpRight :size="15" /></RouterLink><button v-else type="button" class="configuration-action" disabled>{{ t('homeMapDemo.noStock') }}</button></div></template>
            <p v-else class="unlisted-message">该地区暂未上架主机配置，开放后将在这里显示。</p>
          </div>
        </article>
      </div>
      <div v-if="!visible.length" class="catalog-state"><Globe2 :size="26" /><p>没有符合条件的地区。</p><button type="button" class="small-action" @click="search = ''; onlyAvailable = false; setContinent('all')">清除筛选</button></div>
      <div class="catalog-footer"><span>已显示 {{ visible.length }} / {{ filtered.length }} 个地区</span><button v-if="visible.length < filtered.length" type="button" @click="visibleCount += 10">显示更多地区 <ArrowDown :size="15" /></button><span v-else>已显示全部</span></div>
    </template>
  </section>
</template>

<style scoped>
.region-atlas,.atlas-catalog {
  --atlas-accent: #00f2fe;
  --atlas-ink: #f5f5f7;
  --atlas-muted: #a1a7b3;
  color: var(--atlas-ink);
}
.content-width {
  width: min(1120px,calc(100% - 64px));
  margin-inline: auto;
}
.atlas-flag {
  width: 25px;
  height: 18px;
  flex-shrink: 0;
  display: inline-block;
  background-size: cover;
  border-radius: 2px;
}
button,a,input {
  font: inherit;
}
button,a {
  -webkit-tap-highlight-color: transparent;
}
button {
  cursor: pointer;
}
button:disabled {
  cursor: default;
}
button:focus-visible,a:focus-visible,input:focus-visible {
  outline: 2px solid var(--atlas-accent);
  outline-offset: 5px;
}
button:disabled {
  opacity: .42;
}
.atlas-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 24px;
  position: relative;
  z-index: 21;
  padding: 12px 0 0;
}
.continent-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.continent-tabs button {
  background: transparent;
  border: 0;
  color: var(--atlas-muted);
  padding: 10px 14px;
  border-radius: 6px;
  font-size: 13px;
  min-height: 44px;
  transition: background .18s,color .18s;
}
.continent-tabs button.active {
  color: var(--atlas-ink);
  background: #1e222b;
}
.continent-tabs button:hover {
  color: var(--atlas-accent);
}
.all-regions-link {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 0;
  background: none;
  color: var(--atlas-muted);
  font-size: 12px;
  min-height: 44px;
  white-space: nowrap;
}
.all-regions-link:hover {
  color: var(--atlas-accent);
}
.atlas-map {
  position: relative;
  isolation: isolate;
  width: min(1500px,100%);
  margin: 0 auto;
  aspect-ratio: 1440/510;
}
.map-svg {
  position: relative;
  z-index: 10;
  width: 100%;
  height: 100%;
  overflow: hidden;
  touch-action: none;
  cursor: grab;
  user-select: none;
}
.is-gesturing .map-svg {
  cursor: grabbing;
}
.map-transformation {
  transition: transform .7s cubic-bezier(.2,.8,.2,1);
}
.is-gesturing .map-transformation {
  transition: none;
}
.globe-atmosphere {
  position: absolute;
  z-index: 1;
  inset: 1% 0 8%;
  border-radius: 50% 50% 0 0/36% 36% 0 0;
  background: radial-gradient(ellipse at 50% 0%,rgba(99,112,141,.08),transparent 65%);
  border-top: 1px solid #323844;
  pointer-events: none;
}
.map-marker {
  cursor: pointer;
  outline: none;
  transition: opacity .45s;
  animation: atlas-marker-in .65s ease-out backwards;
  animation-delay: calc(var(--pulse-delay) * -1);
}
.map-marker.dimmed {
  opacity: .16;
}
.world-outline {
  animation: atlas-land-in 1s ease-out both;
}
.node-core {
  fill: #8e96a4;
  stroke: #c4ccd8;
  stroke-width: .55;
}
.available .node-core {
  fill: #baffff;
  stroke: #00f2fe;
  stroke-width: 1;
  filter: url(#atlas-neon);
  animation: atlas-breathe 1.5s ease-in-out infinite;
  animation-delay: var(--pulse-delay);
}
.node-ring {
  fill: none;
  stroke: #00f2fe;
  stroke-width: 1;
  opacity: 0;
}
.selected .node-ring,.map-marker:hover .node-ring,.map-marker:focus-visible .node-ring {
  opacity: .75;
}
.node-ping {
  fill: none;
  stroke: #00f2fe;
  stroke-width: 1;
  opacity: 0;
  transform-origin: 0 0;
}
.selected .node-ping,.map-marker:hover .node-ping,.map-marker:focus-visible .node-ping {
  animation: atlas-ping 1.5s ease-out infinite;
}
.map-marker.selected.available .node-core {
  fill: #d5ffff;
  stroke: #00f2fe;
  filter: url(#atlas-neon);
}
.map-bottom {
  position: absolute;
  bottom: 18px;
  left: 0;
  right: 0;
  display: grid;
  grid-template-columns: 1fr 1.6fr 1fr;
  align-items: end;
  gap: 20px;
  z-index: 15;
  pointer-events: none;
}
.atlas-legend {
  font-size: 12px;
  color: var(--atlas-muted);
  display: flex;
  flex-direction: column;
  gap: 9px;
  white-space: nowrap;
}
.atlas-legend>span {
  display: flex;
  gap: 7px;
  align-items: center;
}
.atlas-legend i,.row-state i {
  display: inline-block;
  width: 5px;
  height: 5px;
  flex-shrink: 0;
  border-radius: 50%;
  background: #7a8392;
}
.atlas-legend .available-dot {
  background: #00f2fe;
  box-shadow: 0 0 8px rgba(0,242,254,.65);
}
.atlas-legend small {
  margin-top: 5px;
  color: #8993a4;
  font-size: 11px;
}
.map-selection {
  grid-column: 2;
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 16px;
  border: 1px solid #363c48;
  background: rgba(23,27,35,.94);
  color: var(--atlas-ink);
  border-radius: 10px;
  text-align: left;
  padding: 18px 20px;
  min-height: 80px;
  box-shadow: 0 12px 30px rgba(0,0,0,.2);
}
.map-selection>img {
  width: 26px;
  height: 19px;
  object-fit: cover;
  border-radius: 2px;
}
.map-selection>span:nth-child(2) {
  min-width: 0;
  flex: 1;
  display: grid;
  gap: 6px;
}
.map-selection strong {
  font-size: 14px;
  font-weight: 600;
}
.map-selection small {
  font-size: 11px;
  color: var(--atlas-muted);
  white-space: normal;
}
.map-selection b {
  margin: 0 7px;
  font-weight: 400;
}
.selection-action {
  display: flex;
  align-items: center;
  gap: 7px;
  white-space: nowrap;
  background: #f3f4f6;
  border-radius: 6px;
  padding: 10px 12px;
  font-size: 11px;
  color: #101218;
}
.map-controls {
  position: absolute;
  right: 28px;
  bottom: 30px;
  z-index: 16;
  display: flex;
  gap: 1px;
  border: 1px solid #343944;
  border-radius: 6px;
  overflow: hidden;
}
.map-controls button {
  border: 0;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  color: #d2d7e1;
  background: #161a23;
}
.map-controls button:hover {
  background: #252b36;
}
.mobile-map-hint {
  display: none;
}
.map-tooltip {
  position: absolute;
  z-index: 20;
  width: 280px;
  background: rgba(13,19,32,.85);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(0,242,254,.3);
  border-radius: 8px;
  padding: 12px 16px;
  box-shadow: 0 8px 32px rgba(0,0,0,.5);
  font-size: 13px;
  color: #f5f5f7;
}
.tooltip-title {
  display: flex;
  gap: 9px;
  align-items: center;
}
.tooltip-title img {
  width: 20px;
  height: 15px;
  object-fit: cover;
}
.tooltip-title strong {
  flex: 1;
  font-size: 13px;
  line-height: 1.5;
}
.tooltip-title>button {
  border: 0;
  color: #a1a7b3;
  background: none;
  padding: 4px;
}
.tooltip-code {
  color: #a1a7b3;
  font-size: 11px;
  margin: 6px 0 16px;
}
.tooltip-availability {
  display: flex;
  align-items: center;
  gap: 7px;
  color: #b4bbc8;
  font-size: 12px;
}
.tooltip-availability>span {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #808996;
}
.tooltip-availability.available {
  color: #7af1e9;
}
.tooltip-availability.available>span {
  background: #00f2fe;
}
.tooltip-price {
  margin-top: 17px;
  padding-top: 14px;
  border-top: 1px solid #303746;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.tooltip-price strong {
  font-size: 22px;
  margin-left: 3px;
  font-weight: 600;
}
.tooltip-price small {
  font-size: 11px;
  color: #a1a7b3;
}
.small-action {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  justify-content: center;
  background: #f5f5f7;
  color: #12151c;
  border: 0;
  border-radius: 6px;
  padding: 9px 12px;
  font-size: 12px;
  font-weight: 600;
  min-height: 36px;
  text-decoration: none;
}
.small-action:hover {
  background: #cffcff;
}
.small-action.secondary {
  color: #f5f5f7;
  background: #262e3b;
}
.nearby-regions {
  margin-top: 12px;
  border-top: 1px solid #303746;
  padding-top: 10px;
  display: grid;
  gap: 2px;
}
.nearby-regions>span {
  font-size: 11px;
  color: #a1a7b3;
  margin-bottom: 5px;
}
.nearby-regions button {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border: 0;
  background: none;
  padding: 6px 0;
  color: #e2e5eb;
  font-size: 11px;
  text-align: left;
}
.atlas-catalog {
  margin-top: 64px;
  scroll-margin-top: 90px;
  margin-bottom: 70px;
}
.catalog-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 28px;
}
.catalog-heading h2 {
  font-size: 28px;
  font-weight: 600;
  letter-spacing: -.8px;
  line-height: 1.4;
  margin: 0;
}
.catalog-heading p {
  font-size: 14px;
  color: var(--atlas-muted);
  margin: 9px 0 0;
}
.catalog-total {
  font-size: 12px;
  color: var(--atlas-muted);
  white-space: nowrap;
}
.catalog-context {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 10px;
}
.active-region-filter {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 16px;
  border: 1px solid #355c64;
  border-radius: 6px;
  background: #10212a;
  padding: 2px 10px;
  color: #b9edf1;
  font-size: 12px;
  line-height: 1.7;
}
.active-region-filter strong {
  font-weight: 550;
}
.active-region-filter button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 44px;
  min-height: 44px;
  border: 0;
  background: none;
  color: #e1f8fb;
  font-size: 11px;
}
.catalog-filters {
  display: flex;
  align-items: center;
  gap: 24px;
  margin-bottom: 22px;
}
.region-search {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #929ba9;
  background: #151922;
  border: 1px solid #2b313e;
  border-radius: 7px;
  padding: 0 13px;
  flex: 1;
  max-width: 410px;
}
.region-search input {
  color: #f5f5f7;
  background: none;
  border: 0;
  padding: 12px 0;
  width: 100%;
  min-width: 0;
  font-size: 13px;
}
.region-search input::placeholder {
  color: #9aa3b2;
}
.region-search input:focus {
  outline: none;
}
.region-search:focus-within {
  border-color: #00f2fe;
}
.availability-toggle {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 12px;
  color: #c3c9d3;
  min-height: 44px;
  white-space: nowrap;
}
.availability-toggle input {
  accent-color: #00f2fe;
  width: 15px;
  height: 15px;
}
.filter-note {
  margin-left: auto;
  color: #9aa4b4;
  font-size: 12px;
}
.region-table-heading {
  display: grid;
  grid-template-columns: 3.2fr 1.6fr 1.25fr 1.6fr 1.2fr;
  gap: 18px;
  padding: 15px 24px;
  color: #a1a7b3;
  font-size: 11px;
  background: #11151c;
  border-radius: 7px 7px 0 0;
}
.region-table-heading span:last-child {
  text-align: right;
}
.region-rows {
  display: flex;
  flex-direction: column;
}
.region-row {
  position: relative;
  border-bottom: 1px solid #252b36;
  scroll-margin-top: 95px;
  transition: background .2s;
}
.region-row.is-selected {
  background: #151e29;
  box-shadow: inset 2px 0 #00f2fe;
}
.region-row:hover {
  background: #141a24;
}
.region-summary {
  position: relative;
  display: grid;
  grid-template-columns: 3.2fr 1.6fr 1.25fr 1.6fr 1.2fr;
  gap: 18px;
  align-items: center;
  width: 100%;
  padding: 24px;
  border: 0;
  color: #f1f3f7;
  background: transparent;
  text-align: left;
}
.region-identity {
  display: flex;
  gap: 14px;
  align-items: center;
  min-width: 0;
}
.region-identity img {
  width: 25px;
  height: 18px;
  border-radius: 2px;
  object-fit: cover;
  flex-shrink: 0;
}
.region-identity>span {
  display: grid;
  gap: 7px;
  min-width: 0;
}
.region-identity strong {
  font-size: 14px;
  font-weight: 550;
  line-height: 1.6;
}
.region-identity small {
  color: #99a5b7;
  font-size: 11px;
  overflow-wrap: anywhere;
}
.row-compute,.row-storage {
  display: grid;
  gap: 7px;
  font-size: 13px;
}
.row-compute strong,.row-storage strong {
  font-weight: 500;
}
.row-compute small,.row-storage small {
  font-size: 11px;
  color: #a1a7b3;
}
.row-price {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.row-price strong {
  font-size: 24px;
  font-weight: 550;
  margin-left: 2px;
}
.row-price small {
  font-size: 11px;
  color: #a1a7b3;
}
.row-price .coming-soon {
  font-size: 12px;
  color: #939dac;
}
.row-state {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 7px;
  color: #9ca8b9;
  font-size: 11px;
  white-space: nowrap;
}
.row-state.available {
  color: #72ddd7;
}
.row-state.available i {
  background: #00f2fe;
}
.expand-chevron {
  margin-left: 6px;
  transition: transform .2s;
}
.is-expanded .expand-chevron {
  transform: rotate(180deg);
}
.selection-check {
  position: absolute;
  left: 5px;
  top: calc(50% - 6px);
  color: #00f2fe;
}
.is-unlisted .region-identity strong {
  color: #b0b8c4;
}
.region-configs {
  margin: 0 24px 20px 63px;
  padding-top: 18px;
  border-top: 1px solid #313a48;
  animation: atlas-expand .25s ease-out;
}
.configuration-row {
  display: flex;
  align-items: center;
  gap: 20px;
}
.single-configuration {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}
.single-configuration-info {
  display: grid;
  gap: 9px;
}
.single-configuration-info small {
  color: #b3bdcc;
  font-size: 11px;
}
.configuration-next-step {
  margin: 0;
  color: #bbc5d4;
  font-size: 12px;
}
.mobile-resource-summary {
  display: none;
}
.configuration-label {
  flex: 1;
  display: grid;
  gap: 8px;
  font-size: 12px;
  color: #b2bdcd;
}
.configuration-label strong {
  font-size: 13px;
  color: #ecf0f7;
}
.configuration-label small {
  font-size: 11px;
  color: #b3bdcc;
}
.configuration-price {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.configuration-price strong {
  font-weight: 550;
  font-size: 19px;
}
.configuration-price>span {
  color: #a1a7b3;
  font-size: 11px;
}
.configuration-action {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  border: 0;
  background: #f5f5f7;
  border-radius: 6px;
  color: #11151c;
  padding: 10px 16px;
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
}
.configuration-action:hover {
  background: #c9faff;
}
.configuration-action:disabled {
  opacity: 1;
  background: #262d39;
  color: #aab4c2;
}
.unlisted-message {
  color: #b0bbc9;
  font-size: 13px;
  margin: 0;
}
.catalog-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-top: 24px;
  font-size: 12px;
  color: #9ca7b7;
}
.catalog-footer button {
  display: flex;
  gap: 8px;
  align-items: center;
  color: #e6eaf2;
  border: 0;
  background: none;
  min-height: 44px;
  font-size: 12px;
}
.catalog-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
  min-height: 190px;
  color: #c5cdd8;
  font-size: 14px;
}
.catalog-state p {
  margin: 0;
}
.tooltip-enter-active,.tooltip-leave-active {
  transition: opacity .16s,transform .16s;
}
.tooltip-enter-from,.tooltip-leave-to {
  opacity: 0;
  transform: translateY(6px);
}
.selection-enter-active,.selection-leave-active {
  transition: opacity .15s,transform .15s;
}
.selection-enter-from,.selection-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
@keyframes atlas-marker-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
@keyframes atlas-land-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@keyframes atlas-breathe {
  0%,100% {
    opacity: .2;
  }
  50% {
    opacity: 1;
  }
}
@keyframes atlas-ping {
  0% {
    transform: scale(.7);
    opacity: .8;
  }
  100% {
    transform: scale(2.6);
    opacity: 0;
  }
}
@keyframes atlas-expand {
  from {
    opacity: 0;
    transform: translateY(-5px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@media(min-width:1500px) {
  .atlas-map {
    aspect-ratio: 1440/500;
  }
  .map-bottom {
    bottom: 0;
  }
}
@media(max-width:1050px) {
  .content-width {
    width: calc(100% - 48px);
  }
  .atlas-toolbar {
    gap: 12px;
  }
  .continent-tabs button {
    padding: 10px;
    font-size: 12px;
  }
  .all-regions-link {
    font-size: 11px;
  }
  .map-selection {
    gap: 12px;
    padding: 14px;
    width: 400px;
  }
  .map-bottom {
    grid-template-columns: 1fr 2fr;
  }
  .map-selection strong {
    font-size: 12px;
  }
  .map-controls {
    bottom: 120px;
  }
  .atlas-catalog {
    margin-top: 65px;
  }
  .region-summary,.region-table-heading {
    grid-template-columns: 3fr 1.6fr 1fr 1.4fr 1.4fr;
    gap: 12px;
    padding-inline: 18px;
  }
  .region-identity {
    gap: 10px;
  }
  .region-identity strong {
    font-size: 12px;
  }
  .row-price strong {
    font-size: 20px;
  }
}
@media(max-width:767px) {
  .content-width {
    width: calc(100% - 36px);
  }
  .atlas-toolbar {
    display: block;
    padding-top: 0;
  }
  .continent-tabs {
    gap: 0;
    justify-content: space-between;
  }
  .continent-tabs button {
    padding: 8px 9px;
    font-size: 11px;
    min-height: 44px;
    min-width: 44px;
  }
  .all-regions-link {
    display: none;
  }
  .atlas-map {
    height: 240px;
    aspect-ratio: auto;
    margin-top: 10px;
    background: #0d121b;
    border-radius: 0;
  }
  .map-svg {
    height: 240px;
  }
  .globe-atmosphere {
    inset: 0;
    opacity: .55;
  }
  .node-core {
    r: 5;
  }
  .node-label,.map-bottom {
    display: none;
  }
  .map-controls {
    bottom: 12px;
    right: 18px;
    border-radius: 6px;
  }
  .map-controls button {
    width: 44px;
    height: 44px;
  }
  .mobile-map-hint {
    display: block;
    position: absolute;
    z-index: 14;
    left: 18px;
    bottom: 22px;
    max-width: calc(100% - 180px);
    font-size: 11px;
    color: #b3bfce;
    margin: 0;
    pointer-events: none;
    line-height: 1.6;
  }
  .atlas-catalog {
    margin-top: 38px;
    margin-bottom: 45px;
    scroll-margin-top: 75px;
  }
  .catalog-heading {
    gap: 14px;
    margin-bottom: 20px;
  }
  .catalog-heading:has(.has-selection) {
    flex-wrap: wrap;
  }
  .catalog-context.has-selection {
    width: 100%;
    align-items: stretch;
  }
  .catalog-context.has-selection .catalog-total {
    text-align: right;
  }
  .catalog-heading h2 {
    font-size: 21px;
    letter-spacing: -.6px;
    max-width: 250px;
  }
  .catalog-heading p {
    font-size: 12px;
  }
  .catalog-total {
    font-size: 11px;
  }
  .catalog-filters {
    flex-wrap: wrap;
    gap: 10px 18px;
    margin-bottom: 16px;
  }
  .region-search {
    flex-basis: 100%;
    max-width: none;
    min-height: 44px;
  }
  .region-search input {
    font-size: 12px;
  }
  .availability-toggle {
    font-size: 12px;
  }
  .filter-note {
    font-size: 11px;
  }
  .region-table-heading {
    display: none;
  }
  .region-rows {
    gap: 10px;
  }
  .region-row {
    background: #131923;
    border: 1px solid #2a3341;
    border-radius: 8px;
    overflow: hidden;
  }
  .region-row.is-selected {
    border-color: #41757e;
    box-shadow: inset 2px 0 #00f2fe;
  }
  .region-summary {
    display: grid;
    grid-template-columns: minmax(0,1fr) auto;
    gap: 14px 12px;
    padding: 20px 18px;
  }
  .region-identity {
    grid-column: 1/-1;
    gap: 12px;
  }
  .region-identity strong {
    font-size: 14px;
  }
  .region-identity small {
    font-size: 11px;
  }
  .region-identity img {
    width: 24px;
    height: 17px;
  }
  .row-compute,.row-storage {
    display: none;
  }
  .row-price {
    grid-row: 2;
    grid-column: 1;
  }
  .row-price strong {
    font-size: 22px;
  }
  .row-state {
    grid-row: 2;
    grid-column: 2;
    justify-content: flex-end;
    min-height: 44px;
    font-size: 11px;
  }
  .row-state .expand-chevron {
    margin-left: 8px;
  }
  .selection-check {
    display: none;
  }
  .region-configs {
    margin: 0 18px 20px;
    padding-top: 18px;
  }
  .configuration-row {
    flex-wrap: wrap;
    gap: 18px 10px;
  }
  .single-configuration {
    flex-wrap: wrap;
    gap: 18px;
  }
  .single-configuration-info {
    width: 100%;
  }
  .mobile-resource-summary {
    display: block;
    margin: 0;
    font-size: 12px;
    color: #d0d8e5;
    line-height: 1.8;
  }
  .single-configuration .configuration-action {
    margin-left: auto;
  }
  .configuration-label {
    flex-basis: 100%;
    font-size: 12px;
    line-height: 1.6;
  }
  .configuration-label strong {
    display: none;
  }
  .configuration-price {
    flex: 1;
  }
  .configuration-price strong {
    font-size: 19px;
  }
  .configuration-action {
    min-width: 126px;
    font-size: 12px;
    min-height: 44px;
  }
  .unlisted-message {
    font-size: 12px;
    line-height: 1.8;
  }
  .catalog-footer {
    font-size: 11px;
  }
  .catalog-footer button {
    font-size: 12px;
  }
  .nearby-regions {
    display: none;
  }
  .small-action {
    min-height: 44px;
  }
}
@media(max-width:370px) {
  .continent-tabs button {
    padding-inline: 7px;
    font-size: 10px;
  }
  .catalog-heading h2 {
    font-size: 19px;
  }
  .catalog-total {
    font-size: 10px;
  }
  .region-identity strong {
    font-size: 13px;
  }
}
:global(html[data-home-demo-motion=reduced] *) {
  animation: none!important;
  transition: none!important;
  scroll-behavior: auto!important;
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
.minimal-mobile-choice { display: none; }
.globe-loading { display: grid; place-items: center; height: 100%; color: #bfccdb; font-size: 13px; }
.minimal-selection .selection-action { min-height: 44px; border: 0; text-decoration: none; }
.minimal-selection .selection-action:disabled { background: #262d38; color: #acb6c5; opacity: 1; }
.minimal-load-error { display: flex; align-items: center; justify-content: flex-end; gap: 14px; margin-top: 20px; color: #c6cdd8; font-size: 12px; }
.minimal-load-error button { border: 0; background: none; color: #eff4fa; min-height: 44px; }
.minimal-atlas .atlas-legend small { font-size: 13px; }
@media (min-width: 768px) {
  .minimal-atlas .atlas-map { width: var(--home-map-width, min(100%, 2160px)); aspect-ratio: 1440 / 500; }
  .minimal-atlas .content-width { width: var(--home-content-width, min(1920px, 84vw)); }
  .minimal-atlas .map-controls { bottom: 20px; right: max(20px, 4%); }
}
@media (max-width: 767px) {
  .minimal-atlas .atlas-map.globe-trial-frame { height: clamp(310px, 46svh, 430px); aspect-ratio: auto; }
  .minimal-mobile-choice { display: flex; align-items: center; gap: 12px; margin-top: 22px; padding: 15px 0; }
  .minimal-mobile-choice > div { display: grid; flex: 1; gap: 6px; min-width: 0; }
  .minimal-mobile-choice strong { font-size: 13px; line-height: 1.6; font-weight: 550; }
  .minimal-mobile-choice span { color: #a1a7b3; font-size: 11px; }
  .minimal-mobile-choice .small-action { min-width: 100px; min-height: 44px; font-size: 11px; }
  .minimal-mobile-choice .small-action:disabled { background: #262d38; color: #acb6c5; opacity: 1; }
  .minimal-load-error { justify-content: flex-start; }
  .minimal-atlas .continent-tabs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; }
  .minimal-atlas .continent-tabs button { display: flex; align-items: center; justify-content: center; gap: 3px; padding: 6px 3px; min-width: 44px; min-height: 44px; font-size: 13px; line-height: 1.25; }
  .more-continent-menu { position: absolute; right: 0; top: 48px; z-index: 30; display: grid; padding: 6px; min-width: 170px; background: #18202b; border: 1px solid #3a4556; border-radius: 7px; }
  .more-continent-menu button { border: 0; background: none; color: #eef2f7; padding: 10px 14px; min-height: 44px; text-align: left; font-size: 13px; }
  .mobile-gesture-guide { display: flex; align-items: center; gap: 7px; color: #cbd9e6; margin: 8px 0 0; font-size: 12px; line-height: 1.6; font-weight: 500; }
  .mobile-gesture-guide svg { color: #80d8df; }
  .minimal-atlas .map-controls { border: 0; background: #18212d; box-shadow: 0 3px 12px #0003; border-radius: 50%; }
  .minimal-atlas .map-controls button { border-radius: 50%; background: transparent; }
  .mobile-node-feedback { position: absolute; z-index: 24; width: 240px; border: 1px solid #416472; background: #151e2a; border-radius: 8px; color: #edf3f8; box-shadow: 0 5px 18px #0005; }
  .feedback-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px 8px 14px; }
  .feedback-heading > span { display: grid; gap: 4px; }
  .feedback-heading strong { font-size: 12px; font-weight: 550; line-height: 1.6; }
  .feedback-heading small { display: block; font-size: 11px; color: #b4c3d2; }
  .feedback-heading > button { display: grid; place-items: center; flex-shrink: 0; width: 44px; height: 44px; border: 0; background: none; color: #d7e1eb; }
  .candidate-list { max-height: 132px; overflow-y: auto; border-top: 1px solid #344251; padding: 0 12px; }
  .candidate-list > button { display: grid; gap: 3px; width: 100%; min-height: 48px; padding: 8px 0; text-align: left; background: none; border: 0; color: #ecf2f8; font-size: 12px; }
  .candidate-list small { color: #a7bbcc; font-size: 11px; }
  .mobile-region-preview { margin-top: 12px; }
  .mobile-preview-heading { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 10px; color: #b1c2d0; font-size: 13px; }
  .mobile-region-strip { display: flex; gap: 12px; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none; overscroll-behavior-x: contain; }
  .mobile-region-strip::-webkit-scrollbar { display: none; }
  .mobile-region-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; flex: 0 0 calc(100% - 18px); box-sizing: border-box; min-height: 88px; padding: 14px; border-radius: 8px; border: 1px solid #303c4b; background: #141b25; scroll-snap-align: start; }
  .mobile-region-card.is-current { border-color: #477983; }
  .mobile-card-location { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 44px; padding: 0; border: 0; background: none; text-align: left; color: #eff4f9; }
  .mobile-card-location > span:last-child { display: grid; gap: 5px; }
  .mobile-card-location strong { font-size: 13px; line-height: 1.5; font-weight: 550; }
  .mobile-card-location small { font-size: 11px; color: #b6c3d0; }
  .mobile-card-action { display: flex; align-items: center; }
  .mobile-card-action .small-action { min-width: 64px; min-height: 44px; padding: 0 4px; background: transparent; color: #d8eff2; font-size: 12px; font-weight: 500; }
  .mobile-card-action .small-action:disabled { color: #a6b5c3; background: transparent; opacity: 1; }
}
</style>
