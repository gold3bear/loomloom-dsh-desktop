import { createHash, randomUUID } from 'node:crypto'
import { setTimeout as scheduleTimeout } from 'node:timers/promises'
import { LoomApi, LoomApiError } from './loom-api.js'

const MAX_INPUT_ROWS = 100
const DRAFT_TTL_MS = 10 * 60_000
const ID_PATTERN = /^[A-Za-z0-9._-]{1,200}$/
/** Upstream monetary unit system: 10,000,000 raw API units equal one currency unit. */
const RAW_UNITS_PER_CURRENCY = 10_000_000

/**
 * Run statuses that mark a run as no longer progressing on the server. A run
 * entering any of these states is safe to stop polling; the caller can still
 * request a final result read.
 */
export const TERMINAL_RUN_STATUSES: ReadonlySet<string> = new Set([
  'completed',
  'succeeded',
  'success',
  'failed',
  'error',
  'errored',
  'cancelled',
  'canceled',
  'partial_failed',
])

/**
 * Bounded exponential-backoff knobs used by the execute-time poller. Defaults
 * stay conservative: a SkillBot run is a paid upstream task and the host only
 * spins while the upstream state is non-terminal; cancelling the dispatch
 * aborts the loop immediately.
 */
export interface RunPollOptions {
  /** Initial local delay between polls, in milliseconds. */
  readonly initialDelayMs?: number
  /** Upper bound on the local delay between polls. */
  readonly maxDelayMs?: number
  /** Symmetric jitter multiplier around each scheduled delay (0 = none). */
  readonly jitterRatio?: number
  /** Hard upper bound on the total wait, in milliseconds. */
  readonly maxWaitMs?: number
  /**
   * Optional sleep provider. Tests inject a deterministic sleep so they do
   * not have to wait for real timers; production callers omit it.
   */
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  /** Optional clock for test injection. */
  readonly now?: () => number
}

const DEFAULT_POLL_INITIAL_MS = 1_500
const DEFAULT_POLL_MAX_MS = 5_000
const DEFAULT_POLL_JITTER = 0.2
const DEFAULT_POLL_MAX_WAIT_MS = 5 * 60_000

/** Snapshot of the run state when polling stops. */
export interface RunPollSummary {
  readonly runId: string
  readonly displayName: string
  /** Status string as reported by the upstream `/users/me/runs/{id}` endpoint. */
  readonly status: string
  /** True when the status at poll time was one of {@link TERMINAL_RUN_STATUSES}. */
  readonly terminal: boolean
  /**
   * True when the poller exited before the upstream reached a terminal state,
   * either because the host cancelled the dispatch (page leave / generation
   * dispose) or because {@link RunPollOptions.maxWaitMs} elapsed.
   */
  readonly pending: boolean
  /** Number of polling attempts actually issued (excludes the initial state read). */
  readonly attempts: number
}

export interface SkillbotSummary {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly available: boolean
  readonly fixedFee?: string
  readonly versionId?: string
}

export interface SkillbotField {
  readonly key: string
  readonly label: string
  readonly required: boolean
  readonly valueType: string
  readonly description?: string
  readonly enumValues?: readonly string[]
}

export interface SkillbotDetail extends SkillbotSummary {
  readonly fields: readonly SkillbotField[]
}

export interface ExecutionDraft {
  readonly id: string
  readonly expiresAt: string
  readonly skillbot: SkillbotSummary
  readonly rowCount: number
  readonly quote: MarketQuote
}

export interface MarketQuote {
  /** Buyer-payable estimate returned by the Market quote endpoint. Never locally converted. */
  readonly estimatedBuyerPayable: string
  /** The server-provided currency, if the quote included one. */
  readonly currency?: string
  readonly taskFixedFee?: string
}

export interface ExecutionReceipt {
  readonly draftId: string
  readonly accepted: boolean
  readonly runId?: string
  readonly status?: string
}

export interface RunResults {
  readonly runId: string
  readonly status: string
  readonly totalRows: number
  readonly completedRows: number
  readonly failedRows: number
  readonly artifacts: readonly RunArtifact[]
}

export interface RunArtifact {
  readonly id: string
  readonly label: string
  readonly mimeType?: string
  readonly accessUrl?: string
  /** Inline text payload when the upstream returns the artifact body directly. */
  readonly inlineText?: string
}

export interface SkillbotToolValue {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly available: boolean
  readonly fixedFee?: string
  readonly versionId?: string
}

/** Account balance snapshot from `/users/me/balance`. */
export interface BalanceSnapshot {
  readonly currency?: string
  /** Converted amount, or the `*T` value divided by 10,000,000. */
  readonly availableBalance?: string
}

/** One creator-owned Market listing from `/creators/me/marketListings`. */
export interface CreatorListing {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly status?: string
  readonly saleStatus?: string
  readonly available: boolean
  readonly fixedFee?: string
  readonly currency?: string
  readonly listingVersionId?: string
  readonly publishedVersionId?: string
  readonly reviewStatus?: string
  readonly reviewReason?: string
}

