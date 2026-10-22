import { copyFile, mkdir } from 'node:fs/promises'

const output = new URL('../dist/gateway-ui/', import.meta.url)
await mkdir(output, { recursive: true })
for (const name of ['index.html', 'console.css', 'console.js']) {
  await copyFile(new URL('../src/gateway-ui/' + name, import.meta.url), new URL(name, output))
}
