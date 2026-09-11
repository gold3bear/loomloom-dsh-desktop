import assert from 'node:assert/strict'
import test from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import { createStorefrontCache, STOREFRONT_TTL_MS } from '../src/storefront-cache.js'
import type { StorefrontEntry } from '../src/storefront.js'

type Schema = (value: unknown) => unknown

/**
 * A stand-in for the standard settings service that resolves values through the
 * real registered schema, so the tests exercise production coercion (defaults and
 * rejection) rather than an invented contract.
 */
function fakeSettings(initial: unknown = {}): {
  readonly context: Context
  readonly updates: object[]
  readonly stored: () => Record<string, unknown>
} {
  let raw: unknown = initial
  const updates: object[] = []
  const service = {
    register(_ns: unknown, schema: Schema) {
      schema(raw)
      return {
        get: () => schema(raw),
        async update(patch: object) {
          updates.push(patch)
          raw = { ...(raw as Record<string, unknown>), ...patch }
        },
      }
    },
  }
  return {
    context: { settings: service } as unknown as Context,
    updates,
    stored: () => (raw ?? {}) as Record<string, unknown>,
  }
}

function entry(id: string, name = id): StorefrontEntry {
  return {
    id,
    name,
    description: `${id} description`,
    available: true,
    inputSchemaSnapshot: JSON.stringify({ fields: [{ key: 'topic', label: 'Topic', order: 10, value_type: 'string' }] }),
    version: 'v1',
    updatedAt: '2026-09-10T03:20:53Z',
    creatorNickname: 'user_tuabxc',
    fixedFee: '1.0000000',
    currency: 'CNY',
  }
}

function persistedSnapshot(entries: readonly StorefrontEntry[], savedAt: string, unavailable: readonly string[] = []) {
  return {
    storefront: {
      version: 1,
      configured: true,
      savedAt,
      unavailable: [...unavailable],
      entries: entries.map(item => ({
        id: item.id,
        name: item.name,
        description: item.description,
        available: item.available,
        inputSchemaSnapshot: item.inputSchemaSnapshot,
        version: item.version ?? '',
        updatedAt: item.updatedAt ?? '',
        creatorNickname: item.creatorNickname ?? '',
        fixedFee: item.fixedFee ?? '',
        currency: item.currency ?? '',
      })),
    },
  }
}

test('a fresh storefront is served from cache instead of re-reading the Market', async () => {
  let reads = 0
  const cache = createStorefrontCache(fakeSettings().context, async () => {
    reads += 1
    return { configured: true, entries: [entry('listing-1')], unavailable: [] }
  }, { configured: true })

  const first = await cache.read()
  const second = await cache.read()

  assert.equal(reads, 1)
  assert.equal(first.stale, false)
  assert.equal(second.stale, false)
  assert.deepEqual(second.entries.map(item => item.id), ['listing-1'])
})

test('the refresh control bypasses the cache', async () => {
  let reads = 0
  const cache = createStorefrontCache(fakeSettings().context, async () => {
    reads += 1
    return { configured: true, entries: [entry('listing-1')], unavailable: [] }
  }, { configured: true })

  await cache.read()
  await cache.read(true)

  assert.equal(reads, 2)
})

test('a failed refresh keeps the storefront the user was already browsing', async () => {
  let attempt = 0
  const cache = createStorefrontCache(fakeSettings().context, async () => {
    attempt += 1
    if (attempt > 1) throw new Error('loomloom service is unavailable')
    return { configured: true, entries: [entry('listing-1')], unavailable: ['gone'] }
  }, { configured: true })

  await cache.read()
  const result = await cache.read(true)

  assert.equal(result.stale, true)
  assert.equal(result.error, 'loomloom service is unavailable')
  assert.deepEqual(result.entries.map(item => item.id), ['listing-1'])
  assert.deepEqual(result.unavailable, ['gone'])
})

test('a failed first refresh reports an error instead of pretending the storefront is empty', async () => {
  const cache = createStorefrontCache(fakeSettings().context, async () => {
    throw new Error('loomloom service is unavailable')
  }, { configured: true })

  const result = await cache.read()

  assert.deepEqual(result.entries, [])
  assert.equal(result.stale, true)
  assert.equal(result.error, 'loomloom service is unavailable')
})

test('a successful read is persisted so a restart does not pay for a cold storefront', async () => {
  const settings = fakeSettings()
  const first = createStorefrontCache(settings.context, async () => ({
    configured: true,
    entries: [entry('listing-1', '视觉演示生成器')],
    unavailable: ['gone'],
  }), { configured: true })
  await first.read()

  assert.equal(settings.updates.length, 1)
  const stored = settings.stored().storefront as { entries: { name: string }[], unavailable: string[] }
  assert.equal(stored.entries[0]?.name, '视觉演示生成器')
  assert.deepEqual(stored.unavailable, ['gone'])

  // A second cache over the same scope behaves like the next application launch.
  let reads = 0
  const restarted = createStorefrontCache(settings.context, async () => {
    reads += 1
    return { configured: true, entries: [], unavailable: [] }
  }, { configured: true })
  const restored = await restarted.read()

  assert.equal(reads, 0)
  assert.equal(restored.stale, false)
  assert.deepEqual(restored.entries.map(item => item.id), ['listing-1'])
  assert.deepEqual(restored.unavailable, ['gone'])
})

test('a persisted snapshot past its lifetime is refreshed', async () => {
  const stale = new Date(Date.now() - STOREFRONT_TTL_MS - 1_000).toISOString()
  const settings = fakeSettings(persistedSnapshot([entry('old')], stale))
  let reads = 0
  const cache = createStorefrontCache(settings.context, async () => {
    reads += 1
    return { configured: true, entries: [entry('new')], unavailable: [] }
  }, { configured: true })

  const result = await cache.read()

  assert.equal(reads, 1)
  assert.deepEqual(result.entries.map(item => item.id), ['new'])
})

test('a stale persisted snapshot survives a failed refresh', async () => {
  const stale = new Date(Date.now() - STOREFRONT_TTL_MS - 1_000).toISOString()
  const settings = fakeSettings(persistedSnapshot([entry('old')], stale))
  const cache = createStorefrontCache(settings.context, async () => {
    throw new Error('loomloom service is unavailable')
  }, { configured: true })

  const result = await cache.read()

  assert.equal(result.stale, true)
  assert.deepEqual(result.entries.map(item => item.id), ['old'])
})

test('without a settings service the storefront still resolves from memory', async () => {
  const context = {} as unknown as Context
  let reads = 0
  const cache = createStorefrontCache(context, async () => {
    reads += 1
    return { configured: true, entries: [entry('listing-1')], unavailable: [] }
  }, { configured: true })

  const first = await cache.read()
  const second = await cache.read()

  assert.equal(reads, 1)
  assert.deepEqual(first.entries.map(item => item.id), ['listing-1'])
  assert.deepEqual(second.entries.map(item => item.id), ['listing-1'])
})

test('a malformed persisted document is rejected at registration instead of reaching the storefront', () => {
  const settings = fakeSettings({ storefront: { version: 1, savedAt: 'not-a-number', entries: 'nope', unavailable: [] } })
  assert.throws(() => createStorefrontCache(settings.context, async () => ({ configured: false, entries: [], unavailable: [] }), { configured: true }))
})