/** One creator Market transaction from `/creators/me/marketTransactions`. */
export interface CreatorTransaction {
  readonly runTransactionId?: string
  readonly runId?: string
  readonly listingId?: string
  readonly skillName?: string
  readonly taskFixedFee?: string
  readonly finalBuyerPayable?: string
  readonly currency?: string
  readonly transactionStatus?: string
}

/** Result of publishing a listing through `POST /marketListings`. */
export interface PublishedListing {
  readonly id: string
  readonly status?: string
  readonly reviewStatus?: string
  readonly name?: string
}

export interface PublishListingInput {
  readonly displayName: string
  readonly description?: string
  readonly templateId: string
  readonly templateVersionId: string
  readonly taskFixedFee: number
  readonly listingId?: string
}

/** One official template from `GET /officialTemplates`. */
export interface OfficialTemplate {
  readonly templateId: string
  readonly name: string
  readonly scenario?: string
  readonly inputSummary?: string
  readonly outputType?: string
  readonly version?: string
}

/** One private (creator-authored) template from `GET /users/me/templates`. */
export interface MyTemplate {
  readonly templateId: string
  readonly name: string
  readonly description?: string
  readonly status?: string
  readonly latestVersionId?: string
  readonly publishedVersionId?: string
  readonly outputType?: string
}

/** One declared field of an official template input schema. */
export interface TemplateField {
  readonly key: string
  readonly label: string
  readonly required: boolean
  readonly valueType: string
  readonly inputHint?: string
  readonly enumValues?: readonly string[]
  readonly examples?: readonly string[]
}

/** The full input schema of one official template. */
export interface TemplateSchema {
  readonly templateId: string
  readonly name?: string
  readonly description?: string
  readonly scenario?: string
  readonly outputType?: string
  readonly fields: readonly TemplateField[]
}

/** A downloaded workbook carried as base64 plus its suggested filename. */
export interface WorkbookDownload {
  readonly base64: string
  readonly byteLength: number
  readonly contentType: string
  readonly filename: string
}

export interface DraftToolValue {
  readonly draftId: string
  readonly expiresAt: string
  readonly rowCount: number
  readonly skillbot: SkillbotToolValue
  readonly quote: MarketQuote
}

interface StoredDraft extends ExecutionDraft {
  readonly agent: object
  readonly listingVersionId: string
  readonly inputRows: readonly Record<string, unknown>[]
  readonly fingerprint: string
  readonly clientRequestId: string
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function pickText(value: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const candidate = text(value[key])
    if (candidate !== '') return candidate
  }
  return ''
}

/** Reads the upstream market page cursor, honouring both nested shapes. */
function nextPageToken(value: Record<string, unknown>): string {
  const data = asRecord(value.data)
  return pickText(value, ['nextPageToken', 'next_page_token']) || pickText(data, ['nextPageToken', 'next_page_token'])
}

/**
 * Local keyword matching over the full dataset. Terms are split on
 * whitespace and matched case-insensitively against title, description and
 * id; listings with any hit are kept, ordered by hit count (most relevant
 * first). A non-ASCII keyword needs no tokenization to match.
 */
function matchKeyword(listings: readonly SkillbotSummary[], keyword: string): readonly SkillbotSummary[] {
  const terms = keyword.trim().split(/\s+/u).filter(term => term !== '')
  if (terms.length === 0) return listings
  const normalized = terms.map(term => term.toLocaleLowerCase())
  const scored = listings.map(listing => {
    const haystack = `${listing.name} ${listing.description} ${listing.id}`.toLocaleLowerCase()
    const hits = normalized.filter(term => haystack.includes(term)).length
    return { listing, hits }
  })
  const matched = scored.filter(entry => entry.hits > 0)
  matched.sort((left, right) => right.hits - left.hits)
  return matched.map(entry => entry.listing)
}

function fixedFee(value: Record<string, unknown>): string | undefined {
  return money(value, 'taskFixedFee', 'taskFixedFeeT', text(value.currency))?.amount
}

function listingVersion(value: Record<string, unknown>): string | undefined {
  const version = text(value.listingVersionId)
  return version === '' ? undefined : version
}

function summary(value: Record<string, unknown>): SkillbotSummary {
  const id = text(value.id)
  if (!ID_PATTERN.test(id)) throw new LoomApiError(502, 'loomloom returned a listing without a valid id')
  const name = text(value.displayName) || id
  const description = text(value.description)
  const versionId = listingVersion(value)
  const fee = fixedFee(value)
  return {
    id,
    name,
    description,
    available: text(value.executionAvailabilityStatus) === 'available',
    ...(fee === undefined ? {} : { fixedFee: fee }),
    ...(versionId === undefined ? {} : { versionId }),
  }
}

