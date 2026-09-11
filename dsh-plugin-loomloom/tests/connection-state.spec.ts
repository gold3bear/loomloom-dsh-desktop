import assert from 'node:assert/strict'
import test from 'node:test'
import { readConnectionState } from '../src/client/connection-state.js'
import { LoomloomOnboarding } from '../src/client/LoomloomConnectFlow.js'

test('a stored credential skips first-run onboarding without probing cloud services or models', async () => {
  let probes = 0
  const state = await readConnectionState(true, {
    credential: async () => ({ configured: true }),
    bootstrap: async () => { probes += 1; throw new Error('offline') },
  })
  assert.equal(state, 'already-configured')
  assert.equal(probes, 0)
})

test('first run without a credential prompts login without cloud probes', async () => {
  assert.equal(await readConnectionState(true, {
    credential: async () => ({ configured: false }),
    bootstrap: async () => { throw new Error('must not probe') },
  }), 'unconfigured')
})

test('settings distinguishes login, service availability, model selection and readiness', async () => {
  for (const [configured, loom, router, ready, expected] of [
    [false, 'unknown', 'unknown', false, 'unconfigured'],
    [true, 'unavailable', 'ready', true, 'unavailable'],
    [true, 'ready', 'unavailable', false, 'unavailable'],
    [true, 'ready', 'ready', false, 'model-selection'],
    [true, 'ready', 'ready', true, 'connected'],
  ] as const) {
    assert.equal(await readConnectionState(false, {
      credential: async () => { throw new Error('not needed') },
      bootstrap: async () => ({ credential: { configured }, loom, router, model: { provider: 'shengsuanyun', ready } }),
    }), expected)
  }
})

test('credential lookup failure is not treated as proof that login is missing', async () => {
  await assert.rejects(readConnectionState(true, {
    credential: async () => { throw new Error('host unavailable') },
    bootstrap: async () => { throw new Error('must not probe') },
  }), /host unavailable/u)
})

test('opening model settings completes onboarding before opening the native section', () => {
  const actions: string[] = []
  const element = LoomloomOnboarding({
    stepId: 'loomloom-connect',
    complete: () => { actions.push('complete') },
    openSection: section => { actions.push(section) },
    t: (key: string) => key,
    onCreateFirstChat: () => {},
  } as Parameters<typeof LoomloomOnboarding>[0])
  element.props.onOpenModels()
  assert.deepEqual(actions, ['complete', 'models'])
})
