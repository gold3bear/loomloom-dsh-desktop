import assert from 'node:assert/strict'
import test from 'node:test'
import type { AuthorizationFlow } from '@deepseek-ai/dsh-authorization'
import { registerLoomAuthorization } from '../src/authorization.js'
import { resolveLoomConfig } from '../src/loom-api.js'

test('registers a DSH secret prompt that persists the common ShengSuanYun credential reference', async () => {
  const originalFetch = globalThis.fetch
  let flow: AuthorizationFlow | undefined
  let stored: unknown
  let selection: unknown
  let disposed = false
  const agentDefaultModel = {
    async saveSelection(value: unknown): Promise<void> { selection = value },
  }
  const context = {
    get(name: string): unknown {
      if (name === 'agentDefaultModel') return agentDefaultModel
      if (name === 'authorization') return {
        registerFlow(candidate: AuthorizationFlow): () => void {
          flow = candidate
          return () => { disposed = true }
        },
      }
      return undefined
    },
    credentials: {
      async resolve(): Promise<undefined> { return undefined },
      async set(ref: unknown, value: unknown): Promise<void> { stored = { ref, value } },
    },
  }
  globalThis.fetch = async (input) => new Response(JSON.stringify(String(input).includes('/models') ? { data: [{ id: 'deepseek/deepseek-v4-flash' }] } : { items: [] }), { status: 200 })
  const dispose = registerLoomAuthorization(context as never, resolveLoomConfig())
  assert.equal(flow?.label, 'Loomloom / 胜算云')
  assert.deepEqual(flow?.methods, [
    { id: 'browser', label: '在浏览器中登录胜算云（推荐）' },
    { id: 'api-token', label: '粘贴胜算云 API Key' },
  ])
  try {
    await flow!.run({
      method: 'api-token', signal: new AbortController().signal,
      notify() {},
      async prompt(prompt) {
        assert.equal(prompt.kind, 'secret')
        return '  test-token  '
      },
    })
  } finally { globalThis.fetch = originalFetch }
  assert.deepEqual(stored, { ref: 'SHENGSUANYUN_API_KEY', value: 'test-token' })
  assert.deepEqual(selection, { provider: 'shengsuanyun', model: 'deepseek/deepseek-v4-flash' })
  dispose()
  assert.equal(disposed, true)
})

test('stores a verified fallback key without selecting an unavailable default model', async () => {
  const originalFetch = globalThis.fetch
  let flow: AuthorizationFlow | undefined
  let stored: unknown
  let selections = 0
  const context = {
    get(name: string): unknown {
      if (name === 'agentDefaultModel') return {
        async saveSelection(): Promise<void> { selections += 1 },
      }
      if (name === 'authorization') return {
        registerFlow(candidate: AuthorizationFlow): () => void { flow = candidate; return () => {} },
      }
      return undefined
    },
    credentials: {
      async resolve(): Promise<undefined> { return undefined },
      async set(ref: unknown, value: unknown): Promise<void> { stored = { ref, value } },
    },
  }
  globalThis.fetch = async input => new Response(JSON.stringify(
    String(input).includes('/models') ? { data: [{ id: 'another-chat-model' }] } : { items: [] },
  ), { status: 200 })
  registerLoomAuthorization(context as never, resolveLoomConfig())
  try {
    await flow!.run({
      method: 'api-token',
      signal: new AbortController().signal,
      notify() {},
      async prompt() { return 'fallback-token' },
    })
  } finally {
    globalThis.fetch = originalFetch
  }
  assert.deepEqual(stored, { ref: 'SHENGSUANYUN_API_KEY', value: 'fallback-token' })
  assert.equal(selections, 0)
})

test('rejects a blank token without persisting a common credential', async () => {
  let flow: AuthorizationFlow | undefined
  let writes = 0
  const agentDefaultModel = { async saveSelection(): Promise<void> {} }
  const context = {
    get(name: string) {
      if (name === 'agentDefaultModel') return agentDefaultModel
      return { registerFlow(candidate: AuthorizationFlow) { flow = candidate; return () => {} } }
    },
    credentials: { async set(): Promise<void> { writes += 1 } },
  }
  registerLoomAuthorization(context as never, resolveLoomConfig())
  await assert.rejects(() => flow!.run({
    method: 'api-token', signal: new AbortController().signal, notify() {}, async prompt() { return '  ' },
  }), /不能为空/)
  assert.equal(writes, 0)
})
