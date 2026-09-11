import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import { settingsNamespace, type SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { StorefrontEntry, StorefrontRead } from './storefront.js'

/**
 * How long a resolved storefront is served without re-reading the Market.
 *
 * The storefront is one creator's catalogue and changes only when that creator
 * publishes, so a short cache removes the network from every open without making
 * a new publication invisible for long. The refresh button bypasses it.
 */
export const STOREFRONT_TTL_MS = 10 * 60_000

/** Plugin-owned settings namespace holding the last good storefront. */
export const STOREFRONT_NAMESPACE = settingsNamespace('loomloom')

export interface StorefrontSnapshot {
  readonly configured: boolean
  readonly entries: readonly StorefrontEntry[]
  readonly unavailable: readonly string[]
  readonly fetchedAt: string
}

export interface StorefrontResult extends StorefrontSnapshot {
  /** True when this snapshot is being served after a failed refresh. */
  readonly stale: boolean
  /** Present whenever the last refresh failed, even when cached data is shown. */
  readonly error?: string
}

/**
 * Persisted entry shape.
 *
 * Every field is total (no optionals) because this value round-trips through the
 * settings file: an absent optional would come back as `undefined` and make the
 * stored shape differ from the in-memory one for no benefit. Empty strings mean
 * "absent" and are converted back on read.
 */
interface StoredEntry {
  id: string
  name: string
  description: string
  available: boolean
  inputSchemaSnapshot: string
  version: string
  updatedAt: string
  creatorNickname: string
  fixedFee: string
  currency: string
}

/**
 * Mutable arrays on purpose: schemastery resolves a namespace to mutable shapes,
 * and `readonly` here would make the schema and the document two different types.
 */
interface StoredSnapshot {
  version: number
  cacheKey: string
  configured: boolean
  savedAt: string
  entries: StoredEntry[]
  unavailable: string[]
}

export interface StorefrontCacheDocument {
  storefront: StoredSnapshot
}

const EMPTY_SNAPSHOT: StoredSnapshot = { version: 2, cacheKey: '', configured: false, savedAt: '', entries: [], unavailable: [] }

const StoredEntrySchema = z.object({
  id: z.string().default(''),
  name: z.string().default(''),
  description: z.string().default(''),
  available: z.boolean().default(false),
  inputSchemaSnapshot: z.string().default('{}'),
  version: z.string().default(''),
  updatedAt: z.string().default(''),
  creatorNickname: z.string().default(''),
  fixedFee: z.string().default(''),
  currency: z.string().default(''),
})

const StorefrontCacheSchema: z<StorefrontCacheDocument> = z.object({
  storefront: z.object({
    version: z.number().default(1),
    cacheKey: z.string().default(''),
    configured: z.boolean().default(false),
    savedAt: z.string().default(''),
    entries: z.array(StoredEntrySchema).default([]),
    unavailable: z.array(z.string()).default([]),
  }).default(EMPTY_SNAPSHOT),
})

function store(entry: StorefrontEntry): StoredEntry {
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    available: entry.available,
    inputSchemaSnapshot: entry.inputSchemaSnapshot,
    version: entry.version ?? '',
    updatedAt: entry.updatedAt ?? '',
    creatorNickname: entry.creatorNickname ?? '',
    fixedFee: entry.fixedFee ?? '',
    currency: entry.currency ?? '',
  }
}

function restore(entry: StoredEntry): StorefrontEntry {
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    available: entry.available,
    inputSchemaSnapshot: entry.inputSchemaSnapshot,
    ...(entry.version === '' ? {} : { version: entry.version }),
    ...(entry.updatedAt === '' ? {} : { updatedAt: entry.updatedAt }),
    ...(entry.creatorNickname === '' ? {} : { creatorNickname: entry.creatorNickname }),
    ...(entry.fixedFee === '' ? {} : { fixedFee: entry.fixedFee }),
    ...(entry.currency === '' ? {} : { currency: entry.currency }),
  }
}

