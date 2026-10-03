import { fileURLToPath } from 'node:url'
import { verifyProductionArtifacts } from './production-artifacts.mjs'

await verifyProductionArtifacts(fileURLToPath(new URL('../dist/', import.meta.url)))
console.log('Production artifact verification passed.')
