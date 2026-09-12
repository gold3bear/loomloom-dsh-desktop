import assert from 'node:assert/strict'
import test from 'node:test'
import { LoomBrowserLoginService } from '../src/browser-login.js'
import { resolveLoomConfig } from '../src/loom-api.js'

async function waitForState(
  service: LoomBrowserLoginService,
  sessionId: string,
  expected: 'complete' | 'failed' | 'model-selection-required',
): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (service.status(sessionId)?.state === expected) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.fail(`login session did not reach ${expected}`)
}

test('browser login persists a verified credential without exposing it through session status or callback HTML', async () => {
  const nativeFetch = globalThis.fetch
  const secret = 'browser-grant-that-must-stay-host-only'
  const writes: unknown[] = []
  const selections: unknown[] = []
  const context = {
    credentials: {
      async resolve(): Promise<undefined> { return undefined },
      async set(ref: unknown, value: unknown): Promise<void> { writes.push({ ref, value }) },
    },
    get(name: string): unknown {
      if (name === 'agentDefaultModel') return {
        async saveSelection(value: unknown): Promise<void> { selections.push(value) },
      }
      return undefined
    },
  }
  const service = new LoomBrowserLoginService(context as never, resolveLoomConfig())
  try {
    const started = await service.start()
    globalThis.fetch = async input => {
      if (String(input).startsWith('https://api.shengsuanyun.com/auth/keys')) {
        return new Response(JSON.stringify({ code: 0, data: { data: { api_key: secret } } }), { status: 200 })
      }
      if (String(input).startsWith('https://loomloom.shengsuanyun.com/loom/v1/')) {
        return new Response(JSON.stringify({ items: [] }), { status: 200 })
      }
      return new Response(JSON.stringify({ data: [{ id: 'deepseek-v4-flash' }] }), { status: 200 })
    }

    const callback = new URL(new URL(started.url).searchParams.get('callback_url')!)
    callback.searchParams.set('code', 'single-use-code')
    const callbackReply = await nativeFetch(callback)
    const callbackHtml = await callbackReply.text()
    await waitForState(service, started.sessionId, 'complete')

    assert.equal(callbackReply.status, 200)
    assert.equal(callbackHtml.includes(secret), false)
    assert.equal(callbackHtml.includes('single-use-code'), false)
    assert.deepEqual(service.status(started.sessionId), { state: 'complete' })
    assert.equal(JSON.stringify(service.status(started.sessionId)).includes(secret), false)
    assert.deepEqual(writes, [{ ref: 'SHENGSUANYUN_API_KEY', value: secret }])
    assert.deepEqual(selections, [{ provider: 'shengsuanyun', model: 'deepseek-v4-flash' }])
  } finally {
    globalThis.fetch = nativeFetch
    service.dispose()
  }
})

test('browser login does not persist a newly exchanged credential when its Loom verification fails', async () => {
  const nativeFetch = globalThis.fetch
  let writes = 0
  const context = {
    credentials: {
      async resolve(): Promise<undefined> { return undefined },
      async set(): Promise<void> { writes += 1 },
    },
    get(): undefined { return undefined },
  }
  const service = new LoomBrowserLoginService(context as never, resolveLoomConfig())
  try {
    const started = await service.start()
    globalThis.fetch = async input => String(input).startsWith('https://api.shengsuanyun.com/auth/keys')
      ? new Response(JSON.stringify({ code: 0, data: { api_key: 'rejected-grant' } }), { status: 200 })
      : new Response(JSON.stringify({ error: 'not authorized' }), { status: 401 })

    const callback = new URL(new URL(started.url).searchParams.get('callback_url')!)
    callback.searchParams.set('code', 'single-use-code')
    await nativeFetch(callback)
    await waitForState(service, started.sessionId, 'failed')

    assert.deepEqual(service.status(started.sessionId), { state: 'failed', reason: 'loom-validation-failed' })
    assert.equal(writes, 0)
  } finally {
    globalThis.fetch = nativeFetch
    service.dispose()
  }
})

