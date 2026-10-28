/**
 * Turnstile 工具函数
 * 从现行可见验证组件读取 token，并将焦点移至验证区域。
 */

interface TurnstileTokenReader {
  getToken?: () => string
}

export function readTurnstileToken(
  widget: TurnstileTokenReader | null | undefined,
  currentToken: string,
  root: ParentNode = document
): string {
  const widgetToken = widget?.getToken?.()?.trim()
  if (widgetToken) return widgetToken

  const stateToken = currentToken.trim()
  if (stateToken) return stateToken

  return root
    .querySelector<HTMLInputElement>('input[name="cf-turnstile-response"]')
    ?.value
    ?.trim() || ''
}

export function focusTurnstileSection(section: HTMLElement | null | undefined): void {
  if (!section) return

  section.scrollIntoView({ behavior: 'smooth', block: 'center' })
  window.setTimeout(() => {
    section.focus({ preventScroll: true })
  }, 250)
}
