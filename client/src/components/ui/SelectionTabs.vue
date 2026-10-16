<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{
  modelValue: string
  options: Array<{ value: string; label: string }>
  label: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const root = ref<HTMLElement | null>(null)
const line = ref({ x: 0, y: 0, width: 0 })
let resizeObserver: ResizeObserver | undefined

const indicatorStyle = computed(() => ({
  transform: 'translate(' + line.value.x + 'px, ' + line.value.y + 'px) scaleX(' + line.value.width + ')',
  opacity: line.value.width ? 1 : 0
}))

function measure() {
  const selected = root.value?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')
  line.value = selected
    ? { x: selected.offsetLeft, y: selected.offsetTop + selected.offsetHeight - 2, width: selected.offsetWidth }
    : { x: 0, y: 0, width: 0 }
}

watch([() => props.modelValue, () => props.options], measure, { flush: 'post' })
onMounted(() => {
  measure()
  if (root.value && 'ResizeObserver' in window) {
    resizeObserver = new ResizeObserver(measure)
    resizeObserver.observe(root.value)
  }
})
onBeforeUnmount(() => resizeObserver?.disconnect())
</script>

<template>
  <div ref="root" class="selection-tabs" role="group" :aria-label="label">
    <button
      v-for="option in options" :key="option.value" type="button"
      :aria-pressed="modelValue === option.value"
      @click="emit('update:modelValue', option.value)"
    >
      {{ option.label }}
    </button>
    <span class="selection-tabs-indicator" :style="indicatorStyle" aria-hidden="true"></span>
  </div>
</template>

<style scoped>
.selection-tabs { display: flex; flex-wrap: wrap; position: relative; gap: 0 22px; border-bottom: 1px solid var(--border-color); }
.selection-tabs button { position: relative; padding: 11px 1px 14px; color: var(--text-secondary); font-size: 13px; line-height: 1.5; white-space: nowrap; transition: color 150ms; }
.selection-tabs button:hover, .selection-tabs button[aria-pressed="true"] { color: var(--text-primary); }
.selection-tabs button[aria-pressed="true"] { font-weight: 600; }
.selection-tabs button:focus-visible { outline: 2px solid var(--text-secondary); outline-offset: 3px; border-radius: 3px; }
.selection-tabs-indicator { position: absolute; top: 0; left: 0; width: 1px; height: 2px; pointer-events: none; background: var(--text-primary); transform-origin: left center; transition: transform 180ms ease-out, opacity 100ms; }
@media (max-width: 540px) {
  .selection-tabs { column-gap: 17px; }
  .selection-tabs button { font-size: 12px; }
}
@media (prefers-reduced-motion: reduce) {
  .selection-tabs button, .selection-tabs-indicator { transition: none; }
}
</style>
