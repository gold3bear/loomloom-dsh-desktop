import type { Context } from '@deepseek-ai/cordis'
import { credentialKey, credentialRef, type CredentialRecord } from '@deepseek-ai/dsh-credentials'
import type { ResolvedLoomConfig } from './loom-api.js'

const LOOMLOOM_CREDENTIAL_KEY = credentialKey('loomloom', 'shengsuanyun')

export interface LoomCredentialStatus {
  readonly configured: boolean
  /** A non-secret origin hint, used only by the local DSH settings UI. */
  readonly source?: 'development-token' | 'reference' | 'authorization-grant'
  /** Last four characters of the shared key, for an explicit identity fallback. */
  readonly maskedToken?: string
}

function maskToken(token: string): string {
  const normalized = token.trim()
  return normalized.length < 4 ? '····' : `····${normalized.slice(-4)}`
}

function tokenFromRecord(record: CredentialRecord | undefined): string | undefined {
  if (record?.kind !== 'grant' || typeof record.payload !== 'object' || record.payload === null) return undefined
  const token = (record.payload as Record<string, unknown>).token
  return typeof token === 'string' && token.trim() !== '' ? token.trim() : undefined
}

function identityTokenFromRecord(record: CredentialRecord | undefined): string | undefined {
  if (record?.kind !== 'grant' || typeof record.payload !== 'object' || record.payload === null) return undefined
  const token = (record.payload as Record<string, unknown>).identityToken
  return typeof token === 'string' && token.trim() !== '' ? token.trim() : undefined
}

function grantPayload(record: CredentialRecord | undefined): Record<string, unknown> {
  return record?.kind === 'grant' && typeof record.payload === 'object' && record.payload !== null && !Array.isArray(record.payload)
    ? { ...record.payload as Record<string, unknown> }
    : {}
}

/** Resolves a fresh secret for every upstream request; values never cross the Client boundary. */
export function createLoomTokenResolver(ctx: Context, config: ResolvedLoomConfig): () => Promise<string | undefined> {
  const ref = credentialRef(config.tokenRef)
  return async () => {
    if (config.token !== undefined) return config.token
    const referenced = await ctx.credentials.resolve(ref)
    if (referenced !== undefined) return referenced.value
    const records = ctx.credentials as typeof ctx.credentials & {
      readRecord?: (key: typeof LOOMLOOM_CREDENTIAL_KEY) => Promise<CredentialRecord | undefined>
    }
    return records.readRecord === undefined ? undefined : tokenFromRecord(await records.readRecord(LOOMLOOM_CREDENTIAL_KEY))
  }
}

/** Reads the browser-only JWT used exclusively for the account profile endpoint. */
export function createLoomIdentityTokenResolver(ctx: Context): () => Promise<string | undefined> {
  const records = ctx.credentials as typeof ctx.credentials & {
    readRecord?: (key: typeof LOOMLOOM_CREDENTIAL_KEY) => Promise<CredentialRecord | undefined>
  }
  return async () => records.readRecord === undefined
    ? undefined
    : identityTokenFromRecord(await records.readRecord(LOOMLOOM_CREDENTIAL_KEY))
}

/**
 * Persist the common ShengSuanYun key under its credential reference.  DSH's
 * custom provider UI derives the same reference from provider id
 * `shengsuanyun`, so the Market and chat adapters resolve one stored value.
 * Plugin-owned grant records remain read-only migration fallbacks.
 */
export async function storeLoomToken(ctx: Context, config: ResolvedLoomConfig, token: string): Promise<void> {
  await ctx.credentials.set(credentialRef(config.tokenRef), token)
}

/** Replaces the profile JWT without exposing it through a shared key reference. */
export async function replaceLoomIdentityToken(ctx: Context, token: string | undefined): Promise<void> {
  const records = ctx.credentials as typeof ctx.credentials & {
    modifyRecord?: (
      key: typeof LOOMLOOM_CREDENTIAL_KEY,
      mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
    ) => Promise<CredentialRecord | undefined>
  }
  // Compatibility with the first desktop runtime, which did not expose record writes.
  if (records.modifyRecord === undefined) return
  await records.modifyRecord(LOOMLOOM_CREDENTIAL_KEY, async current => {
    const payload = grantPayload(current)
    if (token === undefined) delete payload.identityToken
    else payload.identityToken = token
    return Object.keys(payload).length === 0 ? undefined : { kind: 'grant', payload }
  })
}

/** Remove the common reference and any legacy plugin grant during explicit logout. */
export async function clearLoomToken(ctx: Context, config: ResolvedLoomConfig): Promise<void> {
  if (config.token !== undefined) throw new Error('development token cannot be cleared from the desktop UI')
  await ctx.credentials.unset(credentialRef(config.tokenRef))
  const records = ctx.credentials as typeof ctx.credentials & {
    deleteRecord?: (key: typeof LOOMLOOM_CREDENTIAL_KEY) => Promise<void>
  }
  if (records.deleteRecord !== undefined) await records.deleteRecord(LOOMLOOM_CREDENTIAL_KEY)
}

/** Returns only credential presence/origin facts. Secret values never cross this boundary. */
export function createLoomCredentialStatusReader(
  ctx: Context,
  config: ResolvedLoomConfig,
): () => Promise<LoomCredentialStatus> {
  const ref = credentialRef(config.tokenRef)
  return async () => {
    if (config.token !== undefined) return { configured: true, source: 'development-token', maskedToken: maskToken(config.token) }
    const reference = await ctx.credentials.describe(ref)
    if (reference.configured) {
      const credentials = ctx.credentials as typeof ctx.credentials & {
        resolve?: (key: ReturnType<typeof credentialRef>) => Promise<{ readonly value: string } | undefined>
      }
      const resolved = credentials.resolve === undefined ? undefined : await credentials.resolve(ref)
      return {
        configured: true,
        source: 'reference',
        ...(resolved?.value === undefined ? {} : { maskedToken: maskToken(resolved.value) }),
      }
    }
    // DSH 0.1.0-rc.7 exposes readRecord but not describeRecord. This Host-only
    // read is reduced immediately to presence; no payload is returned to the Client.
    const records = ctx.credentials as typeof ctx.credentials & {
      readRecord?: (key: typeof LOOMLOOM_CREDENTIAL_KEY) => Promise<CredentialRecord | undefined>
    }
    const grant = records.readRecord === undefined ? undefined : await records.readRecord(LOOMLOOM_CREDENTIAL_KEY)
    const token = tokenFromRecord(grant)
    return token !== undefined
      ? { configured: true, source: 'authorization-grant', maskedToken: maskToken(token) }
      : { configured: false }
  }
}

export { LOOMLOOM_CREDENTIAL_KEY }
