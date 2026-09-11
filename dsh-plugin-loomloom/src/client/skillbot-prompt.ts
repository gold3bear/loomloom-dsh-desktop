/**
 * Handing a SkillBot invocation to the conversation.
 *
 * The market surface does not execute anything: it puts one user message into the
 * session and lets the agent drive the Loomloom tools from there. This module owns
 * the pieces of that handoff worth testing on their own — resolving a target
 * session, submitting into it, composing the prompt — so the React component only
 * wires them to clicks.
 *
 * ## Why this does not use `ctx.conversation`
 *
 * The published `IConversation` face offers `send(text)`, which reads the target
 * session from the **caller's** context. Reaching it therefore means
 * `ctx.sessions.scope(id).conversation`, and that fails at runtime:
 *
 * ```text
 * cannot get property "conversation" without inject
 * ```
 *
 * The scoped context is a freshly minted agent-scope fiber; it never declared the
 * dependency, and cordis's service proxy walks the fiber chain looking for a
 * declaration before it will resolve a service. (`IConversation` also does not
 * publish `sendSession`, the class's explicit-session variant, so that route needs
 * a cast out of the contract.) Every framework caller of those two methods lives
 * *inside* the conversation package, where the fiber already carries the scope.
 *
 * What IS published is enough: `sessions.binding(id)` yields a session face, and
 * `ISession.prompt(content, mode)` submits into it. Both are part of the declared
 * contracts, neither needs a scope, and the call stays on this plugin's own
 * context. The trade is the composer's optimistic local echo, which is built on
 * `beginSubmission`; the message instead appears as soon as the Host accepts it.
 */

/** One submitted content part; only plain text is used here. */
export interface TextPart {
  readonly type: 'text'
  readonly text: string
}

/**
 * The session verb this plugin needs, as declared by `ISession`.
 *
 * `prompt` resolves to the transport's `RemoteResult` shape: `ok` says whether the
 * Host accepted the submission, and a business failure is mirrored into the
 * session snapshot's `promptError` for the surrounding UI.
 */
export interface SessionFace {
  prompt(
    content: readonly TextPart[],
    mode: 'queue' | 'steer',
    signal?: AbortSignal,
    requestId?: unknown,
  ): Promise<{ readonly ok: boolean }>
}

/** The session handle behind an id, as `ISessions.binding` exposes it. */
export interface SessionBindingFace {
  readonly session: SessionFace
}

export interface SkillbotSessions {
  readonly list: {
    getSnapshot(): {
      readonly current?: string
      /** Rows by id; `cwd` is the workspace the sidebar groups them under. */
      readonly byId?: Readonly<Record<string, { readonly cwd?: string } | undefined>>
    }
  }
  create(opts?: { readonly cwd?: string, readonly workspaceId?: string }): Promise<string>
  open(id: string): void
  binding(id: string): SessionBindingFace | undefined
}

/** A resolved place to put one message. */
export interface SendTarget {
  readonly id: string
  send(text: string): Promise<void>
}

export interface ResolveSendTargetOptions {
  /**
   * Where the invocation goes.
   *
   * `'new-session'` (the default) opens a fresh conversation so a SkillBot run owns
   * its transcript instead of being appended to an unrelated thread.
   */
  readonly target?: 'new-session' | 'current-session'
  /** Bounded retries while a freshly created session becomes bindable. */
  readonly attempts?: number
  readonly delayMs?: number
  /** Injectable wait, so tests do not spend real time. */
  readonly sleep?: (ms: number) => Promise<void>
  /**
   * Workspace a session currently sits in — the key the sidebar groups by.
   *
   * Supplied by the caller because the sessions feed itself does not carry it.
   * Without it a new conversation is created against the host's default workspace,
   * which appears as an extra group beside the user's work.
   */
  readonly workspaceOf?: (sessionId: string) => string | undefined
}

const DEFAULT_ATTEMPTS = 5
const DEFAULT_DELAY_MS = 50

