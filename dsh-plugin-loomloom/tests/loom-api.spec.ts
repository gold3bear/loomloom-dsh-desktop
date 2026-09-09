import assert from 'node:assert/strict'
import test from 'node:test'
import { createLoomTokenResolver } from '../src/credentials.js'
import { LoomApi, LoomApiError, resolveLoomConfig } from '../src/loom-api.js'

test('rejects non-HTTPS endpoint configuration', () => {
  assert.throws(() => resolveLoomConfig({ baseUrl: 'http://127.0.0.1:8090' }))
})

test('uses a credential reference without exposing its value in configuration', () => {
  const config = resolveLoomConfig({ tokenEnv: 'LOOMLOOM_TEST_TOKEN' })
  assert.equal(config.token, undefined)
  assert.equal(config.tokenRef, 'LOOMLOOM_TEST_TOKEN')
  assert.equal(config.baseUrl.origin, 'https://loomloom.shengsuanyun.com')
})

test('resolves the current DSH credential value per request', async () => {
  const resolved = resolveLoomConfig({ tokenRef: 'LOOMLOOM_TEST_TOKEN' })
  let value = 'first-secret'
  const context = {
    credentials: {
      async resolve() { return { value, source: 'file' } },
      async readRecord() { return undefined },
    },
  }
  const token = createLoomTokenResolver(context as never, resolved)
  assert.equal(await token(), 'first-secret')
  value = 'rotated-secret'
  assert.equal(await token(), 'rotated-secret')
})

test('falls back to the plugin-owned DSH grant record', async () => {
  const context = {
    credentials: {
      async resolve() { return undefined },
      async readRecord() { return { kind: 'grant' as const, payload: { token: 'stored-secret' } } },
    },
  }
  assert.equal(await createLoomTokenResolver(context as never, resolveLoomConfig())(), 'stored-secret')
})

test('rejects cross-origin-like API paths before issuing a request', async () => {
  const api = new LoomApi(resolveLoomConfig())
  await assert.rejects(() => api.request('//example.com/steal'), /absolute and local/)
})

test('maps upstream failures without leaking response internals', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'denied' }), { status: 401 })
  try {
    await assert.rejects(() => new LoomApi(resolveLoomConfig()).request('/users/me/runs'), (error: unknown) => error instanceof LoomApiError && error.status === 401 && error.message === 'denied')
  } finally { globalThis.fetch = originalFetch }
})
