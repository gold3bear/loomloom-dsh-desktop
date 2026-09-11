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

test('requestBinary decodes a workbook download and sanitizes the suggested filename', async () => {
  const originalFetch = globalThis.fetch
  const workbook = Buffer.from('xlsx-bytes')
  globalThis.fetch = async () => new Response(workbook, {
    status: 200,
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': 'attachment; filename="../../escape.xlsx"',
    },
  })
  try {
    const payload = await new LoomApi(resolveLoomConfig()).requestBinary('/marketListings/listing-1/workbook')
    assert.equal(Buffer.from(payload.base64, 'base64').toString('utf8'), 'xlsx-bytes')
    assert.equal(payload.byteLength, workbook.byteLength)
    // Path separators never survive into the caller's target directory.
    assert.equal(payload.filename, '.._.._escape.xlsx')
  } finally { globalThis.fetch = originalFetch }
})

test('requestBinary omits the filename when the upstream sends no disposition header', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(Buffer.from('x'), { status: 200 })
  try {
    const payload = await new LoomApi(resolveLoomConfig()).requestBinary('/officialTemplates/official-1/workbook')
    assert.equal(payload.filename, undefined)
  } finally { globalThis.fetch = originalFetch }
})

test('requestBinary surfaces a failed workbook status without leaking the body', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('denied', { status: 403 })
  try {
    await assert.rejects(
      () => new LoomApi(resolveLoomConfig()).requestBinary('/marketListings/listing-1/workbook'),
      (error: unknown) => error instanceof LoomApiError && error.status === 403,
    )
  } finally { globalThis.fetch = originalFetch }
})

test('requestBinary rejects cross-origin-like paths before issuing a request', async () => {
  await assert.rejects(
    () => new LoomApi(resolveLoomConfig()).requestBinary('//example.com/steal'),
    /absolute and local/,
  )
})
