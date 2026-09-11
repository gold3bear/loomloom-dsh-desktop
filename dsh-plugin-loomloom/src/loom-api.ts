const DEFAULT_BASE_URL = 'https://loomloom.shengsuanyun.com/loom/v1'
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
/** Workbook downloads are binary and larger than JSON responses. */
const MAX_BINARY_BYTES = 16 * 1024 * 1024

export interface LoomConfig {
  readonly baseUrl?: string
  /** Credential-reference name resolved by DSH credentials on every request. */
  readonly tokenRef?: string
  /** @deprecated Use tokenRef. Kept for existing local profile rows. */
  readonly tokenEnv?: string
  /** Local-development override only. Never expose it to a Client. */
  readonly token?: string
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
}

/** A binary download (a workbook) carried as base64 across the host boundary. */
export interface BinaryPayload {
  readonly base64: string
  readonly byteLength: number
  readonly contentType: string
  readonly filename?: string
}

/** Extract the `filename` parameter of a Content-Disposition header, if any. */
function suggestedFilename(header: string | null): string | undefined {
  if (header === null) return undefined
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/iu.exec(header)
  const candidate = match?.[1]?.trim()
  if (candidate === undefined || candidate === '') return undefined
  // Never let an upstream header escape the caller's chosen directory.
  return candidate.replace(/[\\/]/gu, '_')
}

export function resolveLoomConfig(config: LoomConfig = {}): ResolvedLoomConfig {
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
  return { baseUrl, token, tokenRef }
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
    if (size > MAX_RESPONSE_BYTES) throw new LoomApiError(502, 'loomloom response exceeded size limit')
    chunks.push(next.value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

export class LoomApi {
  constructor(
    private readonly config: ResolvedLoomConfig,
    private readonly resolveToken: () => Promise<string | undefined> = async () => config.token,
  ) {}

  async request(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<unknown> {
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('loomloom path must be absolute and local to configured API')
    const headers = new Headers(init.headers)
    headers.set('accept', 'application/json')
    const token = await this.resolveToken()
    if (token !== undefined && token.trim() !== '') headers.set('authorization', `Bearer ${token.trim()}`)
    if (init.body !== undefined) headers.set('content-type', 'application/json')
    let response: Response
    try {
      response = await fetch(new URL(path.slice(1), this.config.baseUrl), {
        ...init,
        headers,
        ...(signal === undefined ? {} : { signal }),
      })
    } catch {
      throw new LoomApiError(502, 'loomloom service is unavailable')
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
    let response: Response
    try {
      response = await fetch(new URL(path.slice(1), this.config.baseUrl), {
        ...init,
        headers,
        ...(signal === undefined ? {} : { signal }),
      })
    } catch {
      throw new LoomApiError(502, 'loomloom service is unavailable')
    }
    if (!response.ok) throw new LoomApiError(response.status, `loomloom workbook request failed with status ${response.status}`)
    const body = Buffer.from(await response.arrayBuffer())
    if (body.byteLength > MAX_BINARY_BYTES) throw new LoomApiError(502, 'loomloom workbook response exceeded size limit')
    const filename = suggestedFilename(response.headers.get('content-disposition'))
    return {
      base64: body.toString('base64'),
      byteLength: body.byteLength,
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
      ...(filename === undefined ? {} : { filename }),
    }
  }
}
