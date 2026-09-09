import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-authorization'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { beginBrowserAuthorization, verifyBrowserCredential } from './browser-auth.js'
import { clearLoomToken, LOOMLOOM_CREDENTIAL_KEY, storeLoomToken } from './credentials.js'
import { selectShengsuanyunDefaultModel, SHENGSUANYUN_DEFAULT_MODEL } from './default-model.js'
import type { ResolvedLoomConfig } from './loom-api.js'

async function verifyAndStore(ctx: Context, config: ResolvedLoomConfig, token: string, signal: AbortSignal): Promise<void> {
  const modelIds = await verifyBrowserCredential(token, config, signal)
  const previous = await ctx.credentials.resolve(credentialRef(config.tokenRef))
  await storeLoomToken(ctx, config, token)
  if (!modelIds.includes(SHENGSUANYUN_DEFAULT_MODEL)) return
  try {
    await selectShengsuanyunDefaultModel(ctx)
  } catch (cause) {
    if (previous === undefined) await clearLoomToken(ctx, config)
    else await storeLoomToken(ctx, config, previous.value)
    throw cause
  }
}

/**
 * Registers DSH's browser-first PKCE login plus its explicit API-token fallback.
 */
export function registerLoomAuthorization(ctx: Context, config: ResolvedLoomConfig): () => void {
  const authorization = ctx.get('authorization')
  if (authorization === undefined) return () => {}
  return authorization.registerFlow({
    key: LOOMLOOM_CREDENTIAL_KEY,
    label: 'Loomloom / 胜算云',
    methods: [
      { id: 'browser', label: '在浏览器中登录胜算云（推荐）' },
      { id: 'api-token', label: '粘贴胜算云 API Key' },
    ],
    async run(session) {
      if (session.method === 'browser') {
        const browser = await beginBrowserAuthorization(session.signal)
        session.notify({ message: '请在浏览器中完成胜算云授权；DSH 会在回环回调后验证并安全保存凭据。', url: browser.url })
        const token = await browser.result
        await verifyAndStore(ctx, config, token, session.signal)
        return
      }
      if (session.method !== 'api-token') throw new Error('不支持的 Loomloom 授权方式')
      const token = (await session.prompt({
        kind: 'secret',
      message: '请输入胜算云 API Key。它将作为 Loomloom Market 与 DSH 模型 Provider 的共同凭据保存，不会显示在聊天或日志中。',
      })).trim()
      if (token === '') throw new Error('胜算云 API Key 不能为空')
      await verifyAndStore(ctx, config, token, session.signal)
    },
  })
}
