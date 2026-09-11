import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  cancelBrowserLogin,
  type LoomBrowserLoginReason,
  type LoomBrowserLoginState,
  readBrowserLoginStatus,
  startBrowserLogin,
} from './api.js'
import { readConnectionState, type ConnectionState } from './connection-state.js'

type ConnectStage = ConnectionState | 'loading' | 'authorizing'

export interface LoomloomConnectFlowProps extends PropsLocale<'loomloom'> {
  /** Re-read non-secret readiness facts after the parent refreshes its data. */
  readonly refreshKey?: number
  /** Force a new browser grant even when a shared API key is already stored. */
  readonly forceSignIn?: boolean
  /** Called after the Host has reported a complete, verified connection. */
  readonly onConnected?: () => void
  /** Called when a pre-existing configured connection makes onboarding unnecessary. */
  readonly onAlreadyConfigured?: () => void
  /** Opens DSH's published Models section for a verified but non-default model. */
  readonly onOpenModels?: () => void
  /** Selects first-run chrome rather than the inline Settings presentation. */
  readonly onboarding?: boolean
  /** Lets a user skip this onboarding step without representing it as connected. */
  readonly onLater?: () => void
  /** Leaves Settings on DSH's native new-session surface after connection. */
  readonly onCreateFirstChat?: () => void
}

const pollIntervalMs = 500

function delay(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, pollIntervalMs)
    const abort = () => {
      window.clearTimeout(timer)
      reject(new DOMException('The login poll was cancelled', 'AbortError'))
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}

function isAbort(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError'
}

function reasonMessage(reason: LoomBrowserLoginReason | undefined, t: LoomloomConnectFlowProps['t']): string {
  switch (reason) {
    case 'authorization-cancelled': return t('authorizationCancelled')
    case 'authorization-timeout': return t('authorizationTimedOut')
    case 'loom-validation-failed': return t('loomValidationFailed')
    case 'router-validation-failed': return t('routerValidationFailed')
    case 'no-chat-model': return t('noChatModel')
    case 'credential-save-failed': return t('credentialSaveFailed')
    case 'browser-unavailable': return t('browserUnavailable')
    default: return t('signInFailed')
  }
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim() !== '' ? cause.message : fallback
}

function LoomloomOnboardingSurface({ title, children, onLater }: { readonly title: string, readonly children: ReactNode, readonly onLater: (() => void) | undefined }) {
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const node = dialog.current
    if (node === null) return
    node.showModal()
    return () => { if (node.open) node.close() }
  }, [])

  return (
    <dialog ref={dialog} className="loomloomOnboarding" aria-labelledby="loomloom-onboarding-title" onCancel={event => { event.preventDefault(); onLater?.() }}>
      <section className="loomloomOnboardingContent">
        <h2 id="loomloom-onboarding-title" tabIndex={-1}>{title}</h2>
        {children}
      </section>
    </dialog>
  )
}

/**
 * A shared first-run connection flow for Settings and the public onboarding
 * slot. It receives only opaque session ids and non-secret status facts.
 */
