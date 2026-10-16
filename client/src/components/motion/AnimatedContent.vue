<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { gsap } from '@/lib/gsap'

const props = withDefaults(defineProps<{
  distance?: number
  direction?: 'vertical' | 'horizontal'
  duration?: number
  delay?: number
  replayKey?: string | number
}>(), {
  distance: 16,
  direction: 'vertical',
  duration: 0.4,
  delay: 0
})

const root = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | undefined
let media: ReturnType<typeof gsap.matchMedia> | undefined
let entered = false

function play() {
  const element = root.value
  if (!element) return
  media?.revert()
  media = gsap.matchMedia()
  media.add('(prefers-reduced-motion: no-preference)', () => {
    const axis = props.direction === 'horizontal' ? 'x' : 'y'
    gsap.fromTo(element, { [axis]: props.distance, opacity: 0 }, {
      [axis]: 0,
      opacity: 1,
      duration: props.duration,
      delay: props.delay,
      ease: 'power3.out',
      clearProps: 'transform,opacity'
    })
  })
}

onMounted(() => {
  if (!root.value) return
  if (!('IntersectionObserver' in window)) {
    entered = true
    play()
    return
  }
  observer = new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting)) return
    entered = true
    observer?.disconnect()
    play()
  }, { threshold: 0.05 })
  observer.observe(root.value)
})

watch(() => props.replayKey, () => {
  if (entered) play()
}, { flush: 'post' })

onBeforeUnmount(() => {
  observer?.disconnect()
  media?.revert()
})
</script>

<template>
  <div ref="root"><slot /></div>
</template>
