import { useCallback, useEffect, useRef, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import {
  executeSkillbot,
  readCredentialStatus,
  readSkillbot,
  readSkillbotsPage,
  quoteSkillbot,
  type LoomField,
  type LoomListing,
  type LoomMarketQuote,
  type LoomSkillbotDetail,
} from './api.js'
import { LoomloomConnectFlow } from './LoomloomConnectFlow.js'
import { setLoomloomMarketActive } from './market-navigation.js'

export type LoomloomMarketPageProps = PropsLocale<'loomloom'>

interface CurrentQuote {
  readonly value: LoomMarketQuote
  readonly revision: number
}

function inputValue(field: LoomField, value: unknown): string | number | boolean {
  if (field.valueType === 'boolean' || field.valueType === 'bool') return value === true
  if (field.valueType === 'integer' || field.valueType === 'number' || field.valueType === 'float') {
    return typeof value === 'number' ? value : ''
  }
  return typeof value === 'string' ? value : ''
}

function responseRunId(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim() !== '') return value.trim()
  if (typeof value !== 'object' || value === null) return undefined
  const root = value as Record<string, unknown>
  const nested = typeof root.run === 'object' && root.run !== null ? root.run as Record<string, unknown> : {}
  const candidate = nested.runId ?? nested.id ?? root.runId ?? root.id
  return typeof candidate === 'string' && candidate.trim() !== '' ? candidate.trim() : undefined
}

