import assert from 'node:assert/strict'
import test from 'node:test'
import { LoomApiError, resolveLoomConfig } from '../src/loom-api.js'
import {
  createStorefrontReader,
  envSecret,
  STOREFRONT_CONCURRENCY,
  storefrontSourceFor,
  type StorefrontEntry,
} from '../src/storefront.js'

interface Recorded {
  readonly paths: string[]
  peak: number
}

/**
 * A stand-in for the Host API that answers one listing detail per configured id.
 */
function fakeApi(
  listing: (id: string) => unknown | Promise<unknown>,
  onCall?: () => void,
): { readonly api: never, readonly calls: Recorded } {
  const calls: Recorded = { paths: [], peak: 0 }
  let inFlight = 0
  const api = {
    async request(path: string): Promise<unknown> {
      calls.paths.push(path)
      inFlight += 1
      calls.peak = Math.max(calls.peak, inFlight)
      try {
        onCall?.()
        const id = decodeURIComponent(path.replace('/marketListings/', ''))
        const value = await listing(id)
        if (value instanceof Error) throw value
        return value
      } finally {
        inFlight -= 1
      }
    },
  }
  return { api: api as never, calls }
}

function readerFor(ids: readonly string[], listing: (id: string) => unknown | Promise<unknown>, onCall?: () => void) {
  const { api, calls } = fakeApi(listing, onCall)
  const reader = createStorefrontReader(api, resolveLoomConfig({ storefrontListingIds: ids }))
  return { reader, calls }
}

const LIVE_DETAIL = {
  id: 'listing-1',
  displayName: '视觉演示生成器',
  description: '一句话主题 → 可编辑 HTML 演示文稿。',
  creator: { nickname: 'user_tuabxc' },
  status: 'published',
  listingVersionId: 'listing-1-v1',
  version: 'v1',
  updatedAt: '2026-09-10T03:20:53Z',
  currency: 'CNY',
  taskFixedFee: { amount: '1.0000000', currency: 'CNY' },
  saleStatus: 'listed',
  executionAvailabilityStatus: 'available',
  inputSchemaSnapshot: JSON.stringify({ fields: [{ key: 'topic', label: 'Topic', order: 10, value_type: 'string' }] }),
}

test('an unconfigured storefront issues no upstream request at all', async () => {
  const { reader, calls } = readerFor([], () => LIVE_DETAIL)

  assert.deepEqual(await reader(), { configured: false, entries: [], unavailable: [] })
  assert.deepEqual(calls.paths, [])
})

test('each configured id is one anonymous detail read, in authoring order', async () => {
  const { reader, calls } = readerFor(['b', 'a', 'c'], id => ({ ...LIVE_DETAIL, id, displayName: id }))

  const result = await reader()

  assert.deepEqual(calls.paths, ['/marketListings/b', '/marketListings/a', '/marketListings/c'])
  assert.deepEqual(result.entries.map(entry => entry.id), ['b', 'a', 'c'])
  assert.deepEqual(result.unavailable, [])
})

test('a normalized entry carries exactly what the preview and the form need', async () => {
  const { reader } = readerFor(['listing-1'], () => LIVE_DETAIL)

  const [entry] = (await reader()).entries

  assert.deepEqual(entry, {
    id: 'listing-1',
    name: '视觉演示生成器',
    description: '一句话主题 → 可编辑 HTML 演示文稿。',
    available: true,
    version: 'v1',
    updatedAt: '2026-09-10T03:20:53Z',
    creatorNickname: 'user_tuabxc',
    fixedFee: '1.0000000',
    currency: 'CNY',
    inputSchemaSnapshot: LIVE_DETAIL.inputSchemaSnapshot,
  } satisfies StorefrontEntry)
})

test('a de-listed SkillBot is reported unavailable instead of failing the storefront', async () => {
  const { reader } = readerFor(['kept', 'gone'], id => (id === 'gone'
    ? new LoomApiError(404, 'market_listing not found')
    : { ...LIVE_DETAIL, id }))

  const result = await reader()

  assert.deepEqual(result.entries.map(entry => entry.id), ['kept'])
  assert.deepEqual(result.unavailable, ['gone'])
})

test('every id may disappear without turning into an error', async () => {
  const { reader } = readerFor(['a', 'b'], () => new LoomApiError(404, 'market_listing not found'))

  assert.deepEqual(await reader(), { configured: true, entries: [], unavailable: ['a', 'b'] })
})

