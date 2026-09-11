import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { LoomApi, LoomApiError, type ResolvedLoomConfig } from './loom-api.js'

const AUTH_PAGE_URL = 'https://router.shengsuanyun.com/auth'
const ACCOUNT_API_URL = 'https://api.shengsuanyun.com/auth/keys'
const AUTH_CHANNEL = 'CH_B51KXQ98'
const MAX_EXCHANGE_BYTES = 64 * 1024
const AUTH_TIMEOUT_MS = 5 * 60_000
const ROUTER_MODELS_URL = 'https://router.shengsuanyun.com/api/v1/models'
const MAX_ROUTER_MODELS_BYTES = 2 * 1024 * 1024

export class RouterCredentialError extends LoomApiError {
  constructor(
    readonly reason: 'router-validation-failed' | 'no-chat-model',
    status: number,
    message: string,
  ) {
    super(status, message)
    this.name = 'RouterCredentialError'
  }
}

interface ExchangeEnvelope {
  readonly code?: unknown
  readonly msg?: unknown
  readonly data?: unknown
  readonly jwt_token?: unknown
}

/** The exchanged API key serves Loomloom/Router; the JWT is profile-only. */
export interface ShengsuanyunBrowserCredential {
  readonly apiKey: string
  readonly identityToken?: string
}

function successCode(value: unknown): boolean {
  return value === 0 || value === '0'
}

function nonBlankText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function browserCredentialFromEnvelope(payload: ExchangeEnvelope): ShengsuanyunBrowserCredential | undefined {
  const outer = typeof payload.data === 'object' && payload.data !== null ? payload.data as Record<string, unknown> : {}
  const inner = typeof outer.data === 'object' && outer.data !== null ? outer.data as Record<string, unknown> : {}
  const apiKey = nonBlankText(inner.api_key ?? outer.api_key ?? payload.data)
  const identityToken = nonBlankText(inner.jwt_token ?? outer.jwt_token ?? payload.jwt_token)
  // Older deployments issued only a JWT, which also works as their shared key.
  const sharedCredential = apiKey ?? identityToken
  return sharedCredential === undefined
    ? undefined
    : { apiKey: sharedCredential, ...(identityToken === undefined ? {} : { identityToken }) }
}

function token(size: number): string {
  return randomBytes(size).toString('base64url')
}

function challenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

