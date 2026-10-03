import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const productionSettings = Object.freeze({
  apiMode: 'real', apiBaseUrl: '', localAdapter: false, mapFixture: 'none',
})

export async function verifyProductionArtifacts(directory) {
  const info = JSON.parse(await readFile(join(directory, 'build-info.json'), 'utf8'))
  if (Object.entries(productionSettings).some(([key, value]) => info[key] !== value)) {
    throw new Error('Invalid production settings in build-info.json')
  }
  await readFile(join(directory, 'index.html'))
  let javascriptCount = 0
  async function inspect(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const file = join(path, entry.name)
      if (entry.isDirectory()) await inspect(file)
      else if (entry.name.endsWith('.js')) {
        javascriptCount++
        if (/generated[-_]?map[-_]?fixture/i.test(entry.name)) {
          throw new Error(`Production artifact contains a map fixture: ${file}`)
        }
        const javascript = await readFile(file, 'utf8')
        for (const match of javascript.matchAll(/https?:\/\/(?:\[[0-9a-f:.]+\]|[a-z0-9._-]+)(?::\d+)?(?:\/[^\s"'`\\<>]*)?/gi)) {
          // React Router embeds this bare parsing base; it is not an API URL.
          if (match[0] === 'http://localhost') continue
          let hostname
          try { hostname = new URL(match[0]).hostname.toLowerCase().replace(/\.$/, '') }
          catch { continue }
          if (hostname === 'localhost' || hostname === '0.0.0.0' || hostname === '[::1]'
            || hostname.startsWith('127.') || hostname.startsWith('[::ffff:7f')) {
            throw new Error(`Production artifact contains a loopback URL: ${file}`)
          }
        }
      }
    }
  }
  await inspect(join(directory, 'assets'))
  if (!javascriptCount) throw new Error('Production artifact has no JavaScript assets')
}
