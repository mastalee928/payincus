import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { createAgentBodyHash } from './agent-auth.js'

declare module 'fastify' {
  interface FastifyRequest {
    agentWireBodyHash: string | null
  }
}

/** Preserve the bytes signed by Go before JSON parsing changes numbers or escaping. */
export async function captureAgentBodyHash(
  request: FastifyRequest,
  _reply: FastifyReply,
  payload: NodeJS.ReadableStream
): Promise<Readable> {
  const chunks: Buffer[] = []
  const limit = request.routeOptions.bodyLimit
  let size = 0
  const hash = createHash('sha256')
  for await (const chunk of payload) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size > limit) {
      throw Object.assign(new Error('Agent report body is too large'), { statusCode: 413 })
    }
    chunks.push(bytes)
    hash.update(bytes)
  }
  request.agentWireBodyHash = hash.digest('hex')
  return Readable.from(Buffer.concat(chunks))
}

export function matchesAgentBodyHash(request: Pick<FastifyRequest, 'body' | 'agentWireBodyHash'>, expected: string): boolean {
  const hash = expected.toLowerCase()
  // Legacy clients hash the panel's normalized object instead of the wire bytes.
  // Both paths bind the signature to the received report; never trust the header alone.
  return request.agentWireBodyHash === hash || createAgentBodyHash(request.body ?? {}) === hash
}
