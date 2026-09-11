import assert from 'node:assert/strict'
import test, { afterEach } from 'node:test'
import {
  cancelBrowserLogin,
  LoomClientApiError,
  logout,
  readBootstrap,
  readBrowserLoginStatus,
  readAccount,
  readCredentialStatus,
  readRun,
  readRuns,
  readSkillbotsPage,
  readSkillbot,
  readSkillbots,
  readStorefront,
  quoteSkillbot,
  executeSkillbot,
  uploadInputAsset,
} from '../src/client/api.js'

const originalFetch = globalThis.fetch
const originalWindow = globalThis.window

afterEach(() => {
  globalThis.fetch = originalFetch
  Object.defineProperty(globalThis, 'window', { value: originalWindow, configurable: true, writable: true })
})

test('client maps market list variants without exposing credential source details', async () => {
  const urls: string[] = []
  globalThis.fetch = async input => {
    urls.push(String(input))
    if (String(input).endsWith('/credentials')) return new Response(JSON.stringify({ configured: true, source: 'authorization-grant', maskedToken: '····cret' }))
    return new Response(JSON.stringify({ data: { listings: [{ id: 'listing-1', displayName: 'Writer', executionAvailabilityStatus: 'AVAILABLE', taskFixedFee: { amount: '12.5' } }] } }))
  }
  assert.deepEqual(await readCredentialStatus(), { configured: true, maskedToken: '····cret' })
  assert.deepEqual(await readSkillbots(), [{ id: 'listing-1', name: 'Writer', description: '', available: true, fixedFee: '12.5' }])
  assert.deepEqual(urls, ['/api/loomloom/credentials', '/api/loomloom/market?pageSize=100'])
})

test('client reads a bounded market page and preserves its opaque next-page token', async () => {
  const urls: string[] = []
  globalThis.fetch = async input => {
    urls.push(String(input))
    return new Response(JSON.stringify({
      items: [{ id: 'listing-1', displayName: 'Writer', executionAvailabilityStatus: 'AVAILABLE' }],
      nextPageToken: 'opaque-next',
    }))
  }
  assert.deepEqual(await readSkillbotsPage({ pageSize: 30, pageToken: 'opaque-prev' }), {
    listings: [{ id: 'listing-1', name: 'Writer', description: '', available: true }],
    nextPageToken: 'opaque-next',
  })
  assert.equal(urls[0], '/api/loomloom/market?pageSize=30&pageToken=opaque-prev')
})

test('client maps a nested detail and public input schema only', async () => {
  Object.defineProperty(globalThis, 'window', { value: { location: { origin: 'http://127.0.0.1:4312' } }, configurable: true, writable: true })
  globalThis.fetch = async input => new Response(JSON.stringify({ data: { listing: {
    id: 'listing-1', name: 'Writer', executionAvailabilityStatus: 'available',
    inputSchemaSnapshot: JSON.stringify({ fields: [{ key: 'tone', title: 'Tone', isRequired: true, valueType: 'string', enumValues: ['formal', 'casual'] }] }),
  } } }))
  assert.deepEqual(await readSkillbot('listing-1'), {
    id: 'listing-1', name: 'Writer', description: '', available: true,
    fields: [{ key: 'tone', label: 'Tone', required: true, valueType: 'string', order: Number.MAX_SAFE_INTEGER, enumValues: ['formal', 'casual'] }],
  })
})

test('client rejects an invalid selected id before sending a request', async () => {
  let calls = 0
  globalThis.fetch = async () => { calls += 1; return new Response('{}') }
  await assert.rejects(() => readSkillbot('../not-a-listing'), (error: unknown) => error instanceof LoomClientApiError && error.status === 400)
  assert.equal(calls, 0)
})

