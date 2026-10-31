<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { geoCentroid, geoDistance, geoGraticule10, geoOrthographic, geoPath, type GeoPermissibleObjects } from 'd3-geo'
import { useI18n } from 'vue-i18n'
import { RotateCcw, X } from 'lucide-vue-next'
import type { AtlasRegion } from '@/utils/homeRegionAtlas'

const { t, locale } = useI18n()
const props = defineProps<{ regions: AtlasRegion[]; selectedSlug: string; continent: string; loading?: boolean; failed?: boolean }>()
const emit = defineEmits<{ choose: [region: AtlasRegion] }>()
const svg = ref<SVGSVGElement>()
const frame = ref<HTMLElement>()
const rotation = ref<[number, number, number]>([77.48749, -39.04372, 0])
const zoom = ref(1)
const hitRadius = ref(23)
const land = shallowRef<GeoPermissibleObjects[]>([])
const landFailed = ref(false)
const interacting = ref(false)
const feedbackOpen = ref(false)
const cameraMoving = ref(false)
const candidateHighlightSlug = ref('')
const candidateSlugs = ref<string[]>([])
const candidateAnchor = ref({ x: 100, y: 100 })
let candidatePressSlug = ''
const selected = computed(() => props.regions.find(region => region.slug === props.selectedSlug))
const candidates = computed(() => candidateSlugs.value.map(slug => props.regions.find(region => region.slug === slug)).filter((region): region is AtlasRegion => !!region))
const projection = computed(() => geoOrthographic().translate([200, 200]).scale(176 * zoom.value).rotate(rotation.value).clipAngle(90).precision(0.6))
const paths = computed(() => { const path = geoPath(projection.value); return land.value.map(feature => path(feature) ?? '') })
const grid = computed(() => geoPath(projection.value)(geoGraticule10()) ?? '')
const points = computed(() => {
  const center = projection.value.invert?.([200, 200]) ?? [0, 0]
  return props.regions.flatMap(region => {
    const location = region.geography
    if (!location) return []
    const coordinate: [number, number] = [location.longitude, location.latitude]
    if (geoDistance(coordinate, center) >= Math.PI / 2 - 0.008) return []
    const point = projection.value(coordinate)
    if (!point) return []
    // Presentation-only separation for same-city regions; geographic coordinates are retained.
    const x = point[0] + ((region.displayX ?? location.x) - location.x) * 0.6
    const y = point[1] + ((region.displayY ?? location.y) - location.y) * 0.6
    return x >= 4 && x <= 396 && y >= 4 && y <= 396 ? [{ region, x, y }] : []
  })
})
const selectedPoint = computed(() => points.value.find(point => point.region.slug === props.selectedSlug))
const name = (region: AtlasRegion) => region.geography?.code === 'eu-madrid-3' ? t('homeMapDemo.madrid') : region.geography?.code === 'ap-kulai-2' ? t('homeMapDemo.kulai') : locale.value === 'en' ? region.nameEn : locale.value === 'zh-TW' ? region.nameZhTW : region.name
const status = (region: AtlasRegion) => props.loading ? t('homeMapDemo.stockLoading') : props.failed ? t('homeMapDemo.stockUnknown') : region.stock > 0 ? t('homeMapDemo.available', { count: region.stock }) : region.products.length ? t('homeMapDemo.noStock') : t('homeMapDemo.unlisted')
const feedbackStyle = computed(() => {
  const matrix = svg.value?.getScreenCTM(), box = frame.value?.getBoundingClientRect()
  if (!matrix || !box) return {}
  const anchor = candidates.value.length ? candidateAnchor.value : selectedPoint.value
  if (!anchor) return {}
  const point = new DOMPoint(anchor.x, anchor.y).matrixTransform(matrix)
  const height = candidates.value.length ? 190 : 76
  return { left: `${Math.max(12, Math.min(box.width - 252, point.x - box.x - 120))}px`,
    top: `${Math.max(12, Math.min(box.height - height - 12, point.y - box.y - 84))}px` }
})
function reduced() { return document.documentElement.dataset.homeDemoMotion === 'full' ? false : document.documentElement.dataset.homeDemoMotion === 'reduced' || matchMedia('(prefers-reduced-motion: reduce)').matches }
let animation = 0
let movedByUser = false
function animateTo(target: [number, number, number], targetZoom = 1) {
  cancelAnimationFrame(animation)
  feedbackOpen.value = false
  closeCandidates()
  const start = [...rotation.value] as [number, number, number], startZoom = zoom.value
  const longitudeDelta = (((target[0] - start[0]) % 360 + 540) % 360) - 180
  if (reduced()) { rotation.value = target; zoom.value = targetZoom; cameraMoving.value = false; if (selectedPoint.value && selected.value) feedbackOpen.value = true; return }
  cameraMoving.value = true
  const at = performance.now()
  const tick = (time: number) => {
    if (reduced()) { rotation.value = target; zoom.value = targetZoom; cameraMoving.value = false; if (selectedPoint.value && selected.value) feedbackOpen.value = true; return }
    const progress = Math.min(1, (time - at) / 650), ease = 1 - Math.pow(1 - progress, 3)
    rotation.value = [start[0] + longitudeDelta * ease, start[1] + (target[1] - start[1]) * ease, 0]
    zoom.value = startZoom + (targetZoom - startZoom) * ease
    if (progress < 1) animation = requestAnimationFrame(tick)
    else { cameraMoving.value = false; if (selectedPoint.value && selected.value) feedbackOpen.value = true }
  }
  animation = requestAnimationFrame(tick)
}
function focusRegion(region: AtlasRegion) {
  if (!region.geography) return
  movedByUser = true
  animateTo([-region.geography.longitude, -region.geography.latitude, 0], Math.min(2.5, Math.max(1.14, zoom.value * 1.08)))
}
function focusContinent(value: string) {
  movedByUser = true
  if (value === 'all') { reset(); return }
  const locations = props.regions.filter(region => region.continent === value && region.geography).map(region => [region.geography!.longitude, region.geography!.latitude])
  if (!locations.length) return
  const center = geoCentroid({ type: 'MultiPoint', coordinates: locations })
  animateTo([-center[0], -center[1], 0], 1.1)
}
function reset() {
  const region = selected.value ?? props.regions.find(region => region.stock > 0) ?? props.regions.find(region => region.geography)
  if (region?.geography) animateTo([-region.geography.longitude, -region.geography.latitude, 0])
  else animateTo([0, -20, 0])
}
defineExpose({ focusRegion, focusContinent, reset })
watch(() => props.regions, () => {
  if (movedByUser) return
  const region = selected.value ?? props.regions.find(region => region.stock > 0) ?? props.regions[0]
  if (region?.geography) rotation.value = [-region.geography.longitude, -region.geography.latitude, 0]
}, { immediate: true })
watch(() => props.selectedSlug, () => { closeCandidates(); if (!cameraMoving.value) feedbackOpen.value = true })
function closeCandidates() { candidateSlugs.value = []; candidatePressSlug = ''; candidateHighlightSlug.value = '' }
function beginCandidatePress(region: AtlasRegion) { candidatePressSlug = region.slug; candidateHighlightSlug.value = region.slug }
function choose(region: AtlasRegion) { closeCandidates(); feedbackOpen.value = true; emit('choose', region) }
function chooseCandidate(region: AtlasRegion, event: MouseEvent) {
  // A touch can synthesize a click over the newly opened list. Require a new press on a row.
  if (event.detail !== 0 && candidatePressSlug !== region.slug) return
  candidatePressSlug = ''
  choose(region)
  focusRegion(region)
}
const pointers = new Map<number, { x: number; y: number }>()
let origin = { x: 0, y: 0 }, initialRotation: [number, number, number] = [0, 0, 0], initialZoom = 1, initialDistance = 0, dragged = false
function down(event: PointerEvent) {
  if (event.button !== 0) return
  movedByUser = true
  cancelAnimationFrame(animation)
  cameraMoving.value = false
  feedbackOpen.value = false
  closeCandidates()
  svg.value?.setPointerCapture(event.pointerId)
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
  origin = { x: event.clientX, y: event.clientY }
  initialRotation = [...rotation.value]
  initialZoom = zoom.value
  dragged = false
  if (pointers.size === 2) {
    const pair = [...pointers.values()]
    initialDistance = Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y)
    dragged = true; interacting.value = true
  }
}
function move(event: PointerEvent) {
  if (!pointers.has(event.pointerId)) return
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
  if (pointers.size === 2) {
    const pair = [...pointers.values()], distance = Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y)
    zoom.value = Math.min(2.5, Math.max(0.85, initialZoom * distance / Math.max(1, initialDistance)))
    return
  }
  const dx = event.clientX - origin.x, dy = event.clientY - origin.y
  if (Math.hypot(dx, dy) > 5) { dragged = true; interacting.value = true }
  if (dragged) rotation.value = [initialRotation[0] + dx * 0.38 / zoom.value, Math.max(-80, Math.min(80, initialRotation[1] - dy * 0.3 / zoom.value)), 0]
}
function up(event: PointerEvent) {
  const wasDrag = dragged
  pointers.delete(event.pointerId)
  if (!pointers.size) interacting.value = false
  else { origin = [...pointers.values()][0]; initialRotation = [...rotation.value]; dragged = true }
  if (wasDrag || event.type === 'pointercancel') return
  const matrix = svg.value?.getScreenCTM()
  if (!matrix) return
  const nearby = points.value.map(point => { const position = new DOMPoint(point.x, point.y).matrixTransform(matrix); return { ...point, distance: Math.hypot(position.x - event.clientX, position.y - event.clientY) } })
    .filter(point => point.distance <= 22 && (props.continent === 'all' || point.region.continent === props.continent)).sort((a, b) => a.distance - b.distance)
  if (nearby.length > 1) {
    candidateSlugs.value = nearby.map(point => point.region.slug)
    const position = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
    candidateAnchor.value = { x: position.x, y: position.y }
  } else if (nearby[0]) choose(nearby[0].region)
}
const controller = new AbortController()
let resize: ResizeObserver | undefined
onMounted(async () => {
  resize = new ResizeObserver(() => { const scale = svg.value?.getScreenCTM()?.a ?? 1; hitRadius.value = 22 / Math.max(0.1, Math.abs(scale)) })
  if (frame.value) resize.observe(frame.value)
  try {
    const response = await fetch('/maps/mobile-globe-land.json', { signal: controller.signal })
    if (!response.ok) throw Error('Coastline load failed')
    const data = await response.json() as { features: GeoPermissibleObjects[] }
    land.value = data.features
  } catch { if (!controller.signal.aborted) landFailed.value = true }
})
onBeforeUnmount(() => { cancelAnimationFrame(animation); controller.abort(); resize?.disconnect() })
</script>

