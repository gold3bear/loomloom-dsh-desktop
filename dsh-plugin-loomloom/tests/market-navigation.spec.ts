import assert from 'node:assert/strict'
import test, { afterEach, beforeEach } from 'node:test'
import {
  installLoomloomSessionNavigationBridge,
  isLoomloomMarketActive,
  leavesMarketOnClick,
  setLoomloomMarketActive,
} from '../src/client/market-navigation.js'

/**
 * Minimal element double: only `closest` matters. The returned ancestor keeps
 * carrying the same chain, so a nested `closest` on it resolves too — which is
 * exactly the shape the predicate walks.
 */
class FakeElement {
  constructor(private readonly ancestors: readonly string[]) {}
  closest(selector: string): FakeElement | null {
    return this.ancestors.includes(selector) ? new FakeElement(this.ancestors) : null
  }
}

interface Listener { (event: MouseEvent): void }

let listeners: Listener[] = []
let originals = new Map<string, PropertyDescriptor | undefined>()

function installDom(): void {
  listeners = []
  originals = new Map()
  for (const name of ['Element', 'document'] as const) originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
  Object.defineProperty(globalThis, 'Element', { value: FakeElement, configurable: true, writable: true })
  Object.defineProperty(globalThis, 'document', {
    value: {
      addEventListener(_type: string, listener: Listener) { listeners.push(listener) },
      removeEventListener() {},
    },
    configurable: true,
    writable: true,
  })
}

function restoreDom(): void {
  for (const [name, descriptor] of originals) {
    if (descriptor === undefined) delete (globalThis as Record<string, unknown>)[name]
    else Object.defineProperty(globalThis, name, descriptor)
  }
  originals = new Map()
}

function element(ancestors: readonly string[]): Element {
  return new FakeElement(ancestors) as unknown as Element
}

function clickOn(target: Element): void {
  for (const listener of listeners) listener({ target } as unknown as MouseEvent)
}

beforeEach(() => { installDom() })
afterEach(() => {
  restoreDom()
  setLoomloomMarketActive(false)
})

test('a click that hits no session row leaves the market alone', () => {
  // This is the regression: the market occupies main.surface, and the previous
  // guard treated "no session row anywhere" as "leave", so any click — a row, the
  // preview control, the background — threw the user straight back into the chat.
  assert.equal(leavesMarketOnClick(element([])), false)
  assert.equal(leavesMarketOnClick(element(['[role="group"]', 'button'])), false)
})

test('picking a session row does leave the market', () => {
  assert.equal(leavesMarketOnClick(element(['[role="treeitem"]', '[role="tree"]'])), true)
})

test('a tree row outside a session tree is not a session pick', () => {
  // Some other tree (a settings tree, a details tree) must not navigate away.
  assert.equal(leavesMarketOnClick(element(['[role="treeitem"]'])), false)
})

test('a non-element target is ignored', () => {
  assert.equal(leavesMarketOnClick(null), false)
})

test('the market survives every click except picking a session', () => {
  const dispose = installLoomloomSessionNavigationBridge()

  setLoomloomMarketActive(true)
  clickOn(element([]))
  assert.equal(isLoomloomMarketActive(), true, 'a stray click must not leave the market')
  clickOn(element(['button']))
  assert.equal(isLoomloomMarketActive(), true, 'the market owns its own controls')
  clickOn(element(['[role="treeitem"]']))
  assert.equal(isLoomloomMarketActive(), true, 'a foreign tree row is not a session pick')

  clickOn(element(['[role="treeitem"]', '[role="tree"]']))
  assert.equal(isLoomloomMarketActive(), false, 'picking a session must leave the market')
  dispose()
})

test('the bridge stays inert while the market is not active', () => {
  const dispose = installLoomloomSessionNavigationBridge()
  setLoomloomMarketActive(false)
  clickOn(element(['[role="treeitem"]', '[role="tree"]']))
  assert.equal(isLoomloomMarketActive(), false)
  dispose()
})
