/**
 * The run-result payload as the client reads it.
 *
 * The Host writes this value through `output.presentationMeta`, so it arrives
 * from the session log — a durable boundary that a future Host version, a nested
 * call, or a hand-edited log may leave absent or malformed. Everything here is
 * therefore a narrowing: an unrecognized payload becomes `undefined` and the card
 * falls back to the model-facing text instead of drawing half a result.
 */

/** One row of a described table. */
export type RunViewTable = {
  readonly kind: 'table'
  readonly columns: readonly string[]
  readonly rows: readonly (readonly string[])[]
  readonly totalRows: number
  readonly omittedColumns: number
}

/** A single record as a field/value list. */
export type RunViewFields = {
  readonly kind: 'fields'
  readonly rows: readonly (readonly string[])[]
}

/** A scalar list as one column. */
export type RunViewScalars = {
  readonly kind: 'scalars'
  readonly rows: readonly string[]
}

/** A payload that is not tabular. */
export type RunViewText = {
  readonly kind: 'text'
  readonly text: string
}

/** A payload with nothing to draw. */
export type RunViewEmpty = {
  readonly kind: 'empty'
  readonly reason: string
}

export type RunPayloadView = RunViewTable | RunViewFields | RunViewScalars | RunViewText | RunViewEmpty

/** One artifact of the run. */
export type RunArtifactView = {
  readonly id: string
  readonly label: string
  readonly mimeType?: string
  readonly accessUrl?: string
  readonly view?: RunPayloadView
  readonly truncated?: boolean
}

/** The whole projected result. */
export type RunResultView = {
  readonly runId?: string
  readonly status: string
  readonly pending?: boolean
  readonly total: number
  readonly completed: number
  readonly failed: number
  readonly currency?: string
  readonly artifacts: readonly RunArtifactView[]
  readonly omittedArtifacts?: number
  readonly truncated?: boolean
}

/** Payload revision this client understands. */
const SUPPORTED_VERSION = 1

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function strings(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every(entry => typeof entry === 'string') ? [...value] : undefined
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** Narrows one described payload. */
function payloadView(value: unknown): RunPayloadView | undefined {
  const source = record(value)
  if (source === undefined) return undefined
  switch (source.kind) {
    case 'table': {
      const columns = strings(source.columns)
      const rows = Array.isArray(source.rows) ? source.rows.map(strings) : undefined
      if (columns === undefined || rows === undefined || rows.some(row => row === undefined)) return undefined
      return {
        kind: 'table',
        columns,
        rows: rows as string[][],
        totalRows: count(source.totalRows),
        omittedColumns: count(source.omittedColumns),
      }
    }
    case 'fields': {
      const rows = Array.isArray(source.rows) ? source.rows.map(strings) : undefined
      if (rows === undefined || rows.some(row => row === undefined || row.length !== 2)) return undefined
      return { kind: 'fields', rows: rows as string[][] }
    }
    case 'scalars': {
      const rows = strings(source.rows)
      return rows === undefined ? undefined : { kind: 'scalars', rows }
    }
    case 'text': return typeof source.text === 'string' ? { kind: 'text', text: source.text } : undefined
    case 'empty': return { kind: 'empty', reason: typeof source.reason === 'string' ? source.reason : 'unknown' }
    default: return undefined
  }
}

/** Narrows one artifact. */
function artifactView(value: unknown): RunArtifactView | undefined {
  const source = record(value)
  if (source === undefined || typeof source.id !== 'string' || typeof source.label !== 'string') return undefined
  const view = source.view === undefined ? undefined : payloadView(source.view)
  return {
    id: source.id,
    label: source.label,
    ...(optionalString(source.mimeType) === undefined ? {} : { mimeType: optionalString(source.mimeType) as string }),
    ...(optionalString(source.accessUrl) === undefined ? {} : { accessUrl: optionalString(source.accessUrl) as string }),
    ...(view === undefined ? {} : { view }),
    ...(source.truncated === true ? { truncated: true } : {}),
  }
}

/**
 * Narrows a persisted presentation payload.
 * @param meta - the `tool/result` meta value, of unknown shape on the wire.
 * @returns the readable result, or undefined when this client cannot read it.
 */
export function readRunResultMeta(meta: unknown): RunResultView | undefined {
  const source = record(meta)
  if (source === undefined || source.v !== SUPPORTED_VERSION || typeof source.status !== 'string') return undefined
  const counts = record(source.counts) ?? {}
  const artifacts = Array.isArray(source.artifacts)
    ? source.artifacts.map(artifactView).filter((entry): entry is RunArtifactView => entry !== undefined)
    : []
  return {
    ...(optionalString(source.runId) === undefined ? {} : { runId: optionalString(source.runId) as string }),
    status: source.status,
    ...(source.pending === true ? { pending: true } : {}),
    total: count(counts.total),
    completed: count(counts.completed),
    failed: count(counts.failed),
    ...(optionalString(source.currency) === undefined ? {} : { currency: optionalString(source.currency) as string }),
    artifacts,
    ...(typeof source.omittedArtifacts === 'number' ? { omittedArtifacts: source.omittedArtifacts } : {}),
    ...(source.truncated === true ? { truncated: true } : {}),
  }
}

/**
 * The model-facing text of a settled call, used when no readable payload exists.
 *
 * Older sessions were logged before the Host projected a payload, and a call
 * nested under a composite transport never gets one at all; both must still draw
 * something truthful.
 * @param content - the call's result content blocks.
 * @returns the concatenated text blocks, or an empty string.
 */
export function textFromContent(content: readonly { readonly type: string }[]): string {
  return content
    .flatMap(block => {
      const source = record(block)
      return source !== undefined && source.type === 'text' && typeof source.text === 'string' ? [source.text] : []
    })
    .join('\n\n')
    .trim()
}
