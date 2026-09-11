const DEFAULT_BASE_URL = 'https://loomloom.shengsuanyun.com/loom/v1'
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
/** Workbook downloads are binary and larger than JSON responses. */
const MAX_BINARY_BYTES = 16 * 1024 * 1024
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

/**
 * Opaque Market listing id. Shared by configuration parsing and the Host routes
 * so a configured storefront id can never become a path-shaping value.
 */
export const MARKET_LISTING_ID_PATTERN = /^[A-Za-z0-9._-]{1,200}$/u

export interface LoomConfig {
  readonly baseUrl?: string
  /** Credential-reference name resolved by DSH credentials on every request. */
  readonly tokenRef?: string
  /** @deprecated Use tokenRef. Kept for existing local profile rows. */
  readonly tokenEnv?: string
  /** Local-development override only. Never expose it to a Client. */
  readonly token?: string
  /**
   * Storefront allow-list: the Market listing ids this build presents.
   *
   * The public Market list endpoint returns no creator identifier at all (every
   * `creator` is `{ nickname: "" }`), so a single-creator storefront cannot be
   * derived from it. Fixing the ids at build time keeps the whole storefront on
   * anonymous public reads. Authoring order is display order.
   *
   * An empty or absent list means "no storefront configured": the plugin then
   * issues no upstream request and the surface reports the missing
   * configuration. It deliberately never falls back to the full public market,
   * because a white-label build exposing other creators' SkillBots is a worse
   * failure than an empty page.
   */
  readonly storefrontListingIds?: readonly string[]
  /**
   * Name of the environment variable holding a **creator** credential.
   *
   * When set, the storefront stops being a pinned id list and is *derived* on
   * every refresh from `GET /creators/me/marketListings` with that credential:
   * the creator's `published` + `listed` SkillBots become the market, so a newly
   * published SkillBot appears without anyone editing a build file.
   *
   * Only `published` + `listed` entries are taken. The public detail route answers
   * `404` for anything unlisted, so a draft or withdrawn id could only ever render
   * as "no longer listed" — advertising it would be dishonest.
   *
   * This is deliberately a *variable name*, not a value, mirroring `tokenRef` and
   * the DSH `apiKeyEnv` convention: the environment carries the secret, the
   * composed config carries only the name. The credential is used solely for
   * discovery; every listing detail is still read anonymously.
   */
  readonly creatorKeyEnv?: string
}

/**
 * Operator override for the storefront allow-list.
 *
 * A comma-separated list of Market listing ids. When this variable is set it
 * **wins over** the composed config, so a demo or a local run can point the
 * market at another creator without editing a build file. It follows the same
 * shape as the credential knobs (`apiKeyEnv` / `tokenRef`): the environment names
 * the value, the config carries the default.
 *
 * Leaving it unset keeps the build's pinned storefront, which is the deterministic
 * behaviour a shipped white-label client wants.
 */
export const STOREFRONT_IDS_ENV = 'LOOMLOOM_STOREFRONT_IDS'

/**
 * Reads the override list.
 *
 * Entries are split on commas and trimmed; blank entries are dropped so a
 * trailing comma is not an error. An unset or all-blank variable reads as "no
 * override", not as "no storefront" — clearing a build's storefront should take
 * an explicit empty config, not a stray empty environment variable.
 */
export function envStorefrontListingIds(env: Record<string, string | undefined>): readonly string[] | undefined {
  const raw = env[STOREFRONT_IDS_ENV]
  if (raw === undefined) return undefined
  const entries = raw.split(',').map(entry => entry.trim()).filter(entry => entry !== '')
  return entries.length === 0 ? undefined : entries
}

/** Reject a configured id early, at composition time, instead of at first render. */
function storefrontListingId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : ''
  if (id === '') throw new Error('loomloom storefrontListingIds must not contain an empty id')
  if (!MARKET_LISTING_ID_PATTERN.test(id)) {
    throw new Error(`loomloom storefrontListingIds entry is not a Market listing id: ${id}`)
  }
  return id
}

