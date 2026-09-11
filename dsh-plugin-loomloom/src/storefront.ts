import { MARKET_LISTING_ID_PATTERN, type LoomApi, type LoomApiError, type ResolvedLoomConfig } from './loom-api.js'

/**
 * How many listing details one storefront refresh reads at a time. A storefront
 * is one creator's catalogue, so the list is small; the bound exists to keep a
 * misconfigured allow-list from opening a few hundred sockets at once.
 */
export const STOREFRONT_CONCURRENCY = 6

/** Per-listing ceiling. One slow listing must not hold the whole storefront. */
export const STOREFRONT_REQUEST_TIMEOUT_MS = 10_000

/**
 * One SkillBot as the storefront presents it.
 *
 * The Host normalizes the public listing into this shape so the cache and the
 * Client contract stay stable, but it deliberately passes `inputSchemaSnapshot`
 * through verbatim: interpreting published input fields is the Client's job, and
 * duplicating that parser on the Host is how the two would drift apart.
 */
export interface StorefrontEntry {
  readonly id: string
  readonly name: string
  readonly description: string
  /** Published version label, e.g. `v1`. Only the detail route carries this. */
  readonly version?: string
  /** Last publication time, ISO-8601. Only the detail route carries this. */
  readonly updatedAt?: string
  readonly creatorNickname?: string
  readonly fixedFee?: string
  readonly currency?: string
  readonly available: boolean
  /** Raw published input schema; the Client maps it into form fields. */
  readonly inputSchemaSnapshot: string
}

/** One resolved storefront read, before any caching decision. */
export interface StorefrontRead {
  /**
   * False when no allow-list is configured. The surface reports a missing
   * storefront in that case, which is a different message from an empty
   * catalogue — an empty list would otherwise look like every SkillBot was
   * withdrawn.
   */
  readonly configured: boolean
  readonly entries: readonly StorefrontEntry[]
  /** Configured ids the Market no longer serves (unlisted or deleted). */
  readonly unavailable: readonly string[]
}

/**
 * How the storefront decides which SkillBots it presents.
 *
 * The three states are distinguished on purpose. Treating "creator mode is
 * configured but its credential is absent" as "fall back to the pinned list" would
 * make a misconfigured deployment look healthy while quietly no longer tracking new
 * publications, so `null` resolves to an empty storefront that the surface reports
 * as a missing credential.
 */
export interface StorefrontReaderOptions {
  /**
   * Creator-scoped discovery source.
   * - `undefined`: creator mode is off; the pinned allow-list is used.
   * - `null`: creator mode is on but no credential is present.
   * - an API bound to the creator credential: derive the id set from it.
   */
  readonly creator?: LoomApi | null
}

/**
 * Which storefront source is live. Reported to the Client so an operator can tell
 * a derived storefront from a pinned one, and can see a missing creator credential
 * instead of guessing why the market is empty.
 */
export type StorefrontSource = 'creator' | 'pinned' | 'creator-key-missing' | 'none'

/** Reads one named secret from an environment; unset or blank reads as absent. */
export function envSecret(env: Record<string, string | undefined>, name: string | undefined): string | undefined {
  if (name === undefined) return undefined
  const value = env[name]?.trim()
  return value === undefined || value === '' ? undefined : value
}

/** Resolves the live source from configuration plus the creator credential, if any. */
export function storefrontSourceFor(config: ResolvedLoomConfig, creatorKey: string | undefined): StorefrontSource {
  if (config.creatorKeyEnv !== undefined) return creatorKey === undefined ? 'creator-key-missing' : 'creator'
  return config.storefrontListingIds.length > 0 ? 'pinned' : 'none'
}

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonRecord : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Reads `{ amount, currency }`, tolerating a bare string. */
function money(value: unknown): { readonly amount: string, readonly currency: string } {
  if (typeof value === 'string') return { amount: value.trim(), currency: '' }
  const item = record(value)
  return { amount: text(item.amount ?? item.value), currency: text(item.currency ?? item.currencyCode) }
}

function entry(value: unknown, fallbackId: string): StorefrontEntry {
  const item = record(value)
  const creator = record(item.creator)
  const fee = money(item.taskFixedFee)
  const version = text(item.version)
  const updatedAt = text(item.updatedAt ?? item.updated_at)
  const creatorNickname = text(creator.nickname)
  const currency = fee.currency === '' ? text(item.currency) : fee.currency
  return {
    id: text(item.id ?? item.listingId) || fallbackId,
    name: text(item.displayName ?? item.name) || fallbackId,
    description: text(item.description),
    available: text(item.executionAvailabilityStatus).toLowerCase() === 'available',
    inputSchemaSnapshot: typeof item.inputSchemaSnapshot === 'string'
      ? item.inputSchemaSnapshot
      : JSON.stringify(record(item.inputSchemaSnapshot)),
    ...(version === '' ? {} : { version }),
    ...(updatedAt === '' ? {} : { updatedAt }),
    ...(creatorNickname === '' ? {} : { creatorNickname }),
    ...(fee.amount === '' ? {} : { fixedFee: fee.amount }),
    ...(currency === '' ? {} : { currency }),
  }
}

type Settled<R> =
  | { readonly ok: true, readonly value: R }
  | { readonly ok: false, readonly cause: unknown }

/**
 * Runs `work` over `items` with a fixed number of workers, preserving order.
 *
 * Every item settles before the caller resumes, so a failure never leaves a
 * request in flight behind a rejected promise.
 */
