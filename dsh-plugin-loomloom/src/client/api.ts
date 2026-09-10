export interface LoomCredentialStatus {
  readonly configured: boolean
}

export interface LoomAccount {
  readonly configured: boolean
  readonly uid?: string
  readonly displayName?: string
  readonly email?: string
  readonly photoUrl?: string
  readonly balance?: string
  readonly isCreator?: boolean
}

/** Non-secret readiness facts used to decide whether first-run UI is needed. */
export interface LoomBootstrap {
  readonly credential: LoomCredentialStatus
  readonly loom: 'unknown' | 'ready' | 'unavailable'
  readonly router: 'unknown' | 'ready' | 'unavailable'
  readonly model: {
    readonly provider: 'shengsuanyun'
    readonly id?: string
    readonly ready: boolean
  }
}

export interface LoomBrowserLoginStart {
  readonly sessionId: string
  readonly url: string
}

export type LoomBrowserLoginState =
  | 'pending'
  | 'verifying-loom'
  | 'verifying-router'
  | 'model-selection-required'
  | 'complete'
  | 'cancelled'
  | 'failed'

export type LoomBrowserLoginReason =
  | 'browser-unavailable'
  | 'authorization-cancelled'
  | 'authorization-timeout'
  | 'loom-validation-failed'
  | 'router-validation-failed'
  | 'no-chat-model'
  | 'credential-save-failed'

export interface LoomBrowserLoginStatus {
  readonly state: LoomBrowserLoginState
  readonly reason?: LoomBrowserLoginReason
}

export interface LoomListing {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly available: boolean
  readonly fixedFee?: string
}

export interface LoomSkillbotPage {
  readonly listings: readonly LoomListing[]
  readonly nextPageToken?: string
}

export interface LoomField {
  readonly key: string
  readonly label: string
  readonly required: boolean
  readonly valueType: string
  readonly description?: string
  readonly enumValues?: readonly string[]
}

export interface LoomSkillbotDetail extends LoomListing {
  readonly fields: readonly LoomField[]
}

export interface LoomMarketQuote {
  readonly estimatedBuyerPayable: string
  readonly currency?: string
  readonly taskFixedFee?: string
}

export interface LoomRun {
  readonly id: string
  readonly displayName: string
  readonly status: string
  readonly updatedAt?: string
}

export class LoomClientApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'LoomClientApiError'
  }
}

type JsonRecord = Record<string, unknown>
const ID_PATTERN = /^[A-Za-z0-9._-]{1,200}$/

function record(value: unknown): JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonRecord : {}
}

