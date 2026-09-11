import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { LoomCredentialStatus } from './credentials.js'
import type { LoomBrowserLoginService } from './browser-login.js'
import type { LoomBootstrap } from './bootstrap.js'
import type { LoomAccount } from './account.js'
import type { StorefrontCache } from './storefront-cache.js'
import type { StorefrontSource } from './storefront.js'
import { createHash, randomUUID } from 'node:crypto'
import { LoomApi, LoomApiError, sanitizeDownloadFilename } from './loom-api.js'

const PREFIX = '/api/loomloom'
const ID_PATTERN = /^[A-Za-z0-9._-]{1,200}$/
const LOGIN_SESSION_PATTERN = /^[A-Za-z0-9_-]{32}$/
const CLIENT_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,200}$/
const CONFIRMATION_TOKEN_PATTERN = /^[A-Za-z0-9-]{36}$/
const MAX_JSON_REQUEST_BYTES = 512 * 1024
const MAX_WORKBOOK_BYTES = 16 * 1024 * 1024
const MAX_WORKBOOK_REQUEST_BYTES = Math.ceil(MAX_WORKBOOK_BYTES * 4 / 3) + 64 * 1024
const QUOTE_TTL_MS = 10 * 60_000
const MAX_QUOTE_DRAFTS = 100

interface QuoteDraft {
  readonly kind: 'rows' | 'workbook'
  readonly listingId: string
  readonly fingerprint: string
  readonly expiresAt: number
  clientRequestId?: string
}

class QuoteDraftStore {
  readonly #drafts = new Map<string, QuoteDraft>()

  create(kind: QuoteDraft['kind'], listingId: string, fingerprint: string): string {
    this.prune()
    if (this.#drafts.size >= MAX_QUOTE_DRAFTS) {
      const oldest = this.#drafts.keys().next().value as string | undefined
      if (oldest !== undefined) this.#drafts.delete(oldest)
    }
    const token = randomUUID()
    this.#drafts.set(token, { kind, listingId, fingerprint, expiresAt: Date.now() + QUOTE_TTL_MS })
    return token
  }

  require(token: unknown, kind: QuoteDraft['kind'], listingId: string, fingerprint: string, clientRequestId: string): string {
    this.prune()
    if (typeof token !== 'string' || !CONFIRMATION_TOKEN_PATTERN.test(token)) {
      throw new LoomApiError(403, 'execution requires a valid quote confirmation')
    }
    const draft = this.#drafts.get(token)
    if (draft === undefined || draft.kind !== kind || draft.listingId !== listingId || draft.fingerprint !== fingerprint) {
      throw new LoomApiError(403, 'quote confirmation is unavailable or does not match the execution input')
    }
    if (draft.clientRequestId !== undefined && draft.clientRequestId !== clientRequestId) {
      throw new LoomApiError(409, 'an ambiguous retry must reuse the original clientRequestId')
    }
    draft.clientRequestId = clientRequestId
    return token
  }

  consume(token: string): void {
    this.#drafts.delete(token)
  }

  private prune(): void {
    const now = Date.now()
    for (const [token, draft] of this.#drafts) {
      if (draft.expiresAt <= now) this.#drafts.delete(token)
    }
  }
}

function inputFingerprint(listingId: string, value: unknown): string {
  return createHash('sha256').update(listingId).update('\0').update(JSON.stringify(value)).digest('hex')
}

function withConfirmationToken(value: unknown, confirmationToken: string): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? { ...value as Record<string, unknown>, confirmationToken }
    : { data: value, confirmationToken }
}
/**
 * File inputs publish `value_type: asset_ref`, which is satisfied by uploading
 * the bytes and submitting the returned `inputAssetId`. Base64 inflates by about
 * a third, so the request ceiling is set above the decoded file ceiling rather
 * than reusing the ordinary JSON body cap.
 */
const MAX_INPUT_ASSET_BYTES = 4 * 1024 * 1024
const MAX_INPUT_ASSET_REQUEST_BYTES = 6 * 1024 * 1024
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/u
const MEDIA_TYPE_PATTERN = /^[\w.+-]+\/[\w.+-]+$/u

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(JSON.stringify(value))
}

