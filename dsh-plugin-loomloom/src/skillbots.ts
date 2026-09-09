import { createHash, randomUUID } from 'node:crypto'
import { setTimeout as scheduleTimeout } from 'node:timers/promises'
import { LoomApi, LoomApiError } from './loom-api.js'

const MAX_INPUT_ROWS = 100
const DRAFT_TTL_MS = 10 * 60_000
const ID_PATTERN = /^[A-Za-z0-9._-]{1,200}$/

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
}

export interface SkillbotToolValue {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly available: boolean
  readonly fixedFee?: string
  readonly versionId?: string
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

function fixedFee(value: Record<string, unknown>): string | undefined {
  const fee = asRecord(value.taskFixedFee)
  const amount = text(fee.amount)
  return amount === '' ? undefined : amount
}

function listingVersion(value: Record<string, unknown>): string | undefined {
  const version = pickText(value, ['listingVersionId', 'activeListingVersionId', 'latestListingVersionId', 'publishedVersionId', 'currentVersionId', 'versionId'])
  return version === '' ? undefined : version
}

function summary(value: Record<string, unknown>): SkillbotSummary {
  const id = pickText(value, ['id', 'listingId', 'marketListingId'])
  if (!ID_PATTERN.test(id)) throw new LoomApiError(502, 'loomloom returned a listing without a valid id')
  const name = pickText(value, ['displayName', 'name']) || id
  const description = pickText(value, ['description'])
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
  const runId = pickText(run, ['runId', 'id']) || pickText(outer, ['runId', 'id'])
  const status = pickText(run, ['status']) || pickText(outer, ['status'])
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
  const items = payload.items ?? payload.resultRows ?? payload.rows
  return Array.isArray(items) ? items.map(asRecord) : []
}

function artifacts(value: unknown): readonly RunArtifact[] {
  const payload = asRecord(value)
  const items = payload.items ?? payload.artifacts
  if (!Array.isArray(items)) return []
  return items.map(asRecord).map((item, index) => {
    const id = pickText(item, ['artifactId', 'id'])
    if (!ID_PATTERN.test(id)) throw new LoomApiError(502, `loomloom returned invalid artifact ${index + 1}`)
    const label = pickText(item, ['stepLabel', 'displayName', 'portName', 'stepId']) || id
    const mimeType = pickText(item, ['mimeType'])
    const accessUrl = pickText(item, ['accessUrl'])
    if (accessUrl !== '' && !/^https:\/\//u.test(accessUrl)) throw new LoomApiError(502, `loomloom returned invalid artifact URL ${index + 1}`)
    return {
      id, label,
      ...(mimeType === '' ? {} : { mimeType }),
      ...(accessUrl === '' ? {} : { accessUrl }),
    }
  })
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

function parseQuote(value: unknown): MarketQuote {
  const payload = asRecord(value)
  const quote = asRecord(payload.quote ?? payload.data ?? payload)
  const payable = monetaryText(quote.estimatedBuyerPayable ?? quote.buyerPayable ?? quote.estimatedPayable)
    ?? monetaryText(payload.estimatedBuyerPayable ?? payload.buyerPayable ?? payload.estimatedPayable)
  if (payable === undefined) throw new LoomApiError(502, 'loomloom quote did not return an estimated buyer payable amount')
  const fee = monetaryText(quote.taskFixedFee ?? payload.taskFixedFee)
  const currency = payable.currency ?? (pickText(quote, ['currency', 'currencyCode']) || pickText(payload, ['currency', 'currencyCode']))
  return {
    estimatedBuyerPayable: payable.amount,
    ...(currency === '' ? {} : { currency }),
    ...(fee === undefined ? {} : { taskFixedFee: fee.amount }),
  }
}

export class LoomSkillbotService {
  private readonly drafts = new Map<string, StoredDraft>()

  constructor(private readonly api: LoomApi, private readonly now: () => number = Date.now) {}

  async list(signal?: AbortSignal): Promise<readonly SkillbotSummary[]> {
    const payload = asRecord(await this.api.request('/marketListings?pageSize=100', {}, signal))
    const items = Array.isArray(payload.items) ? payload.items : []
    return items.map(item => summary(asRecord(item))).filter(item => item.available)
  }

  async get(listingId: string, signal?: AbortSignal): Promise<SkillbotDetail> {
    if (!ID_PATTERN.test(listingId)) throw new LoomApiError(400, 'invalid listingId')
    const payload = asRecord(await this.api.request(`/marketListings/${encodeURIComponent(listingId)}`, {}, signal))
    return { ...summary(payload), fields: parseFields(payload) }
  }

  async getRun(runId: string, signal?: AbortSignal): Promise<{ readonly runId: string, readonly status: string, readonly displayName: string }> {
    if (!ID_PATTERN.test(runId)) throw new LoomApiError(400, 'invalid runId')
    const payload = runRecord(await this.api.request(`/users/me/runs/${encodeURIComponent(runId)}`, {}, signal))
    return {
      runId: pickText(payload, ['runId', 'id']) || runId,
      status: pickText(payload, ['status']) || 'unknown',
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
