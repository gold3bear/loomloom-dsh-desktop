import assert from 'node:assert/strict'
import test from 'node:test'
import {
  invocationGate,
  resolveSendTarget,
  skillbotPrompt,
  type SessionFace,
  type SkillbotSessions,
} from '../src/client/skillbot-prompt.js'
import { en, zh } from '../src/client/locales.js'

const TEMPLATE = [
  'Call the cloud SkillBot via the Loomloom tools.',
  '- SkillBot: {name}',
  '- listing id: {listingId}',
  '- inputs I filled in:',
  '{input}',
  'Then quote, wait for my approval, execute and summarise.',
].join('\n')

const NO_INPUT = 'I have not filled in any inputs; collect the required ones from me first.'

interface PromptCall {
  readonly content: readonly { readonly type: string, readonly text: string }[]
  readonly mode: string
}

interface FakeOptions {
  readonly current?: string
  /** Workspace the current row lives in, i.e. the sidebar group key. */
  readonly currentCwd?: string
  /** Ids whose binding resolves; others yield undefined. */
  readonly bindable?: readonly string[]
  /** How many `binding` calls fail per id before it resolves. */
  readonly flaky?: number
  readonly create?: string | Error
  /** Make the submitted prompt report a business failure. */
  readonly promptFails?: boolean
}

function fakeSessions(options: FakeOptions = {}): {
  readonly sessions: SkillbotSessions
  readonly actions: string[]
  readonly prompts: PromptCall[]
} {
  const actions: string[] = []
  const prompts: PromptCall[] = []
  // An explicit `bindable` list is authoritative: `create` then does not make the
  // new id resolvable, which is how the never-bindable case is expressed.
  const explicitBindable = options.bindable !== undefined
  const bindable = new Set(options.bindable ?? (options.current === undefined ? [] : [options.current]))
  const attemptsById = new Map<string, number>()
  const session: SessionFace = {
    async prompt(content, mode) {
      prompts.push({ content, mode })
      return { ok: options.promptFails !== true }
    },
  }
  const sessions: SkillbotSessions = {
    list: {
      getSnapshot: () => (options.current === undefined
        ? {}
        : {
          current: options.current,
          byId: { [options.current]: options.currentCwd === undefined ? {} : { cwd: options.currentCwd } },
        }),
    },
    async create(opts) {
      actions.push(opts?.workspaceId !== undefined
        ? `create:workspace=${opts.workspaceId}`
        : opts?.cwd === undefined ? 'create' : `create:cwd=${opts.cwd}`)
      if (options.create instanceof Error) throw options.create
      const id = options.create ?? 'session-new'
      if (!explicitBindable) bindable.add(id)
      return id
    },
    open(id) { actions.push(`open:${id}`) },
    binding(id) {
      const seen = (attemptsById.get(id) ?? 0) + 1
      attemptsById.set(id, seen)
      if (!bindable.has(id)) return undefined
      if (options.flaky !== undefined && seen <= options.flaky) return undefined
      return { session }
    },
  }
  return { sessions, actions, prompts }
}

const instantSleep = async (ms: number): Promise<void> => { void ms }

test('an invocation opens a NEW session even when one is already selected', async () => {
  // The default is the point: a SkillBot run owns its transcript and must not be
  // appended to whatever conversation the user happened to be reading.
  const { sessions, actions } = fakeSessions({ current: 'session-1', create: 'session-new' })

  const target = await resolveSendTarget(sessions, { sleep: instantSleep })

  assert.equal(target.id, 'session-new')
  assert.deepEqual(actions, ['create', 'open:session-new'])
})

test('a new conversation lands in the SAME workspace group as the one being viewed', async () => {
  // The sidebar groups by workspace; creating without a workspace target lands in
  // the host default and shows up as an extra group beside the user's work.
  const { sessions, actions } = fakeSessions({ current: 'session-1', create: 'session-new' })

  await resolveSendTarget(sessions, {
    sleep: instantSleep,
    workspaceOf: sessionId => (sessionId === 'session-1' ? 'ws-work' : undefined),
  })

  assert.deepEqual(actions, ['create:workspace=ws-work', 'open:session-new'])
})

test('without a known workspace the session directory is used before the host default', async () => {
  const { sessions, actions } = fakeSessions({
    current: 'session-1',
    currentCwd: '/Users/daf/work',
    create: 'session-new',
  })

  await resolveSendTarget(sessions, { sleep: instantSleep, workspaceOf: () => undefined })

  assert.deepEqual(actions, ['create:cwd=/Users/daf/work', 'open:session-new'])
})

test('with no current session the host default workspace is used', async () => {
  const { sessions, actions } = fakeSessions({ create: 'session-new' })

  await resolveSendTarget(sessions, { sleep: instantSleep, workspaceOf: () => 'ws-work' })

  assert.deepEqual(actions, ['create', 'open:session-new'])
})

test('a new session is created and opened from the no-session welcome state too', async () => {
  const { sessions, actions } = fakeSessions({ create: 'session-new' })

  const target = await resolveSendTarget(sessions, { sleep: instantSleep })

  assert.equal(target.id, 'session-new')
  assert.deepEqual(actions, ['create', 'open:session-new'])
})