test('browser login does not persist a newly exchanged credential when Router model validation fails', async () => {
  const nativeFetch = globalThis.fetch
  let writes = 0
  const context = {
    credentials: {
      async resolve(): Promise<undefined> { return undefined },
      async set(): Promise<void> { writes += 1 },
    },
    get(): undefined { return undefined },
  }
  const service = new LoomBrowserLoginService(context as never, resolveLoomConfig())
  try {
    const started = await service.start()
    globalThis.fetch = async input => {
      const endpoint = String(input)
      if (endpoint.startsWith('https://api.shengsuanyun.com/auth/keys')) {
        return new Response(JSON.stringify({ code: 0, data: { api_key: 'router-rejected-grant' } }), { status: 200 })
      }
      if (endpoint.startsWith('https://loomloom.shengsuanyun.com/loom/v1/')) {
        return new Response(JSON.stringify({ items: [] }), { status: 200 })
      }
      return new Response(JSON.stringify({ error: 'not authorized' }), { status: 401 })
    }

    const callback = new URL(new URL(started.url).searchParams.get('callback_url')!)
    callback.searchParams.set('code', 'single-use-code')
    await nativeFetch(callback)
    await waitForState(service, started.sessionId, 'failed')

    assert.deepEqual(service.status(started.sessionId), { state: 'failed', reason: 'router-validation-failed' })
    assert.equal(writes, 0)
  } finally {
    globalThis.fetch = nativeFetch
    service.dispose()
  }
})

test('browser login cancellation is idempotent and exposes only a recovery reason', async () => {
  const service = new LoomBrowserLoginService({
    credentials: { async resolve(): Promise<undefined> { return undefined } },
    get(): undefined { return undefined },
  } as never, resolveLoomConfig())
  try {
    const started = await service.start()
    service.cancel(started.sessionId)
    service.cancel(started.sessionId)

    assert.deepEqual(service.status(started.sessionId), {
      state: 'cancelled',
      reason: 'authorization-cancelled',
    })
    assert.equal(JSON.stringify(service.status(started.sessionId)).includes('code_verifier'), false)
    assert.equal(JSON.stringify(service.status(started.sessionId)).includes('Bearer '), false)
  } finally {
    service.dispose()
  }
})

test('browser login waits for a discovered model selection before completing', async () => {
  const nativeFetch = globalThis.fetch
  let selected = { provider: 'other', model: 'other-model' }
  let settingsUpdated: ((namespace: string) => void) | undefined
  const context = {
    credentials: {
      async resolve(): Promise<undefined> { return undefined },
      async set(): Promise<void> {},
      async unset(): Promise<void> {},
    },
    get(name: string): unknown {
      if (name === 'agentDefaultModel') {
        return {
          currentSelection: () => selected,
          async saveSelection(): Promise<void> {},
        }
      }
      return undefined
    },
    on(event: string, listener: (namespace: string) => void): () => void {
      if (event === 'settings/document-updated') settingsUpdated = listener
      return () => {}
    },
  }
  const service = new LoomBrowserLoginService(context as never, resolveLoomConfig())
  try {
    const started = await service.start()
    globalThis.fetch = async input => {
      const endpoint = String(input)
      if (endpoint.startsWith('https://api.shengsuanyun.com/auth/keys')) {
        return new Response(JSON.stringify({ code: 0, data: { api_key: 'new-key' } }), { status: 200 })
      }
      if (endpoint.includes('/users/me/runs')) return new Response(JSON.stringify({ items: [] }), { status: 200 })
      return new Response(JSON.stringify({ data: [{ id: 'chat-model-2' }] }), { status: 200 })
    }
    const callback = new URL(new URL(started.url).searchParams.get('callback_url')!)
    callback.searchParams.set('code', 'single-use-code')
    await nativeFetch(callback)
    await waitForState(service, started.sessionId, 'model-selection-required')

    selected = { provider: 'shengsuanyun', model: 'chat-model-2' }
    settingsUpdated?.('agent-default-model')
    selected = { provider: 'other', model: 'other-model' }
    assert.deepEqual(service.status(started.sessionId), { state: 'complete' })
  } finally {
    globalThis.fetch = nativeFetch
    await service.dispose()
  }
})