function age(fetchedAt: string): number {
  const saved = Date.parse(fetchedAt)
  return Number.isFinite(saved) ? Date.now() - saved : Number.POSITIVE_INFINITY
}

export interface StorefrontCache {
  /**
   * Resolves the storefront, preferring a fresh snapshot.
   * @param force - bypass the TTL, as the refresh control does.
   */
  read(force?: boolean): Promise<StorefrontResult>
}

export interface StorefrontCacheOptions {
  /** Non-secret fingerprint of the API, source and selected catalogue. */
  readonly cacheKey: string
  /**
   * Whether a source is available, including the default public Market.
   *
   * Composition knows this and a failed read does not, so it is passed in: a
   * storefront that is configured but unreachable must not report itself as
   * unconfigured, which would send the operator looking for the wrong problem.
   */
  readonly configured: boolean
}

/**
 * Wraps a storefront read in a last-good cache.
 *
 * Persistence goes through the standard settings service, matching how the
 * community market stores its catalog snapshot, so the storefront survives a
 * restart instead of paying for a cold read on every launch. The settings service
 * is optional: a composition without it keeps the cache in memory and still
 * works, rather than failing to load the plugin.
 *
 * A failed refresh never destroys what is already known. That matters more here
 * than freshness — a transient Market outage must not blank a storefront the user
 * was already browsing.
 */
export function createStorefrontCache(
  ctx: Context,
  read: () => Promise<StorefrontRead>,
  options: StorefrontCacheOptions,
): StorefrontCache {
  // Read through the service property, not `ctx.get`: `get` is strict about the
  // provider fiber being fully active and returned `undefined` during composition,
  // which silently downgraded this cache to memory-only (nothing was ever written to
  // the settings file). `settings` is a declared dependency, so it is present in any
  // composition that applied at all; the optional read only keeps the cache honest
  // for a trimmed or test context.
  const settings: SettingsProvider | undefined = ctx.settings
  const scope: SettingsScope<StorefrontCacheDocument> | undefined = settings?.register(
    STOREFRONT_NAMESPACE,
    StorefrontCacheSchema,
  )
  let memory: StorefrontSnapshot | undefined

  const persisted = (): StorefrontSnapshot | undefined => {
    if (scope === undefined) return undefined
    const stored = scope.get().storefront
    // Legacy snapshots have no source identity and must not hide the public Market.
    if (stored.version !== 2 || stored.cacheKey !== options.cacheKey
      || stored.configured !== options.configured || stored.savedAt === '') return undefined
    return {
      configured: stored.configured,
      entries: stored.entries.map(restore),
      unavailable: [...stored.unavailable],
      fetchedAt: stored.savedAt,
    }
  }

  const current = (): StorefrontSnapshot | undefined => memory ?? persisted()

  const commit = async (value: StorefrontRead, fetchedAt: string): Promise<StorefrontSnapshot> => {
    const snapshot: StorefrontSnapshot = {
      configured: value.configured,
      entries: value.entries,
      unavailable: value.unavailable,
      fetchedAt,
    }
    memory = snapshot
    if (scope !== undefined) {
      await scope.update({
        storefront: {
          version: 2,
          cacheKey: options.cacheKey,
          configured: value.configured,
          savedAt: fetchedAt,
          entries: value.entries.map(store),
          unavailable: [...value.unavailable],
        },
      })
    }
    return snapshot
  }

  return {
    async read(force = false) {
      const previous = current()
      if (!force && previous !== undefined && age(previous.fetchedAt) < STOREFRONT_TTL_MS) {
        return { ...previous, stale: false }
      }
      try {
        const fetchedAt = new Date().toISOString()
        return { ...await commit(await read(), fetchedAt), stale: false }
      } catch (cause) {
        const message = cause instanceof Error && cause.message.trim() !== ''
          ? cause.message
          : 'storefront refresh failed'
        if (previous !== undefined) return { ...previous, stale: true, error: message }
        return {
          configured: options.configured,
          entries: [],
          unavailable: [],
          fetchedAt: new Date().toISOString(),
          stale: true,
          error: message,
        }
      }
    },
  }
}
