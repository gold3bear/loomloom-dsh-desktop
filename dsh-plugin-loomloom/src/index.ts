import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
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
import { resolveDefaultSkillRoot } from './skill-package.js'
import { LoomSkillbotService } from './skillbots.js'
import { createStorefrontCache } from './storefront-cache.js'
import { createStorefrontReader, envSecret, storefrontCacheKey, storefrontSourceFor } from './storefront.js'
import { registerLoomTools } from './tools.js'

export const name = 'loomloom'
// `settings` backs the storefront cache. It is a hard dependency on purpose: a
// silently memory-only cache would re-read the Market on every launch with no
// way for anyone to tell that persistence had stopped working.
export const inject = ['webServer', 'tools', 'systemPrompt', 'credentials', 'authorization', 'agentDefaultModel', 'settings']

const LOOMLOOM_INTERACTION_POLICY = [
  'When the user asks to invoke a Loomloom SkillBot, follow the SkillBot input protocol exactly:',
  '1. Call loomloom_get_skillbot first and use its returned fields, required flags, descriptions and enum values as the source of truth.',
  '2. If no input row was supplied, or any required field is missing, call ask_user_question. Do not ask the same questions as ordinary assistant prose, skip the interaction, invent values or guess answers.',
  '3. Wait for ask_user_question to return and map its answers into input_rows. Do not call loomloom_prepare_execution before the answers are returned.',
  '4. Call loomloom_prepare_execution only after the inputs are complete. Report the quote and wait for explicit user approval before calling loomloom_execute_skillbot.',
  '5. If ask_user_question is unavailable, state that interactive input is unavailable and stop the SkillBot flow; do not fall back to plain-text questions or continue execution.',
].join('\n')

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
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'loomloom:interaction-policy',
    order: 2950,
    text: LOOMLOOM_INTERACTION_POLICY,
  }), 'loomloom: interaction policy')
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
        skillbots,
        skillRoot: () => resolveDefaultSkillRoot(),
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
