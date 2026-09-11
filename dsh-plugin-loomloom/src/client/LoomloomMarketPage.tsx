import { useCallback, useEffect, useRef, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import {
  readCredentialStatus,
  uploadInputAsset,
  type LoomField,
  type LoomStorefrontEntry,
} from './api.js'
import { fieldControl, initialValues, missingRequired, payloadRow } from './field-input.js'
import { LoomloomConnectFlow } from './LoomloomConnectFlow.js'
import { defaultMarketSource, loadMarket, type MarketLoad } from './market-loader.js'
import { setLoomloomMarketActive } from './market-navigation.js'
import {
  invocationGate,
  resolveSendTarget,
  skillbotPrompt,
  type SkillbotSessions,
} from './skillbot-prompt.js'

export type LoomloomMarketPageProps = PropsLocale<'loomloom'> & {
  /** Injected by the plugin apply: the client sessions service. */
  readonly sessions: SkillbotSessions
  /**
   * Injected by the plugin apply: which workspace (sidebar group) a session sits
   * in, so a new conversation joins the group the user is looking at.
   */
  readonly workspaceOf: (sessionId: string) => string | undefined
}

/** A click that still has to run once the credential is in place. */
interface DeferredCall {
  readonly entry: LoomStorefrontEntry
  readonly values?: Record<string, unknown>
}

function message(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim() !== '' ? cause.message : fallback
}

/** Reads a chosen file as the base64 the upload route accepts. */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('the file could not be read'))
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') { reject(new Error('the file could not be read')); return }
      const comma = result.indexOf(',')
      if (comma === -1) { reject(new Error('the file could not be read')); return }
      resolve(result.slice(comma + 1))
    }
    reader.readAsDataURL(file)
  })
}

/**
 * The cloud SkillBot market.
 *
 * It presents one creator's storefront and hands a chosen SkillBot to the
 * conversation: this surface never quotes, executes or bills anything itself. A
 * click becomes one user message and the agent drives the Loomloom tools from
 * there, which keeps a single path to a paid run and a single place its result is
 * reported.
 */
