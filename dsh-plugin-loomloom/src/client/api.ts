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
  /** `string` | `integer` | `enum` | `asset_ref` | `text_reference` in the published vocabulary. */
  readonly valueType: string
  /** Authoring order published by the listing; forms render in ascending order. */
  readonly order: number
  readonly description?: string
  readonly placeholder?: string
  /** `input` | `text` | `textarea` | `select` in the published vocabulary; absent on many fields. */
  readonly widget?: string
  readonly defaultValue?: string
  readonly enumValues?: readonly string[]
  readonly acceptedMimeTypes?: readonly string[]
  readonly maxValues?: number
}

export interface LoomSkillbotDetail extends LoomListing {
  readonly fields: readonly LoomField[]
}

export interface LoomMarketQuote {
  readonly estimatedBuyerPayable: string
  readonly confirmationToken: string
  readonly currency?: string
  readonly taskFixedFee?: string
}

/**
 * One SkillBot as the storefront presents it.
 *
 * Unlike {@link LoomListing} — which maps the full public market list — this comes
 * from the storefront route, so it carries the version and update time the
 * preview must show and already-parsed input fields.
 */
export interface LoomStorefrontEntry extends LoomListing {
  /** Published version label, e.g. `v1`. */
  readonly version?: string
  /** Last publication time, ISO-8601. */
  readonly updatedAt?: string
  readonly creatorNickname?: string
  readonly currency?: string
  readonly fields: readonly LoomField[]
}

/**
 * Which source produced the storefront.
 *
 * Mirrors `StorefrontSource` in `src/storefront.ts`. The two cannot share a module
 * (`tsconfig.client.json` scopes the Client program to `src/client/**`), so the
 * union is repeated; `creator-key-missing` is the state that matters, because it
 * means the market is empty for a configuration reason rather than a data one.
 */
export type LoomStorefrontSource = 'creator' | 'pinned' | 'creator-key-missing' | 'none'

export interface LoomStorefront {
  /** False when this build configures no storefront source at all. */
  readonly configured: boolean
  /** Which source is live: derived from a creator credential, pinned ids, or neither. */
  readonly source: LoomStorefrontSource
  readonly entries: readonly LoomStorefrontEntry[]
  /** Configured SkillBots the Market no longer lists. */
  readonly unavailable: readonly string[]
  readonly fetchedAt: string
  /** True when the last refresh failed and this is the last good snapshot. */
  readonly stale: boolean
  readonly error?: string
}

