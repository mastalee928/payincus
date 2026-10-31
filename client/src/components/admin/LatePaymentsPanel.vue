<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'
import api from '@/api/admin'
import { useAuthStore } from '@/stores/auth'
import type { LatePayment } from './late-payment-types'
const props = defineProps<{ active: boolean }>()
const auth = useAuthStore(), records = ref<LatePayment[]>([]), total = ref(0), page = ref(1), status = ref('pending')
const loading = ref(false), busy = ref(false), error = ref(''), selected = ref<number | null>(null), note = ref('')
let generation = 0, disposed = false
const reasons: Record<string, string> = { timeout: '系统超时取消', user: '用户取消', provider: '支付平台取消',
  cancelled: '历史取消，来源未记录', failed: '订单已失败', refunded: '订单已退款', duplicate_trade: '交易号已用于其他订单',
  superseded_attempt: '来自旧支付链接', additional_payment: '订单完成后收到其他付款' }
const states: Record<string, string> = { pending: '待核对', credited: '已补款', resolved: '已记录结论' }
const identity = () => `${auth.user?.id}:${auth.token}`
async function load() {
  if (!props.active || disposed) return
  const run = ++generation, who = identity()
  loading.value = true; error.value = ''; selected.value = null; note.value = ''
  try {
    const result = await api.admin.getLatePayments({ page: page.value, status: status.value })
    if (run !== generation || who !== identity() || !props.active || disposed) return
    records.value = result.records; total.value = result.total
  } catch { if (run === generation && who === identity() && props.active && !disposed) error.value = '付款记录加载失败，请重试。' }
  finally { if (run === generation && !disposed) loading.value = false }
}
async function resolve(item: LatePayment, action: 'credit' | 'resolve') {
  if (busy.value || note.value.trim().length < 5 || !props.active || auth.user?.role !== 'admin') return
  const run = generation, who = identity(), conclusion = note.value.trim()
  busy.value = true; error.value = ''
  try {
    await api.admin.resolveLatePayment(item.id, action, conclusion)
    if (run === generation && who === identity() && props.active && !disposed) await load()
  } catch (err: any) {
    if (run === generation && who === identity() && props.active && !disposed) error.value = err?.response?.data?.error || '处理未确认，请刷新核对后重试。'
  } finally { busy.value = false }
}
watch([() => props.active, () => auth.token, page, status], () => {
  ++generation; selected.value = null; note.value = ''; records.value = []; error.value = ''; loading.value = false
  void load()
}, { immediate: true, flush: 'sync' })
onUnmounted(() => { disposed = true; ++generation })
const money = (value: number) => value.toFixed(2)
</script>

