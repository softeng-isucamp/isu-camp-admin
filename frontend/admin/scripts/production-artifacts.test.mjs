import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyProductionArtifacts } from './production-artifacts.mjs'

async function artifact(t, javascript = 'fetch("/api/me")', overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'admin-artifact-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await mkdir(join(directory, 'assets'))
  await writeFile(join(directory, 'index.html'), '<script src="/assets/app.js"></script>')
  await writeFile(join(directory, 'assets/app.js'), javascript)
  await writeFile(join(directory, 'build-info.json'), JSON.stringify({
    apiMode: 'real', apiBaseUrl: '', localAdapter: false, mapFixture: 'none', ...overrides,
  }))
  return directory
}

test('accepts a same-origin production artifact', async t => {
  await verifyProductionArtifacts(await artifact(t))
})

for (const url of [
  'http://localhost:5000', 'http://localhost/api', 'http://localhost.:5000/api',
  'http://127.0.0.1:5000', 'http://127.1:5000/api', 'http://2130706433/api',
  'https://[::1]/api', 'http://[0:0:0:0:0:0:0:1]:5000/api',
  'http://[::ffff:127.0.0.1]:5000/api', 'http://0.0.0.0:5000',
]) {
  test(`rejects an artifact containing ${url}`, async t => {
    await assert.rejects(verifyProductionArtifacts(await artifact(t, `fetch("${url}/api/me")`)), /loopback/i)
  })
}

test('allows the bare localhost parsing base bundled by React Router', async t => {
  await verifyProductionArtifacts(await artifact(t, 'new URL("/login", "http://localhost")'))
})

for (const overrides of [{ apiMode: 'local' }, { apiBaseUrl: 'https://other.example' }, { localAdapter: true }, { mapFixture: 'osm' }]) {
  test(`rejects incorrect production settings ${JSON.stringify(overrides)}`, async t => {
    await assert.rejects(verifyProductionArtifacts(await artifact(t, undefined, overrides)), /settings/i)
  })
}

test('rejects a fixture chunk even when metadata claims real mode', async t => {
  const directory = await artifact(t)
  await writeFile(join(directory, 'assets/generatedMapFixture-deadbeef.js'), '{}')
  await assert.rejects(verifyProductionArtifacts(directory), /fixture/i)
})

test('rejects an incomplete build without JavaScript assets', async t => {
  const directory = await artifact(t)
  await rm(join(directory, 'assets/app.js'))
  await assert.rejects(verifyProductionArtifacts(directory), /JavaScript/i)
})

test('rejects an artifact with no build metadata', async t => {
  const directory = await artifact(t)
  await rm(join(directory, 'build-info.json'))
  await assert.rejects(verifyProductionArtifacts(directory))
})
