/**
 * 前端计费计算工具函数
 * 与后端 billing-calc.ts 保持一致
 */

// 周期天数常量（统一定义：1个月 = 31 天）
const CYCLE_DAYS: Record<number, number> = {
  1: 31,      // 月付
  3: 93,      // 季付
  6: 186,     // 半年付
  12: 372     // 年付
}

/**
 * 获取周期天数
 */
function getCycleDays(billingCycle: number): number {
  return CYCLE_DAYS[billingCycle] || (billingCycle * 31)
}

/**
 * 计算日价
 */
export function calculateDailyPrice(price: number, billingCycle: number): number {
  const cycleDays = getCycleDays(billingCycle)
  return price / cycleDays
}

/**
 * 计算折扣后价格
 */
export function calculateDiscountedPrice(originalPrice: number, discountRate: number): number {
  return Number((originalPrice * (1 - discountRate)).toFixed(2))
}