function callbackPage(res: import('node:http').ServerResponse, ok: boolean): void {
  res.statusCode = ok ? 200 : 400
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${ok ? '正在验证授权' : '授权失败'}</title><body><main><h1>${ok ? '授权信息已收到' : '授权未完成'}</h1><p>${ok ? 'DSH 正在验证并保存 API Key；请返回 DSH 查看最终登录状态。' : '请返回 DSH 后重新发起登录。'}</p></main></body></html>`)
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Loomloom callback did not bind a loopback port')
  return address.port
}

async function close(server: Server): Promise<void> {
  await new Promise<void>(resolve => server.close(() => resolve()))
}

async function exchangeCode(
  code: string,
  verifier: string,
  callbackUrl: string,
  signal: AbortSignal,
  accountKeysUrl: string,
): Promise<ShengsuanyunBrowserCredential> {
  let response: Response
  try {
    const endpoint = new URL(accountKeysUrl)
    endpoint.searchParams.set('from', AUTH_CHANNEL)
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: verifier, callback_url: callbackUrl }),
      redirect: 'manual',
      signal,
    })
  } catch {
    throw new LoomApiError(502, '胜算云授权服务暂时不可用')
  }
  const body = await response.text()
  if (body.length > MAX_EXCHANGE_BYTES) throw new LoomApiError(502, '胜算云授权响应过大')
  if (!response.ok) throw new LoomApiError(response.status, '胜算云授权码兑换失败')
  let payload: ExchangeEnvelope
  try { payload = JSON.parse(body) as ExchangeEnvelope } catch { throw new LoomApiError(502, '胜算云授权响应无效') }
  if (!successCode(payload.code)) throw new LoomApiError(502, '胜算云授权码兑换失败')
  const value = browserCredentialFromEnvelope(payload)
  if (value === undefined) throw new LoomApiError(502, '胜算云授权未返回有效凭据')
  return value
}

export interface BrowserAuthorization {
  readonly url: string
  readonly result: Promise<ShengsuanyunBrowserCredential>
}

export interface BrowserAuthorizationOptions {
  readonly authPageUrl?: string
  readonly accountKeysUrl?: string
  readonly timeoutMs?: number
}

function stringList(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').map(item => item.toLowerCase())
    : []
}

function supportsChatCompletions(item: Record<string, unknown>): boolean {
  const declared = [
    ...stringList(item.capabilities),
    ...stringList(item.supported_generation_methods),
    ...stringList(item.supportedGenerationMethods),
    ...stringList(item.supported_endpoints),
    ...stringList(item.supportedEndpoints),
  ]
  if (declared.length === 0) return true
  return declared.some(value =>
    value === 'chat'
    || value === 'chat-completions'
    || value === 'chat_completions'
    || value.endsWith('/chat/completions'),
  )
}

function routerModels(payload: unknown): readonly string[] {
  if (typeof payload !== 'object' || payload === null || !Array.isArray((payload as Record<string, unknown>).data)) {
    throw new RouterCredentialError('router-validation-failed', 502, '胜算云模型目录响应无效')
  }
  const ids = (payload as { readonly data: readonly unknown[] }).data.flatMap(item => {
    if (typeof item !== 'object' || item === null) return []
    const record = item as Record<string, unknown>
    if (!supportsChatCompletions(record)) return []
    const id = record.id
    return typeof id === 'string' && id.trim() !== '' ? [id] : []
  })
  if (ids.length === 0) throw new RouterCredentialError('no-chat-model', 422, '胜算云账号当前没有可用聊天模型')
  return ids
}

async function boundedRouterBody(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declared) && declared > MAX_ROUTER_MODELS_BYTES) {
    await response.body?.cancel()
    throw new RouterCredentialError('router-validation-failed', 502, '胜算云模型目录响应过大')
  }
  const reader = response.body?.getReader()
  if (reader === undefined) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const next = await reader.read()
    if (next.done) break
    size += next.value.byteLength
    if (size > MAX_ROUTER_MODELS_BYTES) {
      await reader.cancel()
      throw new RouterCredentialError('router-validation-failed', 502, '胜算云模型目录响应过大')
    }
    chunks.push(next.value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

/**
 * Starts one loopback PKCE authorization. The verifier and state stay in this
 * Host-only closure and the resulting credential is returned only to the
 * authorization flow that initiated it.
 */
export async function beginBrowserAuthorization(
  signal: AbortSignal,
  options: BrowserAuthorizationOptions = {},
): Promise<BrowserAuthorization> {
  const authPageUrl = options.authPageUrl ?? AUTH_PAGE_URL
  const accountKeysUrl = options.accountKeysUrl ?? ACCOUNT_API_URL
  const verifier = token(32)
  const state = token(16)
  let settle: (value: ShengsuanyunBrowserCredential) => void = () => {}
  let reject: (cause: unknown) => void = () => {}
  let consumed = false
  const result = new Promise<ShengsuanyunBrowserCredential>((resolve, rejectResult) => { settle = resolve; reject = rejectResult })
  const server = createServer((req, res) => {
    const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (req.method !== 'GET' || requestUrl.pathname !== '/callback' || consumed) { callbackPage(res, false); return }
    const code = requestUrl.searchParams.get('code')
    const returnedState = requestUrl.searchParams.get('state')
    if (returnedState !== state) {
      callbackPage(res, false)
      return
    }
    if (requestUrl.searchParams.get('error') !== null) {
      consumed = true
      callbackPage(res, false)
      reject(new LoomApiError(400, '胜算云授权已取消'))
      return
    }
    if (code === null || code.trim() === '') { callbackPage(res, false); return }
    consumed = true
    callbackPage(res, true)
    void (async () => {
      try { settle(await exchangeCode(code, verifier, callbackUrl, signal, accountKeysUrl)) } catch (cause) { reject(cause) }
    })()
  })
  const port = await listen(server)
  // The production authorization service does not consistently echo an OAuth
  // `state` parameter.  Bind it into the registered loopback callback too, so
  // the callback remains state-bound whether the service echoes it or not.
  const callbackUrl = `http://127.0.0.1:${port}/callback?state=${encodeURIComponent(state)}`
  const authorize = new URL(authPageUrl)
  authorize.searchParams.set('app_name', 'DSH Desktop')
  authorize.searchParams.set('callback_url', callbackUrl)
  authorize.searchParams.set('from', AUTH_CHANNEL)
  authorize.searchParams.set('code_challenge', challenge(verifier))
  authorize.searchParams.set('code_challenge_method', 'S256')
  authorize.searchParams.set('state', state)
  const timeout = setTimeout(() => reject(new LoomApiError(408, '等待胜算云浏览器授权超时')), options.timeoutMs ?? AUTH_TIMEOUT_MS)
  const abort = () => reject(signal.reason ?? new DOMException('aborted', 'AbortError'))
  signal.addEventListener('abort', abort, { once: true })
  void result.finally(async () => {
    clearTimeout(timeout)
    signal.removeEventListener('abort', abort)
    await close(server)
  }).catch(() => {})
  return { url: authorize.toString(), result }
}

/**
 * Verifies the shared key against the model Router. This stays Host-only so
 * neither the key nor the raw Router response can enter the renderer.
 */
export async function verifyShengsuanyunRouterCredential(tokenValue: string, signal: AbortSignal): Promise<readonly string[]> {
  let response: Response
  try {
    response = await fetch(ROUTER_MODELS_URL, {
      headers: { accept: 'application/json', authorization: `Bearer ${tokenValue}` },
      signal,
    })
  } catch {
    throw new RouterCredentialError('router-validation-failed', 502, '胜算云模型服务暂时不可用')
  }
  const body = await boundedRouterBody(response)
  if (!response.ok) throw new RouterCredentialError('router-validation-failed', response.status, '胜算云模型凭据验证失败')
  let payload: unknown
  try { payload = JSON.parse(body) } catch {
    throw new RouterCredentialError('router-validation-failed', 502, '胜算云模型目录响应无效')
  }
  return routerModels(payload)
}

/** Verifies the Loom API half of the shared credential before it is persisted. */
export async function verifyLoomCredential(tokenValue: string, config: ResolvedLoomConfig, signal: AbortSignal): Promise<void> {
  const api = new LoomApi({ ...config, token: tokenValue }, async () => tokenValue)
  await api.request('/users/me/runs?pageSize=1', {}, signal)
}

/** Verifies both Loom and Router access for callers that do not expose progress. */
export async function verifyBrowserCredential(tokenValue: string, config: ResolvedLoomConfig, signal: AbortSignal): Promise<readonly string[]> {
  const [loom, router] = await Promise.allSettled([
    verifyLoomCredential(tokenValue, config, signal),
    verifyShengsuanyunRouterCredential(tokenValue, signal),
  ])
  if (loom.status === 'rejected') throw loom.reason
  if (router.status === 'rejected') throw router.reason
  return router.value
}
