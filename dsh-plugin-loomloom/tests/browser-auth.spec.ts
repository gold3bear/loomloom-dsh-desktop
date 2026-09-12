import assert from 'node:assert/strict'
import test from 'node:test'
import { RouterCredentialError, verifyBrowserCredential, verifyShengsuanyunRouterCredential } from '../src/browser-auth.js'
import { resolveLoomConfig } from '../src/loom-api.js'

test('verifies a browser-exchanged credential against Loom and the fixed ShengSuanYun Router origin', async () => {
  const originalFetch = globalThis.fetch
  const calls: { endpoint: string, authorization: string }[] = []
  globalThis.fetch = async (input, init) => {
    const endpoint = String(input)
    calls.push({ endpoint, authorization: new Headers(init?.headers).get('authorization') ?? '' })
    return new Response(JSON.stringify(endpoint.includes('loomloom.shengsuanyun.com')
      ? { items: [] }
      : { data: [{ id: 'deepseek-v4-flash' }] }), { status: 200 })
  }
  try {
    await verifyBrowserCredential('browser-only-secret', resolveLoomConfig(), new AbortController().signal)
  } finally {
    globalThis.fetch = originalFetch
  }
  assert.deepEqual([...calls].sort((left, right) => left.endpoint.localeCompare(right.endpoint)), [
    { endpoint: 'https://loomloom.shengsuanyun.com/loom/v1/users/me/runs?pageSize=1', authorization: 'Bearer browser-only-secret' },
    { endpoint: 'https://router.shengsuanyun.com/api/v1/models', authorization: 'Bearer browser-only-secret' },
  ].sort((left, right) => left.endpoint.localeCompare(right.endpoint)))
})

test('rejects a Router model response that has no usable model ids', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async input => {
    return new Response(JSON.stringify(String(input).includes('loomloom.shengsuanyun.com')
      ? { items: [] }
      : { data: [] }), { status: 200 })
  }
  try {
    await assert.rejects(
      () => verifyBrowserCredential('browser-only-secret', resolveLoomConfig(), new AbortController().signal),
      /没有可用聊天模型/u,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('filters models that explicitly do not support chat completions', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({
    data: [
      { id: 'image-only', supported_generation_methods: ['images'] },
      { id: 'chat-ready', supported_generation_methods: ['chat-completions'] },
    ],
  }), { status: 200 })
  try {
    assert.deepEqual(
      await verifyShengsuanyunRouterCredential('secret', new AbortController().signal),
      ['chat-ready'],
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('returns a stable no-chat-model reason when every advertised model is incompatible', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({
    data: [{ id: 'image-only', capabilities: ['image-generation'] }],
  }), { status: 200 })
  try {
    await assert.rejects(
      () => verifyShengsuanyunRouterCredential('secret', new AbortController().signal),
      (error: unknown) => error instanceof RouterCredentialError && error.reason === 'no-chat-model',
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})
