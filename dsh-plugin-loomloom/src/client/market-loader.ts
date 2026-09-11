import { readStorefront, type LoomStorefront } from './api.js'

/**
 * The single Client call the market surface is allowed to depend on.
 *
 * Browsing is anonymous: the storefront route reads public Market data, and
 * nothing on this path consults a credential. The verified
 * `/api/loomloom/bootstrap` probe (a Loom round trip plus the whole Router model
 * catalogue) and the credential store are deliberately absent — awaiting either
 * before drawing a list is what previously delayed the first row by two extra WAN
 * round trips and flashed the connect flow at users who were already signed in.
 */
export interface MarketSource {
  readonly readStorefront: (refresh?: boolean, signal?: AbortSignal) => Promise<LoomStorefront>
}

export const defaultMarketSource: MarketSource = { readStorefront }

export type MarketLoad =
  | { readonly ok: true, readonly storefront: LoomStorefront }
  | { readonly ok: false, readonly message: string }

/**
 * Resolves the storefront, turning a transport failure into a renderable value.
 *
 * The Host already answers 200 with `stale` and `error` when it can fall back to
 * a cached snapshot, so a rejection here means there is nothing at all to show.
 */
export async function loadMarket(
  source: MarketSource,
  refresh = false,
  signal?: AbortSignal,
): Promise<MarketLoad> {
  try {
    return { ok: true, storefront: await source.readStorefront(refresh, signal) }
  } catch (cause) {
    return {
      ok: false,
      message: cause instanceof Error && cause.message.trim() !== '' ? cause.message : 'storefront unavailable',
    }
  }
}
