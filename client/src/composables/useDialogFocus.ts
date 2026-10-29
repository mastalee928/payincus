import { nextTick, onBeforeUnmount, watch, type Ref } from 'vue'

/** Keep keyboard navigation in the active dialog and restore its opener. */
export function useDialogFocus(root: Ref<HTMLElement | null>, visible: () => boolean, close: () => void) {
  let opener: HTMLElement | null = null, generation = 0
  const controls = () => [...(root.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]') || [])]
    .filter(element => element.getClientRects().length && element.getAttribute('aria-hidden') !== 'true')
  const keydown = (event: KeyboardEvent) => {
    if (!visible() || !root.value) return
    if (event.key === 'Escape') { event.preventDefault(); close(); return }
    if (event.key !== 'Tab') return
    const elements = controls(), first = elements[0], last = elements.at(-1)
    if (!first) { event.preventDefault(); root.value.focus(); return }
    if (!root.value.contains(document.activeElement) || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
      event.preventDefault(); (event.shiftKey ? last : first)?.focus()
    }
  }
  const restore = () => { document.removeEventListener('keydown', keydown, true); if (opener?.isConnected) opener.focus(); opener = null }
  watch(visible, async show => {
    const current = ++generation
    if (!show) { restore(); return }
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    document.addEventListener('keydown', keydown, true)
    await nextTick()
    if (current === generation && visible()) (controls()[0] || root.value)?.focus()
  }, { flush: 'sync' })
  onBeforeUnmount(() => { generation++; restore() })
}
