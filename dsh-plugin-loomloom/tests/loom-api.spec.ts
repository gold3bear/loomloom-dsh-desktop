import assert from 'node:assert/strict'
import test from 'node:test'
import { createLoomTokenResolver } from '../src/credentials.js'
import {
  envStorefrontListingIds,
  LoomApi,
  LoomApiError,
  normalizeStorefrontListingIds,
  resolveLoomConfig,
  STOREFRONT_IDS_ENV,
} from '../src/loom-api.js'

// Storefront assertions pass an explicit environment so an ambient override in
// the developer's shell cannot change what they mean.
const NO_ENV = {}

test('rejects non-HTTPS endpoint configuration', () => {
  assert.throws(() => resolveLoomConfig({ baseUrl: 'http://127.0.0.1:8090' }))
})

test('an absent storefront allow-list means no storefront, never the full market', () => {
  assert.deepEqual(resolveLoomConfig({}, NO_ENV).storefrontListingIds, [])
  assert.deepEqual(resolveLoomConfig({ storefrontListingIds: [] }, NO_ENV).storefrontListingIds, [])
})

test('storefront ids keep authoring order and drop repeats', () => {
  assert.deepEqual(
    resolveLoomConfig({ storefrontListingIds: ['listing-b', 'listing-a', 'listing-b'] }, NO_ENV).storefrontListingIds,
    ['listing-b', 'listing-a'],
  )
})

test('storefront ids are trimmed before they can reach a route path', () => {
  assert.deepEqual(normalizeStorefrontListingIds(['  listing-a  ']), ['listing-a'])
})

test('a malformed storefront id fails at composition time instead of at first render', () => {
  for (const bad of ['', '   ', '../../credential', 'a/b', 'x'.repeat(201)]) {
    assert.throws(() => resolveLoomConfig({ storefrontListingIds: [bad] }, NO_ENV), /storefrontListingIds/u)
  }
  assert.throws(() => normalizeStorefrontListingIds('listing-a' as never), /must be an array/u)
})

test('the environment override repoints the storefront without rebuilding', () => {
  const env = { [STOREFRONT_IDS_ENV]: 'listing-a, listing-b' }
  assert.deepEqual(
    resolveLoomConfig({ storefrontListingIds: ['pinned'] }, env).storefrontListingIds,
    ['listing-a', 'listing-b'],
  )
  assert.deepEqual(resolveLoomConfig({}, env).storefrontListingIds, ['listing-a', 'listing-b'])
})

test('a trailing comma or stray spaces in the override are not an error', () => {
  assert.deepEqual(envStorefrontListingIds({ [STOREFRONT_IDS_ENV]: ' a ,, b ,' }), ['a', 'b'])
})

test('an unset or blank override keeps the build pinned instead of blanking the storefront', () => {
  assert.equal(envStorefrontListingIds(NO_ENV), undefined)
  assert.equal(envStorefrontListingIds({ [STOREFRONT_IDS_ENV]: '' }), undefined)
  assert.equal(envStorefrontListingIds({ [STOREFRONT_IDS_ENV]: ' , , ' }), undefined)
  assert.deepEqual(
    resolveLoomConfig({ storefrontListingIds: ['pinned'] }, { [STOREFRONT_IDS_ENV]: '   ' }).storefrontListingIds,
    ['pinned'],
  )
})

test('a malformed id in the override fails just as loudly as one in the config', () => {
  assert.throws(
    () => resolveLoomConfig({}, { [STOREFRONT_IDS_ENV]: 'listing-a,../../credential' }),
    /storefrontListingIds/u,
  )
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

test('requestBinary decodes encoded filenames and removes header-control characters', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(Buffer.from('xlsx-bytes'), {
    status: 200,
    headers: {
      'content-disposition': "attachment; filename*=UTF-8''report%0D%0ASet-Cookie%3Aevil.xlsx",
    },
  })
  try {
    const payload = await new LoomApi(resolveLoomConfig()).requestBinary('/marketListings/listing-1/workbook')
    assert.equal(payload.filename, 'report__Set-Cookie_evil.xlsx')
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

test('requestBinary rejects an oversized declared response before buffering it', async () => {
  const originalFetch = globalThis.fetch
  let readAttempted = false
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-length': String(16 * 1024 * 1024 + 1) }),
    get body() {
      readAttempted = true
      throw new Error('oversized body must not be read')
    },
  }) as never
  try {
    await assert.rejects(
      () => new LoomApi(resolveLoomConfig()).requestBinary('/marketListings/listing-1/workbook'),
      (error: unknown) => error instanceof LoomApiError && error.status === 502 && error.message === 'loomloom workbook response exceeded size limit',
    )
    assert.equal(readAttempted, false)
  } finally { globalThis.fetch = originalFetch }
})

test('requestBinary rejects cross-origin-like paths before issuing a request', async () => {
  await assert.rejects(
    () => new LoomApi(resolveLoomConfig()).requestBinary('//example.com/steal'),
    /absolute and local/,
  )
})
