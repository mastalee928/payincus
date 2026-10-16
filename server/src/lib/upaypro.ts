import { createHash, timingSafeEqual } from 'node:crypto'
import { safeFetch } from './outbound-security.js'

// UPAY Pro a232783: web/function.go and cron/cron.go.
export const UPAY_PRO_PAYMENT_TYPES = [
  'USDT-TRC20', 'TRX', 'USDT-Polygon', 'USDT-BSC', 'USDT-ERC20',
  'USDT-ArbitrumOne', 'USDC-ERC20', 'USDC-Polygon', 'USDC-BSC', 'USDC-ArbitrumOne'
] as const

export type UpayProPaymentType = typeof UPAY_PRO_PAYMENT_TYPES[number]

export interface UpayProConfig {
  apiurl: string
  secret_key: string
  payment_type: UpayProPaymentType
}

export interface UpayProCreateOrderInput {
  order_id: string
  amount: number
  notify_url: string
  redirect_url: string
}

export interface UpayProOrder {
  orderId: string
  tradeId: string
  amount: number
  actualAmount: number
  address: string
  expiresAt: number
  payUrl: string
}

export interface UpayProNotification {
  order_id: string
  trade_id: string
  amount: number
  actual_amount: number
  token: string
  block_transaction_id: string
  status: 1 | 2 | 3
  signature: string
}

export function buildUpayProConfig(value: Record<string, unknown>): {
  config: UpayProConfig
  valid: boolean
  error?: string
} {
  const config: UpayProConfig = {
    apiurl: typeof value.apiurl === 'string' ? value.apiurl.trim() : '',
    secret_key: typeof value.secret_key === 'string' ? value.secret_key.trim() : '',
    payment_type: value.payment_type as UpayProPaymentType
  }
  if (!config.secret_key || !UPAY_PRO_PAYMENT_TYPES.includes(config.payment_type)) {
    return { config, valid: false, error: '请选择 UPAY 支付名称并填写 UPAY 密钥' }
  }
  try {
    const url = new URL(config.apiurl)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new Error('invalid URL')
    }
    config.apiurl = url.origin
  } catch {
    return { config, valid: false, error: 'UPAY 接口地址必须是 HTTPS 服务域名，无需填写 /api/create_order' }
  }
  return { config, valid: true }
}

/** Go fmt.Sprintf("%g", float64): shortest digits, scientific notation outside [1e-4, 1e6). */
export function formatUpayProNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error('UPAY 数值无效')
  const [digits, exponentString] = value.toExponential().split('e')
  const exponent = Number(exponentString)
  if (exponent >= -4 && exponent < 6) return String(value)
  return `${digits}e${exponent < 0 ? '-' : '+'}${String(Math.abs(exponent)).padStart(2, '0')}`
}

export function upayProMoneyToCents(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 99_999_999.99) return null
  if (Number(value.toFixed(2)) !== value) return null
  return Math.round(value * 100)
}

function signFields(fields: Record<string, string | number>, secret: string): string {
  const content = Object.keys(fields).sort().map(key => {
    const value = fields[key]
    return `${key}=${typeof value === 'number' ? formatUpayProNumber(value) : value}`
  }).join('&')
  // The upstream implementation appends the key directly, without an extra '&'.
  return createHash('md5').update(content + secret, 'utf8').digest('hex')
}

export function signUpayProOrder(input: UpayProCreateOrderInput, config: UpayProConfig): string {
  return signFields({
    amount: input.amount,
    notify_url: input.notify_url,
    order_id: input.order_id,
    redirect_url: input.redirect_url,
    type: config.payment_type
  }, config.secret_key)
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
}

function isPositiveAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER
}

export function verifyUpayProNotification(
  payload: Record<string, unknown>,
  secret: string
): UpayProNotification | null {
  if (
    !secret || !isIdentifier(payload.order_id) || !isIdentifier(payload.trade_id) ||
    upayProMoneyToCents(payload.amount) === null || !isPositiveAmount(payload.actual_amount) ||
    !isIdentifier(payload.token) || !isIdentifier(payload.block_transaction_id) ||
    (payload.status !== 1 && payload.status !== 2 && payload.status !== 3) ||
    typeof payload.signature !== 'string' || !/^[a-f0-9]{32}$/.test(payload.signature)
  ) return null

  const notification = payload as unknown as UpayProNotification
  const expected = signFields({
    actual_amount: notification.actual_amount,
    amount: notification.amount,
    block_transaction_id: notification.block_transaction_id,
    order_id: notification.order_id,
    status: notification.status,
    token: notification.token,
    trade_id: notification.trade_id
  }, secret)
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(notification.signature, 'hex'))
    ? notification
    : null
}

export class UpayProClient {
  constructor(private readonly config: UpayProConfig) {}

  async createOrder(input: UpayProCreateOrderInput): Promise<UpayProOrder> {
    if (!isIdentifier(input.order_id) || upayProMoneyToCents(input.amount) === null) {
      throw new Error('UPAY 订单号或金额无效')
    }
    const response = await safeFetch(`${this.config.apiurl}/api/create_order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ ...input, type: this.config.payment_type, signature: signUpayProOrder(input, this.config) }),
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000)
    }, 'UPAY Pro API URL')
    if (!response.ok) throw new Error(`UPAY Pro 创建订单失败（HTTP ${response.status}）`)

    const body = await response.json() as { status_code?: unknown; data?: Record<string, unknown> } | null
    const data = body?.data
    if (body?.status_code !== 200 || !data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('UPAY Pro 创建订单失败，请检查收款钱包配置')
    }
    if (
      data.order_id !== input.order_id || !isIdentifier(data.trade_id) ||
      upayProMoneyToCents(data.amount) !== upayProMoneyToCents(input.amount) ||
      !isPositiveAmount(data.actual_amount) || !isIdentifier(data.token)
    ) throw new Error('UPAY Pro 返回的订单信息不匹配')

    // The deployed Go code returns Unix milliseconds; older documentation shows seconds.
    const expiration = data.expiration_time
    const expiresAt = typeof expiration === 'number' && Number.isSafeInteger(expiration)
      ? (expiration < 1_000_000_000_000 ? expiration * 1000 : expiration)
      : NaN
    if (!Number.isFinite(new Date(expiresAt).getTime()) || expiresAt <= Date.now()) {
      throw new Error('UPAY Pro 返回的订单有效期无效')
    }
    let payUrl: URL
    try {
      const gatewayPayUrl = new URL(String(data.payment_url))
      const apiUrl = new URL(this.config.apiurl)
      const checkoutPath = `/pay/checkout-counter/${data.trade_id}`
      if (
        apiUrl.protocol !== 'https:' || !['http:', 'https:'].includes(gatewayPayUrl.protocol) ||
        gatewayPayUrl.username || gatewayPayUrl.password || gatewayPayUrl.search || gatewayPayUrl.hash ||
        gatewayPayUrl.pathname !== checkoutPath
      ) throw new Error('invalid URL')
      // UPAY builds payment_url from AppUrl, which may be an internal HTTP backend.
      // Keep checkout on the configured, validated HTTPS origin; never follow AppUrl.
      payUrl = new URL(checkoutPath, apiUrl.origin)
    } catch {
      throw new Error('UPAY Pro 返回的收银台地址或订单路径无效')
    }
    return {
      orderId: input.order_id,
      tradeId: data.trade_id,
      amount: input.amount,
      actualAmount: data.actual_amount,
      address: data.token,
      expiresAt,
      payUrl: payUrl.toString()
    }
  }
}