function string(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function monetary(value: unknown): { readonly amount: string, readonly currency?: string } {
  if (typeof value === 'string') return { amount: value.trim() }
  const item = record(value)
  const amount = string(item.amount ?? item.value)
  const currency = string(item.currency ?? item.currencyCode)
  return {
    amount,
    ...(currency === '' ? {} : { currency }),
  }
}

function listing(value: unknown): LoomListing {
  const item = record(value)
  const fee = record(item.taskFixedFee)
  const id = string(item.id ?? item.listingId ?? item.marketListingId)
  if (id === '') throw new LoomClientApiError('loomloom returned an invalid SkillBot', 502)
  const amount = string(fee.amount)
  return {
    id,
    name: string(item.displayName ?? item.name) || id,
    description: string(item.description),
    available: string(item.executionAvailabilityStatus).toLowerCase() === 'available',
    ...(amount === '' ? {} : { fixedFee: amount }),
  }
}

function field(value: unknown): LoomField | undefined {
  const item = record(value)
  const key = string(item.key ?? item.name ?? item.fieldKey)
  if (key === '') return undefined
  const rawEnums = item.enum_values ?? item.enumValues
  const enumValues = Array.isArray(rawEnums) ? rawEnums.filter((entry): entry is string => typeof entry === 'string') : undefined
  return {
    key,
    label: string(item.label ?? item.title ?? item.displayName) || key,
    required: item.required === true || item.isRequired === true,
    valueType: string(item.value_type ?? item.valueType ?? item.type) || 'string',
    ...(string(item.description ?? item.desc ?? item.inputHint ?? item.help) === '' ? {} : { description: string(item.description ?? item.desc ?? item.inputHint ?? item.help) }),
    ...(enumValues === undefined || enumValues.length === 0 ? {} : { enumValues }),
  }
}

function fields(value: unknown): readonly LoomField[] {
  const item = record(value)
  const snapshot = item.inputSchemaSnapshot
  let schema: JsonRecord = {}
  if (typeof snapshot === 'string') {
    try { schema = record(JSON.parse(snapshot)) } catch { return [] }
  } else schema = record(snapshot)
  return Array.isArray(schema.fields) ? schema.fields.map(field).filter((value): value is LoomField => value !== undefined) : []
}

async function readJson<T>(input: RequestInfo | URL, signal?: AbortSignal): Promise<T> {
  const response = await fetch(input, { cache: 'no-store', ...(signal === undefined ? {} : { signal }) })
  let payload: JsonRecord
  try {
    payload = record(await response.json())
  } catch {
    throw new LoomClientApiError('loomloom returned an invalid response', 502)
  }
  if (!response.ok) throw new LoomClientApiError(string(payload.error) || `request failed: ${response.status}`, response.status)
  return payload as T
}

async function postJson<T>(
  input: RequestInfo | URL,
  signal?: AbortSignal,
  body?: unknown,
): Promise<T> {
  const response = await fetch(input, {
    method: 'POST',
    cache: 'no-store',
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    ...(signal === undefined ? {} : { signal }),
  })
  let payload: unknown
  try { payload = await response.json() } catch { throw new LoomClientApiError('loomloom returned an invalid response', 502) }
  if (!response.ok) {
    const details = record(payload)
    throw new LoomClientApiError(string(details.error) || `request failed: ${response.status}`, response.status)
  }
  return payload as T
}

function items(value: unknown): readonly unknown[] {
  const payload = record(value)
  const data = record(payload.data)
  return Array.isArray(payload.items) ? payload.items
    : Array.isArray(data.items) ? data.items
      : Array.isArray(payload.listings) ? payload.listings
        : Array.isArray(data.listings) ? data.listings
          : []
}

function detail(value: unknown): unknown {
  const payload = record(value)
  const data = record(payload.data)
  return data.listing ?? payload.listing ?? data.marketListing ?? payload.marketListing ?? data ?? payload
}

function run(value: unknown): LoomRun {
  const item = record(value)
  const nested = record(item.run ?? item.data)
  const id = string(nested.runId ?? nested.id ?? item.runId ?? item.id)
  if (id === '') throw new LoomClientApiError('loomloom returned an invalid run', 502)
  const updatedAt = string(nested.updatedAt ?? nested.updated_at ?? item.updatedAt ?? item.updated_at)
  return {
    id,
    displayName: string(nested.displayName ?? nested.name ?? item.displayName ?? item.name) || id,
    status: string(nested.status ?? item.status) || 'unknown',
    ...(updatedAt === '' ? {} : { updatedAt }),
  }
}

export async function readCredentialStatus(signal?: AbortSignal): Promise<LoomCredentialStatus> {
  const result = await readJson<LoomCredentialStatus>('/api/loomloom/credentials', signal)
  return { configured: result.configured === true }
}

export async function readAccount(signal?: AbortSignal): Promise<LoomAccount> {
  const result = await readJson<Partial<LoomAccount>>('/api/loomloom/account', signal)
  const account: {
    configured: boolean
    uid?: string
    displayName?: string
    email?: string
    photoUrl?: string
    balance?: string
    isCreator?: boolean
  } = { configured: result.configured === true }
  const textFields = ['uid', 'displayName', 'email', 'photoUrl', 'balance'] as const
  for (const field of textFields) {
    const value = result[field]
    if (typeof value === 'string' && value.trim() !== '') {
      account[field] = value.trim()
    }
  }
  if (typeof result.isCreator === 'boolean') {
    account.isCreator = result.isCreator
  }
  return account
}

export async function readBootstrap(signal?: AbortSignal): Promise<LoomBootstrap> {
  const result = await readJson<Partial<LoomBootstrap>>('/api/loomloom/bootstrap', signal)
  const credential = record(result.credential)
  const model = record(result.model)
  const loom = result.loom === 'ready' || result.loom === 'unavailable' ? result.loom : 'unknown'
  const router = result.router === 'ready' || result.router === 'unavailable' ? result.router : 'unknown'
  const id = string(model.id)
  return {
    credential: { configured: credential.configured === true },
    loom,
    router,
    model: {
      provider: 'shengsuanyun',
      ...(id === '' ? {} : { id }),
      ready: model.ready === true,
    },
  }
}

export async function logout(signal?: AbortSignal): Promise<void> {
  await postJson<{ readonly configured?: boolean }>('/api/loomloom/credentials/logout', signal)
}

export async function startBrowserLogin(signal?: AbortSignal): Promise<LoomBrowserLoginStart> {
  const result = await postJson<LoomBrowserLoginStart>('/api/loomloom/login/start', signal)
  if (!/^[A-Za-z0-9_-]{32}$/.test(result.sessionId) || !result.url.startsWith('https://')) {
    throw new LoomClientApiError('loomloom returned an invalid login session', 502)
  }
  return result
}

export async function readBrowserLoginStatus(sessionId: string, signal?: AbortSignal): Promise<LoomBrowserLoginStatus> {
  if (!/^[A-Za-z0-9_-]{32}$/.test(sessionId)) throw new LoomClientApiError('invalid login session', 400)
  const url = new URL('/api/loomloom/login/status', window.location.origin)
  url.searchParams.set('sessionId', sessionId)
  const result = await readJson<{ readonly state?: unknown, readonly reason?: unknown }>(url, signal)
  const state = result.state
  const reason = result.reason
  if (
    state === 'pending'
    || state === 'verifying-loom'
    || state === 'verifying-router'
    || state === 'model-selection-required'
    || state === 'complete'
    || state === 'cancelled'
    || state === 'failed'
  ) {
    return {
      state,
      ...(reason === 'browser-unavailable'
        || reason === 'authorization-cancelled'
        || reason === 'authorization-timeout'
        || reason === 'loom-validation-failed'
        || reason === 'router-validation-failed'
        || reason === 'no-chat-model'
        || reason === 'credential-save-failed'
        ? { reason }
        : {}),
    }
  }
  throw new LoomClientApiError('loomloom returned an invalid login session', 502)
}

export async function cancelBrowserLogin(sessionId: string, signal?: AbortSignal): Promise<void> {
  if (!/^[A-Za-z0-9_-]{32}$/.test(sessionId)) throw new LoomClientApiError('invalid login session', 400)
  const url = new URL('/api/loomloom/login/cancel', window.location.origin)
  url.searchParams.set('sessionId', sessionId)
  await postJson<{ readonly cancelled?: boolean }>(url, signal)
}

export async function readSkillbotsPage(options: {
  readonly pageSize?: number
  readonly pageToken?: string
  readonly signal?: AbortSignal
} = {}): Promise<LoomSkillbotPage> {
  const query = new URLSearchParams({ pageSize: String(options.pageSize ?? 30) })
  if (options.pageToken !== undefined && options.pageToken !== '') {
    query.set('pageToken', options.pageToken)
  }
  const payload = await readJson<unknown>(`/api/loomloom/market?${query.toString()}`, options.signal)
  const root = record(payload)
  const data = record(root.data)
  const nextPageToken = string(root.nextPageToken ?? root.next_page_token ?? data.nextPageToken ?? data.next_page_token)
  return {
    listings: items(payload).map(listing),
    ...(nextPageToken === '' ? {} : { nextPageToken }),
  }
}

export async function readSkillbots(signal?: AbortSignal): Promise<readonly LoomListing[]> {
  const page = signal === undefined
    ? await readSkillbotsPage({ pageSize: 100 })
    : await readSkillbotsPage({ pageSize: 100, signal })
  return page.listings
}

export async function readSkillbot(listingId: string, signal?: AbortSignal): Promise<LoomSkillbotDetail> {
  if (!ID_PATTERN.test(listingId)) throw new LoomClientApiError('invalid SkillBot id', 400)
  const url = new URL('/api/loomloom/market/skillbot', window.location.origin)
  url.searchParams.set('listingId', listingId)
  const payload = await readJson<unknown>(url, signal)
  const nested = detail(payload)
  return { ...listing(nested), fields: fields(nested) }
}

export async function quoteSkillbot(
  listingId: string,
  inputRows: readonly Record<string, unknown>[],
  listingVersionId = '',
  signal?: AbortSignal,
): Promise<LoomMarketQuote> {
  if (!ID_PATTERN.test(listingId)) throw new LoomClientApiError('invalid SkillBot id', 400)
  const url = new URL('/api/loomloom/market/skillbot/quote', window.location.origin)
  url.searchParams.set('listingId', listingId)
  const payload = await postJson<LoomMarketQuote>(url, signal, { inputRows, listingVersionId })
  const root = record(payload)
  const quote = record(root.quote ?? root.data)
  const payable = monetary(quote.estimatedBuyerPayable ?? quote.buyerPayable ?? root.estimatedBuyerPayable)
  const fee = monetary(quote.taskFixedFee ?? root.taskFixedFee)
  return {
    estimatedBuyerPayable: payable.amount,
    ...(payable.currency === undefined && string(quote.currency ?? root.currency) === ''
      ? {}
      : { currency: payable.currency ?? string(quote.currency ?? root.currency) }),
    ...(fee.amount === '' ? {} : { taskFixedFee: fee.amount }),
  }
}

export async function executeSkillbot(
  listingId: string,
  inputRows: readonly Record<string, unknown>[],
  listingVersionId = '',
  signal?: AbortSignal,
): Promise<unknown> {
  if (!ID_PATTERN.test(listingId)) throw new LoomClientApiError('invalid SkillBot id', 400)
  const url = new URL('/api/loomloom/market/skillbot/execute', window.location.origin)
  url.searchParams.set('listingId', listingId)
  return await postJson<unknown>(url, signal, {
    inputRows,
    listingVersionId,
    clientRequestId: `loomloom-ui-${crypto.randomUUID()}`,
    confirm: true,
  })
}

export async function readRuns(signal?: AbortSignal): Promise<readonly LoomRun[]> {
  return items(await readJson<unknown>('/api/loomloom/runs', signal)).map(run).slice(0, 20)
}

export async function readRun(runId: string, signal?: AbortSignal): Promise<LoomRun> {
  if (!ID_PATTERN.test(runId)) throw new LoomClientApiError('invalid run id', 400)
  const url = new URL('/api/loomloom/runs/status', window.location.origin)
  url.searchParams.set('runId', runId)
  return run(await readJson<unknown>(url, signal))
}
