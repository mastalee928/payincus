import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { createServer } = await import(pathToFileURL(resolve(repoRoot, 'client/node_modules/vite/dist/node/index.js')).href)
const server = await createServer({ configFile: resolve(repoRoot, 'client/demo/homepage/vite.config.mjs') })
await server.listen()
server.printUrls()
