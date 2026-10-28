import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import zhCN from '../../client/src/locales/zh-CN.js'
import zhTW from '../../client/src/locales/zh-TW.js'
import en from '../../client/src/locales/en.js'

const clientRequire = createRequire(new URL('../../client/package.json', import.meta.url))
// Use a plain Node process: tsx intercepts this runtime's CommonJS dependencies.
execFileSync(process.execPath, [fileURLToPath(new URL('./fixtures/review-locale-runtime.cjs', import.meta.url))], {
  input: JSON.stringify({ modulePath: clientRequire.resolve('vue-i18n'), locales: { 'zh-CN': zhCN, 'zh-TW': zhTW, en } }),
  stdio: ['pipe', 'inherit', 'inherit']
})
const view = readFileSync(new URL('../../client/src/views/admin/TelegramConfigView.vue', import.meta.url), 'utf8')
assert.match(view, /<code class="[^"]*break-all[^"]*">\{\{ telegramWebhookUrl/, 'generated URL must wrap too')
