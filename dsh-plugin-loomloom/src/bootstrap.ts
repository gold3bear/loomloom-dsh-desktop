import type { Context } from '@deepseek-ai/cordis'
import { verifyLoomCredential, verifyShengsuanyunRouterCredential } from './browser-auth.js'
import type { LoomCredentialStatus } from './credentials.js'
import { SHENGSUANYUN_PROVIDER } from './default-model.js'
import type { ResolvedLoomConfig } from './loom-api.js'

const VALIDATION_TIMEOUT_MS = 10_000

export interface LoomBootstrap {
  readonly credential: Readonly<{ readonly configured: boolean }>
  readonly loom: 'unknown' | 'ready' | 'unavailable'
  readonly router: 'unknown' | 'ready' | 'unavailable'
  readonly model: Readonly<{
    readonly provider: typeof SHENGSUANYUN_PROVIDER
    readonly id?: string
    readonly ready: boolean
  }>
}

interface AgentDefaultModelService {
  currentSelection(): {
    readonly provider: string
    readonly model: string
  }
}

async function availability(run: (signal: AbortSignal) => Promise<void>): Promise<boolean> {
  try {
    await run(AbortSignal.timeout(VALIDATION_TIMEOUT_MS))
    return true
  } catch {
    return false
  }
}

async function availableModels(run: (signal: AbortSignal) => Promise<readonly string[]>): Promise<readonly string[] | undefined> {
  try {
    return await run(AbortSignal.timeout(VALIDATION_TIMEOUT_MS))
  } catch {
    return undefined
  }
}

export function createLoomBootstrapReader(
  ctx: Context,
  config: ResolvedLoomConfig,
  readCredentialStatus: () => Promise<LoomCredentialStatus>,
  resolveToken: () => Promise<string | undefined>,
): () => Promise<LoomBootstrap> {
  return async () => {
    const status = await readCredentialStatus()
    const credential = { configured: status.configured }
    if (!status.configured) {
      return {
        credential,
        loom: 'unknown',
        router: 'unknown',
        model: { provider: SHENGSUANYUN_PROVIDER, ready: false },
      }
    }

    const token = await resolveToken()
    if (token === undefined) {
      return {
        credential,
        loom: 'unavailable',
        router: 'unavailable',
        model: { provider: SHENGSUANYUN_PROVIDER, ready: false },
      }
    }

    const [loomReady, modelIds] = await Promise.all([
      availability(signal => verifyLoomCredential(token, config, signal)),
      availableModels(signal => verifyShengsuanyunRouterCredential(token, signal)),
    ])
    const selection = (ctx.get('agentDefaultModel') as AgentDefaultModelService | undefined)?.currentSelection()
    const selectedModel = selection?.provider === SHENGSUANYUN_PROVIDER ? selection.model : undefined
    const modelReady = modelIds !== undefined
      && selectedModel !== undefined
      && modelIds.includes(selectedModel)

    return {
      credential,
      loom: loomReady ? 'ready' : 'unavailable',
      router: modelIds === undefined ? 'unavailable' : 'ready',
      model: {
        provider: SHENGSUANYUN_PROVIDER,
        ...(selectedModel === undefined ? {} : { id: selectedModel }),
        ready: modelReady,
      },
    }
  }
}
