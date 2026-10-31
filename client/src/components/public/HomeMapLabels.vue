<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { layoutMapLabels, type MapLabelPlacement, type MapLabelPoint } from '@/utils/homeMapLabels'

const props = defineProps<{
  frame?: HTMLElement
  mapGroup?: SVGGElement
  points: MapLabelPoint[]
  viewTransform: string
  hoverSlug: string
}>()
const emit = defineEmits<{ select: [id: string] }>()
const labels = ref<MapLabelPlacement[]>([])
let frameId = 0, animateUntil = 0, disposed = false
let resize: ResizeObserver | undefined
const widths = new Map<string, number>()
let context: CanvasRenderingContext2D | null = null
let previous = new Map<string, number>()
function measure(text: string) {
  if (!context) context = document.createElement('canvas').getContext('2d')
  if (context) context.font = '500 13px "Inter Variable", Inter, "Microsoft YaHei", sans-serif'
  let width = widths.get(text)
  if (width === undefined) { width = context?.measureText(text).width ?? text.length * 13; widths.set(text, width) }
  return width
}
function render() {
  frameId = 0
  if (disposed || !props.frame || !props.mapGroup) { labels.value = []; return }
  // Sample the actual animated transform once so text stays attached during CSS transitions.
  const matrix = props.mapGroup.getScreenCTM(), frame = props.frame.getBoundingClientRect()
  if (!matrix || !frame.width) return
  const points = props.points.map(point => {
    const p = new DOMPoint(point.x, point.y).matrixTransform(matrix)
    return { ...point, x: p.x - frame.x, y: p.y - frame.y, radius: Math.max(7, 5 * Math.hypot(matrix.a, matrix.b)) }
  })
  const obstacles = [...props.frame.querySelectorAll('.map-tooltip, .map-controls, .atlas-legend, .map-selection')].map(element => {
    const r = element.getBoundingClientRect()
    return { x: r.x - frame.x, y: r.y - frame.y, width: r.width, height: r.height }
  })
  labels.value = layoutMapLabels(points, frame.width, frame.height, measure, obstacles, previous)
  for (const label of labels.value) previous.set(label.id, label.slot)
  if (performance.now() < animateUntil) frameId = requestAnimationFrame(render)
}
function schedule(animated = false) {
  if (disposed) return
  if (animated) animateUntil = performance.now() + 800
  if (!frameId) frameId = requestAnimationFrame(render)
}
watch(() => props.viewTransform, () => schedule(true), { flush: 'post' })
watch([() => props.points, () => props.hoverSlug], () => schedule(true), { flush: 'post' })
watch([() => props.frame, () => props.mapGroup], () => {
  resize?.disconnect()
  if (props.frame) {
    resize = new ResizeObserver(() => schedule(true))
    resize.observe(props.frame)
  }
  schedule(true)
}, { immediate: true, flush: 'post' })
if (typeof document !== 'undefined') void document.fonts.ready.then(() => { widths.clear(); schedule() })
onBeforeUnmount(() => { disposed = true; cancelAnimationFrame(frameId); resize?.disconnect() })
</script>

<template>
  <div class="map-label-layer">
    <svg class="map-label-leaders" aria-hidden="true">
      <line
        v-for="label in labels" :key="label.id" :x1="label.nodeX" :y1="label.nodeY"
        :x2="Math.max(label.x, Math.min(label.x + label.width, label.nodeX))"
        :y2="Math.max(label.y + 3, Math.min(label.y + label.height - 3, label.nodeY))"
      />
    </svg>
    <button
      v-for="label in labels" :key="label.id" class="map-region-label" :class="{ 'is-selected': label.selected }"
      :data-region="label.id" :style="{ transform: `translate(${label.x}px, ${label.y}px)`, width: `${label.width}px` }"
      type="button" :aria-pressed="label.selected" @click="emit('select', label.id)"
    >
      {{ label.text }}
    </button>
  </div>
</template>

<style scoped>
.map-label-layer { position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: 12; }
.map-label-leaders { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.map-label-leaders line { stroke: var(--home-map-leader, #69788b); stroke-width: .75; opacity: .65; }
.map-region-label { position: absolute; top: 0; left: 0; padding: 0; border: 0; background: transparent; text-align: left; white-space: nowrap; color: var(--home-map-label, #d1d8e3); font: 500 13px/20px 'Inter Variable',Inter,'Microsoft YaHei',sans-serif; pointer-events: auto; cursor: pointer; }
.map-region-label.is-selected { color: var(--home-map-active, #8ce6eb); }
.map-region-label:hover { color: var(--home-map-active, #8ce6eb); }
.map-region-label:focus-visible { outline: 2px solid var(--home-map-active, #8ce6eb); outline-offset: 3px; }
</style>