/** One run row in the Settings run history. */
export interface LoomRun {
  readonly id: string
  readonly displayName: string
  readonly status: string
  readonly updatedAt?: string
  /** Task counters published with the run summary; absent on some responses. */
  readonly totalTasks?: number
  readonly completedTasks?: number
  readonly failedTasks?: number
  readonly firstErrorMessage?: string
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

/** Fields without a published order keep their schema position, after every ordered field. */
const UNORDERED_FIELD = Number.MAX_SAFE_INTEGER

function stringList(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
    : []
}

/** `default_value` reaches us as a string in the published schema but may be a scalar. */
function scalarText(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return String(value)
  const text = string(value)
  return text === '' ? undefined : text
}

/**
 * Reads one published input field.
 *
 * The live schema carries far more than the ids the older mapping read:
 * `presentation.hint` holds the authoring hint most listings populate,
 * `presentation.widget` and `order` drive how the form is drawn, and
 * `default_value`, `accepted_mime_types` and `max_values` describe the value the
 * field accepts. Dropping them is what reduced the form to bare text boxes (the
 * `style` field of the presentation generator offers 26 options, all of them
 * encoded in its hint).
 *
 * Legacy keys stay supported because the chat tools and older snapshot rows vary.
 */
function field(value: unknown): LoomField | undefined {
  const item = record(value)
  const key = string(item.key ?? item.name ?? item.fieldKey)
  if (key === '') return undefined
  const presentation = record(item.presentation)
  const enumValues = stringList(item.enum_values ?? item.enumValues)
  const acceptedMimeTypes = stringList(item.accepted_mime_types ?? item.acceptedMimeTypes)
  const description = string(item.description ?? item.desc)
    || string(presentation.hint ?? item.inputHint ?? item.help)
  const placeholder = string(presentation.placeholder ?? item.placeholder)
  const widget = string(presentation.widget ?? item.widget)
  const defaultValue = scalarText(item.default_value ?? item.defaultValue)
  const maxValues = typeof item.max_values === 'number' && Number.isFinite(item.max_values)
    ? item.max_values
    : undefined
  const order = typeof item.order === 'number' && Number.isFinite(item.order) ? item.order : UNORDERED_FIELD
  return {
    key,
    label: string(item.label ?? item.title ?? item.displayName) || key,
    required: item.required === true || item.isRequired === true,
    valueType: string(item.value_type ?? item.valueType ?? item.type) || 'string',
    order,
    ...(description === '' ? {} : { description }),
    ...(placeholder === '' ? {} : { placeholder }),
    ...(widget === '' ? {} : { widget }),
    ...(defaultValue === undefined ? {} : { defaultValue }),
    ...(enumValues.length === 0 ? {} : { enumValues }),
    ...(acceptedMimeTypes.length === 0 ? {} : { acceptedMimeTypes }),
    ...(maxValues === undefined ? {} : { maxValues }),
  }
}

function fields(value: unknown): readonly LoomField[] {
  const item = record(value)
  const snapshot = item.inputSchemaSnapshot
  let schema: JsonRecord = {}
  if (typeof snapshot === 'string') {
    try { schema = record(JSON.parse(snapshot)) } catch { return [] }
  } else schema = record(snapshot)
  if (!Array.isArray(schema.fields)) return []
  return schema.fields
    .map(field)
    .filter((value): value is LoomField => value !== undefined)
    .sort((left, right) => left.order - right.order)
}

/** Maps one Host-normalized storefront entry; a worthless entry is dropped. */
function storefrontEntry(value: unknown): LoomStorefrontEntry | undefined {
  const item = record(value)
  const id = string(item.id)
  if (id === '') return undefined
  const fixedFee = string(item.fixedFee)
  const currency = string(item.currency)
  const version = string(item.version)
  const updatedAt = string(item.updatedAt)
  const creatorNickname = string(item.creatorNickname)
  return {
    id,
    name: string(item.name) || id,
    description: string(item.description),
    available: item.available === true,
    fields: fields(item),
    ...(fixedFee === '' ? {} : { fixedFee }),
    ...(currency === '' ? {} : { currency }),
    ...(version === '' ? {} : { version }),
    ...(updatedAt === '' ? {} : { updatedAt }),
    ...(creatorNickname === '' ? {} : { creatorNickname }),
  }
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

/** Any of the ids `listing()` accepts; used to recognize a listing-shaped node. */
function listingId(value: unknown): string {
  const item = record(value)
  return string(item.id ?? item.listingId ?? item.marketListingId)
}

/**
 * Unwraps the listing from whichever envelope the Host (or a test double) used.
 *
 * The live Market detail route answers with a **flat** listing: `id`,
 * `displayName`, `version`, `updatedAt` and friends sit at the top level, with no
 * `data` wrapper. An earlier version of this function wrote
 * `... ?? data ?? payload`, but `record(undefined)` is `{}` — a truthy empty
 * object — so the `payload` fallback was unreachable and every real detail read
 * collapsed to `{}` and failed with "invalid SkillBot". Selecting a SkillBot is
 * therefore matched against listing shape instead of against envelope presence.
 */
function detail(value: unknown): unknown {
  const payload = record(value)
  const data = record(payload.data)
  const candidates = [
    data.listing,
    payload.listing,
    data.marketListing,
    payload.marketListing,
    data,
    payload,
  ]
  return candidates.find(candidate => listingId(candidate) !== '') ?? payload
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

function optionalCount<Key extends 'totalTasks' | 'completedTasks' | 'failedTasks'>(
  key: Key,
  value: unknown,
): Partial<Record<Key, number>> {
  return typeof value === 'number' && Number.isFinite(value) ? { [key]: value } as Record<Key, number> : {}
}

function run(value: unknown): LoomRun {
  const item = record(value)
  const nested = record(item.run ?? item.data)
  const id = string(nested.runId ?? nested.id ?? item.runId ?? item.id)
  if (id === '') throw new LoomClientApiError('loomloom returned an invalid run', 502)
  const updatedAt = string(nested.updatedAt ?? nested.updated_at ?? item.updatedAt ?? item.updated_at)
  const firstErrorMessage = string(nested.firstErrorMessage ?? item.firstErrorMessage)
  return {
    id,
    displayName: string(nested.displayName ?? nested.name ?? item.displayName ?? item.name) || id,
    status: string(nested.status ?? item.status) || 'unknown',
    ...(updatedAt === '' ? {} : { updatedAt }),
    ...optionalCount('totalTasks', nested.totalTasks ?? item.totalTasks),
    ...optionalCount('completedTasks', nested.completedTasks ?? item.completedTasks),
    ...optionalCount('failedTasks', nested.failedTasks ?? item.failedTasks),
    ...(firstErrorMessage === '' ? {} : { firstErrorMessage }),
  }
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

/**
 * Reads this build's configured storefront.
 *
 * Every value here is anonymous public Market data, so this runs before any
 * credential exists — browsing a storefront never requires signing in.
 * @param refresh - ask the Host to bypass its cached snapshot.
 */
export async function readStorefront(refresh = false, signal?: AbortSignal): Promise<LoomStorefront> {
  const url = new URL('/api/loomloom/storefront', window.location.origin)
  if (refresh) url.searchParams.set('refresh', '1')
  const payload = record(await readJson<unknown>(url, signal))
  const error = string(payload.error)
  const rawSource = payload.source
  const source: LoomStorefrontSource = rawSource === 'creator'
    || rawSource === 'pinned'
    || rawSource === 'creator-key-missing'
    || rawSource === 'none'
    ? rawSource
    : 'none'
  return {
    configured: payload.configured === true,
    source,
    entries: (Array.isArray(payload.entries) ? payload.entries : [])
      .map(storefrontEntry)
      .filter((value): value is LoomStorefrontEntry => value !== undefined),
    unavailable: Array.isArray(payload.unavailable)
      ? payload.unavailable.filter((value): value is string => typeof value === 'string')
      : [],
    fetchedAt: string(payload.fetchedAt),
    stale: payload.stale === true,
    ...(error === '' ? {} : { error }),
  }
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
  signal?: AbortSignal,
): Promise<LoomMarketQuote> {
  if (!ID_PATTERN.test(listingId)) throw new LoomClientApiError('invalid SkillBot id', 400)
  const url = new URL('/api/loomloom/market/skillbot/quote', window.location.origin)
  url.searchParams.set('listingId', listingId)
  const payload = await postJson<LoomMarketQuote>(url, signal, { inputRows })
  const root = record(payload)
  const quote = record(root.quote ?? root.data)
  const payable = monetary(quote.estimatedBuyerPayable ?? quote.buyerPayable ?? root.estimatedBuyerPayable)
  const fee = monetary(quote.taskFixedFee ?? root.taskFixedFee)
  const confirmationToken = string(root.confirmationToken)
  if (confirmationToken === '') throw new LoomClientApiError('loomloom quote did not return a confirmation token', 502)
  return {
    estimatedBuyerPayable: payable.amount,
    confirmationToken,
    ...(payable.currency === undefined && string(quote.currency ?? root.currency) === ''
      ? {}
      : { currency: payable.currency ?? string(quote.currency ?? root.currency) }),
    ...(fee.amount === '' ? {} : { taskFixedFee: fee.amount }),
  }
}

export async function executeSkillbot(
  listingId: string,
  inputRows: readonly Record<string, unknown>[],
  confirmationToken: string,
  signal?: AbortSignal,
): Promise<unknown> {
  if (!ID_PATTERN.test(listingId)) throw new LoomClientApiError('invalid SkillBot id', 400)
  if (confirmationToken.trim() === '') throw new LoomClientApiError('invalid quote confirmation', 400)
  const url = new URL('/api/loomloom/market/skillbot/execute', window.location.origin)
  url.searchParams.set('listingId', listingId)
  return await postJson<unknown>(url, signal, {
    inputRows,
    clientRequestId: `loomloom-ui-${crypto.randomUUID()}`,
    confirmationToken,
    confirm: true,
  })
}

export interface LoomInputAsset {
  readonly inputAssetId: string
  readonly filename: string
  readonly mimeType: string
  readonly sizeBytes: number
}

/**
 * Uploads one file input.
 *
 * `value_type: asset_ref` fields are satisfied by the returned `inputAssetId`, so
 * the bytes only ever pass through the Host; the form keeps the id, not the file.
 */
export async function uploadInputAsset(
  filename: string,
  contentType: string,
  contentBase64: string,
  signal?: AbortSignal,
): Promise<LoomInputAsset> {
  const payload = record(await postJson<unknown>('/api/loomloom/inputAssets', signal, {
    filename,
    contentType,
    content: contentBase64,
  }))
  const inputAssetId = string(payload.inputAssetId)
  if (inputAssetId === '') throw new LoomClientApiError('loomloom returned an invalid input asset', 502)
  const sizeBytes = payload.sizeBytes
  return {
    inputAssetId,
    filename: string(payload.filename) || filename,
    mimeType: string(payload.mimeType) || contentType,
    sizeBytes: typeof sizeBytes === 'number' && Number.isFinite(sizeBytes) ? sizeBytes : 0,
  }
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
