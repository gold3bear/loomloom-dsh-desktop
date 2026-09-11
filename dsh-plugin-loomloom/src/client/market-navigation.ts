import { useSyncExternalStore } from 'react'

let active = false
const listeners = new Set<() => void>()

export function setLoomloomMarketActive(value: boolean): void {
  if (active === value) return
  active = value
  for (const listener of listeners) listener()
}

/** Non-reactive read of the current state, for imperative callers and tests. */
export function isLoomloomMarketActive(): boolean {
  return active
}

export function useLoomloomMarketActive(): boolean {
  return useSyncExternalStore(
    listener => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    () => active,
    () => false,
  )
}

/**
 * Whether a click should hand the main surface back to the conversation.
 *
 * Only picking a **session row** does: the market occupies the main surface, so
 * choosing a conversation has to reveal it. Every other click — the market's own
 * rows, its preview control, its refresh button, the page background — must leave
 * the surface alone.
 *
 * This is deliberately a predicate rather than an inline condition. The previous
 * inline test read `treeItem?.closest('[role="tree"]') === null`, which yields
 * `undefined` (not `null`) whenever the click is *not* inside a session row, so
 * the guard never fired and **any** click anywhere deactivated the market — the
 * page could not be used at all.
 *
 * @param target - the click's target element, or null when it was not an element.
 * @returns true only for a click inside the sidebar's session tree.
 */
export function leavesMarketOnClick(target: Element | null): boolean {
  if (target === null) return false
  const treeItem = target.closest('[role="treeitem"]')
  if (treeItem === null) return false
  return treeItem.closest('[role="tree"]') !== null
}

/**
 * Leave the market surface when the user picks a session, and only then.
 * @returns disposer removing the listener.
 */
export function installLoomloomSessionNavigationBridge(): () => void {
  const onClick = (event: MouseEvent): void => {
    if (!active) return
    if (!leavesMarketOnClick(event.target instanceof Element ? event.target : null)) return
    setLoomloomMarketActive(false)
  }
  document.addEventListener('click', onClick, true)
  return () => { document.removeEventListener('click', onClick, true) }
}