test('a transient upstream failure rejects so the cache can serve its last good snapshot', async () => {
  const { reader, calls } = readerFor(['a', 'b', 'c'], id => (id === 'b'
    ? new LoomApiError(502, 'loomloom service is unavailable')
    : { ...LIVE_DETAIL, id }))

  await assert.rejects(() => reader(), /unavailable/u)
  // Every configured id is still attempted, so the failure is not order-dependent.
  assert.deepEqual(calls.paths, ['/marketListings/a', '/marketListings/b', '/marketListings/c'])
})

test('reads are bounded so a large allow-list cannot open unbounded sockets', async () => {
  const ids = Array.from({ length: STOREFRONT_CONCURRENCY * 3 }, (_, index) => `listing-${String(index)}`)
  let release: (() => void) | undefined
  const gate = new Promise<void>(resolve => { release = resolve })
  const started: string[] = []
  const { reader, calls } = readerFor(ids, async id => {
    started.push(id)
    if (started.length >= STOREFRONT_CONCURRENCY) release?.()
    await gate
    return { ...LIVE_DETAIL, id }
  })

  const result = await reader()

  assert.equal(result.entries.length, ids.length)
  assert.ok(calls.peak <= STOREFRONT_CONCURRENCY, `peak concurrency was ${String(calls.peak)}`)
})

test('an absent display name falls back to the configured id the user recognizes', async () => {
  const { reader } = readerFor(['listing-1'], () => ({ id: 'listing-1', executionAvailabilityStatus: 'UNAVAILABLE' }))

  const [entry] = (await reader()).entries

  assert.equal(entry.name, 'listing-1')
  assert.equal(entry.description, '')
  assert.equal(entry.available, false)
  assert.equal(entry.fixedFee, undefined)
  assert.equal(entry.inputSchemaSnapshot, '{}')
})

test('the caller abort signal reaches every detail read', async () => {
  const controller = new AbortController()
  const seen: (AbortSignal | undefined)[] = []
  const api = {
    async request(_path: string, _init: RequestInit, signal?: AbortSignal): Promise<unknown> {
      seen.push(signal)
      return LIVE_DETAIL
    },
  }
  const reader = createStorefrontReader(api as never, resolveLoomConfig({ storefrontListingIds: ['a', 'b'] }))

  await reader(controller.signal)

  assert.equal(seen.length, 2)
  assert.ok(seen.every(signal => signal?.aborted === false))
})

// --- creator mode -------------------------------------------------------------

interface CreatorCall {
  readonly path: string
}

/**
 * A creator-scoped API double: it answers `/creators/me/marketListings` with the
 * given catalogue, follows one optional page token, and records every path.
 */
function creatorApi(catalogue: readonly unknown[], calls: CreatorCall[], nextPageToken?: string): never {
  return {
    async request(path: string): Promise<unknown> {
      calls.push({ path })
      const pageToken = new URL(path, 'http://x').searchParams.get('pageToken')
      return pageToken === null
        ? { items: catalogue, ...(nextPageToken === undefined ? {} : { nextPageToken }) }
        : { items: [{ id: 'page-2', status: 'published', saleStatus: 'listed' }] }
    },
  } as never
}

/** Two listed entries plus the shapes that must never reach the storefront. */
function creatorCatalogue(): readonly unknown[] {
  return [
    { id: 'listed-new', status: 'published', saleStatus: 'listed' },
    { id: 'draft-one', status: 'draft', saleStatus: 'unlisted' },
    { id: 'published-unlisted', status: 'published', saleStatus: 'unlisted' },
    { id: 'listed-old', status: 'published', saleStatus: 'listed' },
    { id: 'listed-new', status: 'published', saleStatus: 'listed' },
  ]
}

function datedDetail(id: string): unknown {
  return { ...LIVE_DETAIL, id, updatedAt: id === 'listed-old' ? '2026-01-01T00:00:00Z' : '2026-09-10T03:20:53Z' }
}

test('creator mode derives the ids from the creator catalogue and keeps only what the market serves', async () => {
  const calls: CreatorCall[] = []
  const { api, calls: detailCalls } = fakeApi(id => datedDetail(id))
  const reader = createStorefrontReader(api, resolveLoomConfig({}), { creator: creatorApi(creatorCatalogue(), calls) })

  const result = await reader()

  // Draft and published-but-unlisted entries are dropped: the public detail route
  // answers 404 for them, so advertising them could only ever render as "gone".
  assert.deepEqual([...detailCalls.paths].sort(), ['/marketListings/listed-new', '/marketListings/listed-old'])
  assert.deepEqual(result.entries.map(entry => entry.id), ['listed-new', 'listed-old'])
  assert.equal(result.configured, true)
  assert.deepEqual(result.unavailable, [])
})

