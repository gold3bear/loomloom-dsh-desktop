/**
 * One payload described as display-ready rows.
 *
 * A SkillBot output is JSON whose shape decides how it reads: a batch is a
 * table, a single record is a field/value list, a scalar list is one column, and
 * anything else is text. Both consumers of that decision — the model-facing
 * Markdown and the client's result card — take it from here, so the two can
 * never disagree about column order, caps or elision.
 *
 * Every cell is already escaped, whitespace-collapsed and elided, which is why
 * a renderer joins cells and never re-processes them.
 */

/** Rows kept in a table before it is summarised. */
export const DEFAULT_MAX_ROWS = 20
/** Columns kept before the remainder is reported. */
export const DEFAULT_MAX_COLUMNS = 8
/** Longest cell rendered before it is elided. */
export const MAX_CELL_CHARS = 120

/** Caps applied while describing one payload. */
export interface PayloadOptions {
  readonly maxRows?: number
  readonly maxColumns?: number
  readonly maxCellChars?: number
}

/** Why a payload has nothing to draw. */
export type EmptyReason = 'no-result' | 'empty-list' | 'empty-object' | 'no-fields'

/** A record array as a table, with the elision counts a renderer must report. */
export interface PayloadTable {
  readonly kind: 'table'
  /** Header cells, already display-ready. */
  readonly columns: readonly string[]
  /** Body rows, aligned with {@link columns}. */
  readonly rows: readonly (readonly string[])[]
  /** Rows the payload had before the row cap. */
  readonly totalRows: number
  /** Columns the payload had beyond the column cap. */
  readonly omittedColumns: number
}

/** A single record as a field/value list, nested keys flattened to dot paths. */
export interface PayloadFields {
  readonly kind: 'fields'
  readonly rows: readonly (readonly [string, string])[]
}

/** A scalar array as a single column. */
export interface PayloadScalars {
  readonly kind: 'scalars'
  readonly rows: readonly string[]
}

/** Anything else, verbatim. */
export interface PayloadText {
  readonly kind: 'text'
  readonly text: string
}

/** A payload with nothing to draw. */
export interface PayloadEmpty {
  readonly kind: 'empty'
  readonly reason: EmptyReason
}

export type PayloadView = PayloadTable | PayloadFields | PayloadScalars | PayloadText | PayloadEmpty

/** Nesting levels a single object is expanded into dot paths. */
const MAX_DEPTH = 2

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** One value as a short string; containers become a shape hint rather than exploding. */
function summarize(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return ''
  if (Array.isArray(value)) return value.length === 0 ? '[]' : `[${String(value.length)} items]`
  if (isRecord(value)) return Object.keys(value).length === 0 ? '{}' : '{…}'
  if (typeof value === 'object') return String(value)
  return String(value)
}

/** Collapses whitespace, escapes the table delimiter, and elides long values. */
function cell(value: unknown, maxChars: number): string {
  const text = summarize(value).replace(/\s+/gu, ' ').trim()
  const escaped = text.replace(/\|/gu, '\\|')
  return escaped.length > maxChars ? `${escaped.slice(0, maxChars - 1)}…` : escaped
}

/** Column order: first appearance across rows, so the payload's own order wins. */
function columnsOf(rows: readonly Record<string, unknown>[], maxColumns: number): readonly string[] {
  const columns: string[] = []
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!columns.includes(key)) columns.push(key)
    }
  }
  return columns.slice(0, maxColumns)
}

/** Flattens one object into dot-path leaves, expanding at most {@link MAX_DEPTH} levels. */
function leaves(value: unknown, prefix: string, depth: number, out: [string, unknown][]): void {
  if (depth >= MAX_DEPTH || !isRecord(value)) {
    out.push([prefix, value])
    return
  }
  const entries = Object.entries(value)
  if (entries.length === 0) {
    out.push([prefix, value])
    return
  }
  for (const [key, child] of entries) leaves(child, prefix === '' ? key : `${prefix}.${key}`, depth + 1, out)
}

function table(value: readonly Record<string, unknown>[], options: PayloadOptions): PayloadView {
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS
  const maxColumns = options.maxColumns ?? DEFAULT_MAX_COLUMNS
  const maxChars = options.maxCellChars ?? MAX_CELL_CHARS
  const columns = columnsOf(value, maxColumns)
  if (columns.length === 0) return { kind: 'empty', reason: 'no-fields' }
  const shown = value.slice(0, maxRows)
  const totalColumns = new Set(value.flatMap(row => Object.keys(row))).size
  return {
    kind: 'table',
    columns: columns.map(column => cell(column, maxChars)),
    rows: shown.map(row => columns.map(column => cell(row[column], maxChars))),
    totalRows: value.length,
    omittedColumns: Math.max(0, totalColumns - columns.length),
  }
}

function fields(value: Record<string, unknown>, options: PayloadOptions): PayloadView {
  const maxChars = options.maxCellChars ?? MAX_CELL_CHARS
  const pairs: [string, unknown][] = []
  for (const [key, child] of Object.entries(value)) leaves(child, key, 1, pairs)
  if (pairs.length === 0) return { kind: 'empty', reason: 'empty-object' }
  return { kind: 'fields', rows: pairs.map(([key, child]) => [cell(key, maxChars), cell(child, maxChars)] as const) }
}

/**
 * Describes one result value.
 *
 * Shape decides the form: a record array becomes a table, a single record becomes
 * a field/value list with dotted paths, a scalar array becomes one column, and
 * anything else falls back to text.
 * @param value - the parsed payload.
 * @param options - caps applied to rows, columns and cell length.
 * @returns the display-ready view.
 */
export function describePayload(value: unknown, options: PayloadOptions = {}): PayloadView {
  const maxChars = options.maxCellChars ?? MAX_CELL_CHARS
  if (value === null || value === undefined) return { kind: 'empty', reason: 'no-result' }
  if (Array.isArray(value)) {
    if (value.length === 0) return { kind: 'empty', reason: 'empty-list' }
    return value.every(isRecord)
      ? table(value, options)
      : { kind: 'scalars', rows: value.map(entry => cell(entry, maxChars)) }
  }
  if (isRecord(value)) return fields(value, options)
  return { kind: 'text', text: String(value) }
}

/** The marker a renderer draws for a payload that has nothing to show. */
export function emptyMarker(reason: EmptyReason): string {
  switch (reason) {
    case 'no-result': return '_(no result)_'
    case 'empty-list': return '_(empty list)_'
    case 'empty-object': return '_(empty object)_'
    case 'no-fields': return '_(no fields)_'
  }
}