function parseFields(value: Record<string, unknown>): readonly SkillbotField[] {
  const snapshot = value.inputSchemaSnapshot
  let schema: Record<string, unknown> = {}
  if (typeof snapshot === 'string' && snapshot.trim() !== '') {
    try { schema = asRecord(JSON.parse(snapshot)) } catch { throw new LoomApiError(502, 'loomloom returned an invalid input schema') }
  } else if (typeof snapshot === 'object' && snapshot !== null) schema = asRecord(snapshot)
  const fields = Array.isArray(schema.fields) ? schema.fields : []
  return fields.map((field, index) => {
    const record = asRecord(field)
    const key = pickText(record, ['key', 'name', 'fieldKey'])
    if (!ID_PATTERN.test(key)) throw new LoomApiError(502, `loomloom input schema field ${index + 1} is invalid`)
    const enums = record.enum_values ?? record.enumValues
    const enumValues = Array.isArray(enums) ? enums.filter((item): item is string => typeof item === 'string') : undefined
    return {
      key,
      label: pickText(record, ['label', 'title', 'displayName']) || key,
      required: record.required === true || record.isRequired === true,
      valueType: pickText(record, ['value_type', 'valueType', 'type']) || 'string',
      ...(pickText(record, ['description', 'desc', 'inputHint', 'help']) === '' ? {} : { description: pickText(record, ['description', 'desc', 'inputHint', 'help']) }),
      ...(enumValues === undefined || enumValues.length === 0 ? {} : { enumValues }),
    }
  })
}

function applyJitter(delayMs: number, jitterRatio: number): number {
  if (delayMs <= 0 || jitterRatio <= 0) return delayMs
  const span = delayMs * jitterRatio
  const offset = (Math.random() * 2 - 1) * span
  return Math.max(0, Math.round(delayMs + offset))
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

function inputRows(value: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_INPUT_ROWS) {
    throw new LoomApiError(400, `inputRows must contain 1-${MAX_INPUT_ROWS} object rows`)
  }
  return value.map((row, index) => {
    const record = asRecord(row)
    if (Object.keys(record).length === 0) throw new LoomApiError(400, `inputRows[${index}] must be an object with at least one field`)
    return record
  })
}

function validateRows(fields: readonly SkillbotField[], rows: readonly Record<string, unknown>[]): void {
  for (const [rowIndex, row] of rows.entries()) {
    for (const field of fields) {
      const value = row[field.key]
      if (field.required && (value === undefined || value === null || value === '')) {
        throw new LoomApiError(400, `inputRows[${rowIndex}].${field.key} is required`)
      }
      if (value === undefined || value === null) continue
      if (field.enumValues !== undefined && (!Array.isArray(field.enumValues) || typeof value !== 'string' || !field.enumValues.includes(value))) {
        throw new LoomApiError(400, `inputRows[${rowIndex}].${field.key} must be one of the declared values`)
      }
      if (field.valueType === 'boolean' || field.valueType === 'bool') {
        if (typeof value !== 'boolean') throw new LoomApiError(400, `inputRows[${rowIndex}].${field.key} must be a boolean`)
      } else if (field.valueType === 'integer') {
        if (typeof value !== 'number' || !Number.isInteger(value)) throw new LoomApiError(400, `inputRows[${rowIndex}].${field.key} must be an integer`)
      } else if (field.valueType === 'number' || field.valueType === 'float') {
        if (typeof value !== 'number' || !Number.isFinite(value)) throw new LoomApiError(400, `inputRows[${rowIndex}].${field.key} must be a number`)
      } else if (field.valueType === 'string' && typeof value !== 'string') {
        throw new LoomApiError(400, `inputRows[${rowIndex}].${field.key} must be a string`)
      }
    }
  }
}

function extractRun(value: unknown): { readonly runId?: string, readonly status?: string } {
  const outer = asRecord(value)
  const run = typeof outer.run === 'string' ? { runId: outer.run } : asRecord(outer.run ?? outer.data ?? outer)
  const runId = text(run.runId) || text(outer.runId)
  const status = text(run.status) || text(outer.status)
  return {
    ...(ID_PATTERN.test(runId) ? { runId } : {}),
    ...(status === '' ? {} : { status }),
  }
}

function runRecord(value: unknown): Record<string, unknown> {
  const payload = asRecord(value)
  return asRecord(payload.run ?? payload.data ?? payload)
}

function resultItems(value: unknown): readonly Record<string, unknown>[] {
  const payload = asRecord(value)
  const items = payload.items ?? payload.rows
  return Array.isArray(items) ? items.map(asRecord) : []
}