/** Deduplicate configured storefront ids while preserving authoring order. */
export function normalizeStorefrontListingIds(value: unknown): readonly string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error('loomloom storefrontListingIds must be an array of Market listing ids')
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const entry of value) {
    const id = storefrontListingId(entry)
    if (seen.has(id)) continue
    seen.add(id)
    normalized.push(id)
  }
  return normalized
}

export class LoomApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'LoomApiError'
  }
}

export interface ResolvedLoomConfig {
  readonly baseUrl: URL
  readonly token: string | undefined
  readonly tokenRef: string
  readonly storefrontListingIds: readonly string[]
  readonly creatorKeyEnv: string | undefined
}

/** A binary download (a workbook) carried as base64 across the host boundary. */
export interface BinaryPayload {
  readonly base64: string
  readonly byteLength: number
  readonly contentType: string
  readonly filename?: string
}

/** Make an upstream filename safe for a Content-Disposition response header. */
export function sanitizeDownloadFilename(value: string): string | undefined {
  let decoded = value.trim()
  try { decoded = decodeURIComponent(decoded) } catch {}
  const filename = decoded.replace(/[\u0000-\u001F\u007F"\\/:*?<>|]/gu, '_').trim()
  return filename === '' ? undefined : filename
}

/** Extract the preferred `filename*` or `filename` Content-Disposition parameter. */
function suggestedFilename(header: string | null): string | undefined {
  if (header === null) return undefined
  const extended = /(?:^|;)\s*filename\*=UTF-8''([^;]+)/iu.exec(header)?.[1]
  const plain = /(?:^|;)\s*filename="?([^";]+)"?/iu.exec(header)?.[1]
  return extended === undefined && plain === undefined ? undefined : sanitizeDownloadFilename(extended ?? plain ?? '')
}

/**
 * Resolves the effective plugin configuration.
 * @param config - the composed `cordis.patch.yml` config for this plugin row.
 * @param env - environment consulted for the storefront override. Passed in
 *   rather than read from `process.env` so a caller (and a test) controls it.
 */
export function resolveLoomConfig(
  config: LoomConfig = {},
  env: Record<string, string | undefined> = process.env,
): ResolvedLoomConfig {
  const rawUrl = config.baseUrl ?? DEFAULT_BASE_URL
  const baseUrl = new URL(rawUrl.endsWith('/') ? rawUrl : `${rawUrl}/`)
  if (baseUrl.protocol !== 'https:' || baseUrl.username || baseUrl.password || baseUrl.hash) {
    throw new Error('loomloom baseUrl must be an HTTPS origin without credentials or fragment')
  }
  // `shengsuanyun` is also the provider id recommended by the DSH Models UI,
  // which derives this same credential reference.  One platform key therefore
  // serves the Model Router and Loomloom Market without copying secrets.
  const tokenRef = config.tokenRef ?? config.tokenEnv ?? 'SHENGSUANYUN_API_KEY'
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(tokenRef)) throw new Error('loomloom tokenRef must be a POSIX environment variable name')
  const token = config.token === undefined || config.token.trim() === '' ? undefined : config.token.trim()
  const creatorKeyEnv = config.creatorKeyEnv === undefined ? undefined : config.creatorKeyEnv.trim()
  if (creatorKeyEnv !== undefined && !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(creatorKeyEnv)) {
    throw new Error('loomloom creatorKeyEnv must be a POSIX environment variable name')
  }
  return {
    baseUrl,
    token,
    tokenRef,
    creatorKeyEnv,
    storefrontListingIds: normalizeStorefrontListingIds(
      creatorKeyEnv === undefined ? envStorefrontListingIds(env) ?? config.storefrontListingIds : config.storefrontListingIds,
    ),
  }
}

