import assert from 'node:assert/strict'
import test from 'node:test'
import { createLoomBootstrapReader } from '../src/bootstrap.js'
import { resolveLoomConfig } from '../src/loom-api.js'

test('bootstrap returns an inert first-run state without resolving or validating a missing credential', async () => {
  let tokenReads = 0
  const read = createLoomBootstrapReader(
    { get(): undefined { return undefined } } as never,
    resolveLoomConfig(),
    async () => ({ configured: false }),
    async () => { tokenReads += 1; return undefined },
  )

  assert.deepEqual(await read(), {
    credential: { configured: false },
    loom: 'unknown',
    router: 'unknown',
    model: { provider: 'shengsuanyun', ready: false },
  })
  assert.equal(tokenReads, 0)
})

test('bootstrap verifies both services and the selected model without exposing the credential', async () => {
  const originalFetch = globalThis.fetch
  const secret = 'bootstrap-secret'
  globalThis.fetch = async input => new Response(JSON.stringify(
    String(input).includes('/models')
      ? { data: [{ id: 'deepseek/deepseek-v4-flash' }] }
      : { items: [] },
  ), { status: 200 })
  const read = createLoomBootstrapReader(
    {
      get(name: string) {
        return name === 'agentDefaultModel'
          ? { currentSelection: () => ({ provider: 'shengsuanyun', model: 'deepseek/deepseek-v4-flash' }) }
          : undefined
      },
    } as never,
    resolveLoomConfig(),
    async () => ({ configured: true, source: 'reference' }),
    async () => secret,
  )

  try {
    const result = await read()
    assert.deepEqual(result, {
      credential: { configured: true },
      loom: 'ready',
      router: 'ready',
      model: { provider: 'shengsuanyun', id: 'deepseek/deepseek-v4-flash', ready: true },
    })
    assert.equal(JSON.stringify(result).includes(secret), false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('bootstrap preserves configured state when bounded validation is unavailable', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('offline with secret detail') }
  const read = createLoomBootstrapReader(
    {
      get: () => ({ currentSelection: () => ({ provider: 'shengsuanyun', model: 'model-1' }) }),
    } as never,
    resolveLoomConfig(),
    async () => ({ configured: true }),
    async () => 'secret',
  )

  try {
    assert.deepEqual(await read(), {
      credential: { configured: true },
      loom: 'unavailable',
      router: 'unavailable',
      model: { provider: 'shengsuanyun', id: 'model-1', ready: false },
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})