test('continuing the current session is available, but only on request', async () => {
  const { sessions, actions } = fakeSessions({ current: 'session-1', create: 'session-new' })

  const target = await resolveSendTarget(sessions, { target: 'current-session', sleep: instantSleep })

  assert.equal(target.id, 'session-1')
  assert.deepEqual(actions, [])
})

test('a freshly created session that is not yet bindable is retried', async () => {
  const { sessions } = fakeSessions({ create: 'session-new', flaky: 2 })

  assert.equal((await resolveSendTarget(sessions, { attempts: 5, sleep: instantSleep })).id, 'session-new')
})

test('a session that never becomes bindable fails loudly instead of sending nowhere', async () => {
  const { sessions } = fakeSessions({ create: 'session-new', bindable: [] })

  await assert.rejects(
    () => resolveSendTarget(sessions, { attempts: 3, sleep: instantSleep }),
    /no addressable conversation surface/u,
  )
})

test('an unaddressable current session is reported in the opt-in mode, not silently replaced', async () => {
  const { sessions, actions } = fakeSessions({ current: 'session-1', bindable: [], create: 'session-new' })

  await assert.rejects(
    () => resolveSendTarget(sessions, { target: 'current-session', attempts: 2, sleep: instantSleep }),
  )

  // Asked to continue a specific thread, silently opening a different one would put
  // the invocation where the user is not looking.
  assert.deepEqual(actions, [])
})

test('a failing session creation surfaces its own error', async () => {
  const { sessions } = fakeSessions({ create: new Error('host refused') })

  await assert.rejects(() => resolveSendTarget(sessions, { sleep: instantSleep }), /host refused/u)
})

test('sending submits one queued text part through the published session verb', async () => {
  const { sessions, prompts } = fakeSessions({ create: 'session-new' })

  await (await resolveSendTarget(sessions, { sleep: instantSleep })).send('hello')

  assert.deepEqual(prompts, [{ content: [{ type: 'text', text: 'hello' }], mode: 'queue' }])
})

test('a rejected submission is an error, not a silent success', async () => {
  const { sessions } = fakeSessions({ create: 'session-new', promptFails: true })
  const target = await resolveSendTarget(sessions, { sleep: instantSleep })

  await assert.rejects(() => target.send('hello'), /rejected the prompt/u)
})

test('the gate proceeds on a configured credential and asks to authorize otherwise', () => {
  assert.equal(invocationGate({ configured: true }), 'proceed')
  assert.equal(invocationGate({ configured: false }), 'authorize')
})

test('an unreadable credential blocks rather than guessing', () => {
  // Sending would spend a call on an unconfirmed credential; authorizing would
  // tell an already-signed-in user to sign in.
  assert.equal(invocationGate(undefined), 'blocked')
})

test('filled values reach the prompt as a JSON block', () => {
  const prompt = skillbotPrompt({
    template: TEMPLATE,
    noInput: NO_INPUT,
    name: 'Recruitment Specialist',
    listingId: 'listing-1',
    values: { topic: 'launch', slide_count: 8 },
  })

  assert.match(prompt, /SkillBot: Recruitment Specialist/u)
  assert.match(prompt, /listing id: listing-1/u)
  assert.match(prompt, /```json/u)
  assert.match(prompt, /"slide_count": 8/u)
  assert.doesNotMatch(prompt, /\{name\}|\{listingId\}|\{input\}/u)
  assert.doesNotMatch(prompt, /collect the required ones/u)
})

test('clicking the row without filling anything says so explicitly', () => {
  const prompt = skillbotPrompt({
    template: TEMPLATE,
    noInput: NO_INPUT,
    name: 'Recruitment Specialist',
    listingId: 'listing-1',
  })

  // The agent must not have to guess whether an empty form means "use defaults".
  assert.match(prompt, /collect the required ones from me first/u)
  assert.doesNotMatch(prompt, /```json/u)
  assert.doesNotMatch(prompt, /\{input\}/u)
})

test('an empty values object is treated as not filled', () => {
  const prompt = skillbotPrompt({ template: TEMPLATE, noInput: NO_INPUT, name: 'A', listingId: 'b', values: {} })

  assert.match(prompt, /collect the required ones/u)
  assert.doesNotMatch(prompt, /```json/u)
})

test('market prompts require the interactive question tool before preparation', () => {
  for (const prompt of [zh.promptInvocation, en.promptInvocation]) {
    assert.match(prompt, /loomloom_get_skillbot/u)
    assert.match(prompt, /ask_user_question/u)
    assert.match(prompt, /do not call loomloom_prepare_execution before the answers are returned|在答案返回前禁止调用 loomloom_prepare_execution/u)
    assert.match(prompt, /plain-text question|普通文字代替提问/u)
  }
  assert.match(zh.promptNoInput, /必须通过 ask_user_question/u)
  assert.match(en.promptNoInput, /MUST collect.*ask_user_question/u)
})

test('every placeholder occurrence is replaced, not just the first', () => {
  const prompt = skillbotPrompt({
    template: '{name} / {name} / {listingId} / {listingId}',
    noInput: NO_INPUT,
    name: 'N',
    listingId: 'L',
  })

  assert.equal(prompt, 'N / N / L / L')
})