function artifacts(value: unknown): readonly RunArtifact[] {
  const payload = asRecord(value)
  const items = payload.items ?? payload.artifacts
  if (!Array.isArray(items)) return []
  return items.map(asRecord).map((item, index) => {
    const id = text(item.artifactId)
    if (!ID_PATTERN.test(id)) throw new LoomApiError(502, `loomloom returned invalid artifact ${index + 1}`)
    const label = pickText(item, ['stepLabel', 'displayName', 'portName', 'stepId']) || id
    const mimeType = text(item.mimeType)
    const accessUrl = text(item.accessUrl)
    if (accessUrl !== '' && !/^https:\/\//u.test(accessUrl)) throw new LoomApiError(502, `loomloom returned invalid artifact URL ${index + 1}`)
    const inlineText = pickText(item, ['inlineText', 'inline_text', 'content', 'text'])
    return {
      id, label,
      ...(mimeType === '' ? {} : { mimeType }),
      ...(accessUrl === '' ? {} : { accessUrl }),
      ...(inlineText === '' ? {} : { inlineText }),
    }
  })
}

/**
 * Parse one creator-owned listing (`/creators/me/marketListings`). Unlike the
 * public market listing this shape carries review fields, so the id and name
 * keys stay the same while review state is surfaced when present.
 */
function creatorListing(value: Record<string, unknown>): CreatorListing {
  const id = text(value.id)
  if (!ID_PATTERN.test(id)) throw new LoomApiError(502, 'loomloom returned a creator listing without a valid id')
  const currency = pickText(value, ['currency'])
  const fee = money(value, 'taskFixedFee', 'taskFixedFeeT', currency)
  return {
    id,
    name: text(value.displayName) || id,
    description: text(value.description),
    available: text(value.executionAvailabilityStatus) === 'available',
    ...(text(value.status) === '' ? {} : { status: text(value.status) }),
    ...(text(value.saleStatus) === '' ? {} : { saleStatus: text(value.saleStatus) }),
    ...(fee === undefined ? {} : { fixedFee: fee.amount }),
    ...(fee?.currency === undefined && currency === '' ? {} : { currency: fee?.currency ?? currency }),
    ...(text(value.listingVersionId) === '' ? {} : { listingVersionId: text(value.listingVersionId) }),
    ...(text(value.publishedVersionId) === '' ? {} : { publishedVersionId: text(value.publishedVersionId) }),
    ...(pickText(value, ['reviewStatus', 'review_status']) === '' ? {} : { reviewStatus: pickText(value, ['reviewStatus', 'review_status']) }),
    ...(pickText(value, ['reviewReason', 'review_reason']) === '' ? {} : { reviewReason: pickText(value, ['reviewReason', 'review_reason']) }),
  }
}

/** Parse one creator transaction (`/creators/me/marketTransactions`). */
function creatorTransaction(value: Record<string, unknown>): CreatorTransaction {
  const currency = pickText(value, ['currency'])
  const fee = money(value, 'taskFixedFee', 'taskFixedFeeT', currency)
  const payable = money(value, 'finalBuyerPayable', 'finalBuyerPayableT', currency)
  return {
    ...(text(value.runTransactionId) === '' ? {} : { runTransactionId: text(value.runTransactionId) }),
    ...(text(value.runId) === '' ? {} : { runId: text(value.runId) }),
    ...(text(value.listingId) === '' ? {} : { listingId: text(value.listingId) }),
    ...(pickText(value, ['skillName', 'skill_name']) === '' ? {} : { skillName: pickText(value, ['skillName', 'skill_name']) }),
    ...(fee === undefined ? {} : { taskFixedFee: fee.amount }),
    ...(payable === undefined ? {} : { finalBuyerPayable: payable.amount }),
    ...(fee?.currency === undefined && payable?.currency === undefined && currency === '' ? {} : { currency: fee?.currency ?? payable?.currency ?? currency }),
    ...(text(value.transactionStatus) === '' ? {} : { transactionStatus: text(value.transactionStatus) }),
  }
}

/** Parse one official template summary (`GET /officialTemplates`). */
function officialTemplate(value: Record<string, unknown>): OfficialTemplate {
  const templateId = pickText(value, ['templateId', 'template_id', 'id'])
  if (!ID_PATTERN.test(templateId)) throw new LoomApiError(502, 'loomloom returned an official template without a valid id')
  return {
    templateId,
    name: pickText(value, ['name', 'displayName']) || templateId,
    ...(pickText(value, ['scenario']) === '' ? {} : { scenario: pickText(value, ['scenario']) }),
    ...(pickText(value, ['inputSummary', 'input_summary']) === '' ? {} : { inputSummary: pickText(value, ['inputSummary', 'input_summary']) }),
    ...(pickText(value, ['outputType', 'output_type']) === '' ? {} : { outputType: pickText(value, ['outputType', 'output_type']) }),
    ...(pickText(value, ['version']) === '' ? {} : { version: pickText(value, ['version']) }),
  }
}

/** Parse one private template summary (`GET /users/me/templates`). */
function myTemplate(value: Record<string, unknown>): MyTemplate {
  const templateId = pickText(value, ['templateId', 'template_id', 'id'])
  if (!ID_PATTERN.test(templateId)) throw new LoomApiError(502, 'loomloom returned a private template without a valid id')
  return {
    templateId,
    name: pickText(value, ['name', 'displayName']) || templateId,
    ...(pickText(value, ['description']) === '' ? {} : { description: pickText(value, ['description']) }),
    ...(pickText(value, ['status']) === '' ? {} : { status: pickText(value, ['status']) }),
    ...(pickText(value, ['latestVersionId', 'latest_version_id']) === '' ? {} : { latestVersionId: pickText(value, ['latestVersionId', 'latest_version_id']) }),
    ...(pickText(value, ['publishedVersionId', 'published_version_id']) === '' ? {} : { publishedVersionId: pickText(value, ['publishedVersionId', 'published_version_id']) }),
    ...(pickText(value, ['primaryOutputType', 'primary_output_type', 'outputType']) === '' ? {} : { outputType: pickText(value, ['primaryOutputType', 'primary_output_type', 'outputType']) }),
  }
}

/** Parse the declared fields of an official template schema. */
function templateFields(value: unknown): readonly TemplateField[] {
  if (!Array.isArray(value)) return []
  return value.map((field, index) => {
    const record = asRecord(field)
    const key = pickText(record, ['key', 'fieldKey', 'name'])
    if (!ID_PATTERN.test(key)) throw new LoomApiError(502, `loomloom template field ${index + 1} is invalid`)
    const enums = record.enumValues ?? record.enum_values
    const examples = record.examples
    const enumValues = Array.isArray(enums) ? enums.filter((item): item is string => typeof item === 'string') : undefined
    const exampleValues = Array.isArray(examples) ? examples.filter((item): item is string => typeof item === 'string') : undefined
    const hint = pickText(record, ['inputHint', 'input_hint', 'businessHint', 'business_hint'])
    return {
      key,
      label: pickText(record, ['label', 'title']) || key,
      required: record.required === true,
      valueType: pickText(record, ['type', 'valueType', 'value_type']) || 'string',
      ...(hint === '' ? {} : { inputHint: hint }),
      ...(enumValues === undefined || enumValues.length === 0 ? {} : { enumValues }),
      ...(exampleValues === undefined || exampleValues.length === 0 ? {} : { examples: exampleValues }),
    }
  })
}

/** Parse the full schema of one official template. */
function templateSchema(value: Record<string, unknown>): TemplateSchema {
  const templateId = pickText(value, ['templateId', 'template_id', 'id'])
  if (!ID_PATTERN.test(templateId)) throw new LoomApiError(502, 'loomloom returned a template schema without a valid id')
  return {
    templateId,
    fields: templateFields(value.fields),
    ...(pickText(value, ['name', 'displayName']) === '' ? {} : { name: pickText(value, ['name', 'displayName']) }),
    ...(pickText(value, ['description']) === '' ? {} : { description: pickText(value, ['description']) }),
    ...(pickText(value, ['scenario']) === '' ? {} : { scenario: pickText(value, ['scenario']) }),
    ...(pickText(value, ['outputType', 'output_type']) === '' ? {} : { outputType: pickText(value, ['outputType', 'output_type']) }),
  }
}

function monetaryText(value: unknown): { readonly amount: string, readonly currency?: string } | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return { amount: String(value) }
  if (typeof value === 'string' && value.trim() !== '') return { amount: value.trim() }
  const record = asRecord(value)
  const amount = pickText(record, ['amount', 'displayAmount', 'formatted', 'value'])
  if (amount === '') return undefined
  const currency = pickText(record, ['currency', 'currencyCode'])
  return { amount, ...(currency === '' ? {} : { currency }) }
}

