import { useCallback, useEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { LoomloomConnectFlow } from './LoomloomConnectFlow.js'
import {
  LoomClientApiError,
  type LoomCredentialStatus,
  type LoomListing,
  type LoomRun,
  type LoomSkillbotDetail,
  readBootstrap,
  readRun,
  readRuns,
  logout,
  readSkillbot,
  readSkillbots,
} from './api.js'

export type LoomloomSettingsTabProps = PropsRuntime<'settings.plugins.tab'> & PropsLocale<'loomloom'>

function failureMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim() !== '' ? cause.message : fallback
}

export function LoomloomSettingsTab({ t }: LoomloomSettingsTabProps) {
  const [credentials, setCredentials] = useState<LoomCredentialStatus>({ configured: false })
  const [skillbots, setSkillbots] = useState<readonly LoomListing[]>([])
  const [runs, setRuns] = useState<readonly LoomRun[]>([])
  const [selected, setSelected] = useState<LoomSkillbotDetail | undefined>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()
  const [runLoading, setRunLoading] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [connectRefreshKey, setConnectRefreshKey] = useState(0)
  const detailController = useRef<AbortController>()

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError(undefined)
    try {
      const bootstrap = await readBootstrap(signal)
      if (signal?.aborted) return
      setCredentials(bootstrap.credential)
      if (!bootstrap.credential.configured) {
        setSkillbots([])
        setRuns([])
        setSelected(undefined)
        return
      }
      const [listings, recentRuns] = await Promise.all([readSkillbots(signal), readRuns(signal)])
      if (signal?.aborted) return
      setSkillbots(listings)
      setRuns(recentRuns)
    } catch (cause) {
      if (signal?.aborted) return
      if (cause instanceof LoomClientApiError && cause.status === 401) {
        setCredentials({ configured: false })
        setSkillbots([])
        setRuns([])
        setSelected(undefined)
        setConnectRefreshKey(value => value + 1)
        setError(t('signInFailed'))
        return
      }
      setError(failureMessage(cause, t('error')))
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [t])

  const refreshRuns = useCallback(async () => {
    setRunLoading(true)
    try { setRuns(await readRuns()) } catch (cause) { setError(failureMessage(cause, t('error'))) } finally { setRunLoading(false) }
  }, [t])

  const refreshRun = useCallback(async (runId: string) => {
    try {
      const current = await readRun(runId)
      setRuns(previous => previous.map(item => item.id === runId ? current : item))
    } catch (cause) { setError(failureMessage(cause, t('error'))) }
  }, [t])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => {
      controller.abort()
      detailController.current?.abort()
    }
  }, [load])

  const select = useCallback(async (listingId: string) => {
    detailController.current?.abort()
    const controller = new AbortController()
    detailController.current = controller
    setError(undefined)
    try {
      const detail = await readSkillbot(listingId, controller.signal)
      if (!controller.signal.aborted) setSelected(detail)
    } catch (cause) {
      if (!controller.signal.aborted) setError(failureMessage(cause, t('error')))
    }
  }, [t])

  const signOut = useCallback(async () => {
    setSigningOut(true)
    setError(undefined)
    try {
      await logout()
      setCredentials({ configured: false })
      setSkillbots([])
      setRuns([])
      setSelected(undefined)
      setConnectRefreshKey(value => value + 1)
    } catch (cause) { setError(failureMessage(cause, t('error'))) } finally { setSigningOut(false) }
  }, [t])

  return (
    <section className="loomloomRoot" aria-label={t('tab')}>
      <header className="loomloomHeader">
        <div>
          <h2>{t('title')}</h2>
          <p>{t('subtitle')}</p>
        </div>
        <button
          className="loomloomButton"
          type="button"
          onClick={() => {
            setConnectRefreshKey(value => value + 1)
            void load()
          }}
          disabled={loading}
        >
          {loading ? t('loading') : t('refresh')}
        </button>
      </header>

      <LoomloomConnectFlow
        t={t}
        refreshKey={connectRefreshKey}
        onConnected={() => { void load() }}
      />
      {credentials.configured && <div className="loomloomNote loomloomAccountActions">
        <p>{t('credentialHint')}</p>
        <button className="loomloomButton" type="button" onClick={() => void signOut()} disabled={signingOut}>
          {signingOut ? t('signingOut') : t('signOut')}
        </button>
      </div>}
      {error !== undefined && <div className="loomloomError" role="alert">{error}</div>}

      {credentials.configured && !loading && error === undefined && skillbots.length === 0 && <div className="loomloomEmpty">{t('empty')}</div>}
      {credentials.configured && skillbots.length > 0 && (
        <div className="loomloomGrid" aria-label={t('title')}>
          {skillbots.map(skillbot => (
            <button
              className="loomloomCard"
              type="button"
              key={skillbot.id}
              aria-pressed={selected?.id === skillbot.id}
              onClick={() => { void select(skillbot.id) }}
            >
              <div className="loomloomCardTop">
                <h3>{skillbot.name}</h3>
                <span className="loomloomBadge" data-available={skillbot.available}>{skillbot.available ? t('available') : t('unavailable')}</span>
              </div>
              {skillbot.description !== '' && <p>{skillbot.description}</p>}
              {skillbot.fixedFee !== undefined && <div className="loomloomMeta">{t('fee')}: {skillbot.fixedFee}</div>}
            </button>
          ))}
        </div>
      )}

      {selected !== undefined && (
        <section className="loomloomDetail" aria-label={selected.name}>
          <div className="loomloomDetailHead">
            <h3>{t('schema')}</h3>
            <span>{selected.name}</span>
          </div>
          <p className="loomloomFieldHint">{t('inputHint')}</p>
          {selected.fields.length === 0
            ? <div className="loomloomEmpty">{t('noSchema')}</div>
            : <div className="loomloomFields">
              {selected.fields.map(field => (
                <div className="loomloomField" key={field.key}>
                  <div className="loomloomFieldHead">
                    <strong>{field.label}</strong>
                    <code>{field.key}</code>
                    <span className="loomloomFieldTag">{field.required ? t('required') : t('optional')} · {field.valueType}</span>
                  </div>
                  {field.description !== undefined && <p>{field.description}</p>}
                  {field.enumValues !== undefined && <p>{field.enumValues.join(' · ')}</p>}
                </div>
              ))}
            </div>}
        </section>
      )}

      {credentials.configured && <section className="loomloomDetail" aria-label={t('runs')}>
        <div className="loomloomDetailHead">
          <h3>{t('runs')}</h3>
          <button className="loomloomButton" type="button" onClick={() => void refreshRuns()} disabled={runLoading}>
            {runLoading ? t('loading') : t('refresh')}
          </button>
        </div>
        {runs.length === 0
          ? <div className="loomloomEmpty">{t('noRuns')}</div>
          : <div className="loomloomRuns">
            {runs.map(item => (
              <div className="loomloomRun" key={item.id}>
                <div>
                  <strong>{item.displayName}</strong>
                  <code>{item.id}</code>
                </div>
                <span className="loomloomRunStatus">{item.status}</span>
                <button className="loomloomButton" type="button" onClick={() => void refreshRun(item.id)}>{t('runRefresh')}</button>
              </div>
            ))}
          </div>}
      </section>}

      {credentials.configured && <aside className="loomloomNote">
        <strong>{t('chatExecution')}</strong>
        <p>{t('chatExecutionDetail')}</p>
      </aside>}
    </section>
  )
}
