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