async function bindable(
  sessions: SkillbotSessions,
  id: string,
  attempts: number,
  delayMs: number,
  sleep: (ms: number) => Promise<void>,
): Promise<SessionFace> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const session = sessions.binding(id)?.session
    if (session !== undefined) return session
    if (attempt < attempts - 1) await sleep(delayMs)
  }
  throw new Error(`loomloom: session "${id}" exposed no addressable conversation surface`)
}

/**
 * Resolves the session to send into.
 *
 * The default is a **new** session, and that default is the point: a SkillBot call
 * is a self-contained job, not a remark in whatever conversation the user happened
 * to be reading. Appending it to the current session would bury the invocation in
 * an unrelated thread, drag that thread's context into the run, and leave the
 * answer mixed with everything else. A fresh session also gives the run its own
 * transcript to report into, and the market surface keeps working from the
 * no-session welcome state, which is where a first call tends to happen.
 *
 * `'current-session'` is kept as an explicit opt-in for callers that genuinely
 * want to continue a thread.
 */
export async function resolveSendTarget(
  sessions: SkillbotSessions,
  options: ResolveSendTargetOptions = {},
): Promise<SendTarget> {
  const attempts = Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS)
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS
  const sleep = options.sleep ?? (async (ms: number) => { await new Promise(resolve => setTimeout(resolve, ms)) })

  const snapshot = sessions.list.getSnapshot()
  const current = snapshot.current
  const reuse = options.target === 'current-session' && current !== undefined && current !== ''
  // A new conversation belongs in the **same group** as the one being viewed. The
  // sidebar groups by workspace, and `create()` with no target lands in the host's
  // default workspace — an extra group beside the user's work.
  let id = current ?? ''
  if (!reuse) {
    const workspaceId = current === undefined ? undefined : options.workspaceOf?.(current)
    if (workspaceId !== undefined) id = await sessions.create({ workspaceId })
    else {
      // No workspace to inherit (no current session, or one outside any group):
      // fall back to its directory, then to the host default.
      const cwd = current === undefined ? undefined : snapshot.byId?.[current]?.cwd
      id = await sessions.create(cwd === undefined ? {} : { cwd })
    }
  }
  // Selecting the new session is what puts the user in front of the run; the
  // market surface yields main.surface immediately afterwards.
  if (!reuse) sessions.open(id)
  const session = await bindable(sessions, id, attempts, delayMs, sleep)

  return {
    id,
    async send(text: string) {
      const outcome = await session.prompt([{ type: 'text', text }], 'queue')
      if (!outcome.ok) throw new Error('the conversation rejected the prompt')
    },
  }
}

/**
 * What a click is allowed to do about the ShengSuanYun credential.
 *
 * `blocked` exists because "we could not tell" is not the same as "not signed in":
 * sending anyway would spend a call on a credential we never confirmed, and
 * opening the sign-in flow would tell the user to authorize when they may already
 * have. The caller reports it instead.
 */
export type InvocationGate = 'proceed' | 'authorize' | 'blocked'

export function invocationGate(credential: { readonly configured: boolean } | undefined): InvocationGate {
  if (credential === undefined) return 'blocked'
  return credential.configured ? 'proceed' : 'authorize'
}

export interface SkillbotPromptInput {
  /** Localized message template carrying `{name}`, `{listingId}` and `{input}`. */
  readonly template: string
  /** Localized sentence used in place of the input block when the form was skipped. */
  readonly noInput: string
  readonly name: string
  readonly listingId: string
  /** Inputs the user filled in the preview; omitted when the row itself was clicked. */
  readonly values?: Record<string, unknown>
}

/**
 * Composes the message the agent receives.
 *
 * The input block is either the user's filled values or an explicit sentence saying
 * nothing was filled, so the agent never has to guess whether an empty form means
 * "use the defaults" or "ask me" — it is told which.
 */
export function skillbotPrompt(input: SkillbotPromptInput): string {
  const values = input.values
  const filled = values !== undefined && Object.keys(values).length > 0
  const block = filled ? ['```json', JSON.stringify(values, null, 2), '```'].join('\n') : input.noInput
  return input.template
    .replaceAll('{name}', input.name)
    .replaceAll('{listingId}', input.listingId)
    .replaceAll('{input}', block)
}
