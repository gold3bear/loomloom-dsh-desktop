/**
 * Renders a run's result value as the Markdown a DSH conversation already draws.
 *
 * SkillBot outputs are JSON — a batch of generated rows, a structured brief, a
 * per-row status — and dropping that into a tool card as raw text makes the one
 * artefact the user paid for the hardest thing on screen to read. The
 * conversation renders GFM tables (`micromark-extension-gfm-table` is part of the
 * client renderer), so a table is reachable through the ordinary text content
 * block: no new block type, no upstream change, and a plain fallback when the
 * payload is not tabular.
 *
 * Everything here is a pure string transform so it can be tested without a Host,
 * a client, or a network.
 */

/** Rows kept in a table before it is summarised. */
const DEFAULT_MAX_ROWS = 20
/** Columns kept before the remainder is reported. */
const DEFAULT_MAX_COLUMNS = 8
/** Longest cell rendered before it is elided. */
const MAX_CELL_CHARS = 120
/** Nesting levels a single object is expanded into dot paths. */
const MAX_DEPTH = 2
/**
 * Character budget for one artifact payload.
 *
 * The value is handed to the model as well as drawn on the card, so an
 * unbounded output would land in the conversation's context. The Host already
 * caps an upstream body at 2 MB, which is far too much for a context window;
 * this is the presentation budget. Truncation stays visible in the text so a
 * caller never mistakes a cut payload for a complete one.
 */
export const MAX_ARTIFACT_TEXT_CHARS = 16_000
const TRUNCATION_MARKER = '\n…[truncated]'

/** Number of artifacts whose payload is drawn before the rest are only listed. */
const DEFAULT_MAX_ARTIFACTS = 3

export interface PresentationOptions {
  readonly maxRows?: number
  readonly maxColumns?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Parses an artifact's inline text when it is a JSON object or array.
 *
 * Scalar JSON (`42`, `"done"`) is deliberately not treated as a payload: the raw
 * text is already the best presentation of it, and refusing it keeps callers from
 * rendering a one-cell table.
 */
export function parseInlineJson(text: string): unknown | undefined {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined
  try {
    const parsed: unknown = JSON.parse(trimmed)
    return isRecord(parsed) || Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/** Collapses whitespace, escapes the table delimiter, and elides long values. */
function cell(value: unknown): string {
  const text = summarize(value).replace(/\s+/gu, ' ').trim()
  const escaped = text.replace(/\|/gu, '\\|')
  return escaped.length > MAX_CELL_CHARS ? `${escaped.slice(0, MAX_CELL_CHARS - 1)}…` : escaped
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

interface Row {
  readonly [key: string]: unknown
}

/** Column order: first appearance across rows, so the payload's own order wins. */
function columnsOf(rows: readonly Row[], maxColumns: number): readonly string[] {
  const columns: string[] = []
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!columns.includes(key)) columns.push(key)
    }
  }
  return columns.slice(0, maxColumns)
}

function table(header: readonly string[], body: readonly (readonly string[])[]): string {
  const head = `| ${header.join(' | ')} |`
  const rule = `| ${header.map(() => '---').join(' | ')} |`
  const lines = body.map(cells => `| ${cells.join(' | ')} |`)
  return [head, rule, ...lines].join('\n')
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

function objectTable(value: Record<string, unknown>): string {
  const pairs: [string, unknown][] = []
  for (const [key, child] of Object.entries(value)) leaves(child, key, 1, pairs)
  if (pairs.length === 0) return '_(empty object)_'
  return table(['field', 'value'], pairs.map(([key, child]) => [cell(key), cell(child)]))
}

function rowsTable(rows: readonly Row[], options: PresentationOptions): string {
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS
  const maxColumns = options.maxColumns ?? DEFAULT_MAX_COLUMNS
  const columns = columnsOf(rows, maxColumns)
  if (columns.length === 0) return '_(no fields)_'
  const shown = rows.slice(0, maxRows)
  const rendered = table(columns.map(column => cell(column)), shown.map(row => columns.map(column => cell(row[column]))))
  const notes: string[] = []
  if (rows.length > shown.length) notes.push(`showing ${String(shown.length)} of ${String(rows.length)} rows`)
  const totalColumns = new Set(rows.flatMap(row => Object.keys(row))).size
  if (totalColumns > columns.length) notes.push(`${String(totalColumns - columns.length)} more column(s) omitted`)
  return [rendered, ...notes.map(note => `_${note}_`)].join('\n\n')
}

function scalarTable(values: readonly unknown[]): string {
  return table(['value'], values.map(value => [cell(value)]))
}

/**
 * Renders one result value as Markdown.
 *
 * Shape decides the form: a record array becomes a table, a single record becomes
 * a field/value table with dotted paths, a scalar array becomes a one-column
 * table, and anything else falls back to a fenced block so a caller never has to
 * special-case a payload it did not expect.
 */
export function jsonToMarkdown(value: unknown, options: PresentationOptions = {}): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return '_(empty list)_'
    return value.every(isRecord)
      ? rowsTable(value, options)
      : scalarTable(value)
  }
  if (isRecord(value)) return objectTable(value)
  if (value === null || value === undefined) return '_(no result)_'
  return `\`\`\`\n${String(value)}\n\`\`\``
}

/** Bounds one artifact payload, marking the cut so a truncated result is never read as complete. */
export function capArtifactText(text: string, budget: number = MAX_ARTIFACT_TEXT_CHARS): string {
  return text.length <= budget ? text : `${text.slice(0, budget)}${TRUNCATION_MARKER}`
}

/** One output artifact as the card needs it. */
export interface PresentedArtifact {
  readonly label: string
  readonly mimeType?: string
  readonly accessUrl?: string
  /** The artifact's own content; JSON is drawn as a table. */
  readonly inlineText?: string
}

export interface ArtifactPresentationOptions extends PresentationOptions {
  /** Artifacts whose payload is drawn; any remainder is listed by count. */
  readonly maxArtifacts?: number
}

function fenced(text: string): string {
  return `\`\`\`\n${text.replace(/```/gu, '`\u200b``')}\n\`\`\``
}

/**
 * Draws a run's output artifacts.
 *
 * Each artifact is titled by its label, its JSON payload becomes a table, its
 * non-JSON payload becomes a fenced block, and a download link follows whenever
 * the upstream published one. Only the first few payloads are drawn: a run can
 * return many artifacts and the card is not the place to read all of them.
 */
export function renderArtifacts(
  artifacts: readonly PresentedArtifact[],
  options: ArtifactPresentationOptions = {},
): string {
  if (artifacts.length === 0) return '_(no output artifacts)_'
  const maxArtifacts = options.maxArtifacts ?? DEFAULT_MAX_ARTIFACTS
  const shown = artifacts.slice(0, maxArtifacts)
  const blocks = shown.map(artifact => {
    const parts = [`**${artifact.label}**`]
    if (artifact.inlineText !== undefined && artifact.inlineText.trim() !== '') {
      const parsed = parseInlineJson(artifact.inlineText)
      parts.push(parsed === undefined ? fenced(artifact.inlineText) : jsonToMarkdown(parsed, options))
    }
    if (artifact.accessUrl !== undefined) {
      parts.push(`[${artifact.mimeType ?? 'download'}](${artifact.accessUrl})`)
    }
    return parts.join('\n\n')
  })
  if (artifacts.length > shown.length) {
    blocks.push(`_${String(artifacts.length - shown.length)} more artifact(s) not shown_`)
  }
  return blocks.join('\n\n')
}