<template>
  <div ref="frame" class="mobile-vector-globe" :class="interacting ? 'is-interacting' : ''">
    <svg ref="svg" viewBox="0 0 400 400" class="vector-globe-svg" role="group" :aria-label="t('homeMapDemo.globeLabel')" :data-rotation="rotation.join(',')" :data-zoom="zoom" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up">
      <defs>
        <radialGradient id="globe-ocean" cx="34%" cy="27%" r="75%"><stop offset="0" stop-color="var(--globe-ocean-start, #152334)" /><stop offset="0.66" stop-color="var(--globe-ocean-mid, #0b1420)" /><stop offset="1" stop-color="var(--globe-ocean-end, #04090f)" /></radialGradient>
        <radialGradient id="globe-light" cx="30%" cy="22%" r="82%"><stop offset="0" stop-color="#a1b9d0" stop-opacity="0.07" /><stop offset="0.7" stop-color="#060a12" stop-opacity="0" /><stop offset="1" stop-color="#000" stop-opacity="var(--globe-shade-opacity, .55)" /></radialGradient>
        <filter id="globe-point-light" x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur stdDeviation="3" /><feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        <clipPath id="globe-circle"><circle cx="200" cy="200" :r="176 * zoom" /></clipPath>
      </defs>
      <circle cx="200" cy="200" :r="178 * zoom" fill="var(--globe-rim, #101b2b)" stroke="var(--globe-rim-stroke, #344458)" stroke-width="0.8" />
      <g clip-path="url(#globe-circle)">
        <circle cx="200" cy="200" :r="176 * zoom" fill="url(#globe-ocean)" />
        <path :d="grid" fill="none" stroke="var(--globe-grid, #4c637c)" stroke-opacity="0.13" stroke-width="0.7" />
        <path v-for="(path, index) in paths" :key="index" :d="path" fill="var(--globe-land, #202d3c)" stroke="var(--globe-land-stroke, #526378)" stroke-opacity="0.55" stroke-width="0.65" />
        <circle cx="200" cy="200" :r="176 * zoom" fill="url(#globe-light)" pointer-events="none" />
        <g v-for="point in points" :key="point.region.slug" class="globe-region-point" :class="[point.region.stock > 0 && !loading && !failed ? 'available' : '', point.region.slug === selectedSlug ? 'selected' : '', point.region.slug === candidateHighlightSlug ? 'previewed' : '', continent !== 'all' && point.region.continent !== continent ? 'dimmed' : '']" :transform="`translate(${point.x} ${point.y})`" role="button" tabindex="0" :aria-label="`${name(point.region)}，${status(point.region)}`" @keydown.enter.prevent="choose(point.region)" @keydown.space.prevent="choose(point.region)">
          <circle :r="hitRadius" fill="transparent" class="globe-node-hit" />
          <circle v-if="point.region.slug === selectedSlug || point.region.slug === candidateHighlightSlug" class="globe-point-ring" r="12" fill="none" stroke="#7edde5" stroke-width="0.9" opacity="0.8" />
          <circle class="globe-node-core" :r="point.region.stock > 0 ? 5 : 3.5" />
        </g>
      </g>
    </svg>
    <button type="button" class="globe-reset" :aria-label="t('homeMapDemo.resetGlobe')" @click="reset"><RotateCcw :size="15" /></button>
    <div v-if="candidates.length" class="globe-feedback" :style="feedbackStyle"><div class="globe-feedback-title"><strong>{{ t('homeMapDemo.nearby') }}</strong><button type="button" :aria-label="t('homeMapDemo.closeNearby')" @click="closeCandidates"><X :size="14" /></button></div><div class="globe-candidates"><button v-for="region in candidates" :key="region.slug" type="button" @pointerenter="candidateHighlightSlug = region.slug" @pointerleave="candidateHighlightSlug = ''" @focus="candidateHighlightSlug = region.slug" @blur="candidateHighlightSlug = ''" @pointerdown="beginCandidatePress(region)" @pointercancel="candidateHighlightSlug = ''; candidatePressSlug = ''" @click="chooseCandidate(region, $event)"><span>{{ name(region) }}</span><small>{{ status(region) }}</small></button></div></div>
    <div v-else-if="feedbackOpen && selectedPoint && selected" class="globe-feedback" :style="feedbackStyle" role="status"><div class="globe-feedback-title"><span><strong>{{ name(selected) }}</strong><small>{{ status(selected) }}</small></span><button type="button" :aria-label="t('homeMapDemo.closeGlobeFeedback')" @click="feedbackOpen = false"><X :size="14" /></button></div></div>
    <p v-if="landFailed" class="coastline-error" role="alert">{{ t('homeMapDemo.coastlineFailed') }}</p>
  </div>