/**
 * Stream a downloaded workbook back to the caller. Binary payloads cross the
 * upstream boundary as base64 (the CLI's `[]byte` JSON encoding), so the route
 * decodes once and sets a download filename the browser can honour.
 */
function sendBinary(res: ServerResponse, payload: { base64: string, contentType: string, filename: string }): void {
  res.statusCode = 200
  res.setHeader('content-type', payload.contentType)
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  res.setHeader('content-disposition', `attachment; filename="${sanitizeDownloadFilename(payload.filename) ?? 'download.xlsx'}"`)
  res.end(Buffer.from(payload.base64, 'base64'))
}

function sameAuthority(req: IncomingMessage, port: number): boolean {
  const host = req.headers.host?.toLowerCase()
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`
}

function apiFailure(res: ServerResponse, cause: unknown): void {
  if (cause instanceof LoomApiError) sendJson(res, cause.status >= 400 && cause.status < 600 ? cause.status : 502, { error: cause.message })
  else sendJson(res, 400, { error: cause instanceof Error ? cause.message : 'invalid request' })
}

function credentialFailure(res: ServerResponse): void {
  // Credential backends can attach implementation details to their errors. The
  // browser only needs to know that status is temporarily unavailable.
  sendJson(res, 503, { error: 'loomloom credential status is unavailable' })
}

async function requestBody(req: IncomingMessage, maxBytes = MAX_JSON_REQUEST_BYTES): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;|$)/iu.test(req.headers['content-type'] ?? '')) {
    throw new LoomApiError(415, 'content-type must be application/json')
  }

  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk)
    size += bytes.byteLength
    if (size > maxBytes) throw new LoomApiError(413, 'request body is too large')
    chunks.push(bytes)
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error()
    return value as Record<string, unknown>
  } catch {
    throw new LoomApiError(400, 'request body must be a JSON object')
  }
}

function workbookPayload(body: Record<string, unknown>): { readonly filename: string, readonly content: string } {
  const filename = typeof body.filename === 'string' ? body.filename.trim() : ''
  const content = typeof body.content === 'string' ? body.content.trim() : ''
  if (filename === '' || content === '') throw new LoomApiError(400, 'filename and content are required')
  if (filename.length > 255) throw new LoomApiError(400, 'filename is too long')
  if (content.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(content)) {
    throw new LoomApiError(400, 'content must be valid base64')
  }
  if (Buffer.byteLength(content, 'base64') > MAX_WORKBOOK_BYTES) {
    throw new LoomApiError(413, 'workbook is too large')
  }
  return { filename, content }
}

/**
 * Forward a filled workbook to one upstream workbook action. The client sends
 * `{ filename, content }` where content is base64 bytes (the same encoding the
 * upstream expects from the Go CLI), plus a `listingId` query parameter. The
 * paid run action additionally requires an explicit confirmation and a
 * stable idempotency key.
 */
async function forwardWorkbookAction(
  req: IncomingMessage,
  res: ServerResponse,
  api: LoomApi,
  action: string,
  mode: 'prepare' | 'quote' | 'execute',
  quoteDrafts: QuoteDraftStore,
): Promise<void> {
  await forwardWorkbookTo(req, res, api, id => `/marketListings/${encodeURIComponent(id)}${action}`, 'listingId', mode, quoteDrafts)
}

/** The official-template variant of {@link forwardWorkbookAction}. */
async function forwardTemplateWorkbookAction(
  req: IncomingMessage,
  res: ServerResponse,
  api: LoomApi,
  action: string,
): Promise<void> {
  await forwardWorkbookTo(req, res, api, id => `/officialTemplates/${encodeURIComponent(id)}${action}`, 'templateId', 'prepare')
}

async function forwardWorkbookTo(
  req: IncomingMessage,
  res: ServerResponse,
  api: LoomApi,
  pathFor: (id: string) => string,
  idParam: string,
  mode: 'prepare' | 'quote' | 'execute',
  quoteDrafts?: QuoteDraftStore,
): Promise<void> {
  try {
    const id = new URL(req.url ?? '/', 'http://localhost').searchParams.get(idParam)
    if (id === null || !ID_PATTERN.test(id)) throw new LoomApiError(400, `invalid ${idParam}`)
    const body = await requestBody(req, MAX_WORKBOOK_REQUEST_BYTES)
    const { filename, content } = workbookPayload(body)
    const payload: Record<string, unknown> = { filename, content }
    const fingerprint = inputFingerprint(id, payload)
    if (mode === 'execute') {
      if (quoteDrafts === undefined) throw new LoomApiError(503, 'workbook quote confirmation is unavailable')
      if (body.confirm !== true) throw new LoomApiError(403, 'workbook execution requires explicit confirmation')
      if (typeof body.clientRequestId !== 'string' || !CLIENT_REQUEST_ID_PATTERN.test(body.clientRequestId)) {
        throw new LoomApiError(400, 'workbook execution requires a valid clientRequestId')
      }
      const confirmationToken = quoteDrafts.require(body.confirmationToken, 'workbook', id, fingerprint, body.clientRequestId)
      payload.confirm = true
      payload.clientRequestId = body.clientRequestId
      const response = await api.request(pathFor(id), { method: 'POST', body: JSON.stringify(payload) })
      quoteDrafts.consume(confirmationToken)
      sendJson(res, 200, response)
      return
    }
    const response = await api.request(pathFor(id), { method: 'POST', body: JSON.stringify(payload) })
    if (mode === 'quote') {
      if (quoteDrafts === undefined) throw new LoomApiError(503, 'workbook quote confirmation is unavailable')
      sendJson(res, 200, withConfirmationToken(response, quoteDrafts.create('workbook', id, fingerprint)))
      return
    }
    sendJson(res, 200, response)
  } catch (cause) { apiFailure(res, cause) }
}

/**
 * Optional Host surfaces registered after the original route set.
 *
 * These arrived later than the positional dependencies above, and each one is a
 * separately owned capability rather than another credential reader; grouping
 * them keeps the call site readable as the surface grows.
 */
export interface LoomRouteExtras {
  /** Last-good storefront over the configured Market listing allow-list. */
  readonly storefront?: StorefrontCache
  /**
   * Which storefront source is live. Published so a caller can tell a derived
   * creator storefront from a pinned list, and can see a missing creator
   * credential rather than guessing why the market is empty.
   */
  readonly storefrontSource?: StorefrontSource
}

export function registerLoomRoutes(
  ctx: Context,
  api: LoomApi,
  readCredentialStatus: () => Promise<LoomCredentialStatus>,
  browserLogin?: LoomBrowserLoginService,
  clearCredential?: () => Promise<void>,
  readBootstrap?: () => Promise<LoomBootstrap>,
  readAccount?: () => Promise<LoomAccount>,
  extras: LoomRouteExtras = {},
): () => void {
  const port = ctx.webServer.port
  const quoteDrafts = new QuoteDraftStore()
  const register = (path: string, handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>) =>
    ctx.webServer.register({ kind: 'exact', path, handler })
  const requireOrigin = (req: IncomingMessage, res: ServerResponse): boolean => {
    if (!sameAuthority(req, port)) {
      sendJson(res, 403, { error: 'loomloom request authority rejected' })
      return false
    }
    if (req.method === 'GET' || req.method === 'HEAD') return true
    const host = req.headers.host?.toLowerCase()
    if (host !== undefined && req.headers.origin === `http://${host}`) return true
    sendJson(res, 403, { error: 'loomloom request authority rejected' })
    return false
  }
  const routes = [
    register(`${PREFIX}/health`, async (req, res) => {
      if (req.method !== 'GET' || !requireOrigin(req, res)) return
      sendJson(res, 200, { ok: true })
    }),
    register(`${PREFIX}/credentials`, async (req, res) => {
      if (req.method !== 'GET' || !requireOrigin(req, res)) return
      try { sendJson(res, 200, await readCredentialStatus()) } catch { credentialFailure(res) }
    }),
    register(`${PREFIX}/bootstrap`, async (req, res) => {
      if (req.method !== 'GET' || !requireOrigin(req, res)) return
      try {
        if (readBootstrap !== undefined) {
          sendJson(res, 200, await readBootstrap())
          return
        }
        const credential = await readCredentialStatus()
        sendJson(res, 200, {
          credential,
          loom: 'unknown',
          router: 'unknown',
          model: { provider: 'shengsuanyun', ready: false },
        })
      } catch { credentialFailure(res) }
    }),
    register(`${PREFIX}/account`, async (req, res) => {
      if (req.method !== 'GET' || !requireOrigin(req, res)) return
      if (readAccount === undefined) { sendJson(res, 503, { error: 'loomloom account is unavailable' }); return }
      try { sendJson(res, 200, await readAccount()) } catch (cause) { apiFailure(res, cause) }
    }),
    register(`${PREFIX}/credentials/logout`, async (req, res) => {
      if (req.method !== 'POST' || !requireOrigin(req, res)) return
      if (clearCredential === undefined) { sendJson(res, 503, { error: 'loomloom logout is unavailable' }); return }
      try { await clearCredential(); sendJson(res, 200, { configured: false }) } catch { credentialFailure(res) }
    }),
    register(`${PREFIX}/login/start`, async (req, res) => {
      if (req.method !== 'POST' || !requireOrigin(req, res)) return
      if (browserLogin === undefined) { sendJson(res, 503, { error: 'loomloom browser login is unavailable' }); return }
      try { sendJson(res, 200, await browserLogin.start()) } catch { sendJson(res, 503, { error: 'loomloom browser login is unavailable' }) }
    }),
    register(`${PREFIX}/login/status`, async (req, res) => {
      if (req.method !== 'GET' || !requireOrigin(req, res)) return
      if (browserLogin === undefined) { sendJson(res, 503, { error: 'loomloom browser login is unavailable' }); return }
      const sessionId = new URL(req.url ?? '/', 'http://localhost').searchParams.get('sessionId')
      if (sessionId === null || !LOGIN_SESSION_PATTERN.test(sessionId)) { sendJson(res, 400, { error: 'invalid login session' }); return }
      const status = browserLogin.status(sessionId)
      if (status === undefined) { sendJson(res, 404, { error: 'login session not found' }); return }
      sendJson(res, 200, status)
    }),
    register(`${PREFIX}/login/cancel`, async (req, res) => {
      if (req.method !== 'POST' || !requireOrigin(req, res)) return
      if (browserLogin === undefined) { sendJson(res, 503, { error: 'loomloom browser login is unavailable' }); return }
      const sessionId = new URL(req.url ?? '/', 'http://localhost').searchParams.get('sessionId')
      if (sessionId === null || !LOGIN_SESSION_PATTERN.test(sessionId)) { sendJson(res, 400, { error: 'invalid login session' }); return }
      await browserLogin.cancel(sessionId)
      // Deliberately idempotent: callers must not be able to probe session ids.
      sendJson(res, 200, { cancelled: true })
    }),
    register(`${PREFIX}/storefront`, async (req, res) => {
      if (req.method !== 'GET' || !requireOrigin(req, res)) return
      if (extras.storefront === undefined) { sendJson(res, 503, { error: 'loomloom storefront is unavailable' }); return }
      // `refresh=1` is the refresh control: it re-reads the Market instead of
      // serving the cached storefront. Both paths answer 200 so the Client has
      // one shape to render; a failed refresh still reports the last good
      // storefront together with `stale` and `error`.
      const force = new URL(req.url ?? '/', 'http://localhost').searchParams.get('refresh') === '1'
      try {
        const result = await extras.storefront.read(force)
        // The Client renders the reason; the log keeps it discoverable after the
        // page is gone, which is the only way to diagnose an empty market.
        if (result.error !== undefined) ctx.logger.warn(`loomloom: storefront refresh failed: ${result.error}`)
        sendJson(res, 200, { ...result, source: extras.storefrontSource ?? 'none' })
      } catch (cause) { apiFailure(res, cause) }
    }),
    register(`${PREFIX}/market`, async (req, res) => {
      if (req.method !== 'GET' || !requireOrigin(req, res)) return
      const query = new URL(req.url ?? '/', 'http://localhost').searchParams
      const rawPageSize = Number(query.get('pageSize') ?? '100')
      if (!Number.isInteger(rawPageSize) || rawPageSize < 1 || rawPageSize > 100) {
        sendJson(res, 400, { error: 'pageSize must be an integer from 1 to 100' })
        return
      }
      const upstream = new URLSearchParams({ pageSize: String(rawPageSize) })
      const pageToken = query.get('pageToken')
      if (pageToken !== null && pageToken !== '') upstream.set('pageToken', pageToken)
      const keyword = query.get('keyword')
      if (keyword !== null && keyword !== '') upstream.set('keyword', keyword)
      try { sendJson(res, 200, await api.request(`/marketListings?${upstream.toString()}`)) } catch (cause) { apiFailure(res, cause) }
    }),
    register(`${PREFIX}/market/skillbot`, async (req, res) => {
      if (req.method !== 'GET' || !requireOrigin(req, res)) return
      const listingId = new URL(req.url ?? '/', 'http://localhost').searchParams.get('listingId')
      if (listingId === null || !ID_PATTERN.test(listingId)) { sendJson(res, 400, { error: 'invalid listingId' }); return }
      try { sendJson(res, 200, await api.request(`/marketListings/${encodeURIComponent(listingId)}`)) } catch (cause) { apiFailure(res, cause) }
    }),
    register(`${PREFIX}/inputAssets`, async (req, res) => {
      if (req.method !== 'POST' || !requireOrigin(req, res)) return
      try {
        const body = await requestBody(req, MAX_INPUT_ASSET_REQUEST_BYTES)
        const filename = typeof body.filename === 'string' ? body.filename.trim() : ''
        const contentType = typeof body.contentType === 'string' ? body.contentType.trim() : ''
        const content = typeof body.content === 'string' ? body.content.trim() : ''
        if (filename === '' || filename.length > 255) throw new LoomApiError(400, 'filename must be a non-empty name of at most 255 characters')
        if (!MEDIA_TYPE_PATTERN.test(contentType)) throw new LoomApiError(400, 'contentType must be a media type')
        // Validate the encoding before decoding: Buffer.from(..., 'base64') silently
        // drops invalid characters, which would upload a truncated file.
        if (content === '' || content.length % 4 !== 0 || !BASE64_PATTERN.test(content)) {
          throw new LoomApiError(400, 'content must be base64 data')
        }
        if (Buffer.from(content, 'base64').byteLength > MAX_INPUT_ASSET_BYTES) {
          throw new LoomApiError(413, 'input asset exceeds the upload limit')
        }
        sendJson(res, 200, await api.request(
          '/inputAssets:upload',
          { method: 'POST', body: JSON.stringify({ content, contentType, filename }) },
        ))
      } catch (cause) { apiFailure(res, cause) }
    }),
    register(`${PREFIX}/market/skillbot/quote`, async (req, res) => {
      if (req.method !== 'POST' || !requireOrigin(req, res)) return
      try {
        const listingId = new URL(req.url ?? '/', 'http://localhost').searchParams.get('listingId')
        if (listingId === null || !ID_PATTERN.test(listingId)) throw new LoomApiError(400, 'invalid listingId')
        const body = await requestBody(req)
        const inputRows = body.inputRows
        if (!Array.isArray(inputRows) || inputRows.length < 1 || inputRows.length > 100) {
          throw new LoomApiError(400, 'inputRows must contain 1-100 rows')
        }
        const response = await api.request(
          `/marketListings/${encodeURIComponent(listingId)}:quote`,
          { method: 'POST', body: JSON.stringify({ inputRows }) },
        )
        const confirmationToken = quoteDrafts.create('rows', listingId, inputFingerprint(listingId, inputRows))
        sendJson(res, 200, withConfirmationToken(response, confirmationToken))
      } catch (cause) { apiFailure(res, cause) }
    }),
    register(`${PREFIX}/market/skillbot/execute`, async (req, res) => {
      if (req.method !== 'POST' || !requireOrigin(req, res)) return
      try {
        const listingId = new URL(req.url ?? '/', 'http://localhost').searchParams.get('listingId')
        if (listingId === null || !ID_PATTERN.test(listingId)) throw new LoomApiError(400, 'invalid listingId')
        const body = await requestBody(req)
        if (body.confirm !== true) throw new LoomApiError(403, 'execution requires explicit confirmation')
        const inputRows = body.inputRows
        if (!Array.isArray(inputRows) || inputRows.length < 1 || inputRows.length > 100) {
          throw new LoomApiError(400, 'inputRows must contain 1-100 rows')
        }
        if (typeof body.clientRequestId !== 'string' || !CLIENT_REQUEST_ID_PATTERN.test(body.clientRequestId)) {
          throw new LoomApiError(400, 'execution requires a valid clientRequestId')
        }
        const confirmationToken = quoteDrafts.require(
          body.confirmationToken,
          'rows',
          listingId,
          inputFingerprint(listingId, inputRows),
          body.clientRequestId,
        )
        const response = await api.request(
          `/marketListings/${encodeURIComponent(listingId)}:execute`,
          {
            method: 'POST',
            body: JSON.stringify({ inputRows, clientRequestId: body.clientRequestId, confirm: true }),
          },
        )
        quoteDrafts.consume(confirmationToken)
        sendJson(res, 200, response)
      } catch (cause) { apiFailure(res, cause) }
    }),
    register(`${PREFIX}/runs`, async (req, res) => {
      if (req.method !== 'GET' || !requireOrigin(req, res)) return
      try { sendJson(res, 200, await api.request('/users/me/runs?pageSize=50')) } catch (cause) { apiFailure(res, cause) }
    }),
    register(`${PREFIX}/runs/status`, async (req, res) => {
      if (req.method !== 'GET' || !requireOrigin(req, res)) return
      const runId = new URL(req.url ?? '/', 'http://localhost').searchParams.get('runId')
      if (runId === null || !ID_PATTERN.test(runId)) { sendJson(res, 400, { error: 'invalid runId' }); return }
      try { sendJson(res, 200, await api.request(`/users/me/runs/${encodeURIComponent(runId)}`)) } catch (cause) { apiFailure(res, cause) }
    }),
    register(`${PREFIX}/balance`, async (req, res) => {
      if (req.method !== 'GET' || !requireOrigin(req, res)) return
      try { sendJson(res, 200, await api.request('/users/me/balance')) } catch (cause) { apiFailure(res, cause) }
    }),
    register(`${PREFIX}/creator/listings`, async (req, res) => {
      if (req.method !== 'GET' || !requireOrigin(req, res)) return
      try { sendJson(res, 200, await api.request('/creators/me/marketListings?pageSize=100')) } catch (cause) { apiFailure(res, cause) }
    }),
    register(`${PREFIX}/creator/transactions`, async (req, res) => {
      if (req.method !== 'GET' || !requireOrigin(req, res)) return
      try { sendJson(res, 200, await api.request('/creators/me/marketTransactions?pageSize=100')) } catch (cause) { apiFailure(res, cause) }
    }),
    register(`${PREFIX}/creator/earnings`, async (req, res) => {
      if (req.method !== 'GET' || !requireOrigin(req, res)) return
      const limit = new URL(req.url ?? '/', 'http://localhost').searchParams.get('pageSize') ?? '100'
      if (!/^\d{1,4}$/u.test(limit)) { sendJson(res, 400, { error: 'invalid pageSize' }); return }
      try { sendJson(res, 200, await api.request(`/creators/me/earnings?pageSize=${limit}`)) } catch (cause) { apiFailure(res, cause) }
    }),
    register(`${PREFIX}/templates`, async (req, res) => {
      if (req.method !== 'GET' || !requireOrigin(req, res)) return
      try { sendJson(res, 200, await api.request('/officialTemplates')) } catch (cause) { apiFailure(res, cause) }
    }),
    register(`${PREFIX}/templates/schema`, async (req, res) => {
      if (req.method !== 'GET' || !requireOrigin(req, res)) return
      const templateId = new URL(req.url ?? '/', 'http://localhost').searchParams.get('templateId')
      if (templateId === null || !ID_PATTERN.test(templateId)) { sendJson(res, 400, { error: 'invalid templateId' }); return }
      try { sendJson(res, 200, await api.request(`/officialTemplates/${encodeURIComponent(templateId)}/schema`)) } catch (cause) { apiFailure(res, cause) }
    }),
    register(`${PREFIX}/my-templates`, async (req, res) => {
      if (req.method !== 'GET' || !requireOrigin(req, res)) return
      try { sendJson(res, 200, await api.request('/users/me/templates?pageSize=50')) } catch (cause) { apiFailure(res, cause) }
    }),
    register(`${PREFIX}/templates/workbook/validate`, async (req, res) => {
      if (req.method !== 'POST' || !requireOrigin(req, res)) return
      await forwardTemplateWorkbookAction(req, res, api, ':validateWorkbook')
    }),
    register(`${PREFIX}/templates/workbook/precheck`, async (req, res) => {
      if (req.method !== 'POST' || !requireOrigin(req, res)) return
      await forwardTemplateWorkbookAction(req, res, api, ':precheckWorkbook')
    }),
    register(`${PREFIX}/market/workbook`, async (req, res) => {
      if (req.method !== 'GET' || !requireOrigin(req, res)) return
      const listingId = new URL(req.url ?? '/', 'http://localhost').searchParams.get('listingId')
      if (listingId === null || !ID_PATTERN.test(listingId)) { sendJson(res, 400, { error: 'invalid listingId' }); return }
      try {
        const workbook = await api.requestBinary(`/marketListings/${encodeURIComponent(listingId)}/workbook`)
        sendBinary(res, { ...workbook, filename: workbook.filename ?? `${listingId}.xlsx` })
      } catch (cause) { apiFailure(res, cause) }
    }),
    register(`${PREFIX}/templates/workbook`, async (req, res) => {
      if (req.method !== 'GET' || !requireOrigin(req, res)) return
      const templateId = new URL(req.url ?? '/', 'http://localhost').searchParams.get('templateId')
      if (templateId === null || !ID_PATTERN.test(templateId)) { sendJson(res, 400, { error: 'invalid templateId' }); return }
      try {
        const workbook = await api.requestBinary(`/officialTemplates/${encodeURIComponent(templateId)}/workbook`)
        sendBinary(res, { ...workbook, filename: workbook.filename ?? `${templateId}.xlsx` })
      } catch (cause) { apiFailure(res, cause) }
    }),
    register(`${PREFIX}/orchestration-input`, async (req, res) => {
      if (req.method !== 'POST' || !requireOrigin(req, res)) return
      try {
        const body = await requestBody(req)
        const filename = typeof body.filename === 'string' ? body.filename.trim() : ''
        const content = typeof body.content === 'string' ? body.content : ''
        if (filename === '' || content === '') throw new LoomApiError(400, 'filename and content are required')
        sendJson(res, 200, await api.request('/orchestrationInputs:upload', {
          method: 'POST',
          body: JSON.stringify({ filename, content: Buffer.from(content, 'utf8').toString('base64') }),
        }))
      } catch (cause) { apiFailure(res, cause) }
    }),
    register(`${PREFIX}/market/workbook/validate`, async (req, res) => {
      if (req.method !== 'POST' || !requireOrigin(req, res)) return
      await forwardWorkbookAction(req, res, api, ':validateWorkbook', 'prepare', quoteDrafts)
    }),
    register(`${PREFIX}/market/workbook/quote`, async (req, res) => {
      if (req.method !== 'POST' || !requireOrigin(req, res)) return
      await forwardWorkbookAction(req, res, api, ':quoteWorkbook', 'quote', quoteDrafts)
    }),
    register(`${PREFIX}/market/workbook/run`, async (req, res) => {
      if (req.method !== 'POST' || !requireOrigin(req, res)) return
      await forwardWorkbookAction(req, res, api, ':executeWorkbook', 'execute', quoteDrafts)
    }),
  ]
  return () => routes.forEach(dispose => dispose())
}