async function mapSettled<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<readonly Settled<R>[]> {
  const results: Settled<R>[] = new Array<Settled<R>>(items.length)
  let cursor = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      const item = items[index]
      if (item === undefined) continue
      try {
        results[index] = { ok: true, value: await work(item) }
      } catch (cause) {
        results[index] = { ok: false, cause }
      }
    }
  }
  const workerCount = Math.max(1, Math.min(limit, items.length))
  await Promise.all(Array.from({ length: workerCount }, worker))
  return results
}

/** Bound on creator pagination; a storefront is far smaller than this. */
const CREATOR_DISCOVERY_PAGE_SIZE = 200
const CREATOR_DISCOVERY_MAX_PAGES = 10

/** Newest first, undated entries last, ties broken by name for a stable order. */
function byRecency(left: StorefrontEntry, right: StorefrontEntry): number {
  const leftAt = left.updatedAt === undefined ? Number.NEGATIVE_INFINITY : Date.parse(left.updatedAt)
  const rightAt = right.updatedAt === undefined ? Number.NEGATIVE_INFINITY : Date.parse(right.updatedAt)
  if (leftAt !== rightAt) return rightAt - leftAt
  return left.name.localeCompare(right.name)
}

/**
 * Derives the storefront id set from the creator's own catalogue.
 *
 * `GET /creators/me/marketListings` is the only route that publishes a stable
 * creator↔listing relationship *and* the sale status, so it is what makes the
 * storefront track new publications instead of a hand-maintained id list. It is
 * read with the creator credential purely for discovery: every detail below is
 * still fetched anonymously, so the storefront content stays public data.
 *
 * `status: published` alone is not enough — the public market only carries
 * `saleStatus: listed`, and the public detail route answers `404` for anything
 * unlisted. Taking unlisted ids would put entries in the storefront that can never
 * resolve.
 */
async function discoverCreatorListingIds(creatorApi: LoomApi, signal?: AbortSignal): Promise<readonly string[]> {
  const ids: string[] = []
  const seen = new Set<string>()
  let pageToken: string | undefined
  for (let page = 0; page < CREATOR_DISCOVERY_MAX_PAGES; page += 1) {
    const query = new URLSearchParams({ pageSize: String(CREATOR_DISCOVERY_PAGE_SIZE) })
    if (pageToken !== undefined) query.set('pageToken', pageToken)
    const payload = record(await creatorApi.request(`/creators/me/marketListings?${query.toString()}`, {}, signal))
    const items = Array.isArray(payload.items) ? payload.items : []
    for (const value of items) {
      const item = record(value)
      if (text(item.status) !== 'published' || text(item.saleStatus) !== 'listed') continue
      const id = text(item.id ?? item.listingId)
      if (id === '' || !MARKET_LISTING_ID_PATTERN.test(id) || seen.has(id)) continue
      seen.add(id)
      ids.push(id)
    }
    const next = text(payload.nextPageToken)
    if (next === '' || items.length === 0) break
    pageToken = next
  }
  return ids
}

/**
 * Reads the configured storefront from anonymous public Market reads.
 *
 * Two sources, in order of authority:
 *
 * - **Creator mode** (`creatorKeyEnv` configured): the id set is derived from the
 *   creator's own catalogue on every refresh, so a newly published SkillBot shows
 *   up with no maintenance. A missing credential resolves to an empty read rather
 *   than falling back to a pinned list — a silent fallback would hide the
 *   misconfiguration and quietly stop tracking new publications.
 * - **Pinned mode**: the allow-list from config. One id maps to one detail call
 *   rather than a walk over the full public market, because the full market's list
 *   route returns no creator identifier at all (every `creator` is
 *   `{ nickname: "" }`) so it cannot be filtered by creator, and the detail payload
 *   is the only source of the version and update time the preview must show.
 *
 * A `404` means that listing is no longer listed: it is reported as unavailable
 * instead of failing the storefront. Any other failure is transient and is
 * re-thrown so the cache layer can fall back to its last good snapshot.
 */
export function createStorefrontReader(
  api: LoomApi,
  config: ResolvedLoomConfig,
  options: StorefrontReaderOptions = {},
): (signal?: AbortSignal) => Promise<StorefrontRead> {
  return async (signal?: AbortSignal) => {
    if (options.creator === null) return { configured: false, entries: [], unavailable: [] }
    const ids = options.creator === undefined
      ? config.storefrontListingIds
      : await discoverCreatorListingIds(options.creator, signal)
    const derived = options.creator !== undefined
    if (ids.length === 0) return { configured: derived || config.storefrontListingIds.length > 0, entries: [], unavailable: [] }

    const settled = await mapSettled(ids, STOREFRONT_CONCURRENCY, async (id) => {
      const requestSignal = AbortSignal.any([
        AbortSignal.timeout(STOREFRONT_REQUEST_TIMEOUT_MS),
        ...(signal === undefined ? [] : [signal]),
      ])
      try {
        return { listed: true as const, payload: await api.request(`/marketListings/${encodeURIComponent(id)}`, {}, requestSignal) }
      } catch (cause) {
        if ((cause as LoomApiError).status === 404) return { listed: false as const, payload: undefined }
        throw cause
      }
    })

    const entries: StorefrontEntry[] = []
    const unavailable: string[] = []
    const failures: unknown[] = []
    settled.forEach((result, index) => {
      const id = ids[index] ?? ''
      if (result.ok) {
        if (result.value.listed) entries.push(entry(result.value.payload, id))
        else unavailable.push(id)
      } else if (failures.length === 0) failures.push(result.cause)
    })
    if (failures.length > 0) throw failures[0]
    // A derived storefront has no authoring order, so it is presented newest
    // first, matching the market's own default ordering.
    return { configured: true, entries: derived ? entries.sort(byRecency) : entries, unavailable }
  }
}
