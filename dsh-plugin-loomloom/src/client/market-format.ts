import type { LoomStorefrontEntry } from './api.js'

/**
 * Pure formatting and filtering for the market surface.
 *
 * The market cards are a thin renderer over these functions, which keeps the
 * search, fee and monogram rules testable without a DOM.
 */

/** Case-insensitive substring test over the fields a card shows. */
function matches(entry: LoomStorefrontEntry, needle: string): boolean {
  return [entry.name, entry.description, entry.creatorNickname ?? '']
    .some(value => value.toLowerCase().includes(needle))
}

/**
 * Entries matching a free-text query.
 * @param entries - the storefront's entries, in published order.
 * @param query - what the user typed; blank returns every entry.
 * @returns the matching entries, order preserved.
 */
export function filterEntries(
  entries: readonly LoomStorefrontEntry[],
  query: string,
): readonly LoomStorefrontEntry[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return entries
  return entries.filter(entry => matches(entry, needle))
}

/**
 * Fixed fee with its currency, as one card- and dialog-ready string.
 * @param entry - the storefront entry.
 * @param freeLabel - the localized label used when the listing charges nothing.
 * @returns e.g. `0.0100000 CNY`, or the free label.
 */
export function feeText(entry: LoomStorefrontEntry, freeLabel: string): string {
  const amount = entry.fixedFee ?? freeLabel
  return entry.currency === undefined ? amount : `${amount} ${entry.currency}`
}

/** Publication date in the viewer's locale, or undefined when absent or unparsable. */
export function updatedText(iso: string | undefined): string | undefined {
  if (iso === undefined || iso.trim() === '') return undefined
  const value = new Date(iso)
  return Number.isNaN(value.getTime()) ? undefined : value.toLocaleDateString()
}

/**
 * First character of a name, for the card's avatar tile.
 * @param name - creator nickname, falling back to the SkillBot name.
 * @returns one upper-cased character; `?` for an empty name.
 */
export function monogram(name: string | undefined): string {
  const first = name === undefined ? undefined : [...name.trim()][0]
  return first === undefined ? '?' : first.toUpperCase()
}
