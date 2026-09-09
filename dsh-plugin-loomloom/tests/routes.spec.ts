import assert from 'node:assert/strict'
import { createServer, request, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import { registerLoomRoutes } from '../src/routes.js'
import type { LoomBrowserLoginService } from '../src/browser-login.js'

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>

interface TestServer {
  readonly port: number
  readonly calls: readonly { readonly path: string, readonly init?: RequestInit }[]
  close(): Promise<void>
}

async function startServer(options: {
  readonly credentialStatus?: () => Promise<unknown>
  readonly clearCredential?: () => Promise<void>
  readonly apiResponse?: unknown
  readonly browserLogin?: Pick<LoomBrowserLoginService, 'start' | 'status' | 'cancel'>
  readonly bootstrap?: () => Promise<unknown>
  readonly account?: () => Promise<unknown>
} = {}): Promise<TestServer> {
  const routes = new Map<string, Handler>()
  const calls: { path: string, init?: RequestInit }[] = []
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname
    const handler = routes.get(path)
    if (handler === undefined) { res.statusCode = 404; res.end(); return }
    void handler(req, res)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const { port } = server.address() as AddressInfo
  const context = {
    webServer: {
      port,
      register(route: { readonly path: string, readonly handler: Handler }) {
        routes.set(route.path, route.handler)
        return () => { routes.delete(route.path) }
      },
    },
  } as unknown as Context
  const dispose = registerLoomRoutes(context, {
    async request(path: string, init?: RequestInit): Promise<unknown> {
      calls.push({ path, ...(init === undefined ? {} : { init }) })
      return options.apiResponse ?? { id: 'listing-1', displayName: 'Safe SkillBot' }
    },
  } as never,
  options.credentialStatus as (() => Promise<never>) ?? (async () => ({ configured: false })),
  options.browserLogin as LoomBrowserLoginService | undefined,
  options.clearCredential,
  options.bootstrap as (() => Promise<never>) | undefined,
  options.account as (() => Promise<never>) | undefined)
  return {
    port,
    calls,
    async close() {
      dispose()
      await new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error)))
    },
  }
}

async function read(server: TestServer, path: string, headers: Record<string, string> = {}, method = 'GET'): Promise<{ readonly status: number, readonly body: unknown, readonly headers: IncomingMessage['headers'] }> {
  return await new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: server.port, path, headers, method }, res => {
      const chunks: Buffer[] = []
      res.on('data', chunk => chunks.push(Buffer.from(chunk)))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString('utf8')), headers: res.headers }))
    })
    req.once('error', reject)
    req.end()
  })
}

test('Host routes require the DSH loopback authority before reading credentials or market data', async () => {
  const server = await startServer()
  try {
    const result = await read(server, '/api/loomloom/credentials', { host: `evil.example:${server.port}` })
    assert.equal(result.status, 403)
    assert.deepEqual(result.body, { error: 'loomloom request authority rejected' })
    assert.equal(server.calls.length, 0)
  } finally { await server.close() }
})

test('bootstrap route returns Host-validated readiness without credential material', async () => {
  const secret = 'must-not-cross-bootstrap'
  const server = await startServer({
    bootstrap: async () => ({
      credential: { configured: true },
      loom: 'ready',
      router: 'ready',
      model: { provider: 'shengsuanyun', id: 'chat-1', ready: true },
    }),
  })
  try {
    const result = await read(server, '/api/loomloom/bootstrap', { host: `127.0.0.1:${server.port}` })
    assert.equal(result.status, 200)
    assert.deepEqual(result.body, {
      credential: { configured: true },
      loom: 'ready',
      router: 'ready',
      model: { provider: 'shengsuanyun', id: 'chat-1', ready: true },
    })
    assert.equal(JSON.stringify(result.body).includes(secret), false)
  } finally {
    await server.close()
  }
})

test('account route returns normalized identity data and never credential material', async () => {
  const secret = 'account-secret-must-not-cross'
  const server = await startServer({
    account: async () => ({
      configured: true,
      uid: 'user-1',
      displayName: 'Test User',
      email: 'user@example.com',
      photoUrl: 'https://cdn.example/avatar.png',
      balance: '12.50',
      isCreator: false,
    }),
  })
  try {
    const result = await read(server, '/api/loomloom/account', { host: `127.0.0.1:${server.port}` })
    assert.equal(result.status, 200)
    assert.deepEqual(result.body, {
      configured: true,
      uid: 'user-1',
      displayName: 'Test User',
      email: 'user@example.com',
      photoUrl: 'https://cdn.example/avatar.png',
      balance: '12.50',
      isCreator: false,
    })
    assert.equal(JSON.stringify(result.body).includes(secret), false)
    assert.equal(result.headers['cache-control'], 'no-store')
    assert.equal(result.headers['x-content-type-options'], 'nosniff')
  } finally {
    await server.close()
  }
})

