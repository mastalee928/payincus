import assert from 'node:assert/strict'
import { legacyIpv6SlaacSelector, dedicatedIpv6GuestScript } from '../src/lib/incus/dedicated-ipv6.js'
import { execFileSync } from 'node:child_process'
const prefix='fdc8:49fb:f71f:5fcb', old=prefix+':1266:6aff:fe18:11b5'
const awk=process.env.REVIEW_AWK || (process.platform==='win32' ? 'C:/Program Files/Git/usr/bin/awk.exe' : 'awk')
const lines=[
  `5: eth0 inet6 ${old}/64 scope global mngtmpaddr noprefixroute`,
  `5: eth0 inet6 ${prefix}::2/64 scope global nodad`,
  `5: eth0 inet6 ${prefix}::3/64 scope global nodad`,
  '5: eth0 inet6 fd99::123/64 scope global mngtmpaddr'
]
const select=(input:string)=>execFileSync(awk,['-v','primary='+prefix+'::2','-v','suffix=1266:6aff:fe18:11b5',legacyIpv6SlaacSelector],
 {input,encoding:'utf8',windowsHide:true}).trim()
assert.equal(select(lines.join('\n')),old)
assert.equal(select(lines.join('\n').replace('mngtmpaddr noprefixroute','nodad')),'','static EUI address must stay')
assert.ok(dedicatedIpv6GuestScript.includes('! grep -Fxq "$legacy" "$directory/addresses"'))
console.log('IPv6 legacy selector passed on actual awk: only same-prefix MAC-derived SLAAC, mappings/static/other-prefix addresses preserved')
