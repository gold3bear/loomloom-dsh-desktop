import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { apply as applyClient, inject as clientInject } from '../src/client/index.js'
import { inject } from '../src/index.js'

test('bundle mounts the authorization seam before the Loomloom Host plugin', async () => {
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')

  assert.ok(inject.includes('authorization'))
  assert.match(patch, /id: authorization\s+name: '@deepseek-ai\/dsh-authorization'/u)
  assert.match(patch, /id: authorization[\s\S]*id: loomloom/u)
})

test('client waits for the native sessions service before registering first-run onboarding', () => {
  assert.ok(clientInject.includes('sessions'))
})

test('connected onboarding completes and opens the native new-session surface', () => {
  let onboarding: ((props: unknown) => { readonly props: { readonly onCreateFirstChat: () => void } }) | undefined
  const actions: string[] = []
  const registrations: string[] = []
  const context = {
    effect(): () => void { return () => {} },
    get(name: string): unknown {
      assert.equal(name, 'sessions')
      return {
        clear(): void { actions.push('clear-session') },
        list: {
          getSnapshot: () => ({ current: 'session-1' }),
          subscribe: () => () => {},
        },
      }
    },
    locale: {
      register(): () => void { return () => {} },
      bind(): (key: string) => string { return key => key },
    },
    slots: {
      inject(_name: string, register: () => unknown): unknown { return register() },
      register(
        options: { readonly name: string },
        component: (props: unknown) => { readonly props: { readonly onCreateFirstChat: () => void } },
      ): () => void {
        registrations.push(options.name)
        if (options.name === 'settings.onboarding') onboarding = component
        return () => {}
      },
    },
  }

  applyClient(context as never)
  const element = onboarding!({
    stepId: 'loomloom-connect',
    complete: () => { actions.push('complete') },
    openSection: () => {},
    t: (key: string) => key,
  })
  element.props.onCreateFirstChat()

  assert.deepEqual(actions, ['complete', 'clear-session'])
  assert.ok(registrations.includes('sidebar.primary.navigation'))
  assert.ok(registrations.includes('main.surface'))
  assert.ok(!registrations.includes('sidebar.workspaces'))
  assert.ok(!registrations.includes('conversation'))
})