<template>
  <section class="late-payments card overflow-hidden" aria-labelledby="late-payment-heading" :aria-busy="loading || busy">
    <div class="flex flex-wrap items-start justify-between gap-4 border-b border-themed p-5">
      <div class="min-w-0">
        <h2 id="late-payment-heading" class="text-base font-semibold text-themed">迟到付款核对</h2>
        <p class="mt-1 text-sm text-themed-muted">系统超时取消后的有效付款自动补入余额；其他付款保留证据，核对后处理。</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <select v-model="status" aria-label="付款处理状态" class="input min-h-11 w-auto" :disabled="busy" @change="page = 1">
          <option value="pending">待核对</option><option value="credited">已补款</option><option value="resolved">已记录结论</option>
        </select>
        <button class="btn btn-ghost min-h-11" :disabled="loading || busy" @click="load">刷新</button>
      </div>
    </div>
    <p v-if="error" role="alert" class="px-5 py-3 text-sm text-red-600 dark:text-red-400">{{ error }}</p>
    <p v-if="loading" role="status" class="p-5 text-sm text-themed-muted">正在读取付款记录…</p>
    <p v-else-if="!records.length && !error" class="p-5 text-sm text-themed-muted">当前没有{{ states[status] }}的付款。</p>
    <div v-else class="divide-y divide-themed">
      <article v-for="item in records" :key="item.id" class="p-5" :data-payment-id="item.id">
        <div class="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div class="min-w-0 space-y-2">
            <div class="flex flex-wrap items-center gap-2 text-sm"><strong class="break-all text-themed">{{ item.username }}</strong><span class="text-themed-muted">{{ item.provider }} · {{ states[item.status] }}</span></div>
            <p class="break-all text-sm text-themed">订单 {{ item.orderNo }}</p>
            <p class="break-all text-xs text-themed-muted">交易号 {{ item.tradeNo }}</p>
            <p class="text-sm text-themed-muted">{{ reasons[item.reason] || item.reason }}</p>
            <p v-if="item.note" class="break-words text-sm text-themed-muted">处理结论：{{ item.note }}</p>
          </div>
          <div class="space-y-2 lg:text-right">
            <p class="text-sm text-themed-muted">平台报告 <span class="tabular-nums text-themed">{{ item.receivedAmount ?? '—' }} {{ item.currency || '' }}</span></p>
            <p class="text-sm text-themed-muted">订单入账金额 <strong class="tabular-nums text-themed">¥{{ money(item.creditAmount) }}</strong></p>
            <button v-if="item.status === 'pending' && auth.user?.role === 'admin'" class="btn btn-ghost min-h-11" :disabled="busy" @click="selected = item.id; note = ''; error = ''">核对处理</button>
          </div>
        </div>
        <form v-if="selected === item.id" class="mt-4 space-y-3 border-t border-themed pt-4" @submit.prevent="resolve(item, 'resolve')">
          <p class="text-sm text-themed-muted">补款前请核对平台交易、原订单和退款记录。保存结论不会调整余额。</p>
          <label class="block text-sm text-themed" :for="`late-note-${item.id}`">核对结论</label>
          <textarea :id="`late-note-${item.id}`" v-model="note" class="input w-full" rows="3" minlength="5" maxlength="500" required :disabled="busy" placeholder="填写到账或退款核对结果，至少5个字"></textarea>
          <div class="flex flex-wrap gap-2">
            <button v-if="item.canCredit" type="button" class="btn btn-primary min-h-11" :disabled="busy || note.trim().length < 5" @click="resolve(item, 'credit')">{{ busy ? '处理中…' : `确认补入 ¥${money(item.creditAmount)}` }}</button>
            <button type="submit" class="btn btn-ghost min-h-11" :disabled="busy || note.trim().length < 5">仅保存结论</button>
            <button type="button" class="btn btn-ghost min-h-11" :disabled="busy" @click="selected = null">取消</button>
          </div>
          <p v-if="!item.canCredit" class="text-sm text-themed-muted">这笔付款不能直接补款，请核对原支付链接、退款或重复入账记录后保存处理结论。</p>
        </form>
      </article>
    </div>
    <div v-if="total > 20" class="flex items-center justify-between gap-3 border-t border-themed p-5 text-sm">
      <button class="btn btn-ghost min-h-11" :disabled="page === 1 || loading || busy" @click="page--">上一页</button>
      <span class="tabular-nums text-themed-muted">{{ page }} / {{ Math.ceil(total / 20) }}</span>
      <button class="btn btn-ghost min-h-11" :disabled="page * 20 >= total || loading || busy" @click="page++">下一页</button>
    </div>
  </section>
</template>

<style scoped>
.late-payments { --late-bg: #fff; --late-ink: #171717; --late-muted: #626262; --late-border: #dedede; --late-control: #999;
  background: var(--late-bg) !important; color: var(--late-ink) !important; border: 1px solid var(--late-border) !important; box-shadow: none !important; }
.late-payments .text-themed { color: var(--late-ink) !important; }
.late-payments .text-themed-muted { color: var(--late-muted) !important; }
.late-payments .btn { box-shadow: none !important; background-image: none !important; transform: none !important; }
.late-payments .btn-primary { background: var(--late-ink) !important; color: var(--late-bg) !important; border: 1px solid var(--late-ink) !important; }
.late-payments .btn-ghost { color: var(--late-ink) !important; }
.late-payments .input { background: var(--late-bg) !important; color: var(--late-ink) !important; border: 1px solid var(--late-control) !important; }
.late-payments :is(button, select, textarea):focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
:global(.dark .late-payments) { --late-bg: #111; --late-ink: #f5f5f5; --late-muted: #b8b8b8; --late-border: #333; --late-control: #777; }
</style>