test('browser login routes expose only a short-lived opaque session and authorization URL', async () => {
  const sessionId = 'a'.repeat(32)
  const server = await startServer({
    browserLogin: {
      async start() { return { sessionId, url: 'https://www.shengsuanyun.com/auth?state=opaque' } },
      status(value) { return value === sessionId ? { state: 'pending' } : undefined },
      cancel() {},
    } as Pick<LoomBrowserLoginService, 'start' | 'status' | 'cancel'>,
  })
  try {
    const start = await read(server, '/api/loomloom/login/start', { host: `127.0.0.1:${server.port}` }, 'POST')
    assert.equal(start.status, 200)
    assert.deepEqual(start.body, { sessionId, url: 'https://www.shengsuanyun.com/auth?state=opaque' })
    assert.equal(JSON.stringify(start.body).includes('token'), false)

    const status = await read(server, `/api/loomloom/login/status?sessionId=${sessionId}`, { host: `127.0.0.1:${server.port}` })
    assert.equal(status.status, 200)
    assert.deepEqual(status.body, { state: 'pending' })

    const rejected = await read(server, '/api/loomloom/login/start', { host: `evil.example:${server.port}` }, 'POST')
    assert.equal(rejected.status, 403)
  } finally { await server.close() }
})

test('bootstrap treats an unconfigured credential as a valid first-run state and login cancel is idempotent', async () => {
  const sessionId = 'b'.repeat(32)
  const cancelled: string[] = []
  const server = await startServer({
    credentialStatus: async () => ({ configured: false }),
    browserLogin: {
      async start() { return { sessionId, url: 'https://router.shengsuanyun.com/auth' } },
      status() { return undefined },
      cancel(value) { cancelled.push(value) },
    } as Pick<LoomBrowserLoginService, 'start' | 'status' | 'cancel'>,
  })
  try {
    const bootstrap = await read(server, '/api/loomloom/bootstrap', { host: `127.0.0.1:${server.port}` })
    assert.equal(bootstrap.status, 200)
    assert.deepEqual(bootstrap.body, {
      credential: { configured: false }, loom: 'unknown', router: 'unknown', model: { provider: 'shengsuanyun', ready: false },
    })
    const cancel = await read(server, `/api/loomloom/login/cancel?sessionId=${sessionId}`, { host: `127.0.0.1:${server.port}` }, 'POST')
    assert.equal(cancel.status, 200)
    assert.deepEqual(cancel.body, { cancelled: true })
    assert.deepEqual(cancelled, [sessionId])
  } finally { await server.close() }
})

test('credential route returns presence only and turns backend failures into a generic response', async () => {
  const secret = 'this-must-never-cross-the-route'
  const server = await startServer({ credentialStatus: async () => { throw new Error(secret) } })
  try {
    const result = await read(server, '/api/loomloom/credentials', { host: `127.0.0.1:${server.port}` })
    assert.equal(result.status, 503)
    assert.deepEqual(result.body, { error: 'loomloom credential status is unavailable' })
    assert.equal(JSON.stringify(result.body).includes(secret), false)
    assert.equal(result.headers['cache-control'], 'no-store')
    assert.equal(result.headers['x-content-type-options'], 'nosniff')
  } finally { await server.close() }
})

test('logout route is loopback-only and returns no secret material', async () => {
  let cleared = 0
  const server = await startServer({ clearCredential: async () => { cleared += 1 } })
  try {
    const result = await read(server, '/api/loomloom/credentials/logout', { host: `127.0.0.1:${server.port}` }, 'POST')
    assert.equal(result.status, 200)
    assert.deepEqual(result.body, { configured: false })
    assert.equal(cleared, 1)
    const rejected = await read(server, '/api/loomloom/credentials/logout', { host: `evil.example:${server.port}` }, 'POST')
    assert.equal(rejected.status, 403)
    assert.equal(cleared, 1)
  } finally { await server.close() }
})

test('market detail validates opaque ids before asking the upstream API', async () => {
  const server = await startServer()
  try {
    const bad = await read(server, '/api/loomloom/market/skillbot?listingId=../../credential', { host: `127.0.0.1:${server.port}` })
    assert.equal(bad.status, 400)
    assert.deepEqual(bad.body, { error: 'invalid listingId' })
    assert.equal(server.calls.length, 0)

    const good = await read(server, '/api/loomloom/market/skillbot?listingId=listing-1', { host: `127.0.0.1:${server.port}` })
    assert.equal(good.status, 200)
    assert.deepEqual(server.calls, [{ path: '/marketListings/listing-1' }])
  } finally { await server.close() }
})

test('market list reads the public SkillBot catalog instead of creator-owned listings', async () => {
  const server = await startServer({ apiResponse: { items: [{ id: 'listing-1' }] } })
  try {
    const result = await read(server, '/api/loomloom/market', { host: `127.0.0.1:${server.port}` })
    assert.equal(result.status, 200)
    assert.deepEqual(server.calls, [{ path: '/marketListings?pageSize=100' }])
  } finally { await server.close() }
})

test('market quote and execute routes enforce bounded rows and explicit confirmation', async () => {
  const server = await startServer({ apiResponse: { runId: 'run-1', status: 'queued' } })
  try {
    const quote = await read(server, '/api/loomloom/market/skillbot/quote?listingId=listing-1', { host: `127.0.0.1:${server.port}`, 'content-type': 'application/json' }, 'POST')
    assert.equal(quote.status, 400)
    const execute = await read(server, '/api/loomloom/market/skillbot/execute?listingId=listing-1', { host: `127.0.0.1:${server.port}`, 'content-type': 'application/json' }, 'POST')
    assert.equal(execute.status, 400)
  } finally {
    await server.close()
  }
})