/**
 * Resolve a monetary field the same way the upstream CLI does: prefer the
 * converted `moneyResponse` object; otherwise convert the raw-unit `*T`
 * integer using `10,000,000 units = 1 currency unit`. Currency is never
 * guessed when only a `*T` value is present.
 */
function money(value: Record<string, unknown>, moneyKey: string, rawKey: string, currency: string): { readonly amount: string, readonly currency?: string } | undefined {
  const converted = monetaryText(value[moneyKey])
  if (converted !== undefined) return { ...converted, ...(converted.currency === undefined && currency !== '' ? { currency } : {}) }
  const raw = value[rawKey]
  const units = typeof raw === 'number' && Number.isFinite(raw)
    ? raw
    : typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))
      ? Number(raw)
      : undefined
  if (units === undefined) return undefined
  return { amount: String(units / RAW_UNITS_PER_CURRENCY), ...(currency === '' ? {} : { currency }) }
}

function parseQuote(value: unknown): MarketQuote {
  const payload = asRecord(value)
  const quote = asRecord(payload.quote ?? payload.data ?? payload)
  const currency = pickText(quote, ['currency', 'currencyCode']) || pickText(payload, ['currency', 'currencyCode'])
  const payable = money(quote, 'estimatedBuyerPayable', 'estimatedBuyerPayableT', currency)
    ?? money(payload, 'estimatedBuyerPayable', 'estimatedBuyerPayableT', currency)
  if (payable === undefined) throw new LoomApiError(502, 'loomloom quote did not return an estimated buyer payable amount')
  const fee = money(quote, 'taskFixedFee', 'taskFixedFeeT', currency) ?? money(payload, 'taskFixedFee', 'taskFixedFeeT', currency)
  return {
    estimatedBuyerPayable: payable.amount,
    ...(payable.currency === undefined ? {} : { currency: payable.currency }),
    ...(fee === undefined ? {} : { taskFixedFee: fee.amount }),
  }
}

export class LoomSkillbotService {
  private readonly drafts = new Map<string, StoredDraft>()

  constructor(private readonly api: LoomApi, private readonly now: () => number = Date.now) {}