test('cancelling model selection removes the credential written by that login session', async () => {
  const nativeFetch = globalThis.fetch
  let stored: string | undefined
  const context = {
    credentials: {
      async resolve() { return stored === undefined ? undefined : { value: stored } },
      async set(_ref: unknown, value: string): Promise<void> { stored = value },
      async unset(): Promise<void> { stored = undefined },
    },
    get(name: string): unknown {
      if (name === 'agentDefaultModel') {
        return {
          currentSelection: () => ({ provider: 'other', model: 'other-model' }),
          async saveSelection(): Promise<void> {},
        }
      }
      return undefined
    },
  }
  const service = new LoomBrowserLoginService(context as never, resolveLoomConfig())
  try {
    const started = await service.start()
    globalThis.fetch = async input => {
      const endpoint = String(input)
      if (endpoint.startsWith('https://api.shengsuanyun.com/auth/keys')) {
        return new Response(JSON.stringify({ code: 0, data: { api_key: 'temporary-key' } }), { status: 200 })
      }
      if (endpoint.includes('/users/me/runs')) return new Response(JSON.stringify({ items: [] }), { status: 200 })
      return new Response(JSON.stringify({ data: [{ id: 'chat-model-2' }] }), { status: 200 })
    }
    const callback = new URL(new URL(started.url).searchParams.get('callback_url')!)
    callback.searchParams.set('code', 'single-use-code')
    await nativeFetch(callback)
    await waitForState(service, started.sessionId, 'model-selection-required')
    assert.equal(stored, 'temporary-key')

    await service.cancel(started.sessionId)
    assert.equal(stored, undefined)
    assert.deepEqual(service.status(started.sessionId), {
      state: 'cancelled',
      reason: 'authorization-cancelled',
    })
  } finally {
    globalThis.fetch = nativeFetch
    await service.dispose()
  }
})

test('browser login reports a distinct no-chat-model failure without persisting the credential', async () => {
  const nativeFetch = globalThis.fetch
  let writes = 0
  const context = {
    credentials: {
      async resolve(): Promise<undefined> { return undefined },
      async set(): Promise<void> { writes += 1 },
    },
    get(): undefined { return undefined },
  }
  const service = new LoomBrowserLoginService(context as never, resolveLoomConfig())
  try {
    const started = await service.start()
    globalThis.fetch = async input => {
      const endpoint = String(input)
      if (endpoint.startsWith('https://api.shengsuanyun.com/auth/keys')) {
        return new Response(JSON.stringify({ code: 0, data: { api_key: 'no-chat-key' } }), { status: 200 })
      }
      if (endpoint.includes('/users/me/runs')) return new Response(JSON.stringify({ items: [] }), { status: 200 })
      return new Response(JSON.stringify({ data: [{ id: 'image-only', capabilities: ['images'] }] }), { status: 200 })
    }
    const callback = new URL(new URL(started.url).searchParams.get('callback_url')!)
    callback.searchParams.set('code', 'single-use-code')
    await nativeFetch(callback)
    await waitForState(service, started.sessionId, 'failed')

    assert.deepEqual(service.status(started.sessionId), { state: 'failed', reason: 'no-chat-model' })
    assert.equal(writes, 0)
  } finally {
    globalThis.fetch = nativeFetch
    await service.dispose()
  }
})

test('browser login reports an explicit authorization refusal without waiting for timeout', async () => {
  const nativeFetch = globalThis.fetch
  const service = new LoomBrowserLoginService({
    credentials: { async resolve(): Promise<undefined> { return undefined } },
    get(): undefined { return undefined },
  } as never, resolveLoomConfig())
  try {
    const started = await service.start()
    const callback = new URL(new URL(started.url).searchParams.get('callback_url')!)
    callback.searchParams.set('error', 'access_denied')
    const response = await nativeFetch(callback)
    await waitForState(service, started.sessionId, 'failed')

    assert.equal(response.status, 400)
    assert.deepEqual(service.status(started.sessionId), {
      state: 'failed',
      reason: 'authorization-cancelled',
    })
  } finally {
    await service.dispose()
  }
})
