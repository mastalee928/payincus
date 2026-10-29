import { buildHostApiUrl, extractHostAddressFromUrl, normalizeHostAddress } from './validation'

/** URL.port omits standard HTTP(S) ports even when they were explicit. */
export function hostApiPort(url: string): number {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Unsupported host URL')
    return parsed.port ? Number(parsed.port) : parsed.protocol === 'http:' ? 80 : 443
  } catch { return 8443 }
}

/** Unrelated form edits must not change or revalidate the saved endpoint. */
export function editedHostEndpoint(original: string, address: string, port: number): string | undefined {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Invalid host API port')
  const normalized = normalizeHostAddress(address)
  if (normalized === extractHostAddressFromUrl(original) && port === hostApiPort(original)) return undefined
  if (!original) return buildHostApiUrl(normalized, port)
  const parsed = new URL(original)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Unsupported host URL')
  parsed.hostname = normalized.includes(':') ? `[${normalized}]` : normalized
  parsed.port = String(port)
  return parsed.href
}
