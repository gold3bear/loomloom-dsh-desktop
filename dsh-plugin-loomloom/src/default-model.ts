import type { Context } from '@deepseek-ai/cordis'

export const SHENGSUANYUN_PROVIDER = 'shengsuanyun'
export const SHENGSUANYUN_DEFAULT_MODEL = 'deepseek-v4-flash'

interface AgentDefaultModelService {
  currentSelection(): {
    readonly provider: string
    readonly model: string
  }
  saveSelection(selection: {
    readonly provider: string
    readonly model: string
  }): Promise<void>
}

/**
 * Persist the post-login default through DSH's first-class selection service.
 * This is intentionally separate from the provider route: user settings take
 * precedence over Cordis composition, so only a successful explicit Loomloom
 * authorization may replace a pre-existing model choice.
 */
export async function selectShengsuanyunDefaultModel(ctx: Context): Promise<void> {
  const service = ctx.get('agentDefaultModel') as AgentDefaultModelService | undefined
  if (service === undefined) throw new Error('DSH default-model service is unavailable')
  await service.saveSelection({
    provider: SHENGSUANYUN_PROVIDER,
    model: SHENGSUANYUN_DEFAULT_MODEL,
  })
}

export function currentShengsuanyunModel(ctx: Context): string | undefined {
  const service = ctx.get('agentDefaultModel') as AgentDefaultModelService | undefined
  const selection = service?.currentSelection()
  return selection?.provider === SHENGSUANYUN_PROVIDER ? selection.model : undefined
}
