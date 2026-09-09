import { LoomApiError, type LoomApi } from './loom-api.js'

const ACCOUNT_API_URL = 'https://api.shengsuanyun.com/user/info'
const MAX_ACCOUNT_RESPONSE_BYTES = 256 * 1024

export interface LoomAccount {
  readonly configured: boolean
  readonly uid?: string
  readonly displayName?: string
  readonly email?: string
  readonly photoUrl?: string
  readonly balance?: string
  readonly isCreator?: boolean
}

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized === '' ? undefined : normalized
}

function scalarText(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return text(value)
}

function userRecord(payload: unknown): JsonRecord {
  const root = record(payload)
  const data = record(root.data)
  return record(root.user ?? data.user ?? data)
}

function listingItems(payload: unknown): readonly unknown[] {
  const root = record(payload)
  const data = record(root.data)
  if (Array.isArray(root.items)) return root.items
  if (Array.isArray(data.items)) return data.items
  if (Array.isArray(root.listings)) return root.listings
  if (Array.isArray(data.listings)) return data.listings
  return []
}

function normalizeAccount(payload: unknown, isCreator?: boolean): LoomAccount {
  const user = userRecord(payload)
  const account: {
    configured: boolean
    uid?: string
    displayName?: string
    email?: string
    photoUrl?: string
    balance?: string
    isCreator?: boolean
  } = { configured: true }
  const uid = text(user.uid ?? user.id ?? user.userId)
  const displayName = text(user.displayName ?? user.display_name ?? user.name)
  const email = text(user.email ?? user.mail)
  const photoUrl = text(user.photoUrl ?? user.photo_url ?? user.avatar ?? user.avatarUrl)
  const balance = scalarText(user.balance ?? user.balanceAmount ?? user.availableBalance)
  if (uid !== undefined) account.uid = uid
  if (displayName !== undefined) account.displayName = displayName
  if (email !== undefined) account.email = email
  if (photoUrl !== undefined) account.photoUrl = photoUrl
  if (balance !== undefined) account.balance = balance
  if (isCreator !== undefined) account.isCreator = isCreator
  return account
}

function optionalRoleFailure(cause: unknown): boolean {
  return cause instanceof Error
    && 'status' in cause
    && ((cause as LoomApiError).status === 401 || (cause as LoomApiError).status === 403 || (cause as LoomApiError).status === 404)
}

/**
 * Reads only the user fields needed by the identity surface. The raw user
 * payload and credential remain in Host memory.
 */
export function createLoomAccountReader(api: LoomApi): () => Promise<LoomAccount> {
  return createLoomAccountReaderWithToken(api, async () => undefined)
}

export function createLoomAccountReaderWithToken(
  api: LoomApi,
  resolveToken: () => Promise<string | undefined>,
): () => Promise<LoomAccount> {
  return async () => {
    const token = await resolveToken()
    if (token === undefined || token.trim() === '') throw new Error('loomloom account is not configured')
    const response = await fetch(ACCOUNT_API_URL, {
      headers: {
        accept: 'application/json',
        'x-token': token.trim(),
      },
    })
    const body = await response.text()
    if (body.length > MAX_ACCOUNT_RESPONSE_BYTES) throw new Error('loomloom account response exceeded size limit')
    if (!response.ok) {
      throw new LoomApiError(response.status, 'loomloom account is unavailable')
    }
    let userPayload: unknown
    try {
      userPayload = JSON.parse(body)
    } catch {
      throw new Error('loomloom account returned invalid JSON')
    }
    let isCreator: boolean | undefined
    try {
      isCreator = listingItems(await api.request('/creators/me/marketListings?pageSize=1')).length > 0
    } catch (cause) {
      if (!optionalRoleFailure(cause)) isCreator = undefined
      else isCreator = false
    }
    return normalizeAccount(userPayload, isCreator)
  }
}
