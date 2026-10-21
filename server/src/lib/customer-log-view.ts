import { isIP } from 'node:net'

/** Customer logs retain operation results without exposing management endpoints or utility errors. */
export function customerLogContent(content: string): string {
  return content
    .replace(/(?:无法连接到\s*Incus|Cannot connect to Incus|Incus:\s*connect|connect\s+E(?:HOSTUNREACH|CONNREFUSED|TIMEDOUT|NETUNREACH))[^\r\n]*/gi, '连接失败，请稍后重试或联系支持。')
    .replace(/(?:https?:\/\/)?\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3}|\*)(?::\d{1,5})?/g, (value, a: string, b: string, c: string, d: string) => {
      if (d !== '*' && isIP(`${a}.${b}.${c}.${d}`) !== 4) return value
      const first = Number(a), second = Number(b)
      const privateAddress = first === 0 || first === 10 || first === 127 || (first === 169 && second === 254) ||
        (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168) || (first === 100 && second >= 64 && second <= 127)
      return privateAddress ? '[地址已隐藏]' : value
    })
    .replace(/(?:https?:\/\/)?\[?(?:f[cd][0-9a-f]{2}|fe[89ab][0-9a-f]):[0-9a-f:]+\]?(?::\d{1,5})?/gi, '[地址已隐藏]')
    .replace(/(?<![0-9a-f:])(?:https?:\/\/)?\[?::1\]?(?::\d{1,5})?(?![0-9a-f:])/gi, '[地址已隐藏]')
    .replace(/(?:https?:\/\/)?localhost(?::\d{1,5})?/gi, '[地址已隐藏]')
}