test('client maps run history and validates run status lookups', async () => {
  Object.defineProperty(globalThis, 'window', { value: { location: { origin: 'http://127.0.0.1:4312' } }, configurable: true, writable: true })
  const urls: string[] = []
  globalThis.fetch = async input => {
    urls.push(String(input))
    if (String(input).includes('/runs/status')) return new Response(JSON.stringify({ run: { id: 'run-1', name: 'Writer', status: 'completed' } }))
    return new Response(JSON.stringify({ items: [{ id: 'run-1', displayName: 'Writer', status: 'queued', updated_at: '2026-09-08T00:00:00Z' }] }))
  }
  assert.deepEqual(await readRuns(), [{ id: 'run-1', displayName: 'Writer', status: 'queued', updatedAt: '2026-09-08T00:00:00Z' }])
  assert.deepEqual(await readRun('run-1'), { id: 'run-1', displayName: 'Writer', status: 'completed' })
  assert.deepEqual(urls, ['/api/loomloom/runs', 'http://127.0.0.1:4312/api/loomloom/runs/status?runId=run-1'])
  await assert.rejects(() => readRun('../invalid'), (error: unknown) => error instanceof LoomClientApiError && error.status === 400)
})

test('client logout uses the same-origin Host route and returns no credential data', async () => {
  const requests: RequestInit[] = []
  globalThis.fetch = async (_input, init) => {
    requests.push(init ?? {})
    return new Response(JSON.stringify({ configured: false }))
  }
  await logout()
  assert.deepEqual(requests, [{ method: 'POST', cache: 'no-store' }])
})

test('client normalizes bootstrap and login lifecycle responses', async () => {
  Object.defineProperty(globalThis, 'window', { value: { location: { origin: 'http://127.0.0.1:4312' } }, configurable: true, writable: true })
  const requests: string[] = []
  globalThis.fetch = async (input, init) => {
    requests.push(`${init?.method ?? 'GET'} ${String(input)}`)
    if (String(input).includes('/login/status')) {
      return new Response(JSON.stringify({ state: 'model-selection-required' }))
    }
    if (String(input).includes('/login/cancel')) return new Response(JSON.stringify({ cancelled: true }))
    return new Response(JSON.stringify({
      credential: { configured: true, source: 'must-not-cross' },
      loom: 'ready',
      router: 'ready',
      model: { provider: 'shengsuanyun', id: 'chat-1', ready: true },
    }))
  }
  const sessionId = 'c'.repeat(32)

  assert.deepEqual(await readBootstrap(), {
    credential: { configured: true },
    loom: 'ready',
    router: 'ready',
    model: { provider: 'shengsuanyun', id: 'chat-1', ready: true },
  })
  assert.deepEqual(await readBrowserLoginStatus(sessionId), { state: 'model-selection-required' })
  await cancelBrowserLogin(sessionId)
  assert.deepEqual(requests, [
    'GET /api/loomloom/bootstrap',
    `GET http://127.0.0.1:4312/api/loomloom/login/status?sessionId=${sessionId}`,
    `POST http://127.0.0.1:4312/api/loomloom/login/cancel?sessionId=${sessionId}`,
  ])
})

test('client normalizes account identity fields and discards unknown response data', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    configured: true,
    uid: ' user-1 ',
    displayName: ' Test User ',
    email: ' user@example.com ',
    photoUrl: ' https://cdn.example/avatar.png ',
    balance: ' 12.50 ',
    isCreator: true,
    token: 'must-not-cross',
    raw: { authorization: 'Bearer secret' },
  }))
  assert.deepEqual(await readAccount(), {
    configured: true,
    uid: 'user-1',
    displayName: 'Test User',
    email: 'user@example.com',
    photoUrl: 'https://cdn.example/avatar.png',
    balance: '12.50',
    isCreator: true,
  })
})

test('client sends quoted and confirmed SkillBot requests with same-origin routes', async () => {
  Object.defineProperty(globalThis, 'window', { value: { location: { origin: 'http://127.0.0.1:4312' } }, configurable: true, writable: true })
  const requests: Array<{ url: string, init: RequestInit }> = []
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init: init ?? {} })
    return new Response(JSON.stringify(
      String(input).includes('/quote')
        ? { quote: { estimatedBuyerPayable: { amount: '1.50', currency: 'CNY' } }, confirmationToken: 'quote-token-1' }
        : { runId: 'run-1', status: 'queued' },
    ))
  }
  const rows = [{ topic: 'Coffee' }]
  assert.deepEqual(await quoteSkillbot('listing-1', rows), {
    estimatedBuyerPayable: '1.50',
    confirmationToken: 'quote-token-1',
    currency: 'CNY',
  })
  assert.deepEqual(await executeSkillbot('listing-1', rows, 'quote-token-1'), { runId: 'run-1', status: 'queued' })
  assert.equal(requests.length, 2)
  assert.deepEqual(JSON.parse(String(requests[0]?.init.body)), { inputRows: rows })
  const executionBody = JSON.parse(String(requests[1]?.init.body)) as Record<string, unknown>
  assert.deepEqual(executionBody.inputRows, rows)
  assert.equal(executionBody.confirm, true)
  assert.equal(executionBody.confirmationToken, 'quote-token-1')
  assert.match(String(executionBody.clientRequestId), /^loomloom-ui-/u)
})