export function LoomloomMarketPage({ t }: LoomloomMarketPageProps) {
  const [configured, setConfigured] = useState(false)
  const [listings, setListings] = useState<readonly LoomListing[]>([])
  const [nextPageToken, setNextPageToken] = useState<string | undefined>()
  const [selected, setSelected] = useState<LoomSkillbotDetail | undefined>()
  const [rows, setRows] = useState<readonly Record<string, unknown>[]>([{}])
  const [quote, setQuote] = useState<CurrentQuote | undefined>()
  const [runId, setRunId] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const inputRevision = useRef(0)
  const executionPending = useRef(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(undefined)
    try {
      const credential = await readCredentialStatus()
      setConfigured(credential.configured)
      if (!credential.configured) {
        setListings([])
        setNextPageToken(undefined)
        return
      }
      const page = await readSkillbotsPage({ pageSize: 30 })
      setListings(page.listings)
      setNextPageToken(page.nextPageToken)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('error'))
    } finally {
      setLoading(false)
    }
  }, [t])

  const loadMore = async (): Promise<void> => {
    if (nextPageToken === undefined || loadingMore) return
    setLoadingMore(true)
    setError(undefined)
    try {
      const page = await readSkillbotsPage({ pageSize: 30, pageToken: nextPageToken })
      setListings(previous => [...previous, ...page.listings])
      setNextPageToken(page.nextPageToken)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('error'))
    } finally {
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    void load()
  }, [load])

  const select = async (listingId: string): Promise<void> => {
    setError(undefined)
    setQuote(undefined)
    setRunId(undefined)
    setRows([{}])
    inputRevision.current += 1
    try {
      setSelected(await readSkillbot(listingId))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('error'))
    }
  }

  const updateField = (field: LoomField, value: string | number | boolean): void => {
    setRows(previous => [{ ...previous[0], [field.key]: value }])
    setQuote(undefined)
    setRunId(undefined)
    inputRevision.current += 1
  }

  const requestQuote = async (): Promise<void> => {
    if (selected === undefined) return
    const revision = inputRevision.current
    const inputRows = rows
    setSubmitting(true)
    setError(undefined)
    try {
      const value = await quoteSkillbot(selected.id, inputRows)
      if (inputRevision.current === revision) setQuote({ value, revision })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('error'))
    } finally {
      setSubmitting(false)
    }
  }

  const execute = async (): Promise<void> => {
    if (selected === undefined || quote === undefined || quote.revision !== inputRevision.current || executionPending.current) return
    executionPending.current = true
    setSubmitting(true)
    setError(undefined)
    try {
      setRunId(responseRunId(await executeSkillbot(selected.id, rows)))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('error'))
    } finally {
      executionPending.current = false
      setSubmitting(false)
    }
  }

  return (
        <div className="loomloomMarketPage">
          <section className="loomloomMarketPanel" role="region" aria-labelledby="loomloom-market-title">
            <header className="loomloomMarketHeader">
              <div>
                <p className="loomloomMarketEyebrow">{t('marketEyebrow')}</p>
                <h2 id="loomloom-market-title">{t('marketTitle')}</h2>
              </div>
            </header>
            {!configured
              ? <LoomloomConnectFlow t={t} onConnected={() => { void load() }} onLater={() => { setLoomloomMarketActive(false) }} />
              : <div className="loomloomMarketBody">
                {error && <p className="loomloomError" role="alert">{error}</p>}
                {runId && <div className="loomloomMarketSuccess" role="status">{t('executionSubmitted')}: <code>{runId}</code></div>}
                {selected === undefined
                  ? <div className="loomloomMarketList">
                    <div className="loomloomMarketSectionHead">
                      <h3>{t('marketSkillbots')}</h3>
                      <button className="loomloomButton" type="button" onClick={() => void load()} disabled={loading || loadingMore}>{t('refresh')}</button>
                    </div>
                    {loading
                      ? <p className="loomloomFlowDescription">{t('loading')}</p>
                      : listings.map(item => (
                        <button className="loomloomMarketItem" type="button" key={item.id} onClick={() => void select(item.id)}>
                          <span className="loomloomMarketItemMain">
                            <strong>{item.name}</strong>
                            {item.description && <small>{item.description}</small>}
                          </span>
                          <span className="loomloomMarketItemMeta">{item.fixedFee ?? t('free')} <span aria-hidden="true">›</span></span>
                        </button>
                      ))}
                    {!loading && listings.length === 0 && <p className="loomloomFlowDescription">{t('marketEmpty')}</p>}
                    {!loading && nextPageToken !== undefined && (
                      <button className="loomloomButton" type="button" onClick={() => void loadMore()} disabled={loadingMore}>
                        {loadingMore ? t('loading') : t('loadMore')}
                      </button>
                    )}
                  </div>
                  : <div className="loomloomMarketDetail">
                    <button className="loomloomMarketBack" type="button" onClick={() => { setSelected(undefined); setQuote(undefined); setRunId(undefined) }}>← {t('backToMarket')}</button>
                    <div className="loomloomMarketDetailTitle">
                      <div>
                        <p className="loomloomMarketEyebrow">{t('skillbot')}</p>
                        <h3>{selected.name}</h3>
                      </div>
                      <span className="loomloomBadge" data-available={selected.available}>{selected.available ? t('available') : t('unavailable')}</span>
                    </div>
                    {selected.description && <p className="loomloomFlowDescription">{selected.description}</p>}
                    <div className="loomloomMarketForm">
                      {selected.fields.map(field => (
                        <label className="loomloomMarketField" key={field.key}>
                          <span>{field.label}{field.required ? ' *' : ''}</span>
                          {field.enumValues
                            ? <select value={String(rows[0]?.[field.key] ?? '')} onChange={event => updateField(field, event.target.value)}>
                              <option value="">{t('selectPlaceholder')}</option>
                              {field.enumValues.map(value => <option value={value} key={value}>{value}</option>)}
                            </select>
                            : field.valueType === 'boolean' || field.valueType === 'bool'
                              ? <input type="checkbox" checked={inputValue(field, rows[0]?.[field.key]) === true} onChange={event => updateField(field, event.target.checked)} />
                              : <input
                                type={field.valueType === 'integer' || field.valueType === 'number' || field.valueType === 'float' ? 'number' : 'text'}
                                value={String(inputValue(field, rows[0]?.[field.key]))}
                                placeholder={field.description}
                                onChange={event => {
                                  const raw = event.target.value
                                  const value = field.valueType === 'integer' ? (raw === '' ? '' : Number.parseInt(raw, 10))
                                    : field.valueType === 'number' || field.valueType === 'float' ? (raw === '' ? '' : Number.parseFloat(raw))
                                      : raw
                                  updateField(field, value)
                                }}
                              />}
                          {field.description && <small>{field.description}</small>}
                        </label>
                      ))}
                    </div>
                    {quote && <div className="loomloomMarketQuote">
                      <span>{t('estimatedPayable')}</span>
                      <strong>{quote.value.estimatedBuyerPayable} {quote.value.currency ?? ''}</strong>
                    </div>}
                    <div className="loomloomFlowActions">
                      {!quote
                        ? <button className="loomloomButton loomloomButtonPrimary" type="button" onClick={() => void requestQuote()} disabled={submitting || !selected.available}>{submitting ? t('loading') : t('getQuote')}</button>
                        : <button className="loomloomButton loomloomButtonPrimary" type="button" onClick={() => void execute()} disabled={submitting}>{submitting ? t('loading') : t('confirmExecute')}</button>}
                    </div>
                  </div>}
              </div>}
          </section>
        </div>
  )
}
