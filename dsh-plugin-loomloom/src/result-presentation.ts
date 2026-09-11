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
 * The shape decision itself lives in `payload-view.ts`, shared with the client's
 * result card; this module only turns that view into Markdown.
 */

import { describePayload, emptyMarker, type PayloadOptions, type PayloadTable } from './payload-view.js'

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

export type PresentationOptions = PayloadOptions

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function table(header: readonly string[], body: readonly (readonly string[])[]): string {
  const head = `| ${header.join(' | ')} |`
  const rule = `| ${header.map(() => '---').join(' | ')} |`
  const lines = body.map(cells => `| ${cells.join(' | ')} |`)
  return [head, rule, ...lines].join('\n')
}

/** One table view plus the elision notes a reader must see. */
function tableMarkdown(view: PayloadTable): string {
  const rendered = table(view.columns, view.rows)
  const notes: string[] = []
  const shown = view.rows.length
  if (view.totalRows > shown) notes.push(`showing ${String(shown)} of ${String(view.totalRows)} rows`)
  if (view.omittedColumns > 0) notes.push(`${String(view.omittedColumns)} more column(s) omitted`)
  return [rendered, ...notes.map(note => `_${note}_`)].join('\n\n')
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
  const view = describePayload(value, options)
  switch (view.kind) {
    case 'table': return tableMarkdown(view)
    case 'fields': return table(['field', 'value'], view.rows)
    case 'scalars': return table(['value'], view.rows.map(row => [row]))
    case 'text': return `\`\`\`\n${view.text}\n\`\`\``
    case 'empty': return emptyMarker(view.reason)
  }
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
