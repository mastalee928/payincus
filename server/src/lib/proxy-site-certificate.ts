import { checkServerIdentity, type TLSSocket } from 'node:tls'

export interface ProxySiteCertificateResult {
  status: 'valid' | 'error'
  error?: string
  hint?: string
  certificate: {
    valid: boolean
    issuer: string
    subject: string
    validFrom: string
    validTo: string
    daysRemaining: number
  }
  checks: { validity: boolean; hostname: boolean; tlsAuthorization: boolean }
}

/** Diagnostic TLS connections may read untrusted certificates, but cannot pass
 * validation until date, hostname and the TLS authorization result all pass.
 */
export function inspectProxySiteCertificate(
  socket: Pick<TLSSocket, 'getPeerCertificate' | 'authorized' | 'authorizationError'>,
  domain: string,
  now = Date.now()
): ProxySiteCertificateResult {
  const cert = socket.getPeerCertificate()
  if (!cert?.subject) throw new Error('无法获取证书信息')
  const start = Date.parse(cert.valid_from), end = Date.parse(cert.valid_to)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || !Number.isFinite(now)) {
    throw new Error('证书有效期字段无效')
  }
  const validity = now >= start && now <= end
  // Always check the requested domain, even when an earlier chain failure kept
  // Node from reaching its automatic hostname check.
  const hostnameError = checkServerIdentity(domain, cert)
  const hostname = !hostnameError
  const tlsAuthorization = socket.authorized === true
  const valid = validity && hostname && tlsAuthorization
  const errors: string[] = []
  const hints: string[] = []
  if (!validity) {
    errors.push(now < start ? 'CERT_NOT_YET_VALID' : 'CERT_HAS_EXPIRED')
    hints.push(now < start ? '证书尚未生效，请检查证书有效期和服务器时间' : '证书已过期，请检查 Caddy 证书续签')
  }
  if (!hostname) {
    errors.push('ERR_TLS_CERT_ALTNAME_INVALID')
    hints.push('证书域名不匹配，请检查该域名的 DNS 指向和 Caddy 站点配置')
  }
  if (!tlsAuthorization) {
    const error = String(socket.authorizationError || 'TLS_CERTIFICATE_NOT_AUTHORIZED')
    if (!errors.includes(error)) {
      errors.push(error)
      hints.push('证书信任校验未通过，请检查证书签发机构和完整证书链')
    }
  }
  return {
    status: valid ? 'valid' : 'error',
    ...(valid ? {} : { error: errors.join('; '), hint: hints.join('；') }),
    certificate: {
      valid,
      issuer: [cert.issuer?.O, cert.issuer?.CN].filter(Boolean).join(' - ') || 'Unknown',
      subject: cert.subject.CN || domain,
      validFrom: new Date(start).toISOString(),
      validTo: new Date(end).toISOString(),
      daysRemaining: Math.floor((end - now) / 86_400_000)
    },
    checks: { validity, hostname, tlsAuthorization }
  }
}
