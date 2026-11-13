import { cacheSystemImage } from '../src/services/system-image-cache.js'
for (const architecture of ['x86_64', 'aarch64']) {
  const image = await cacheSystemImage('images:debian/11/cloud' + (architecture === 'aarch64' ? '/arm64' : ''), architecture, 'container')
  console.log(`Prepared persistent Debian 11 ${architecture}: ${image.fingerprint}`)
}
