const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { createRequire } = require('node:module')
const { modulePath, locales } = JSON.parse(readFileSync(0, 'utf8'))
const { createI18n } = createRequire(modulePath)('vue-i18n')

function leaves(value, prefix = '') {
  if (typeof value === 'string') return [prefix]
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, nested]) => leaves(nested, prefix ? `${prefix}.${key}` : key))
}
function resolve(value, key) {
  return key.split('.').reduce((v, part) => v?.[part], value)
}
const namespaces = ['telegramConfig', 'invites', 'admin.system.invitePricing', 'admin.paymentProviders', 'wallet.paymentMethods']
let count = 0
for (const [locale, messages] of Object.entries(locales)) {
  const errors = []
  const i18n = createI18n({ legacy: false, locale, fallbackLocale: false, messages: { [locale]: messages },
    warnHtmlMessage: false, missing: (_locale, key) => { errors.push(`missing ${key}`) },
    onWarn: warning => errors.push(warning)
  })
  for (const namespace of namespaces) {
    const expected = leaves(resolve(locales['zh-CN'], namespace), namespace)
    assert.deepEqual(leaves(resolve(messages, namespace), namespace).sort(), [...expected].sort(), `${locale}.${namespace}`)
    for (const key of expected) {
      const message = String(resolve(messages, key))
      const parameters = Object.fromEntries([...message.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map(m => [m[1], 'fixture']))
      assert.notEqual(i18n.global.t(key, parameters), key, `${locale}.${key}`)
      count++
    }
  }
  assert.equal(i18n.global.t('admin.paymentProviders.config.heleketMethodsPlaceholder'), 'USDT@TRON\nUSDT@BSC\nBTC\nETH')
  assert.deepEqual(errors, [], `${locale} messages must compile and resolve`)
}
console.log(`review locale runtime: ${count} messages compiled and resolved`)