export function LoomloomMarketPage({ t, sessions, workspaceOf }: LoomloomMarketPageProps) {
  const [state, setState] = useState<MarketLoad | undefined>()
  const [busy, setBusy] = useState(true)
  const [preview, setPreview] = useState<LoomStorefrontEntry | undefined>()
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [assetNames, setAssetNames] = useState<Record<string, string>>({})
  const [uploadingKey, setUploadingKey] = useState<string | undefined>()
  const [formError, setFormError] = useState<string | undefined>()
  const [starting, setStarting] = useState(false)
  const [authorizing, setAuthorizing] = useState(false)
  const deferred = useRef<DeferredCall | undefined>(undefined)
  const inFlight = useRef(false)
  const loadController = useRef<AbortController | undefined>()
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  const load = useCallback(async (refresh = false) => {
    loadController.current?.abort()
    const controller = new AbortController()
    loadController.current = controller
    setBusy(true)
    const result = await loadMarket(defaultMarketSource, refresh, controller.signal)
    if (controller.signal.aborted || !alive.current) return
    setState(result)
    setBusy(false)
  }, [])

  useEffect(() => {
    void load()
    return () => { loadController.current?.abort() }
  }, [load])

  /** The one place an invocation leaves this surface. */
  const send = useCallback(async (entry: LoomStorefrontEntry, submitted?: Record<string, unknown>): Promise<void> => {
    const target = await resolveSendTarget(sessions, { workspaceOf })
    await target.send(skillbotPrompt({
      template: t('promptInvocation'),
      noInput: t('promptNoInput'),
      name: entry.name,
      listingId: entry.id,
      ...(submitted === undefined ? {} : { values: submitted }),
    }))
    if (!alive.current) return
    // The conversation renders only once this surface yields main.surface, so the
    // user has to land there for the message just sent to be visible at all.
    setPreview(undefined)
    setAuthorizing(false)
    setValues({})
    setAssetNames({})
    setFormError(undefined)
    setLoomloomMarketActive(false)
  }, [sessions, t, workspaceOf])

  const invoke = useCallback(async (entry: LoomStorefrontEntry, submitted?: Record<string, unknown>): Promise<void> => {
    if (inFlight.current) return
    inFlight.current = true
    setStarting(true)
    setFormError(undefined)
    try {
      const credential = await readCredentialStatus().catch(() => undefined)
      const gate = invocationGate(credential)
      if (gate === 'blocked') {
        setFormError(t('credentialUnavailable'))
        return
      }
      if (gate === 'authorize') {
        // Remember what the click meant, then authorize; the flow resumes it.
        deferred.current = { entry, ...(submitted === undefined ? {} : { values: submitted }) }
        setAuthorizing(true)
        return
      }
      await send(entry, submitted)
    } catch (cause) {
      if (alive.current) setFormError(message(cause, t('sendFailed')))
    } finally {
      inFlight.current = false
      if (alive.current) setStarting(false)
    }
  }, [send, t])

  const onConnected = useCallback((): void => {
    const call = deferred.current
    deferred.current = undefined
    if (call === undefined) { setAuthorizing(false); return }
    void (async () => {
      try {
        await send(call.entry, call.values)
      } catch (cause) {
        if (!alive.current) return
        setAuthorizing(false)
        setFormError(message(cause, t('sendFailed')))
      }
    })()
  }, [send, t])

  const onDeclined = useCallback((): void => {
    // Declining is a choice, not a failure: drop the deferred call and return to
    // the list, where the same row starts it again.
    deferred.current = undefined
    setAuthorizing(false)
  }, [])

  const openPreview = (entry: LoomStorefrontEntry): void => {
    setPreview(entry)
    setValues(initialValues(entry.fields))
    setAssetNames({})
    setFormError(undefined)
  }

  const updateField = (field: LoomField, value: unknown): void => {
    setValues(previous => ({ ...previous, [field.key]: value }))
  }

  const upload = async (field: LoomField, file: File): Promise<void> => {
    setUploadingKey(field.key)
    setFormError(undefined)
    try {
      const asset = await uploadInputAsset(file.name, file.type || 'application/octet-stream', await fileToBase64(file))
      setAssetNames(previous => ({ ...previous, [field.key]: asset.filename }))
      updateField(field, asset.inputAssetId)
    } catch (cause) {
      setFormError(message(cause, t('uploadFailed')))
    } finally {
      if (alive.current) setUploadingKey(undefined)
    }
  }

  const submitPreview = (): void => {
    if (preview === undefined) return
    if (missingRequired(preview.fields, values).length > 0) {
      setFormError(t('requiredMissing'))
      return
    }
    void invoke(preview, payloadRow(preview.fields, values))
  }

  const storefront = state?.ok === true ? state.storefront : undefined

  const fieldInput = (field: LoomField) => {
    const control = fieldControl(field)
    const value = values[field.key]
    if (control === 'file') {
      const chosen = assetNames[field.key]
      return (
        <div className="loomloomFileRow">
          <input
            type="file"
            accept={field.acceptedMimeTypes?.join(',')}
            disabled={uploadingKey === field.key}
            onChange={event => {
              const file = event.target.files?.[0]
              if (file !== undefined) void upload(field, file)
            }}
          />
          {uploadingKey === field.key && <small>{t('uploading')}</small>}
          {chosen !== undefined && uploadingKey !== field.key && (
            <>
              <small>{chosen}</small>
              <button className="loomloomButton" type="button" onClick={() => {
                setAssetNames(previous => {
                  const next = { ...previous }
                  delete next[field.key]
                  return next
                })
                updateField(field, '')
              }}>{t('clearFile')}</button>
            </>
          )}
        </div>
      )
    }
    if (control === 'select') {
      return (
        <select value={String(value ?? '')} onChange={event => { updateField(field, event.target.value) }}>
          <option value="">{t('selectPlaceholder')}</option>
          {(field.enumValues ?? []).map(option => <option value={option} key={option}>{option}</option>)}
        </select>
      )
    }
    if (control === 'checkbox') {
      return <input type="checkbox" checked={value === true} onChange={event => { updateField(field, event.target.checked) }} />
    }
    if (control === 'textarea') {
      return (
        <textarea
          rows={3}
          value={String(value ?? '')}
          placeholder={field.placeholder ?? field.description}
          onChange={event => { updateField(field, event.target.value) }}
        />
      )
    }
    return (
      <input
        type={control === 'number' ? 'number' : 'text'}
        value={String(value ?? '')}
        placeholder={field.placeholder ?? field.description}
        onChange={event => {
          const raw = event.target.value
          updateField(field, control === 'number' && raw !== '' ? Number.parseInt(raw, 10) : raw)
        }}
      />
    )
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

        <div className="loomloomMarketBody">
          {state?.ok === false && <p className="loomloomError" role="alert">{state.message}</p>}
          {formError !== undefined && preview === undefined && !authorizing && (
            <p className="loomloomError" role="alert">{formError}</p>
          )}
          {storefront?.error !== undefined && (
            <p className="loomloomMarketNotice" role="status">
              {t('storefrontRefreshFailed', { message: storefront.error })}
            </p>
          )}
          {storefront !== undefined && storefront.unavailable.length > 0 && (
            <p className="loomloomMarketNotice" role="status">
              {t('storefrontUnavailable', { count: storefront.unavailable.length })}
            </p>
          )}

          {storefront !== undefined && !storefront.configured
            ? <div className="loomloomMarketNotice" role="status">
              <strong>
                {storefront.source === 'creator-key-missing'
                  ? t('storefrontCreatorKeyMissing')
                  : t('storefrontUnconfigured')}
              </strong>
              {storefront.source !== 'creator-key-missing' && <p>{t('storefrontUnconfiguredHint')}</p>}
            </div>
            : <div className="loomloomMarketList">
              <div className="loomloomMarketSectionHead">
                <h3>{t('marketSkillbots')}</h3>
                <button className="loomloomButton" type="button" onClick={() => void load(true)} disabled={busy}>
                  {busy ? t('loading') : t('refresh')}
                </button>
              </div>
              {busy && storefront === undefined && <p className="loomloomFlowDescription" role="status">{t('loading')}</p>}
              {(storefront?.entries ?? []).map(entry => (
                <div className="loomloomMarketItem" key={entry.id} role="group">
                  <button
                    className="loomloomMarketItemOpen"
                    type="button"
                    disabled={!entry.available || starting}
                    onClick={() => void invoke(entry)}
                  >
                    <span className="loomloomMarketItemMain">
                      <strong>{entry.name}</strong>
                      {entry.description && <small>{entry.description}</small>}
                    </span>
                    <span className="loomloomMarketItemMeta">
                      {entry.fixedFee ?? t('free')}{entry.currency === undefined ? '' : ` ${entry.currency}`}
                    </span>
                  </button>
                  <button
                    className="loomloomMarketPreview"
                    type="button"
                    aria-label={`${t('previewInputs')}: ${entry.name}`}
                    onClick={() => { openPreview(entry) }}
                  >
                    <span aria-hidden="true">☰</span>
                  </button>
                </div>
              ))}
              {!busy && storefront !== undefined && storefront.entries.length === 0 && (
                <p className="loomloomFlowDescription">{t('marketEmpty')}</p>
              )}
            </div>}
        </div>
      </section>

      {preview !== undefined && (
        <div className="loomloomCallOverlay" role="presentation" onMouseDown={event => {
          if (event.target === event.currentTarget) setPreview(undefined)
        }}>
          <div className="loomloomCallDialog" role="dialog" aria-modal="true" aria-labelledby="loomloom-preview-title">
            <div className="loomloomCallHeader">
              <h3 id="loomloom-preview-title">{t('previewTitle')} · {preview.name}</h3>
              <button className="loomloomIdentityClose" type="button" aria-label={t('closeCall')} onClick={() => { setPreview(undefined) }}>×</button>
            </div>
            {formError !== undefined && <p className="loomloomError" role="alert">{formError}</p>}
            <dl className="loomloomMarketFacts">
              {preview.version !== undefined && <><dt>{t('versionLabel')}</dt><dd>{preview.version}</dd></>}
              {preview.updatedAt !== undefined && (
                <><dt>{t('updatedAtLabel')}</dt><dd>{new Date(preview.updatedAt).toLocaleString()}</dd></>
              )}
              {preview.creatorNickname !== undefined && <><dt>{t('creatorLabel')}</dt><dd>{preview.creatorNickname}</dd></>}
              <dt>{t('fee')}</dt>
              <dd>{preview.fixedFee ?? t('free')}{preview.currency === undefined ? '' : ` ${preview.currency}`}</dd>
            </dl>
            {preview.description !== '' && <p className="loomloomFlowDescription">{preview.description}</p>}
            {preview.fields.length === 0
              ? <p className="loomloomFlowDescription">{t('noSchema')}</p>
              : <div className="loomloomMarketForm">
                {preview.fields.map(field => (
                  <label className="loomloomMarketField" key={field.key}>
                    <span>{field.label}{field.required ? ' *' : ''}</span>
                    {fieldInput(field)}
                    {field.description !== undefined && <small>{field.description}</small>}
                  </label>
                ))}
              </div>}
            <div className="loomloomFlowActions">
              <button
                className="loomloomButton loomloomButtonPrimary"
                type="button"
                disabled={!preview.available || starting}
                onClick={submitPreview}
              >
                {starting ? t('preparingCall') : t('callInChat')}
              </button>
            </div>
          </div>
        </div>
      )}

      {authorizing && (
        <div className="loomloomCallOverlay" role="presentation">
          <div className="loomloomCallDialog" role="dialog" aria-modal="true" aria-labelledby="loomloom-auth-title">
            <div className="loomloomCallHeader">
              <h3 id="loomloom-auth-title">{t('authRequired')}</h3>
              <button className="loomloomIdentityClose" type="button" aria-label={t('closeCall')} onClick={onDeclined}>×</button>
            </div>
            <p className="loomloomFlowDescription">{t('authContinueHint')}</p>
            <LoomloomConnectFlow t={t} onConnected={onConnected} onLater={onDeclined} />
          </div>
        </div>
      )}
    </div>
  )
}
