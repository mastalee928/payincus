import type { IncusClient } from './incus-client.js'

/** Bound all requests, including operation polling and recorded exec output.
 * The pooled connection itself is shared and must not be destroyed on timeout. */
export function ipv6BoundedClient(client: IncusClient, signal: AbortSignal): IncusClient {
  return Object.assign(Object.create(client), {
    request: (method: string, path: string, body: unknown = null, timeout = 20000, requestSignal?: AbortSignal) => {
      signal.throwIfAborted()
      const signals = [signal, AbortSignal.timeout(Math.min(timeout, 20000))]
      if (requestSignal) signals.push(requestSignal)
      return client.request(method, path, body, timeout, AbortSignal.any(signals))
    },
    readFile: (path: string) => {
      signal.throwIfAborted()
      return client.readFile(path, AbortSignal.any([signal, AbortSignal.timeout(8000)]))
    }
  }) as IncusClient
}

export function waitForIpv6Connection(connecting: Promise<IncusClient>, signal: AbortSignal): Promise<IncusClient> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    connecting.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}
