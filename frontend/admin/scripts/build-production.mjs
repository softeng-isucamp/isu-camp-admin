import { spawnSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { build } from 'vite'
import { productionSettings, verifyProductionArtifacts } from './production-artifacts.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(import.meta.url)
const types = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-b'], { cwd: root, stdio: 'inherit' })
if (types.status !== 0) process.exit(types.status ?? 1)

// Ignore dotenv files and override inherited fixture/API settings at compile time.
await build({
  root,
  mode: 'production',
  envDir: false,
  define: {
    'import.meta.env.VITE_API_MODE': JSON.stringify(productionSettings.apiMode),
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify(productionSettings.apiBaseUrl),
    'import.meta.env.VITE_TEST_LOCAL_ADAPTER': JSON.stringify('false'),
    'import.meta.env.VITE_MAP_FIXTURE': JSON.stringify(productionSettings.mapFixture),
  },
})
const directory = join(root, 'dist')
await writeFile(join(directory, 'build-info.json'), JSON.stringify({
  ...productionSettings,
  sourceCommit: process.env.SOURCE_COMMIT ?? null,
}, null, 2) + '\n')
await verifyProductionArtifacts(directory)
console.log('Production artifact verified: real backend, same-origin /api, fixtures disabled.')