  async list(signal?: AbortSignal, options: { keyword?: string } = {}): Promise<readonly SkillbotSummary[]> {
    // Fetch the complete market dataset by walking every page; the upstream
    // keyword search is unreliable (especially for non-ASCII terms), so a
    // keyword filters the full dataset locally instead of being forwarded.
    const merged: SkillbotSummary[] = []
    const seen = new Set<string>()
    let pageToken = ''
    for (;;) {
      const query = new URLSearchParams({ pageSize: '100' })
      if (pageToken !== '') query.set('pageToken', pageToken)
      const payload = asRecord(await this.api.request(`/marketListings?${query.toString()}`, {}, signal))
      const items = Array.isArray(payload.items) ? payload.items : []
      for (const item of items) {
        const candidate = summary(asRecord(item))
        if (candidate.available) merged.push(candidate)
      }
      pageToken = nextPageToken(payload)
      if (pageToken === '') break
      if (seen.has(pageToken)) throw new LoomApiError(502, 'loomloom returned a repeating market listing page token')
      seen.add(pageToken)
    }
    const keyword = text(options.keyword)
    return keyword === '' ? merged : matchKeyword(merged, keyword)
  }

  async get(listingId: string, signal?: AbortSignal): Promise<SkillbotDetail> {
    if (!ID_PATTERN.test(listingId)) throw new LoomApiError(400, 'invalid listingId')
    const payload = asRecord(await this.api.request(`/marketListings/${encodeURIComponent(listingId)}`, {}, signal))
    return { ...summary(payload), fields: parseFields(payload) }
  }

  /**
   * Read the settled balance snapshot. `/users/me/balance` carries the raw
   * `availableBalanceT` integer and the converted `availableBalance` object;
   * `money()` prefers the converted form and never guesses the currency.
   */
  async getBalance(signal?: AbortSignal): Promise<BalanceSnapshot> {
    const payload = asRecord(await this.api.request('/users/me/balance', {}, signal))
    const currency = pickText(payload, ['currency'])
    const available = money(payload, 'availableBalance', 'availableBalanceT', currency)
    return {
      ...(available?.currency === undefined && currency === '' ? {} : { currency: available?.currency ?? currency }),
      ...(available === undefined ? {} : { availableBalance: available.amount }),
    }
  }

  /** List creator-owned Market listings from `/creators/me/marketListings`. */
  async listMyListings(signal?: AbortSignal): Promise<readonly CreatorListing[]> {
    const payload = asRecord(await this.api.request('/creators/me/marketListings?pageSize=100', {}, signal))
    const items = Array.isArray(payload.items) ? payload.items : []
    return items.map(item => creatorListing(asRecord(item)))
  }

  /** List creator Market transactions from `/creators/me/marketTransactions`. */
  async listCreatorTransactions(signal?: AbortSignal): Promise<readonly CreatorTransaction[]> {
    const payload = asRecord(await this.api.request('/creators/me/marketTransactions?pageSize=100', {}, signal))
    const items = Array.isArray(payload.items) ? payload.items : []
    return items.map(item => creatorTransaction(asRecord(item)))
  }

  /** List official (first-party) templates from `GET /officialTemplates`. */
  async listOfficialTemplates(signal?: AbortSignal): Promise<readonly OfficialTemplate[]> {
    const payload = asRecord(await this.api.request('/officialTemplates', {}, signal))
    const items = Array.isArray(payload.templates) ? payload.templates : Array.isArray(payload.items) ? payload.items : []
    return items.map(item => officialTemplate(asRecord(item)))
  }

  /**
   * List the account's private (creator-authored) templates. Publishing a
   * listing requires a template id and version id, and both come from here.
   */
  async listMyTemplates(signal?: AbortSignal): Promise<readonly MyTemplate[]> {
    const payload = asRecord(await this.api.request('/users/me/templates?pageSize=50', {}, signal))
    const items = Array.isArray(payload.items) ? payload.items : Array.isArray(payload.templates) ? payload.templates : []
    return items.map(item => myTemplate(asRecord(item)))
  }

  /** Read one official template input schema from `GET /officialTemplates/{id}/schema`. */
  async getTemplateSchema(templateId: string, signal?: AbortSignal): Promise<TemplateSchema> {
    if (!ID_PATTERN.test(templateId)) throw new LoomApiError(400, 'invalid templateId')
    const payload = asRecord(await this.api.request(`/officialTemplates/${encodeURIComponent(templateId)}/schema`, {}, signal))
    return templateSchema(payload)
  }

  /** Download a Market SkillBot input workbook (`GET /marketListings/{id}/workbook`). */
  async downloadMarketWorkbook(listingId: string, signal?: AbortSignal): Promise<WorkbookDownload> {
    if (!ID_PATTERN.test(listingId)) throw new LoomApiError(400, 'invalid listingId')
    const binary = await this.api.requestBinary(`/marketListings/${encodeURIComponent(listingId)}/workbook`, {}, signal)
    return { base64: binary.base64, byteLength: binary.byteLength, contentType: binary.contentType, filename: binary.filename ?? `${listingId}.xlsx` }
  }

  /** Download an official template input workbook (`GET /officialTemplates/{id}/workbook`). */
  async downloadTemplateWorkbook(templateId: string, signal?: AbortSignal): Promise<WorkbookDownload> {
    if (!ID_PATTERN.test(templateId)) throw new LoomApiError(400, 'invalid templateId')
    const binary = await this.api.requestBinary(`/officialTemplates/${encodeURIComponent(templateId)}/workbook`, {}, signal)
    return { base64: binary.base64, byteLength: binary.byteLength, contentType: binary.contentType, filename: binary.filename ?? `${templateId}.xlsx` }
  }

