import { useCallback, useMemo, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import {
  IconCheckOutline16,
  IconCopyOutline16,
  IconDownloadOutline16,
  MarkdownText,
  StateDot,
  writeClipboard,
  type StateDotState,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  readRunResultMeta,
  textFromContent,
  type RunArtifactView,
  type RunPayloadView,
  type RunResultView,
} from './result-view.js'

export type LoomloomRunResultCardProps = ToolCallViewProps & PropsLocale<'loomloom'>

/** Rows drawn before the table offers to expand. */
const VISIBLE_ROWS = 8

/** Status dot + chip tone for one run status string. */
function statusTone(status: string): { readonly state: StateDotState, readonly tone: string } {
  switch (status) {
    case 'completed': case 'succeeded': case 'success': return { state: 'done', tone: 'success' }
    case 'failed': case 'error': return { state: 'error', tone: 'danger' }
    case 'running': case 'pending': case 'queued': return { state: 'ongoing', tone: 'info' }
    // An unrecognized status must not claim success; the dot asks for attention
    // while the chip states the raw status verbatim.
    default: return { state: 'warning', tone: 'neutral' }
  }
}

/** Rows a table draws before its artifact needs the expand control. */
function hiddenRowCount(meta: RunResultView): number {
  return meta.artifacts.reduce((max, artifact) => {
    const view = artifact.view
    if (view?.kind !== 'table') return max
    return Math.max(max, view.rows.length)
  }, 0)
}

/** One artifact payload drawn as a table, text or an empty note. */
function PayloadBlock({ view, expanded, t }: {
  readonly view: RunPayloadView
  readonly expanded: boolean
  readonly t: LoomloomRunResultCardProps['t']
}) {
  switch (view.kind) {
    case 'table': {
      const rows = expanded ? view.rows : view.rows.slice(0, VISIBLE_ROWS)
      return (
        <div className="loomloomResultTableWrap">
          <table className="loomloomResultTable">
            <thead>
              <tr>{view.columns.map((column, index) => <th key={`${String(index)}-${column}`}>{column}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {view.columns.map((_, columnIndex) => (
                    <td key={columnIndex}>
                      {row[columnIndex] ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }
    case 'fields':
      return (
        <div className="loomloomResultTableWrap">
          <table className="loomloomResultTable">
            <tbody>
              {view.rows.map((row, index) => (
                <tr key={index}>
                  <th scope="row">{row[0] ?? ''}</th>
                  <td>{row[1] ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'scalars':
      return (
        <div className="loomloomResultTableWrap">
          <table className="loomloomResultTable">
            <tbody>{view.rows.map((row, index) => <tr key={index}><td>{row}</td></tr>)}</tbody>
          </table>
        </div>
      )
    case 'text':
      return <MarkdownText
        text={view.text}
        labels={{ code: { copyLabel: t('markdownCopy'), copiedLabel: t('markdownCopied') }, footnotes: t('markdownFootnotes') }}
      />
    case 'empty':
      return <p className="loomloomResultNote">{t('runEmptyPayload')}</p>
  }
}

/** One artifact: head, download link, payload and the elision notes. */
function ArtifactBlock({ artifact, expanded, t }: {
  readonly artifact: RunArtifactView
  readonly expanded: boolean
  readonly t: LoomloomRunResultCardProps['t']
}) {
  const table = artifact.view?.kind === 'table' ? artifact.view : undefined
  const notes: string[] = []
  if (table !== undefined && table.totalRows > table.rows.length) {
    notes.push(t('runShownRows', { shown: table.rows.length, total: table.totalRows }))
  }
  if (table !== undefined && table.omittedColumns > 0) {
    notes.push(t('runOmittedColumns', { count: table.omittedColumns }))
  }
  if (artifact.truncated === true) notes.push(t('runTruncated'))

  return (
    <section className="loomloomResultArtifact" aria-label={artifact.label}>
      <div className="loomloomResultArtifactHead">
        <strong>{artifact.label}</strong>
        {artifact.mimeType !== undefined && <span className="loomloomChip" data-tone="neutral">{artifact.mimeType}</span>}
        {artifact.accessUrl !== undefined && (
          <a href={artifact.accessUrl} target="_blank" rel="noreferrer">
            <IconDownloadOutline16 size={14} />
            {t('runDownload')}
          </a>
        )}
      </div>
      {artifact.view === undefined
        ? <p className="loomloomResultNote">{t('runEmptyPayload')}</p>
        : <PayloadBlock view={artifact.view} expanded={expanded} t={t} />}
      {notes.length > 0 && <p className="loomloomResultNote">{notes.join(' · ')}</p>}
    </section>
  )
}

/**
 * The conversation card for `loomloom_execute_skillbot` and
 * `loomloom_get_run_results`.
 *
 * It draws the Host's structured payload — status, row counts, one block per
 * output artifact with a real table and a download link — so the artefact the
 * user paid for is the readable thing on screen. A call with no readable payload
 * (an older session, or a nested transport) falls back to the model-facing text
 * rather than an empty card.
 */
export function LoomloomRunResultCard({ block, t }: LoomloomRunResultCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const settled = block.kind === 'tool-result' ? block : undefined
  const meta: RunResultView | undefined = useMemo(
    () => (settled === undefined ? undefined : readRunResultMeta(settled.meta)),
    [settled],
  )

  const copyRunId = useCallback((runId: string) => {
    void writeClipboard(runId).then(result => {
      if (result !== true) return
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 1600)
    })
  }, [])

  if (settled === undefined) {
    return (
      <div className="loomloomResultCard">
        <div className="loomloomResultHead">
          <StateDot state="ongoing" />
          <h4>{t('runCardTitle')}</h4>
          <span className="loomloomChip" data-tone="info">{t('runStatusRunning')}</span>
        </div>
      </div>
    )
  }

  if (settled.isError) {
    return (
      <div className="loomloomResultCard">
        <div className="loomloomResultHead">
          <StateDot state="error" />
          <h4>{t('runCardTitle')}</h4>
        </div>
        <p className="loomloomAlert" data-tone="danger">{textFromContent(settled.content) || t('error')}</p>
      </div>
    )
  }

  if (meta === undefined) {
    const text = textFromContent(settled.content)
    return (
      <div className="loomloomResultCard">
        <div className="loomloomResultHead">
          <StateDot state="done" />
          <h4>{t('runCardTitle')}</h4>
        </div>
        {text === ''
          ? <p className="loomloomResultNote">{t('runEmptyPayload')}</p>
          : <MarkdownText
            text={text}
            labels={{ code: { copyLabel: t('markdownCopy'), copiedLabel: t('markdownCopied') }, footnotes: t('markdownFootnotes') }}
          />}
      </div>
    )
  }

  const tone = statusTone(meta.status)
  const runId = meta.runId
  const drawnRows = hiddenRowCount(meta)
  const trailing = drawnRows > VISIBLE_ROWS

  return (
    <div className="loomloomResultCard">
      <div className="loomloomResultHead">
        <StateDot state={tone.state} />
        <h4>{t('runCardTitle')}</h4>
        <span className="loomloomChip" data-tone={tone.tone}>{meta.status}</span>
        {runId !== undefined && (
          <button className="loomloomIconButton" type="button" onClick={() => { copyRunId(runId) }}>
            {copied ? <IconCheckOutline16 size={14} /> : <IconCopyOutline16 size={14} />}
            {copied ? t('runCopied') : t('runCopyId')}
          </button>
        )}
      </div>

      <dl className="loomloomResultStats">
        <div className="loomloomStat"><dt>{t('runStatsRows')}</dt><dd>{meta.total}</dd></div>
        <div className="loomloomStat"><dt>{t('runCompleted')}</dt><dd>{meta.completed}</dd></div>
        <div className="loomloomStat"><dt>{t('runFailed')}</dt><dd>{meta.failed}</dd></div>
      </dl>

      {meta.artifacts.length === 0
        ? <p className="loomloomResultNote">{t('runNoArtifacts')}</p>
        : <div className="loomloomResultArtifacts">
          {meta.artifacts.map(artifact => (
            <ArtifactBlock artifact={artifact} expanded={expanded} t={t} key={artifact.id} />
          ))}
        </div>}

      {trailing && (
        <button className="loomloomIconButton" type="button" onClick={() => { setExpanded(!expanded) }}>
          {expanded ? t('runShowLess') : t('runShowAll', { count: drawnRows })}
        </button>
      )}
      {meta.omittedArtifacts !== undefined && meta.omittedArtifacts > 0 && (
        <p className="loomloomResultNote">{t('runOmittedArtifacts', { count: meta.omittedArtifacts })}</p>
      )}
      {meta.truncated === true && <p className="loomloomResultNote">{t('runTruncated')}</p>}
    </div>
  )
}
