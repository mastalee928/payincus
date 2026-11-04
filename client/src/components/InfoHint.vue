<script setup lang="ts">
import { computed, ref, useId } from 'vue'
defineProps<{ text: string }>()
const open = ref(false), hovered = ref(false), focused = ref(false), id = useId()
const dismissed = ref(false)
const visible = computed(() => !dismissed.value && (open.value || hovered.value || focused.value))
function toggle() {
  open.value = !open.value
  dismissed.value = !open.value
}
</script>

<template>
  <span class="info-hint" @mouseenter="hovered = true; dismissed = false" @mouseleave="hovered = false">
    <button
      type="button"
      :aria-label="text"
      :aria-describedby="visible ? id : undefined"
      :aria-expanded="visible"
      @click.stop="toggle"
      @focus="focused = true; dismissed = false"
      @blur="focused = false; open = false"
      @keydown.esc.stop="dismissed = true; open = false"
    >
      <svg aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10v1" /></svg>
    </button>
    <span v-if="visible" :id="id" role="tooltip" class="info-hint-content">{{ text }}</span>
  </span>
</template>

<style scoped>
.info-hint{position:relative;display:inline-flex;vertical-align:middle;font-weight:400}.info-hint button{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;color:var(--text-secondary);border-radius:4px}.info-hint svg{width:16px;height:16px;stroke-width:1.8}.info-hint button:focus-visible{outline:2px solid var(--text-primary);outline-offset:2px}.info-hint-content{position:absolute;bottom:calc(100% + 6px);left:0;z-index:60;width:240px;max-width:65vw;padding:10px 12px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-primary);color:var(--text-primary);font-size:13px;line-height:1.6;box-shadow:0 4px 16px #0002}@media(pointer:coarse){.info-hint button{width:44px;height:44px}}
</style>