  /**
   * Upload JSONL orchestration input rows (`POST /orchestrationInputs:upload`).
   * The upstream expects `content` as raw bytes, which Go encodes as base64 in
   * JSON, so the caller's text is base64 encoded here.
   */
  async uploadOrchestrationInput(filename: string, content: string, signal?: AbortSignal): Promise<{ readonly inputFileId: string, readonly rowCount?: number }> {
    const name = text(filename)
    if (name === '') throw new LoomApiError(400, 'filename is required')
    if (text(content) === '') throw new LoomApiError(400, 'content is required')
    const payload = { filename: name, content: Buffer.from(content, 'utf8').toString('base64') }
    const response = asRecord(await this.api.request('/orchestrationInputs:upload', { method: 'POST', body: JSON.stringify(payload) }, signal))
    const inputFileId = pickText(response, ['inputFileId', 'input_file_id'])
    if (inputFileId === '') throw new LoomApiError(502, 'loomloom did not return an inputFileId')
    const rowCount = response.rowCount ?? response.row_count
    return {
      inputFileId,
      ...(typeof rowCount === 'number' && Number.isFinite(rowCount) ? { rowCount } : {}),
    }
  }

  async publishListing(input: PublishListingInput, signal?: AbortSignal): Promise<PublishedListing> {
    const displayName = text(input.displayName)
    if (displayName === '') throw new LoomApiError(400, 'displayName is required')
    const templateId = text(input.templateId)
    if (!ID_PATTERN.test(templateId)) throw new LoomApiError(400, 'templateId is required')
    const templateVersionId = text(input.templateVersionId)
    if (!ID_PATTERN.test(templateVersionId)) throw new LoomApiError(400, 'templateVersionId is required')
    if (!Number.isFinite(input.taskFixedFee) || input.taskFixedFee < 0) throw new LoomApiError(400, 'taskFixedFee must be a non-negative number')
    const payload = {
      displayName,
      templateId,
      templateVersionId,
      taskFixedFeeT: Math.round(input.taskFixedFee * RAW_UNITS_PER_CURRENCY),
      ...(text(input.description) === '' ? {} : { description: text(input.description) }),
      ...(text(input.listingId) === '' ? {} : { listingId: text(input.listingId) }),
    }
    const response = asRecord(await this.api.request('/marketListings', { method: 'POST', body: JSON.stringify(payload) }, signal))
    const id = text(response.id) || text(response.listingId)
    if (!ID_PATTERN.test(id)) throw new LoomApiError(502, 'loomloom did not return a published listing id')
    const status = text(response.status)
    const reviewStatus = pickText(response, ['reviewStatus', 'review_status'])
    const name = text(response.displayName)
    return {
      id,
      ...(status === '' ? {} : { status }),
      ...(reviewStatus === '' ? {} : { reviewStatus }),
      ...(name === '' ? {} : { name }),
    }
  }

  async getRun(runId: string, signal?: AbortSignal): Promise<{ readonly runId: string, readonly status: string, readonly displayName: string }> {
    if (!ID_PATTERN.test(runId)) throw new LoomApiError(400, 'invalid runId')
    const payload = runRecord(await this.api.request(`/users/me/runs/${encodeURIComponent(runId)}`, {}, signal))
    return {
      runId: text(payload.runId) || runId,
      status: text(payload.status) || 'unknown',
      displayName: pickText(payload, ['displayName', 'name']) || runId,
    }
  }

  async getRunResults(runId: string, signal?: AbortSignal): Promise<RunResults> {
    if (!ID_PATTERN.test(runId)) throw new LoomApiError(400, 'invalid runId')
    const detail = await this.getRun(runId, signal)
    const [rowsPayload, artifactsPayload] = await Promise.all([
      this.api.request(`/users/me/runs/${encodeURIComponent(runId)}/resultRows?pageSize=100`, {}, signal),
      this.api.request(`/users/me/runs/${encodeURIComponent(runId)}/artifacts?pageSize=100`, {}, signal),
    ])
    const rows = resultItems(rowsPayload)
    const completedRows = rows.filter(row => ['completed', 'succeeded', 'success'].includes(pickText(row, ['status']).toLowerCase())).length
    const failedRows = rows.filter(row => ['failed', 'cancelled', 'canceled'].includes(pickText(row, ['status']).toLowerCase())).length
    return { runId: detail.runId, status: detail.status, totalRows: rows.length, completedRows, failedRows, artifacts: artifacts(artifactsPayload) }
  }

