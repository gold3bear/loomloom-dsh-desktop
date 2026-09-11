import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import test from 'node:test'
import { beginBrowserAuthorization } from '../src/browser-auth.js'

async function server(handler: Parameters<typeof createServer>[0]): Promise<{ readonly url: string; close(): Promise<void> }> {
  const instance = createServer(handler)
  await new Promise<void>((resolve, reject) => {
    instance.once('error', reject)
    instance.listen(0, '127.0.0.1', () => { instance.off('error', reject); resolve() })
  })
  const address = instance.address()
  assert.notEqual(address, null)
  assert.notEqual(typeof address, 'string')
  return {
    url: `http://127.0.0.1:${(address as { port: number }).port}`,
    async close() { await new Promise<void>(resolve => instance.close(() => resolve())) },
  }
}

test('browser authorization uses the ShengSuanYun channel contract and exchanges a state-bound callback once', async () => {
  let exchange: Record<string, unknown> | undefined
  let exchangePath = ''
  const account = await server(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    exchange = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
    exchangePath = req.url ?? ''
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ code: 0, data: { data: { api_key: 'browser-grant', jwt_token: 'profile-jwt' } } }))
  })
  try {
    const authorization = await beginBrowserAuthorization(new AbortController().signal, {
      authPageUrl: `${account.url}/authorize`, accountKeysUrl: `${account.url}/auth/keys`, timeoutMs: 1_000,
    })
    const authorizeUrl = new URL(authorization.url)
    const callback = authorizeUrl.searchParams.get('callback_url')
    const state = authorizeUrl.searchParams.get('state')
    assert.notEqual(callback, null)
    assert.notEqual(state, null)
    const callbackUrl = new URL(callback!)
    callbackUrl.searchParams.set('code', 'one-time-code')
    const reply = await fetch(callbackUrl)
    assert.equal(reply.status, 200)
    assert.deepEqual(await authorization.result, { apiKey: 'browser-grant', identityToken: 'profile-jwt' })
    assert.deepEqual({ code: exchange?.code, callback_url: exchange?.callback_url }, {
      code: 'one-time-code', callback_url: callback,
    })
    assert.equal(new URL(exchangePath, account.url).searchParams.get('from'), 'CH_B51KXQ98')
    assert.equal(authorizeUrl.searchParams.get('from'), 'CH_B51KXQ98')
    assert.equal(new URL(callback!).searchParams.get('state'), state)
    const verifier = String(exchange?.code_verifier)
    assert.equal(createHash('sha256').update(verifier).digest('base64url'), authorizeUrl.searchParams.get('code_challenge'))
  } finally {
    await account.close()
  }
})
