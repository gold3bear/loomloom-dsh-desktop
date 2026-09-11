import assert from 'node:assert/strict'
import test from 'node:test'
import { clearLoomToken, createLoomCredentialStatusReader } from '../src/credentials.js'
import { resolveLoomConfig } from '../src/loom-api.js'

test('reports credential presence without returning any secret value', async () => {
  const read = createLoomCredentialStatusReader({
    credentials: {
      async describe() { return { configured: false, writable: true } },
      async readRecord() { return { kind: 'grant', payload: { token: 'never-return-this-secret' } } },
    },
  } as never, resolveLoomConfig())
  assert.deepEqual(await read(), { configured: true, source: 'authorization-grant' })
})

test('reports a development token only as its non-secret source kind', async () => {
  const read = createLoomCredentialStatusReader({
    credentials: {
      async describe() { throw new Error('must not read reference when development token is configured') },
      async readRecord() { throw new Error('must not read grant when development token is configured') },
    },
  } as never, resolveLoomConfig({ token: 'never-return-this-secret' }))
  assert.deepEqual(await read(), { configured: true, source: 'development-token' })
})

test('does not report a malformed grant record as a configured credential', async () => {
  const read = createLoomCredentialStatusReader({
    credentials: {
      async describe() { return { configured: false, writable: true } },
      async readRecord() { return { kind: 'grant', payload: { token: '' } } },
    },
  } as never, resolveLoomConfig())
  assert.deepEqual(await read(), { configured: false })
})

test('logout removes the common reference and legacy grant without returning a secret', async () => {
  const calls: string[] = []
  const context = {
    credentials: {
      async unset() { calls.push('unset') },
      async deleteRecord() { calls.push('deleteRecord') },
    },
  }
  await clearLoomToken(context as never, resolveLoomConfig())
  assert.deepEqual(calls, ['unset', 'deleteRecord'])
})
