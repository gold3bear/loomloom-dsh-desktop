import { randomBytes } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import {
  beginBrowserAuthorization,
  RouterCredentialError,
  verifyLoomCredential,
  verifyShengsuanyunRouterCredential,
} from './browser-auth.js'
import { clearLoomToken, createLoomIdentityTokenResolver, replaceLoomIdentityToken, storeLoomToken } from './credentials.js'
import {
  currentShengsuanyunModel,
  selectShengsuanyunDefaultModel,
  SHENGSUANYUN_DEFAULT_MODEL,
} from './default-model.js'
import type { ResolvedLoomConfig } from './loom-api.js'

const SESSION_TTL_MS = 10 * 60_000
const MAX_PENDING_SESSIONS = 3

export type BrowserLoginState = 'pending' | 'verifying-loom' | 'verifying-router' | 'model-selection-required' | 'complete' | 'cancelled' | 'failed'
export type BrowserLoginReason = 'authorization-cancelled' | 'authorization-timeout' | 'loom-validation-failed' | 'router-validation-failed' | 'no-chat-model' | 'credential-save-failed'

export interface BrowserLoginStart {
  readonly sessionId: string
  readonly url: string
}

export interface BrowserLoginStatus {
  readonly state: BrowserLoginState
  readonly reason?: BrowserLoginReason
}

interface LoginSession {
  readonly id: string
  readonly controller: AbortController
  readonly previousCredential: string | undefined
  readonly previousIdentityToken: string | undefined
  readonly expiresAt: number
  readonly expiryTimer: ReturnType<typeof setTimeout>
  modelIds: readonly string[]
  wroteCredential: boolean
  state: BrowserLoginState
  reason?: BrowserLoginReason
}

/**
 * A Host-only bridge for the Settings client.  It exposes a short-lived opaque
 * session and authorization URL, never the PKCE verifier, callback code, or
 * credential.  The exchanged credential is verified then written directly to
 * the DSH credential backend.
 */
export class LoomBrowserLoginService {
  readonly #sessions = new Map<string, LoginSession>()
  #credentialOwner: string | undefined
  #writingCredential = false
  readonly #disposeCredentialListener: () => void
  readonly #disposeSettingsListener: () => void

