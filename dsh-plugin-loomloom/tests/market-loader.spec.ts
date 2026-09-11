import assert from 'node:assert/strict'
import test, { afterEach } from 'node:test'
import type { LoomStorefront } from '../src/client/api.js'
import { defaultMarketSource, loadMarket, type MarketSource } from '../src/client/market-loader.js'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  delete (globalThis as { window?: unknown }).window
})

function storefront(overrides: Partial<LoomStorefront> = {}): LoomStorefront {
  return {
    configured: true,
    entries: [{
      id: 'listing-1',
      name: '视觉演示生成器',
      description: '一句话主题 → 可编辑 HTML 演示文稿。',
      available: true,
      fields: [],
      version: 'v1',
      updatedAt: '2026-09-10T03:20:53Z',
      fixedFee: '1.0000000',
      currency: 'CNY',
    }],
    unavailable: [],
    fetchedAt: '2026-09-10T04:00:00Z',
    stale: false,
    ...overrides,
  }
}

function recorder(result: LoomStorefront | Error): { readonly source: MarketSource, readonly calls: { refresh: boolean }[] } {
  const calls: { refresh: boolean }[] = []
  const source: MarketSource = {
    async readStorefront(refresh = false) {
      calls.push({ refresh })
      if (result instanceof Error) throw result
      return result
    },
  }
  return { source, calls }
}

test('the market surface depends on the storefront read and nothing else', () => {
  // Regression guard for the whole point of this module: reaching for the
  // verified bootstrap or the credential store here is what put two extra WAN
  // round trips in front of the first rendered row.
  assert.deepEqual(Object.keys(defaultMarketSource), ['readStorefront'])
})

test('a resolved storefront reaches the page unchanged', async () => {
  const { source } = recorder(storefront())

  const result = await loadMarket(source)

  assert.equal(result.ok, true)
  assert.ok(result.ok)
  assert.deepEqual(result.storefront, storefront())
})

test('the refresh control is forwarded to the Host cache', async () => {
  const { source, calls } = recorder(storefront())

  await loadMarket(source, false)
  await loadMarket(source, true)

  assert.deepEqual(calls, [{ refresh: false }, { refresh: true }])
})

test('a stale snapshot still renders, carrying its warning', async () => {
  const { source } = recorder(storefront({ stale: true, error: 'loomloom service is unavailable' }))

  const result = await loadMarket(source)

  assert.ok(result.ok)
  assert.equal(result.storefront.stale, true)
  assert.equal(result.storefront.error, 'loomloom service is unavailable')
  assert.equal(result.storefront.entries.length, 1)
})

test('an unconfigured storefront is a resolved value, not an error', async () => {
  const { source } = recorder(storefront({ configured: false, entries: [] }))

  const result = await loadMarket(source)

  assert.ok(result.ok)
  assert.equal(result.storefront.configured, false)
})

test('a transport failure becomes a renderable message instead of a rejection', async () => {
  const { source } = recorder(new Error('loomloom storefront is unavailable'))

  assert.deepEqual(await loadMarket(source), { ok: false, message: 'loomloom storefront is unavailable' })

  const blank = recorder(new Error(''))
  assert.deepEqual(await loadMarket(blank.source), { ok: false, message: 'storefront unavailable' })
})

test('the real Client wiring reads only the storefront route, never a credential or the full market', async () => {
  Object.defineProperty(globalThis, 'window', {
    value: { location: { origin: 'http://127.0.0.1:4312' } },
    configurable: true,
    writable: true,
  })
  const urls: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input))
    return new Response(JSON.stringify({
      configured: true,
      entries: [{ id: 'listing-1', name: 'Writer', available: true, inputSchemaSnapshot: '{"fields":[]}' }],
      unavailable: [],
      fetchedAt: '2026-09-10T04:00:00Z',
      stale: false,
    }))
  }) as typeof fetch

  const result = await loadMarket(defaultMarketSource)

  assert.equal(result.ok, true)
  assert.deepEqual(urls, ['http://127.0.0.1:4312/api/loomloom/storefront'])
  assert.ok(!urls.some(url => url.includes('bootstrap')))
  assert.ok(!urls.some(url => url.includes('credentials')))
  assert.ok(!urls.some(url => url.includes('pageSize')))
})