async function readBoundedBody(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (reader === undefined) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const next = await reader.read()
    if (next.done) break
    size += next.value.byteLength
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined)
      throw new LoomApiError(502, 'loomloom response exceeded size limit')
    }
    chunks.push(next.value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

async function readBoundedBinary(response: Response): Promise<Buffer> {
  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null && /^\d+$/u.test(declaredLength) && Number(declaredLength) > MAX_BINARY_BYTES) {
    throw new LoomApiError(502, 'loomloom workbook response exceeded size limit')
  }
  const reader = response.body?.getReader()
  if (reader === undefined) return Buffer.alloc(0)
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const next = await reader.read()
    if (next.done) break
    size += next.value.byteLength
    if (size > MAX_BINARY_BYTES) {
      await reader.cancel().catch(() => undefined)
      throw new LoomApiError(502, 'loomloom workbook response exceeded size limit')
    }
    chunks.push(next.value)
  }
  return Buffer.concat(chunks)
}

export class LoomApi {
  constructor(
    private readonly config: ResolvedLoomConfig,
    private readonly resolveToken: () => Promise<string | undefined> = async () => config.token,
  ) {}

  private requestSignal(signal?: AbortSignal): { readonly signal: AbortSignal, readonly timeout: AbortSignal } {
    const timeout = AbortSignal.timeout(DEFAULT_REQUEST_TIMEOUT_MS)
    return { signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]), timeout }
  }

  private transportFailure(signal: AbortSignal | undefined, timeout: AbortSignal): LoomApiError {
    if (signal?.aborted) return new LoomApiError(499, 'loomloom request was cancelled')
    if (timeout.aborted) return new LoomApiError(504, 'loomloom service timed out')
    return new LoomApiError(502, 'loomloom service is unavailable')
  }

  async request(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<unknown> {
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('loomloom path must be absolute and local to configured API')
    const headers = new Headers(init.headers)
    headers.set('accept', 'application/json')
    const token = await this.resolveToken()
    if (token !== undefined && token.trim() !== '') headers.set('authorization', `Bearer ${token.trim()}`)
    if (init.body !== undefined) headers.set('content-type', 'application/json')
    const requestSignal = this.requestSignal(signal)
    let response: Response
    try {
      response = await fetch(new URL(path.slice(1), this.config.baseUrl), {
        ...init,
        headers,
        signal: requestSignal.signal,
      })
    } catch {
      throw this.transportFailure(signal, requestSignal.timeout)
    }
    const text = await readBoundedBody(response)
    let payload: unknown = null
    try { payload = text === '' ? null : JSON.parse(text) } catch { throw new LoomApiError(502, 'loomloom returned invalid JSON') }
    if (!response.ok) {
      const message = typeof payload === 'object' && payload !== null
        ? String((payload as Record<string, unknown>).error ?? (payload as Record<string, unknown>).message ?? 'loomloom request failed')
        : 'loomloom request failed'
      throw new LoomApiError(response.status, message)
    }
    return payload
  }

  /**
   * Fetch a binary response (an `.xlsx` workbook) and return it base64 encoded
   * together with the suggested filename. Binary endpoints never carry a JSON
   * error body, so a non-OK status is surfaced by status code alone.
   */
  async requestBinary(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<BinaryPayload> {
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('loomloom path must be absolute and local to configured API')
    const headers = new Headers(init.headers)
    headers.set('accept', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/octet-stream')
    const token = await this.resolveToken()
    if (token !== undefined && token.trim() !== '') headers.set('authorization', `Bearer ${token.trim()}`)
    const requestSignal = this.requestSignal(signal)
    let response: Response
    try {
      response = await fetch(new URL(path.slice(1), this.config.baseUrl), {
        ...init,
        headers,
        signal: requestSignal.signal,
      })
    } catch {
      throw this.transportFailure(signal, requestSignal.timeout)
    }
    if (!response.ok) throw new LoomApiError(response.status, `loomloom workbook request failed with status ${response.status}`)
    const body = await readBoundedBinary(response)
    const filename = suggestedFilename(response.headers.get('content-disposition'))
    return {
      base64: body.toString('base64'),
      byteLength: body.byteLength,
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
      ...(filename === undefined ? {} : { filename }),
    }
  }
}