  constructor(private readonly ctx: Context, private readonly config: ResolvedLoomConfig) {
    const credentialEvents = ctx as Context & {
      on?: (event: 'credentials/reference-updated', listener: (ref: string) => void) => () => void
    }
    this.#disposeCredentialListener = credentialEvents.on?.('credentials/reference-updated', ref => {
      if (ref === this.config.tokenRef && !this.#writingCredential) this.#credentialOwner = undefined
    }) ?? (() => {})
    const settingsEvents = ctx as Context & {
      on?: (event: 'settings/document-updated', listener: (namespace: string) => void) => () => void
    }
    this.#disposeSettingsListener = settingsEvents.on?.('settings/document-updated', namespace => {
      if (namespace !== 'agent-default-model') return
      for (const session of this.#sessions.values()) {
        if (session.state === 'model-selection-required') this.reconcileModelSelection(session)
      }
    }) ?? (() => {})
  }

  async start(): Promise<BrowserLoginStart> {
    this.cleanup()
    const active = [...this.#sessions.values()].filter(session => !this.final(session.state)).length
    if (active >= MAX_PENDING_SESSIONS) throw new Error('too many pending Loomloom login sessions')
    const controller = new AbortController()
    const previous = await this.ctx.credentials.resolve(credentialRef(this.config.tokenRef))
    const previousIdentityToken = await createLoomIdentityTokenResolver(this.ctx)()
    const authorization = await beginBrowserAuthorization(controller.signal)
    const sessionId = randomBytes(24).toString('base64url')
    const expiryTimer = setTimeout(() => { void this.expire(sessionId) }, SESSION_TTL_MS)
    expiryTimer.unref?.()
    const session: LoginSession = {
      id: sessionId,
      controller,
      previousCredential: previous?.value,
      previousIdentityToken,
      expiresAt: Date.now() + SESSION_TTL_MS,
      expiryTimer,
      modelIds: [],
      wroteCredential: false,
      state: 'pending',
    }
    this.#sessions.set(sessionId, session)
    void authorization.result.then(async credential => {
      if (this.final(session.state)) return
      session.state = 'verifying-loom'
      try {
        const [loomResult, routerResult] = await Promise.allSettled([
          verifyLoomCredential(credential.apiKey, this.config, controller.signal),
          verifyShengsuanyunRouterCredential(credential.apiKey, controller.signal),
        ])
        if (controller.signal.aborted) { this.finish(session, 'cancelled', 'authorization-cancelled'); return }
        if (loomResult.status === 'rejected') {
          this.finish(session, 'failed', 'loom-validation-failed')
          return
        }
        if (routerResult.status === 'rejected') throw routerResult.reason
        const modelIds = routerResult.value
        session.state = 'verifying-router'
        session.modelIds = modelIds
        await this.writeCredential(session, credential.apiKey, credential.identityToken)
        if (controller.signal.aborted) {
          await this.restoreCredential(session)
          this.finish(session, 'cancelled', 'authorization-cancelled')
          return
        }
        if (!modelIds.includes(SHENGSUANYUN_DEFAULT_MODEL)) {
          this.finish(session, 'model-selection-required')
          return
        }
        if (controller.signal.aborted) { await this.restoreCredential(session); this.finish(session, 'cancelled', 'authorization-cancelled'); return }
        await selectShengsuanyunDefaultModel(this.ctx)
        if (controller.signal.aborted) {
          await this.restoreCredential(session)
          this.finish(session, 'cancelled', 'authorization-cancelled')
          return
        }
        this.finish(session, 'complete')
      } catch (cause) {
        if (session.wroteCredential) await this.restoreCredential(session)
        if (controller.signal.aborted) {
          this.finish(session, 'cancelled', 'authorization-cancelled')
          return
        }
        this.finish(session, 'failed', this.validationReason(cause))
      }
    }).catch(cause => {
      if (controller.signal.aborted) this.finish(session, 'cancelled', 'authorization-cancelled')
      else this.finish(session, 'failed', this.authorizationReason(cause))
    })
    return { sessionId, url: authorization.url }
  }

  status(sessionId: string): BrowserLoginStatus | undefined {
    this.cleanup()
    const session = this.#sessions.get(sessionId)
    if (session?.state === 'model-selection-required') this.reconcileModelSelection(session)
    return session === undefined ? undefined : { state: session.state, ...(session.reason === undefined ? {} : { reason: session.reason }) }
  }

  async cancel(sessionId: string): Promise<void> {
    this.cleanup()
    const session = this.#sessions.get(sessionId)
    if (session === undefined || this.final(session.state)) return
    session.controller.abort()
    this.finish(session, 'cancelled', 'authorization-cancelled')
    await this.restoreCredential(session)
  }

  async dispose(): Promise<void> {
    this.#disposeCredentialListener()
    this.#disposeSettingsListener()
    for (const session of this.#sessions.values()) {
      clearTimeout(session.expiryTimer)
      session.controller.abort()
      await this.restoreCredential(session)
    }
    this.#sessions.clear()
  }

  private cleanup(): void {
    const now = Date.now()
    for (const [id, session] of this.#sessions) {
      if (session.expiresAt <= now && this.final(session.state)) this.#sessions.delete(id)
    }
  }

  private final(state: BrowserLoginState): boolean {
    return state === 'complete' || state === 'cancelled' || state === 'failed'
  }

  private finish(session: LoginSession, state: BrowserLoginState, reason?: BrowserLoginReason): void {
    if (this.final(session.state)) return
    session.state = state
    if (state === 'complete') {
      session.wroteCredential = false
      if (this.#credentialOwner === session.id) this.#credentialOwner = undefined
    }
    if (reason === undefined) delete session.reason
    else session.reason = reason
  }

  private authorizationReason(cause: unknown): BrowserLoginReason {
    if (cause instanceof Error && /取消/u.test(cause.message)) return 'authorization-cancelled'
    return cause instanceof Error && /超时/u.test(cause.message) ? 'authorization-timeout' : 'loom-validation-failed'
  }

  private validationReason(cause: unknown): BrowserLoginReason {
    if (cause instanceof RouterCredentialError) return cause.reason
    return cause instanceof Error && /模型/u.test(cause.message) ? 'router-validation-failed' : 'credential-save-failed'
  }

  private async restoreCredential(session: LoginSession): Promise<void> {
    if (!session.wroteCredential || this.#credentialOwner !== session.id) return
    this.#writingCredential = true
    try {
      if (session.previousCredential === undefined) await clearLoomToken(this.ctx, this.config)
      else await storeLoomToken(this.ctx, this.config, session.previousCredential)
      await replaceLoomIdentityToken(this.ctx, session.previousIdentityToken)
      session.wroteCredential = false
      this.#credentialOwner = undefined
    } finally {
      this.#writingCredential = false
    }
  }

  private async writeCredential(session: LoginSession, token: string, identityToken: string | undefined): Promise<void> {
    this.#writingCredential = true
    try {
      await storeLoomToken(this.ctx, this.config, token)
      await replaceLoomIdentityToken(this.ctx, identityToken)
      session.wroteCredential = true
      this.#credentialOwner = session.id
    } finally {
      this.#writingCredential = false
    }
  }

  private reconcileModelSelection(session: LoginSession): void {
    const selected = currentShengsuanyunModel(this.ctx)
    if (selected !== undefined && session.modelIds.includes(selected)) this.finish(session, 'complete')
  }

  private async expire(sessionId: string): Promise<void> {
    const session = this.#sessions.get(sessionId)
    if (session === undefined) return
    if (this.final(session.state)) {
      this.#sessions.delete(sessionId)
      return
    }
    session.controller.abort()
    await this.restoreCredential(session)
    this.finish(session, 'failed', 'authorization-timeout')
    const removal = setTimeout(() => this.#sessions.delete(sessionId), 60_000)
    removal.unref?.()
  }
}
