import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-settings'
import { registerLoomAuthorization } from './authorization.js'
import { createLoomAccountReaderWithToken } from './account.js'
import { createLoomBootstrapReader } from './bootstrap.js'
import { LoomBrowserLoginService } from './browser-login.js'
import { clearLoomToken, createLoomCredentialStatusReader, createLoomIdentityTokenResolver, createLoomTokenResolver } from './credentials.js'
import { LoomApi, resolveLoomConfig, type LoomConfig } from './loom-api.js'
import { registerLoomRoutes } from './routes.js'
import { LoomSkillbotService } from './skillbots.js'
import { createStorefrontCache } from './storefront-cache.js'
import { createStorefrontReader, envSecret, storefrontCacheKey, storefrontSourceFor } from './storefront.js'
import { registerLoomTools } from './tools.js'

export const name = 'loomloom'
// `settings` backs the storefront cache. It is a hard dependency on purpose: a
// silently memory-only cache would re-read the Market on every launch with no
// way for anyone to tell that persistence had stopped working.
export const inject = ['webServer', 'tools', 'credentials', 'authorization', 'agentDefaultModel', 'settings']

export function apply(ctx: Context, config: LoomConfig = {}): void {
  const resolved = resolveLoomConfig(config)
  const resolveToken = createLoomTokenResolver(ctx, resolved)
  const resolveIdentityToken = createLoomIdentityTokenResolver(ctx)
  const readCredentialStatus = createLoomCredentialStatusReader(ctx, resolved)
  const api = new LoomApi(resolved, resolveToken)
  const skillbots = new LoomSkillbotService(api)
  const browserLogin = new LoomBrowserLoginService(ctx, resolved)
  // Creator mode: the credential is read once at composition, because a process
  // environment cannot change under a running generation. It is used only to
  // discover which listings are the creator's; every detail read stays anonymous.
  const creatorKey = envSecret(process.env, resolved.creatorKeyEnv)
  const storefrontSource = storefrontSourceFor(resolved, creatorKey)
  if (resolved.creatorKeyEnv !== undefined && creatorKey === undefined) {
    ctx.logger.warn(`loomloom: creatorKeyEnv is "${resolved.creatorKeyEnv}" but that environment variable is not set; using the public Market catalogue`)
  }
  const creatorApi = creatorKey === undefined ? null : new LoomApi(resolved, async () => creatorKey)
  const publicApi = new LoomApi(resolved, async () => undefined)
  // One line per generation: that the plugin applied at all, and which storefront
  // source is live. Without it an empty market is indistinguishable from a plugin
  // that never loaded.
  ctx.logger.info(
    `loomloom: storefront source=${storefrontSource}`
    + ` pinned=${String(resolved.storefrontListingIds.length)}`
    + (resolved.creatorKeyEnv === undefined ? '' : ` creatorKeyEnv=${resolved.creatorKeyEnv}`),
  )
  ctx.effect(() => {
    const disposeRoutes = registerLoomRoutes(
      ctx,
      api,
      readCredentialStatus,
      browserLogin,
      () => clearLoomToken(ctx, resolved),
      createLoomBootstrapReader(ctx, resolved, readCredentialStatus, resolveToken),
      createLoomAccountReaderWithToken(api, resolveToken, resolveIdentityToken),
      {
        storefront: createStorefrontCache(
          ctx,
          createStorefrontReader(publicApi, resolved, storefrontSource === 'public'
            ? { publicMarket: true }
            : storefrontSource === 'creator' ? { creator: creatorApi } : {}),
          { configured: true, cacheKey: storefrontCacheKey(resolved, creatorKey) },
        ),
        storefrontSource,
      },
    )
    return async () => {
      disposeRoutes()
      await browserLogin.dispose()
    }
  }, 'loomloom: host routes')
  ctx.effect(() => registerLoomTools(ctx, skillbots), 'loomloom: DSH tools')
  ctx.effect(() => registerLoomAuthorization(ctx, resolved), 'loomloom: credential authorization')
}

export { LoomApi, LoomApiError, resolveLoomConfig } from './loom-api.js'
export { LoomSkillbotService } from './skillbots.js'
export type { LoomConfig } from './loom-api.js'
