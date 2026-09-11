/**
 * The structured result payload the client's result card renders.
 *
 * `output.presentationMeta` is persisted verbatim on the `tool/result` session
 * event and replayed on every later read, so this value is both the card's data
 * source and a line in the session log: it is bounded by design (a whole-meta
 * character budget, capped rows, capped columns, capped artifacts) and it holds
 * no input rows. The client never parses the model-facing Markdown.
 */

import { MAX_ARTIFACT_TEXT_CHARS, capArtifactText, parseInlineJson } from './result-presentation.js'
import { describePayload, type PayloadView } from './payload-view.js'

/** Payload revision; a client that does not know it falls back to the plain card. */
export const RUN_RESULT_META_VERSION = 1
/** Artifacts whose payload the card draws; the remainder is only counted. */
export const MAX_META_ARTIFACTS = 3
/** Whole-meta budget, applied to the serialized value the session log stores. */
export const MAX_META_CHARS = MAX_ARTIFACT_TEXT_CHARS

/**
 * A JSON value, declared locally because the client narrows this payload without
 * importing a Host package.
 */
export type RunJson = null | boolean | number | string | RunJson[] | { [key: string]: RunJson }

/** One artifact as the card draws it. */
export type RunResultArtifactMeta = {
  readonly id: string
  readonly label: string
  readonly mimeType?: string
  readonly accessUrl?: string
  /** The described payload; absent when the artifact has no inline content or was elided. */
  readonly view?: RunJson
  /** Whether this artifact's payload was cut by the budget. */
  readonly truncated?: true
}

/** The whole result, as the card and the session log see it. */
export type RunResultMeta = {
  readonly v: 1
  readonly runId?: string
  readonly status: string
  readonly pending?: true
  readonly counts: { readonly total: number; readonly completed: number; readonly failed: number }
  readonly currency?: string
  readonly artifacts: RunResultArtifactMeta[]
  /** Artifacts the run returned beyond {@link MAX_META_ARTIFACTS}. */
  readonly omittedArtifacts?: number
  /** Whether the budget cut anything. */
  readonly truncated?: true
}

/** One artifact of the tool's canonical value. */
export type RunResultSourceArtifact = {
  readonly id: string
  readonly label: string
  readonly mimeType?: string
  readonly accessUrl?: string
  readonly inlineText?: string
}

/** The fields of `loomloom_execute_skillbot` / `loomloom_get_run_results` this projection reads. */
export type RunResultSource = {
  readonly runId?: string
  readonly status?: string
  readonly pending?: boolean
  readonly totalRows?: number
  readonly completedRows?: number
  readonly failedRows?: number
  readonly currency?: string
  readonly artifacts?: readonly RunResultSourceArtifact[]
}

/** Copies a described payload into plain JSON: the log stores arrays, not readonly views. */
function jsonView(view: PayloadView): RunJson {
  switch (view.kind) {
    case 'table': return { kind: 'table', columns: [...view.columns], rows: view.rows.map(row => [...row]), totalRows: view.totalRows, omittedColumns: view.omittedColumns }
    case 'fields': return { kind: 'fields', rows: view.rows.map(row => [row[0], row[1]]) }
    case 'scalars': return { kind: 'scalars', rows: [...view.rows] }
    case 'text': return { kind: 'text', text: view.text }
    case 'empty': return { kind: 'empty', reason: view.reason }
  }
}

/** Mutable build face of {@link RunResultMeta}; the returned value is the readonly one. */
type DraftMeta = { -readonly [K in keyof RunResultMeta]: RunResultMeta[K] }

/** One artifact's payload as a view, or absent when there is nothing to draw. */
function artifactView(inlineText: string | undefined): { view?: RunJson, truncated: boolean } {
  if (inlineText === undefined || inlineText.trim() === '') return { truncated: false }
  const parsed = parseInlineJson(inlineText)
  if (parsed !== undefined) return { view: jsonView(describePayload(parsed)), truncated: false }
  const capped = capArtifactText(inlineText)
  return { view: jsonView({ kind: 'text', text: capped }), truncated: capped !== inlineText }
}

