import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconCheckOutline16,
  IconListPenOutline16,
  IconPaperclipOutline16,
  IconPlayOutline16,
  IconRefreshOutline16,
  IconSearchOutline16,
  IconWarningOutline16,
  Input,
  Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  readCredentialStatus,
  uploadInputAsset,
  type LoomField,
  type LoomStorefrontEntry,
} from './api.js'
import { fieldControl, initialValues, missingRequired, payloadRow } from './field-input.js'
import { feeText, filterEntries, monogram, updatedText } from './market-format.js'
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

/** Card count drawn while the storefront is still loading. */
const SKELETON_CARDS = [0, 1, 2] as const

/** Nested controls keep their own behavior; the card body starts the chat handoff. */
function isNestedControl(target: EventTarget | null): boolean {
  return target instanceof Element
    && target.closest('button,a,input,textarea,select,label') !== null
}

/**
 * The cloud SkillBot market.
 *
 * It presents one creator's storefront as a card grid and hands a chosen
 * SkillBot to the conversation: this surface never quotes, executes or bills
 * anything itself. A click becomes one user message and the agent drives the
 * Loomloom tools from there, which keeps a single path to a paid run and a
 * single place its result is reported.
 */
export function LoomloomMarketPage({ t, sessions, workspaceOf }: LoomloomMarketPageProps) {
  const [state, setState] = useState<MarketLoad | undefined>()
  const [busy, setBusy] = useState(true)
  const [query, setQuery] = useState('')
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
    // the list, where the same card starts it again.
    deferred.current = undefined
    setAuthorizing(false)
  }, [])

  const openPreview = (entry: LoomStorefrontEntry): void => {
    setPreview(entry)
    setValues(initialValues(entry.fields))
    setAssetNames({})
    setFormError(undefined)
  }

  const closePreview = (): void => {
    setPreview(undefined)
    setFormError(undefined)
  }

  const updateField = (field: LoomField, value: unknown): void => {
    setValues(previous => ({ ...previous, [field.key]: value }))
  }

  const clearUpload = (field: LoomField): void => {
    setAssetNames(previous => {
      const next = { ...previous }
      delete next[field.key]
      return next
    })
    updateField(field, '')
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
  const entries = storefront?.entries ?? []
  const visible = filterEntries(entries, query)

  const fieldInput = (field: LoomField): ReactNode => {
    const control = fieldControl(field)
    const value = values[field.key]
    if (control === 'file') {
      const chosen = assetNames[field.key]
      const uploading = uploadingKey === field.key
      if (chosen !== undefined && !uploading) {
        return (
          <div className="loomloomDropzone" data-filled={true}>
            <div className="loomloomDropzoneFilled">
              <span className="loomloomFileChip">
                <IconCheckOutline16 size={12} />
                <span>{chosen}</span>
              </span>
              <button className="loomloomButton" type="button" data-size="sm" onClick={() => { clearUpload(field) }}>
                {t('clearFile')}
              </button>
            </div>
          </div>
        )
      }
      const accepted = field.acceptedMimeTypes ?? []
      return (
        <label className="loomloomDropzone">
          <IconPaperclipOutline16 size={20} />
          <strong>{uploading ? t('uploading') : t('dropzoneTitle')}</strong>
          {accepted.length > 0 && <small>{t('dropzoneHint', { types: accepted.join(' / ') })}</small>}
          <input
            className="loomloomDropzoneInput"
            type="file"
            accept={accepted.join(',')}
            disabled={uploading}
            onChange={event => {
              const file = event.target.files?.[0]
              if (file !== undefined) void upload(field, file)
            }}
          />
        </label>
      )
    }
    if (control === 'select') {
      return (
        <select className="loomloomSelect" value={String(value ?? '')} onChange={event => { updateField(field, event.target.value) }}>
          <option value="">{t('selectPlaceholder')}</option>
          {(field.enumValues ?? []).map(option => <option value={option} key={option}>{option}</option>)}
        </select>
      )
    }
    if (control === 'checkbox') {
      return (
        <span className="loomloomCheckboxRow">
          <input type="checkbox" checked={value === true} onChange={event => { updateField(field, event.target.checked) }} />
          <span>{field.placeholder ?? field.label}</span>
        </span>
      )
    }
    if (control === 'textarea') {
      return (
        <textarea
          className="loomloomTextarea"
          rows={4}
          value={String(value ?? '')}
          placeholder={field.placeholder ?? field.description}
          onChange={event => { updateField(field, event.target.value) }}
        />
      )
    }
    return (
      <input
        className="loomloomInput"
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

  const notice = (tone: 'info' | 'warning' | 'danger', body: ReactNode, key: string) => (
    <div className="loomloomAlert" data-tone={tone} role={tone === 'danger' ? 'alert' : 'status'} key={key}>
      {tone !== 'info' && <IconWarningOutline16 />}
      <div>{body}</div>
    </div>
  )

  return (
    <div className="loomloomMarketPage">
      <section className="loomloomMarketPanel" role="region" aria-labelledby="loomloom-market-title">
        <header className="loomloomMarketHeader">
          <div className="loomloomMarketHeaderInner">
            <div className="loomloomMarketHeaderMain">
              <p className="loomloomMarketEyebrow">{t('marketEyebrow')}</p>
              <h2 id="loomloom-market-title">{t('marketTitle')}</h2>
              <p className="loomloomMarketSubtitle">{t('marketSubtitle')}</p>
            </div>
            <div className="loomloomMarketToolbar">
              <Input
                className="loomloomMarketSearch"
                icon={<IconSearchOutline16 />}
                type="search"
                value={query}
                placeholder={t('marketSearchPlaceholder')}
                aria-label={t('marketSearchLabel')}
                onChange={event => { setQuery(event.target.value) }}
              />
              <button
                className="loomloomButton"
                type="button"
                onClick={() => void load(true)}
                disabled={busy}
              >
                <IconRefreshOutline16 />
                {busy ? t('loading') : t('refresh')}
              </button>
            </div>
          </div>
        </header>

        <div className="loomloomMarketBody">
          {state?.ok === false && notice('danger', <p>{state.message}</p>, 'load')}
          {formError !== undefined && preview === undefined && !authorizing && notice('danger', <p>{formError}</p>, 'form')}
          {storefront?.error !== undefined
            && notice('warning', <p>{t('storefrontRefreshFailed', { message: storefront.error })}</p>, 'stale')}
          {storefront !== undefined && storefront.unavailable.length > 0
            && notice('warning', <p>{t('storefrontUnavailable', { count: storefront.unavailable.length })}</p>, 'unavailable')}

          {storefront !== undefined && !storefront.configured
            ? notice(
              'info',
              <>
                <strong>
                  {storefront.source === 'creator-key-missing'
                    ? t('storefrontCreatorKeyMissing')
                    : t('storefrontUnconfigured')}
                </strong>
                {storefront.source !== 'creator-key-missing' && <p>{t('storefrontUnconfiguredHint')}</p>}
              </>,
              'unconfigured',
            )
            : <>
              {busy && storefront === undefined && <>
                <p className="loomloomMarketSummary" role="status">{t('loading')}</p>
                <div className="loomloomMarketCards" aria-hidden="true">
                  {SKELETON_CARDS.map(index => (
                    <div className="loomloomMarketSkeleton" key={index}><span /><span /><span /></div>
                  ))}
                </div>
              </>}

              {!(busy && storefront === undefined) && <>
                <p className="loomloomMarketSummary">
                  <strong>{t('marketSkillbots')}</strong>
                  <span>{t('marketCount', { count: entries.length })}</span>
                </p>

                {visible.length === 0
                  ? <div className="loomloomEmptyBand">
                    <strong>{query.trim() === '' ? t('marketEmpty') : t('marketSearchEmpty')}</strong>
                  </div>
                  : <div className="loomloomMarketCards">
                    {visible.map(entry => {
                      const creator = entry.creatorNickname
                      const updated = updatedText(entry.updatedAt)
                      return (
                        <article
                          className="loomloomMarketCard"
                          key={entry.id}
                          aria-label={entry.name}
                          aria-disabled={!entry.available}
                          role="button"
                          tabIndex={entry.available ? 0 : -1}
                          onClick={(event: MouseEvent<HTMLElement>) => {
                            if (entry.available && !starting && !isNestedControl(event.target)) void invoke(entry)
                          }}
                          onKeyDown={(event: KeyboardEvent<HTMLElement>) => {
                            if ((event.key === 'Enter' || event.key === ' ') && entry.available && !starting && !isNestedControl(event.target)) {
                              event.preventDefault()
                              void invoke(entry)
                            }
                          }}
                        >
                          <div className="loomloomMarketCardHead">
                            <span className="loomloomMarketAvatar" aria-hidden="true">{monogram(creator ?? entry.name)}</span>
                            <span className="loomloomMarketCardTitle">
                              <strong>{entry.name}</strong>
                              {creator !== undefined && <span>{t('marketCreator', { name: creator })}</span>}
                            </span>
                            <span className="loomloomChip" data-tone={entry.available ? 'success' : 'neutral'}>
                              {entry.available ? t('available') : t('unavailable')}
                            </span>
                          </div>

                          <div className="loomloomMarketChips">
                            {entry.version !== undefined && <span className="loomloomChip" data-tone="info">{t('versionLabel')} {entry.version}</span>}
                            <span className="loomloomChip" data-tone="outline">{t('marketInputs', { count: entry.fields.length })}</span>
                            {updated !== undefined && <span className="loomloomChip" data-tone="quiet">{t('marketUpdated', { date: updated })}</span>}
                          </div>

                          {entry.description !== '' && <p className="loomloomMarketDesc">{entry.description}</p>}

                          <div className="loomloomMarketCardFoot">
                            <span className="loomloomMarketFee">
                              <strong>{feeText(entry, t('free'))}</strong>
                              <small>{t('fee')}</small>
                            </span>
                            <span className="loomloomMarketActions">
                              <button
                                className="loomloomButton loomloomButtonPrimary"
                                type="button"
                                disabled={!entry.available || starting}
                                aria-label={`${t('callInChat')}: ${entry.name}`}
                                onClick={() => void invoke(entry)}
                              >
                                <IconPlayOutline16 />
                                {t('callInChat')}
                              </button>
                              <button
                                className="loomloomButton"
                                type="button"
                                aria-label={`${t('previewInputs')}: ${entry.name}`}
                                onClick={() => { openPreview(entry) }}
                              >
                                <IconListPenOutline16 />
                                {t('previewInputsShort')}
                              </button>
                            </span>
                          </div>
                        </article>
                      )
                    })}
                  </div>}
              </>}
            </>}
        </div>
      </section>

      {preview !== undefined && (
        <Modal
          open
          onClose={closePreview}
          title={`${t('previewTitle')} · ${preview.name}`}
          closeLabel={t('closeCall')}
          className="loomloomDialog"
          contentClassName="loomloomDialogScroll"
          footer={<div className="loomloomDialogFooter">
            <div className="loomloomFeeBar">
              <div>
                <strong>{t('previewFeeBarTitle')}</strong>
                <small>{t('previewFeeBarNote')}</small>
              </div>
              <span className="loomloomFeeBarValue">{feeText(preview, t('free'))}</span>
            </div>
            <button
              className="loomloomButton loomloomButtonPrimary loomloomButtonBlock"
              type="button"
              disabled={!preview.available || starting}
              onClick={submitPreview}
            >
              <IconPlayOutline16 />
              {starting ? t('preparingCall') : t('callInChat')}
            </button>
          </div>}
        >
          <div className="loomloomDialogBody">
            <p className="loomloomDialogMeta">
              {preview.creatorNickname !== undefined
                && <span>{t('marketCreator', { name: preview.creatorNickname })}</span>}
              {preview.version !== undefined && <span>{t('versionLabel')} {preview.version}</span>}
              {preview.updatedAt !== undefined && <span>{t('updatedAtLabel')} {new Date(preview.updatedAt).toLocaleString()}</span>}
              <span>{t('fee')} {feeText(preview, t('free'))}</span>
            </p>

            {preview.description !== '' && <p className="loomloomDialogText">{preview.description}</p>}
            {formError !== undefined && notice('danger', <p>{formError}</p>, 'dialog-error')}

            <section className="loomloomDialogSection" aria-label={t('schema')}>
              <h3>{t('schema')}</h3>
              {preview.fields.length === 0
                ? <p className="loomloomDialogText">{t('noSchema')}</p>
                : <div className="loomloomFieldList">
                  {preview.fields.map(field => (
                    <label className="loomloomFieldRow" key={field.key}>
                      <span className="loomloomFieldLabel">
                        {field.label}
                        {field.required && <span className="loomloomFieldRequired" aria-hidden="true">*</span>}
                      </span>
                      {fieldInput(field)}
                      {field.description !== undefined && <small className="loomloomFieldNote">{field.description}</small>}
                    </label>
                  ))}
                </div>}
            </section>

            <section className="loomloomDialogSection">
              <h3>{t('previewStepsTitle')}</h3>
              <ul className="loomloomSteps">
                <li><IconCheckOutline16 size={12} />{t('previewStepRead')}</li>
                <li><IconCheckOutline16 size={12} />{t('previewStepQuote')}</li>
                <li><IconCheckOutline16 size={12} />{t('previewStepApprove')}</li>
                <li><IconCheckOutline16 size={12} />{t('previewStepResult')}</li>
              </ul>
            </section>
          </div>
        </Modal>
      )}

      {authorizing && (
        <Modal
          open
          onClose={onDeclined}
          title={t('authRequired')}
          description={t('authContinueHint')}
          closeLabel={t('closeCall')}
          className="loomloomDialog"
          contentClassName="loomloomDialogScroll"
        >
          <LoomloomConnectFlow t={t} onConnected={onConnected} onLater={onDeclined} />
        </Modal>
      )}
    </div>
  )
}