export function LoomloomConnectFlow({
  t, refreshKey, forceSignIn = false, onConnected, onAlreadyConfigured, onOpenModels, onboarding = false, onLater, onCreateFirstChat,
}: LoomloomConnectFlowProps) {
  const [stage, setStage] = useState<ConnectStage>('loading')
  const [loginState, setLoginState] = useState<LoomBrowserLoginState>('pending')
  const [error, setError] = useState<string | undefined>()
  const [browserWasBlocked, setBrowserWasBlocked] = useState(false)
  const sessionRef = useRef<string | undefined>()
  const authorizationUrlRef = useRef<string | undefined>()
  const pollController = useRef<AbortController | undefined>()
  const cancelOnUnmount = useRef(true)
  const startedHere = useRef(false)
  const signInButton = useRef<HTMLButtonElement>(null)
  const errorId = useId()

  const stopPolling = useCallback((cancelRemote: boolean) => {
    pollController.current?.abort()
    pollController.current = undefined
    const sessionId = sessionRef.current
    sessionRef.current = undefined
    authorizationUrlRef.current = undefined
    if (cancelRemote && cancelOnUnmount.current && sessionId !== undefined) {
      void cancelBrowserLogin(sessionId).catch(() => undefined)
    }
  }, [])

  const refresh = useCallback(async () => {
    try {
      setStage('loading')
      setError(undefined)
      const next = forceSignIn ? 'unconfigured' : await readConnectionState(onboarding && !startedHere.current)
      setStage(next)
      if (next === 'already-configured') onAlreadyConfigured?.()
      if (next === 'unavailable') setError(t('connectionStatusFailed'))
    } catch (cause) {
      setStage('unavailable')
      setError(errorMessage(cause, t('connectionStatusFailed')))
    }
  }, [forceSignIn, onAlreadyConfigured, onboarding, t])

  useEffect(() => { void refresh() }, [refresh, refreshKey])
  useEffect(() => () => { stopPolling(true) }, [stopPolling])

  const poll = useCallback(async (sessionId: string, controller: AbortController) => {
    try {
      for (;;) {
        await delay(controller.signal)
        const status = await readBrowserLoginStatus(sessionId, controller.signal)
        setLoginState(status.state)
        if (status.state === 'pending' || status.state === 'verifying-loom' || status.state === 'verifying-router') continue
        pollController.current = undefined
        if (status.state === 'complete') {
          sessionRef.current = undefined
          authorizationUrlRef.current = undefined
          setStage('connected')
          onConnected?.()
          return
        }
        if (status.state === 'model-selection-required') {
          cancelOnUnmount.current = false
          setStage('model-selection')
          return
        }
        sessionRef.current = undefined
        authorizationUrlRef.current = undefined
        setStage('unconfigured')
        setError(reasonMessage(status.reason, t))
        window.setTimeout(() => signInButton.current?.focus(), 0)
        return
      }
    } catch (cause) {
      if (isAbort(cause)) return
      setStage('unconfigured')
      setError(errorMessage(cause, t('signInFailed')))
    }
  }, [onConnected, refresh, t])

  const signIn = useCallback(async () => {
    stopPolling(true)
    startedHere.current = true
    cancelOnUnmount.current = true
    setError(undefined)
    setBrowserWasBlocked(false)
    setLoginState('pending')
    try {
      const login = await startBrowserLogin()
      sessionRef.current = login.sessionId
      authorizationUrlRef.current = login.url
      const popup = window.open(login.url, '_blank', 'noopener,noreferrer')
      setBrowserWasBlocked(popup === null)
      const controller = new AbortController()
      pollController.current = controller
      setStage('authorizing')
      void poll(login.sessionId, controller)
    } catch (cause) {
      setStage('unconfigured')
      setError(errorMessage(cause, t('signInFailed')))
      window.setTimeout(() => signInButton.current?.focus(), 0)
    }
  }, [poll, stopPolling, t])

  const cancel = useCallback(async () => {
    const sessionId = sessionRef.current
    pollController.current?.abort()
    pollController.current = undefined
    sessionRef.current = undefined
    authorizationUrlRef.current = undefined
    if (sessionId !== undefined) {
      try { await cancelBrowserLogin(sessionId) } catch (cause) {
        setError(errorMessage(cause, t('cancelFailed')))
      }
    }
    cancelOnUnmount.current = true
    setStage('unconfigured')
    window.setTimeout(() => signInButton.current?.focus(), 0)
  }, [t])

  const copyAuthorizationLink = useCallback(async () => {
    const url = authorizationUrlRef.current
    if (url === undefined || !navigator.clipboard?.writeText) {
      setError(t('copyLinkFailed'))
      return
    }
    try {
      await navigator.clipboard.writeText(url)
      setError(undefined)
    } catch {
      setError(t('copyLinkFailed'))
    }
  }, [t])

  if (onboarding && (stage === 'loading' || stage === 'already-configured')) return null

  const body = (
    <>
      {stage === 'loading' && <p className="loomloomFlowDescription" role="status">{t('loading')}</p>}
      {stage === 'unavailable' && <div className="loomloomFlowActions">
        <button className="loomloomButton" type="button" onClick={() => void refresh()}>{t('refresh')}</button>
        {onboarding && onLater !== undefined && <button className="loomloomButton" type="button" onClick={onLater}>{t('connectLater')}</button>}
      </div>}
      {stage === 'unconfigured' && <>
        <p className="loomloomFlowDescription">{t('connectDescription')}</p>
        <details className="loomloomFlowDetails">
          <summary>{t('connectionDetails')}</summary>
          <p>{t('connectionDetailsBody')}</p>
        </details>
        <p className="loomloomFlowPrivacy">{t('connectionPrivacy')}</p>
        <div className="loomloomFlowActions">
          <button ref={signInButton} className="loomloomButton loomloomButtonPrimary" type="button" onClick={() => void signIn()} aria-describedby={error === undefined ? undefined : errorId}>
            {t('signIn')}
          </button>
          {onboarding && onLater !== undefined && <button className="loomloomButton" type="button" onClick={onLater}>{t('connectLater')}</button>}
        </div>
      </>}
      {stage === 'authorizing' && <>
        <p className="loomloomFlowDescription" role="status">
          {loginState === 'verifying-loom'
            ? t('verifyingLoom')
            : loginState === 'verifying-router'
              ? t('verifyingRouter')
              : t('signInWaiting')}
        </p>
        <ol className="loomloomFlowSteps">
          <li data-current={loginState === 'pending'}>{t('waitingBrowser')}</li>
          <li data-current={loginState === 'verifying-loom'}>{t('verifyingLoom')}</li>
          <li data-current={loginState === 'verifying-router'}>{t('verifyingRouter')}</li>
          <li data-current={false}>{t('savingConnection')}</li>
        </ol>
        {browserWasBlocked && <div className="loomloomInlineWarning" role="status">
          <p>{t('browserUnavailable')}</p>
          <button className="loomloomButton" type="button" onClick={() => void copyAuthorizationLink()}>{t('copyAuthorizationLink')}</button>
        </div>}
        <div className="loomloomFlowActions">
          <button className="loomloomButton" type="button" onClick={() => void cancel()}>{t('cancelSignIn')}</button>
        </div>
      </>}
      {stage === 'model-selection' && <>
        <p className="loomloomFlowDescription">{t('modelSelectionRequired')}</p>
        <div className="loomloomFlowActions">
          {onOpenModels !== undefined && <button className="loomloomButton loomloomButtonPrimary" type="button" onClick={onOpenModels}>{t('openModels')}</button>}
          {onboarding && onLater !== undefined && <button className="loomloomButton" type="button" onClick={onLater}>{t('connectLater')}</button>}
          {sessionRef.current !== undefined && <button className="loomloomButton" type="button" onClick={() => void cancel()}>{t('cancelSignIn')}</button>}
        </div>
      </>}
      {stage === 'connected' && <>
        <div className="loomloomConnectionChecks" role="status">
          <span>✓ {t('loomReady')}</span>
          <span>✓ {t('chatModelReady')}</span>
        </div>
        <p className="loomloomFlowDescription">{t('connectedHint')}</p>
        {onboarding && <div className="loomloomFlowActions">
          <button className="loomloomButton loomloomButtonPrimary" type="button" onClick={onCreateFirstChat}>{t('createFirstChat')}</button>
        </div>}
      </>}
      {error !== undefined && <div id={errorId} className="loomloomError" role="alert">{error}</div>}
    </>
  )

  if (onboarding) return <LoomloomOnboardingSurface title={t('onboardingTitle')} onLater={onLater}>{body}</LoomloomOnboardingSurface>
  return <section className="loomloomConnectFlow" aria-label={t('connectionTitle')}>{body}</section>
}

export type LoomloomOnboardingProps = PropsRuntime<'settings.onboarding'> & PropsLocale<'loomloom'>

/** First-run entry; it leaves all session creation to DSH's native UI. */
export function LoomloomOnboarding({
  complete,
  openSection,
  t,
  onCreateFirstChat,
}: LoomloomOnboardingProps & { readonly onCreateFirstChat: () => void }) {
  return <LoomloomConnectFlow
    t={t}
    onboarding
    onAlreadyConfigured={complete}
    onOpenModels={() => { complete(); openSection('models') }}
    onLater={complete}
    onCreateFirstChat={onCreateFirstChat}
  />
}
