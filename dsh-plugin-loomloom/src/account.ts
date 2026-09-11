import { LoomApiError, type LoomApi } from './loom-api.js'

const ACCOUNT_API_URL = 'https://api.shengsuanyun.com/user/info'
const MAX_ACCOUNT_RESPONSE_BYTES = 256 * 1024
const ACCOUNT_TIMEOUT_MS = 10_000

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

const IDENTITY_FIELDS = [
  'uid', 'id', 'userId', 'ID', 'UserID',
  'displayName', 'display_name', 'name',
  'Nickname', 'NickName', 'nickname', 'nickName', 'nick_name',
  'Username', 'UserName', 'username', 'userName', 'user_name',
] as const

const IDENTITY_ENVELOPES = [
  'data', 'Data', 'user', 'User', 'userInfo', 'UserInfo', 'userinfo',
  'profile', 'Profile', 'account', 'Account', 'result', 'Result',
] as const

function isIdentityRecord(value: JsonRecord): boolean {
  return IDENTITY_FIELDS.some(field => field in value)
}

/**
 * The ShengSuanYun account endpoint has several deployed envelope variants.
 * We traverse only recognized envelope names and return a record only when it
 * contains an approved identity field; arbitrary upstream data never escapes.
 */
function userRecord(payload: unknown): JsonRecord {
  const queue: unknown[] = [payload]
  const visited = new Set<object>()
  while (queue.length > 0) {
    const candidate = queue.shift()
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate) || visited.has(candidate)) continue
    visited.add(candidate)
    const current = candidate as JsonRecord
    if (isIdentityRecord(current)) return current
    for (const key of IDENTITY_ENVELOPES) queue.push(current[key])
  }
  return {}
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
  // `/user/info` predates the Loom API and uses PascalCase fields for many
  // accounts. Keep the same display precedence as the legacy desktop client.
  const uid = text(user.uid ?? user.id ?? user.userId ?? user.ID ?? user.UserID)
  const displayName = text(
    user.displayName ?? user.display_name ?? user.name
      ?? user.Nickname ?? user.NickName ?? user.nickname ?? user.nickName ?? user.nick_name
      ?? user.Username ?? user.UserName ?? user.username ?? user.userName ?? user.user_name,
  )
  const email = text(user.email ?? user.mail ?? user.Email)
  const photoUrl = text(user.photoUrl ?? user.photo_url ?? user.avatar ?? user.avatarUrl ?? user.HeadImg)
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

async function boundedAccountBody(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declared) && declared > MAX_ACCOUNT_RESPONSE_BYTES) {
    await response.body?.cancel()
    throw new Error('loomloom account response exceeded size limit')
  }
  const reader = response.body?.getReader()
  if (reader === undefined) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const next = await reader.read()
    if (next.done) break
    size += next.value.byteLength
    if (size > MAX_ACCOUNT_RESPONSE_BYTES) {
      await reader.cancel()
      throw new Error('loomloom account response exceeded size limit')
    }
    chunks.push(next.value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
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
  resolveIdentityToken: () => Promise<string | undefined> = resolveToken,
): () => Promise<LoomAccount> {
  return async () => {
    const token = await resolveIdentityToken()
    // A browser grant may contain only the shared API key. Keep the connection
    // usable and let the Client render its masked-key identity fallback rather
    // than treating missing profile JWT data as a logged-out state.
    if (token === undefined || token.trim() === '') return { configured: true }
    const responsePromise = fetch(ACCOUNT_API_URL, {
      headers: {
        accept: 'application/json',
        'x-token': token.trim(),
      },
      signal: AbortSignal.timeout(ACCOUNT_TIMEOUT_MS),
    })
    const creatorPromise = api.request('/creators/me/marketListings?pageSize=1')
      .then(payload => listingItems(payload).length > 0)
      .catch(cause => {
        if (optionalRoleFailure(cause)) return false
        return undefined
      })
    const response = await responsePromise
    const body = await boundedAccountBody(response)
    if (!response.ok) {
      throw new LoomApiError(response.status, 'loomloom account is unavailable')
    }
    let userPayload: unknown
    try {
      userPayload = JSON.parse(body)
    } catch {
      throw new Error('loomloom account returned invalid JSON')
    }
    const envelope = record(userPayload)
    if (typeof envelope.code === 'number' && envelope.code !== 0) {
      throw new LoomApiError(401, 'loomloom account identity is unavailable')
    }
    const isCreator = await creatorPromise
    return normalizeAccount(userPayload, isCreator)
  }
}
