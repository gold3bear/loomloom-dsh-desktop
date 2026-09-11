import assert from 'node:assert/strict'
import test from 'node:test'
import { createLoomAccountReaderWithToken } from '../src/account.js'
import { LoomApiError, resolveLoomConfig } from '../src/loom-api.js'

test('normalizes user info and infers creator status from the creator listing', async () => {
  const calls: string[] = []
  const originalFetch = globalThis.fetch
  const reader = createLoomAccountReaderWithToken({
    async request(path: string): Promise<unknown> {
      calls.push(path)
      return { items: [{ id: 'listing-1' }] }
    },
  } as never, async () => 'account-secret')
  globalThis.fetch = async input => {
    assert.equal(String(input), 'https://api.shengsuanyun.com/user/info')
    return new Response(JSON.stringify({
      data: {
        user: {
          uid: 'user-1',
          display_name: 'Test User',
          mail: 'user@example.com',
          avatarUrl: 'https://cdn.example/avatar.png',
          balance: 12.5,
        },
      },
    }))
  }

  try {
    assert.deepEqual(await reader(), {
      configured: true,
      uid: 'user-1',
      displayName: 'Test User',
      email: 'user@example.com',
      photoUrl: 'https://cdn.example/avatar.png',
      balance: '12.5',
      isCreator: true,
    })
    assert.deepEqual(calls, ['/creators/me/marketListings?pageSize=1'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('keeps identity available when creator-role probing is denied', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ user: { uid: 'user-1', displayName: 'User' } }))
  const reader = createLoomAccountReaderWithToken({
    async request(path: string): Promise<unknown> {
      throw new LoomApiError(403, 'denied')
    },
  } as never, async () => 'account-secret')

  try {
    assert.deepEqual(await reader(), {
      configured: true,
      uid: 'user-1',
      displayName: 'User',
      isCreator: false,
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('maps the established ShengSuanYun profile fields without forwarding the raw record', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({
    data: {
      ID: 'ssy-user-1',
      Nickname: '胜算云昵称',
      Username: 'fallback-account',
      Email: 'person@example.com',
      HeadImg: 'https://cdn.example/profile.png',
      privateProfileSetting: 'must-not-leave-host',
    },
  }))
  const reader = createLoomAccountReaderWithToken({
    async request(): Promise<unknown> { return { items: [] } },
  } as never, async () => 'secret')
  try {
    assert.deepEqual(await reader(), {
      configured: true,
      uid: 'ssy-user-1',
      displayName: '胜算云昵称',
      email: 'person@example.com',
      photoUrl: 'https://cdn.example/profile.png',
      isCreator: false,
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('uses the ShengSuanYun username only when no nickname is available', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ data: { ID: 'user-1', Username: 'account-name' } }))
  const reader = createLoomAccountReaderWithToken({
    async request(): Promise<unknown> { return { items: [] } },
  } as never, async () => 'secret')
  try {
    assert.deepEqual(await reader(), {
      configured: true,
      uid: 'user-1',
      displayName: 'account-name',
      isCreator: false,
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('finds an identity behind deployed ShengSuanYun envelope and casing variants', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({
    Data: { UserInfo: { UserID: 'user-1', NickName: '嵌套昵称' } },
    debug: { token: 'must-not-leave-host' },
  }))
  const reader = createLoomAccountReaderWithToken({
    async request(): Promise<unknown> { return { items: [] } },
  } as never, async () => 'secret')
  try {
    const result = await reader()
    assert.deepEqual(result, { configured: true, uid: 'user-1', displayName: '嵌套昵称', isCreator: false })
    assert.equal(JSON.stringify(result).includes('must-not-leave-host'), false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('does not expose raw upstream user payload fields', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({
    user: { uid: 'user-1', token: 'secret', authorization: 'Bearer secret' },
  }))
  const reader = createLoomAccountReaderWithToken({
    async request(): Promise<unknown> { return { items: [] } },
  } as never, async () => 'secret')
  try {
    const result = await reader()
    assert.equal(JSON.stringify(result).includes('secret'), false)
    assert.deepEqual(result, { configured: true, uid: 'user-1', isCreator: false })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('uses the browser identity JWT instead of the shared API key for user info', async () => {
  const originalFetch = globalThis.fetch
  let profileToken: string | null = null
  globalThis.fetch = async (_input, init) => {
    profileToken = new Headers(init?.headers).get('x-token')
    return new Response(JSON.stringify({ data: { ID: 'user-1', Nickname: '资料令牌用户' } }))
  }
  const reader = createLoomAccountReaderWithToken(
    { async request(): Promise<unknown> { return { items: [] } } } as never,
    async () => 'shared-api-key',
    async () => 'profile-jwt',
  )
  try {
    assert.deepEqual(await reader(), { configured: true, uid: 'user-1', displayName: '资料令牌用户', isCreator: false })
    assert.equal(profileToken, 'profile-jwt')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('keeps a key-only connection available when no profile JWT was returned', async () => {
  let called = false
  const reader = createLoomAccountReaderWithToken(
    { async request(): Promise<unknown> { called = true; return { items: [] } } } as never,
    async () => 'shared-api-key',
    async () => undefined,
  )
  assert.deepEqual(await reader(), { configured: true })
  assert.equal(called, false)
})

test('rejects an account endpoint business failure even when its HTTP status is 200', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ code: 20003, data: { reload: true }, msg: 'not a token' }))
  const reader = createLoomAccountReaderWithToken(
    { async request(): Promise<unknown> { return { items: [] } } } as never,
    async () => 'profile-jwt',
  )
  try {
    await assert.rejects(reader, error => error instanceof LoomApiError && error.status === 401)
  } finally {
    globalThis.fetch = originalFetch
  }
})