  /**
   * Poll a run until it reaches a terminal status, the host signal aborts, or
   * the total wait budget elapses. The returned summary is the canonical input
   * for an execute_skillbot tool result: pending distinguishes a
   * dispatch-cancelled or budget-exhausted exit from a clean terminal state.
   */
  async pollRunUntilTerminal(
    runId: string,
    options: RunPollOptions = {},
    signal?: AbortSignal,
  ): Promise<RunPollSummary> {
    if (!ID_PATTERN.test(runId)) throw new LoomApiError(400, 'invalid runId')
    if (signal?.aborted) throw new LoomApiError(499, 'run polling was cancelled before it started')
    const initialDelayMs = options.initialDelayMs ?? DEFAULT_POLL_INITIAL_MS
    const maxDelayMs = options.maxDelayMs ?? DEFAULT_POLL_MAX_MS
    const jitterRatio = options.jitterRatio ?? DEFAULT_POLL_JITTER
    const maxWaitMs = options.maxWaitMs ?? DEFAULT_POLL_MAX_WAIT_MS
    const sleep = options.sleep ?? scheduleTimeout
    const now = options.now ?? Date.now
    const startedAt = now()
    let attempts = 0
    let nextDelay = initialDelayMs
    // The first read of the run is the synchronous call that returned the
    // runId; the loop begins with the first follow-up poll.
    let last
    while (true) {
      if (signal?.aborted) {
        const summary = last ?? { runId, status: 'unknown', displayName: runId }
        return { ...summary, terminal: TERMINAL_RUN_STATUSES.has(summary.status.toLowerCase()), pending: true, attempts }
      }
      const elapsed = now() - startedAt
      if (elapsed >= maxWaitMs) {
        const summary = last ?? { runId, status: 'unknown', displayName: runId }
        return { ...summary, terminal: TERMINAL_RUN_STATUSES.has(summary.status.toLowerCase()), pending: true, attempts }
      }
      attempts += 1
      const detail = await this.getRun(runId, signal)
      last = detail
      if (TERMINAL_RUN_STATUSES.has(detail.status.toLowerCase())) {
        return { runId: detail.runId, status: detail.status, displayName: detail.displayName, terminal: true, pending: false, attempts }
      }
      const remaining = Math.max(0, maxWaitMs - (now() - startedAt))
      const capped = Math.min(nextDelay, remaining)
      if (capped === 0) {
        return { runId: detail.runId, status: detail.status, displayName: detail.displayName, terminal: false, pending: true, attempts }
      }
      const jittered = applyJitter(capped, jitterRatio)
      await sleep(jittered, signal)
      nextDelay = Math.min(maxDelayMs, nextDelay * 2)
    }
  }

  async prepare(agent: object, listingId: string, listingVersionId: string | undefined, rows: unknown, signal?: AbortSignal): Promise<ExecutionDraft> {
    const detail = await this.get(listingId, signal)
    if (!detail.available) throw new LoomApiError(409, 'the selected SkillBot is not available')
    const normalizedRows = inputRows(rows)
    validateRows(detail.fields, normalizedRows)
    const version = listingVersionId === undefined || listingVersionId === '' ? detail.versionId ?? '' : listingVersionId
    const quote = parseQuote(await this.api.request(
      `/marketListings/${encodeURIComponent(listingId)}:quote`,
      { method: 'POST', body: JSON.stringify({ inputRows: normalizedRows, listingVersionId: version }) },
      signal,
    ))
    const fingerprint = createHash('sha256').update(canonicalJson({ listingId, version, normalizedRows })).digest('hex')
    this.prune()
    const draft: StoredDraft = {
      id: `loom-draft-${randomUUID()}`,
      expiresAt: new Date(this.now() + DRAFT_TTL_MS).toISOString(),
      skillbot: detail,
      rowCount: normalizedRows.length,
      agent,
      listingVersionId: version,
      inputRows: normalizedRows,
      fingerprint,
      clientRequestId: `loomloom-dsh-${randomUUID()}`,
      quote,
    }
    this.drafts.set(draft.id, draft)
    return this.publicDraft(draft)
  }

  async execute(agent: object, draftId: string, signal?: AbortSignal): Promise<ExecutionReceipt> {
    this.prune()
    const draft = this.drafts.get(draftId)
    if (draft === undefined || draft.agent !== agent) throw new LoomApiError(404, 'execution draft is unavailable')
    const currentFingerprint = createHash('sha256').update(canonicalJson({ listingId: draft.skillbot.id, version: draft.listingVersionId, normalizedRows: draft.inputRows })).digest('hex')
    if (draft.fingerprint !== currentFingerprint) throw new LoomApiError(409, 'execution draft integrity check failed')
    const payload = {
      inputRows: draft.inputRows,
      listingVersionId: draft.listingVersionId,
      clientRequestId: draft.clientRequestId,
      confirm: true,
    }
    const response = await this.api.request(`/marketListings/${encodeURIComponent(draft.skillbot.id)}:execute`, { method: 'POST', body: JSON.stringify(payload) }, signal)
    this.drafts.delete(draftId)
    return { draftId, accepted: true, ...extractRun(response) }
  }

  describeDraft(draftId: string, agent: object): ExecutionDraft | undefined {
    this.prune()
    const draft = this.drafts.get(draftId)
    return draft === undefined || draft.agent !== agent ? undefined : this.publicDraft(draft)
  }

  private publicDraft(draft: StoredDraft): ExecutionDraft {
    return { id: draft.id, expiresAt: draft.expiresAt, skillbot: draft.skillbot, rowCount: draft.rowCount, quote: draft.quote }
  }

  private prune(): void {
    const now = this.now()
    for (const [id, draft] of this.drafts) if (Date.parse(draft.expiresAt) <= now) this.drafts.delete(id)
  }
}
