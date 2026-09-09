import { useSyncExternalStore } from 'react'

let active = false
const listeners = new Set<() => void>()

export function setLoomloomMarketActive(value: boolean): void {
  if (active === value) return
  active = value
  for (const listener of listeners) listener()
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

export function installLoomloomSessionNavigationBridge(): () => void {
  const onClick = (event: MouseEvent): void => {
    if (!active || !(event.target instanceof Element)) return
    const treeItem = event.target.closest('[role="treeitem"]')
    if (treeItem?.closest('[role="tree"]') === null) return
    setLoomloomMarketActive(false)
  }
  document.addEventListener('click', onClick, true)
  return () => { document.removeEventListener('click', onClick, true) }
}
