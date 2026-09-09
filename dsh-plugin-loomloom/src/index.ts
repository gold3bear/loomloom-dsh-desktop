import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-credentials'
import { registerLoomAuthorization } from './authorization.js'
import { createLoomAccountReaderWithToken } from './account.js'
import { createLoomBootstrapReader } from './bootstrap.js'
import { LoomBrowserLoginService } from './browser-login.js'
import { clearLoomToken, createLoomCredentialStatusReader, createLoomTokenResolver } from './credentials.js'
import { LoomApi, resolveLoomConfig, type LoomConfig } from './loom-api.js'
import { registerLoomRoutes } from './routes.js'
import { LoomSkillbotService } from './skillbots.js'
import { registerLoomTools } from './tools.js'

export const name = 'loomloom'
export const inject = ['webServer', 'tools', 'credentials', 'authorization', 'agentDefaultModel']

export function apply(ctx: Context, config: LoomConfig = {}): void {
  const resolved = resolveLoomConfig(config)
  const resolveToken = createLoomTokenResolver(ctx, resolved)
  const readCredentialStatus = createLoomCredentialStatusReader(ctx, resolved)
  const api = new LoomApi(resolved, resolveToken)
  const skillbots = new LoomSkillbotService(api)
  const browserLogin = new LoomBrowserLoginService(ctx, resolved)
  ctx.effect(() => {
    const disposeRoutes = registerLoomRoutes(
      ctx,
      api,
      readCredentialStatus,
      browserLogin,
      () => clearLoomToken(ctx, resolved),
      createLoomBootstrapReader(ctx, resolved, readCredentialStatus, resolveToken),
      createLoomAccountReaderWithToken(api, resolveToken),
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