</template>

<style scoped>
.mobile-vector-globe { position: relative; width: 100%; height: 100%; isolation: isolate; }
.vector-globe-svg { width: 100%; height: 100%; touch-action: none; user-select: none; cursor: grab; }
.is-interacting .vector-globe-svg { cursor: grabbing; }
.globe-region-point { outline: none; cursor: pointer; }
.globe-region-point.dimmed { opacity: 0.22; }
.previewed .globe-point-ring { stroke-width: 1.5; animation: globe-breathe 1.5s ease-in-out infinite; }
.previewed .globe-node-core { stroke: #8debf0; filter: url(#globe-point-light); }
.globe-node-core { fill: #a8b5c4; stroke: #d8e0e9; stroke-width: 0.5; }
.available .globe-node-core { fill: #c4ffff; stroke: #00f2fe; filter: url(#globe-point-light); animation: globe-breathe 1.5s ease-in-out infinite; }
.globe-reset { position: absolute; right: 18px; bottom: 12px; display: grid; place-items: center; width: 44px; height: 44px; border: 1px solid #384555; border-radius: 50%; background: #142031; color: #d7e4ee; cursor: pointer; }
.globe-feedback { position: absolute; z-index: 25; width: 240px; overflow: hidden; color: #ecf2f8; background: #152030; border: 1px solid #446271; border-radius: 8px; box-shadow: 0 6px 18px #0006; }
.globe-feedback-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px 8px 14px; }
.globe-feedback-title > span { display: grid; gap: 4px; }
.globe-feedback-title strong { font-size: 12px; font-weight: 550; line-height: 1.6; }
.globe-feedback-title small { display: block; color: #b6c7d6; font-size: 11px; }
.globe-feedback-title > button { display: grid; place-items: center; width: 44px; height: 44px; flex-shrink: 0; color: #d7e3ee; background: none; border: 0; }
.globe-candidates { max-height: 132px; overflow-y: auto; overscroll-behavior: contain; touch-action: pan-y; border-top: 1px solid #354859; padding: 0 12px; }
.globe-candidates > button { display: grid; gap: 3px; width: 100%; min-height: 48px; padding: 8px 0; font-size: 12px; text-align: left; color: #eff5f8; border: 0; background: none; }
.globe-candidates small { color: #adbfce; font-size: 11px; }
.coastline-error { position: absolute; left: 18px; bottom: 12px; color: #d7e3ef; font-size: 12px; }
button:focus-visible,.globe-region-point:focus-visible { outline: 2px solid #8ae1e5; outline-offset: 3px; }
@keyframes globe-breathe { 0%,100% { opacity: 0.2; } 50% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { :global(html:not([data-home-demo-motion=full])) .globe-node-core { animation: none; } }
</style>