test('a derived storefront is presented newest first, since it has no authoring order', async () => {
  const { api } = fakeApi(id => datedDetail(id))
  const reader = createStorefrontReader(api, resolveLoomConfig({}), { creator: creatorApi(creatorCatalogue(), []) })

  assert.deepEqual((await reader()).entries.map(entry => entry.id), ['listed-new', 'listed-old'])
})

test('creator discovery follows the opaque page token', async () => {
  const calls: CreatorCall[] = []
  const { api } = fakeApi(id => ({ ...LIVE_DETAIL, id }))
  const reader = createStorefrontReader(api, resolveLoomConfig({}), {
    creator: creatorApi([{ id: 'listed-new', status: 'published', saleStatus: 'listed' }], calls, 'page-2'),
  })

  const result = await reader()

  assert.equal(calls.length, 2)
  assert.match(calls[0]?.path ?? '', /^\/creators\/me\/marketListings\?pageSize=200$/u)
  assert.match(calls[1]?.path ?? '', /pageToken=page-2/u)
  assert.deepEqual([...result.entries.map(entry => entry.id)].sort(), ['listed-new', 'page-2'])
})

test('a creator with nothing listed yields a configured but empty storefront', async () => {
  const { api, calls: detailCalls } = fakeApi(id => ({ ...LIVE_DETAIL, id }))
  const reader = createStorefrontReader(api, resolveLoomConfig({}), {
    creator: creatorApi([{ id: 'draft-one', status: 'draft', saleStatus: 'unlisted' }], []),
  })

  assert.deepEqual(await reader(), { configured: true, entries: [], unavailable: [] })
  assert.deepEqual(detailCalls.paths, [])
})

test('a missing creator credential does not silently fall back to the pinned list', async () => {
  const { api, calls } = fakeApi(id => ({ ...LIVE_DETAIL, id }))
  const reader = createStorefrontReader(api, resolveLoomConfig({ storefrontListingIds: ['pinned'] }), { creator: null })

  // Falling back would make a misconfigured deployment look healthy while quietly
  // no longer tracking new publications.
  assert.deepEqual(await reader(), { configured: false, entries: [], unavailable: [] })
  assert.deepEqual(calls.paths, [])
})

test('the reported source distinguishes derived, pinned and unset storefronts', () => {
  const pinned = resolveLoomConfig({ storefrontListingIds: ['a'] }, {})
  const empty = resolveLoomConfig({}, {})
  const creator = resolveLoomConfig({ creatorKeyEnv: 'LOOMLOOM_CREATOR_KEY' }, {})

  assert.equal(storefrontSourceFor(pinned, undefined), 'pinned')
  assert.equal(storefrontSourceFor(empty, undefined), 'none')
  assert.equal(storefrontSourceFor(creator, undefined), 'creator-key-missing')
  assert.equal(storefrontSourceFor(creator, 'secret'), 'creator')
  // Creator mode is authoritative: pinning ids alongside it does not downgrade it.
  assert.equal(
    storefrontSourceFor(resolveLoomConfig({ creatorKeyEnv: 'X', storefrontListingIds: ['a'] }, {}), 'secret'),
    'creator',
  )
})

test('a blank creator credential reads as absent rather than as an empty secret', () => {
  assert.equal(envSecret({}, 'LOOMLOOM_CREATOR_KEY'), undefined)
  assert.equal(envSecret({ LOOMLOOM_CREATOR_KEY: '   ' }, 'LOOMLOOM_CREATOR_KEY'), undefined)
  assert.equal(envSecret({ LOOMLOOM_CREATOR_KEY: '' }, 'LOOMLOOM_CREATOR_KEY'), undefined)
  assert.equal(envSecret({ LOOMLOOM_CREATOR_KEY: ' k ' }, 'LOOMLOOM_CREATOR_KEY'), 'k')
  assert.equal(envSecret({ LOOMLOOM_CREATOR_KEY: 'k' }, undefined), undefined)
})

test('creator mode ignores the storefront id override', () => {
  const config = resolveLoomConfig(
    { creatorKeyEnv: 'LOOMLOOM_CREATOR_KEY', storefrontListingIds: ['pinned'] },
    { LOOMLOOM_STOREFRONT_IDS: 'from-env' },
  )

  assert.equal(config.creatorKeyEnv, 'LOOMLOOM_CREATOR_KEY')
  assert.deepEqual(config.storefrontListingIds, ['pinned'])
})

test('a malformed creatorKeyEnv fails at composition time', () => {
  for (const bad of ['', '   ', '1BAD', 'HAS-DASH', 'has space']) {
    assert.throws(() => resolveLoomConfig({ creatorKeyEnv: bad }, {}), /creatorKeyEnv/u)
  }
})