/** Applies a row cap to every table/scalar view, marking what it cut. */
function capRows(artifacts: RunResultArtifactMeta[], rows: number): boolean {
  let cut = false
  for (const artifact of artifacts) {
    const view = artifact.view
    if (typeof view !== 'object' || view === null || Array.isArray(view)) continue
    const kind = (view as { kind?: unknown }).kind
    if (kind !== 'table' && kind !== 'scalars') continue
    const current = (view as { rows: RunJson[] }).rows
    if (current.length === 0) continue
    const keep = rows === 0 ? [] : current.slice(0, rows)
    if (keep.length === current.length) continue
    cut = true
    if (rows === 0) {
      delete (artifact as { view?: RunJson }).view
      ;(artifact as { truncated?: true }).truncated = true
      continue
    }
    ;(view as { rows: RunJson[] }).rows = keep
    ;(artifact as { truncated?: true }).truncated = true
  }
  return cut
}

/** Drops every remaining payload view, keeping labels and download links. */
function dropViews(artifacts: RunResultArtifactMeta[]): boolean {
  let cut = false
  for (const artifact of artifacts) {
    if (artifact.view === undefined) continue
    cut = true
    delete (artifact as { view?: RunJson }).view
    ;(artifact as { truncated?: true }).truncated = true
  }
  return cut
}

/**
 * Projects one execution/read result into the card's payload.
 *
 * The payload is trimmed deterministically while it exceeds
 * {@link MAX_META_CHARS}: rows first (10, then 5, then 2, then none), then the
 * payloads themselves, then whole artifacts from the end. Every cut is reported
 * through `truncated`/`omittedArtifacts` so a reader never mistakes a trimmed
 * result for a complete one.
 * @param source - the tool's canonical value.
 * @returns the bounded presentation payload.
 */
export function runResultMeta(source: RunResultSource): RunResultMeta {
  const all = source.artifacts ?? []
  const shown = all.slice(0, MAX_META_ARTIFACTS)
  const artifacts: RunResultArtifactMeta[] = shown.map(artifact => {
    const { view, truncated } = artifactView(artifact.inlineText)
    return {
      id: artifact.id,
      label: artifact.label,
      ...(artifact.mimeType === undefined ? {} : { mimeType: artifact.mimeType }),
      ...(artifact.accessUrl === undefined ? {} : { accessUrl: artifact.accessUrl }),
      ...(view === undefined ? {} : { view }),
      ...(truncated ? { truncated: true as const } : {}),
    }
  })

  const meta: DraftMeta = {
    v: RUN_RESULT_META_VERSION,
    ...(source.runId === undefined ? {} : { runId: source.runId }),
    status: source.status ?? 'unknown',
    ...(source.pending === true ? { pending: true as const } : {}),
    counts: {
      total: source.totalRows ?? 0,
      completed: source.completedRows ?? 0,
      failed: source.failedRows ?? 0,
    },
    ...(source.currency === undefined ? {} : { currency: source.currency }),
    artifacts,
    ...(all.length > shown.length ? { omittedArtifacts: all.length - shown.length } : {}),
  }

  const size = (): number => JSON.stringify(meta).length
  let cut = false
  for (const rows of [10, 5, 2, 0]) {
    if (size() <= MAX_META_CHARS) break
    if (capRows(artifacts, rows)) cut = true
  }
  if (size() > MAX_META_CHARS && dropViews(artifacts)) cut = true
  while (size() > MAX_META_CHARS && artifacts.length > 0) {
    artifacts.pop()
    meta.omittedArtifacts = (meta.omittedArtifacts ?? 0) + 1
    cut = true
  }
  if (cut || size() > MAX_META_CHARS) meta.truncated = true
  return { ...meta }
}
