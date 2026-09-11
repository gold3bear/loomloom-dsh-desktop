import assert from 'node:assert/strict'
import test from 'node:test'
import type { LoomBootstrap } from '../src/client/api.js'
import { connectStage } from '../src/client/connect-stage.js'

function bootstrap(overrides: {
  readonly configured?: boolean
  readonly loom?: LoomBootstrap['loom']
  readonly router?: LoomBootstrap['router']
  readonly modelId?: string | undefined
  readonly modelReady?: boolean
} = {}): LoomBootstrap {
  return {
    credential: { configured: overrides.configured ?? true },
    loom: overrides.loom ?? 'ready',
    router: overrides.router ?? 'ready',
    model: {
      provider: 'shengsuanyun',
      ...(overrides.modelId === undefined ? {} : { id: overrides.modelId }),
      ready: overrides.modelReady ?? false,
    },
  }
}

test('an unconfigured credential stays unconfigured however ready the routes are', () => {
  assert.equal(connectStage(bootstrap({ configured: false, modelReady: true })), 'unconfigured')
})

test('a failing route reports failure rather than asking for a model', () => {
  assert.equal(connectStage(bootstrap({ loom: 'unavailable' })), 'unconfigured')
  assert.equal(connectStage(bootstrap({ router: 'unavailable' })), 'unconfigured')
  assert.equal(connectStage(bootstrap({ loom: 'unknown', router: 'unknown' })), 'unconfigured')
})

test('a verified credential with a verified chat model is connected', () => {
  assert.equal(connectStage(bootstrap({ modelId: 'deepseek/deepseek-v4-flash', modelReady: true })), 'connected')
})

test('a chat model on the verified route that is missing from the catalogue asks for a model', () => {
  assert.equal(connectStage(bootstrap({ modelId: 'deepseek/deepseek-v4-flash', modelReady: false })), 'model-selection')
})

test('a chat model on any other route cannot be judged, so it never blocks onboarding', () => {
  // The Host names an id only for the route it verifies; `qiye`-style custom
  // routes arrive here with no id, and this is the case that used to trap the
  // user behind a dialog that reappeared on every mount.
  assert.equal(connectStage(bootstrap({ modelId: undefined, modelReady: false })), 'connected')
})