test('client reads the configured storefront, mapping its published input fields', async () => {
  Object.defineProperty(globalThis, 'window', { value: { location: { origin: 'http://127.0.0.1:4312' } }, configurable: true, writable: true })
  const urls: string[] = []
  globalThis.fetch = async input => {
    urls.push(String(input))
    return new Response(JSON.stringify({
      configured: true,
      source: urls.length === 1 ? 'creator' : 'something-else',
      entries: [
        {
          id: 'listing-1',
          name: 'Visual deck',
          description: 'One line to a deck.',
          available: true,
          fixedFee: '1.0000000',
          currency: 'CNY',
          version: 'v1',
          updatedAt: '2026-09-10T03:20:53Z',
          creatorNickname: 'Mat',
          inputSchemaSnapshot: JSON.stringify({ fields: [{ key: 'topic', title: 'Topic', order: 1, value_type: 'string' }] }),
        },
        { id: 'listing-2', name: 'Pinned one' },
        { name: 'without an id' },
      ],
      unavailable: ['gone-1', 7],
      fetchedAt: '2026-09-10T04:00:00Z',
      stale: true,
      error: 'listing-2 could not be read',
      source_detail: 'must-not-cross',
    }))
  }
  assert.deepEqual(await readStorefront(true), {
    configured: true,
    source: 'creator',
    entries: [
      {
        id: 'listing-1',
        name: 'Visual deck',
        description: 'One line to a deck.',
        available: true,
        fields: [{ key: 'topic', label: 'Topic', required: false, valueType: 'string', order: 1 }],
        fixedFee: '1.0000000',
        currency: 'CNY',
        version: 'v1',
        updatedAt: '2026-09-10T03:20:53Z',
        creatorNickname: 'Mat',
      },
      { id: 'listing-2', name: 'Pinned one', description: '', available: false, fields: [] },
    ],
    unavailable: ['gone-1'],
    fetchedAt: '2026-09-10T04:00:00Z',
    stale: true,
    error: 'listing-2 could not be read',
  })
  // An unknown source degrades to `none` rather than crossing the wire verbatim.
  assert.equal((await readStorefront()).source, 'none')
  assert.deepEqual(urls, [
    'http://127.0.0.1:4312/api/loomloom/storefront?refresh=1',
    'http://127.0.0.1:4312/api/loomloom/storefront',
  ])
})

test('client uploads a file input through the Host and keeps only its id', async () => {
  const requests: Array<{ url: string, init: RequestInit }> = []
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init: init ?? {} })
    return new Response(JSON.stringify({
      inputAssetId: 'asset-1',
      filename: 'deck.html',
      mimeType: 'text/html',
      sizeBytes: 2048,
      signedUrl: 'https://must-not-cross.example/deck.html',
    }))
  }
  assert.deepEqual(await uploadInputAsset('deck.html', 'text/html', 'PGh0bWw+'), {
    inputAssetId: 'asset-1',
    filename: 'deck.html',
    mimeType: 'text/html',
    sizeBytes: 2048,
  })
  assert.equal(requests[0]?.url, '/api/loomloom/inputAssets')
  assert.equal(requests[0]?.init.method, 'POST')
  assert.deepEqual(JSON.parse(String(requests[0]?.init.body)), {
    filename: 'deck.html',
    contentType: 'text/html',
    content: 'PGh0bWw+',
  })

  globalThis.fetch = async () => new Response(JSON.stringify({ filename: 'deck.html' }))
  await assert.rejects(
    () => uploadInputAsset('deck.html', 'text/html', 'PGh0bWw+'),
    (error: unknown) => error instanceof LoomClientApiError && error.status === 502,
  )
})
