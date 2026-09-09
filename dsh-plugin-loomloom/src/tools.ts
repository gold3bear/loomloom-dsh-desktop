import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-user-approval'
import { LoomApiError } from './loom-api.js'
import { LoomSkillbotService, type DraftToolValue, type ExecutionDraft, type MarketQuote, type SkillbotSummary, type SkillbotToolValue } from './skillbots.js'

const SKILLBOT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string' as const, required: true },
    name: { type: 'string' as const, required: true },
    description: { type: 'string' as const, required: true },
    available: { type: 'boolean' as const, required: true },
    fixedFee: { type: 'string' as const },
    versionId: { type: 'string' as const },
  },
} as const

function skillbotValue(skillbot: SkillbotSummary): SkillbotToolValue {
  return {
    id: skillbot.id,
    name: skillbot.name,
    description: skillbot.description,
    available: skillbot.available,
    ...(skillbot.fixedFee === undefined ? {} : { fixedFee: skillbot.fixedFee }),
    ...(skillbot.versionId === undefined ? {} : { versionId: skillbot.versionId }),
  }
}

function quoteValue(quote: MarketQuote): { readonly estimatedBuyerPayable: string, readonly currency?: string, readonly taskFixedFee?: string } {
  return {
    estimatedBuyerPayable: quote.estimatedBuyerPayable,
    ...(quote.currency === undefined ? {} : { currency: quote.currency }),
    ...(quote.taskFixedFee === undefined ? {} : { taskFixedFee: quote.taskFixedFee }),
  }
}

function draftValue(draft: ExecutionDraft): DraftToolValue {
  return {
    draftId: draft.id,
    expiresAt: draft.expiresAt,
    rowCount: draft.rowCount,
    skillbot: skillbotValue(draft.skillbot),
    quote: quoteValue(draft.quote),
  }
}

interface ExecutionToolArtifact {
  id: string
  label: string
  mimeType?: string
  accessUrl?: string
}

interface ExecutionToolValue {
  draftId: string
  accepted: boolean
  runId?: string
  status?: string
  pending?: boolean
  pollAttempts?: number
  totalRows?: number
  completedRows?: number
  failedRows?: number
  artifacts?: ExecutionToolArtifact[]
}

function executionResultValue(receipt: Awaited<ReturnType<LoomSkillbotService['execute']>>, poll: Awaited<ReturnType<LoomSkillbotService['pollRunUntilTerminal']>> | undefined, result: Awaited<ReturnType<LoomSkillbotService['getRunResults']>> | undefined): ExecutionToolValue {
  const value: ExecutionToolValue = {
    draftId: receipt.draftId,
    accepted: receipt.accepted,
    ...(receipt.runId === undefined ? {} : { runId: receipt.runId }),
    ...(receipt.status === undefined ? {} : { status: receipt.status }),
  }
  if (poll !== undefined) {
    value.status = poll.status
    value.pending = poll.pending
    value.pollAttempts = poll.attempts
  }
  if (result !== undefined) {
    value.totalRows = result.totalRows
    value.completedRows = result.completedRows
    value.failedRows = result.failedRows
    value.artifacts = result.artifacts.map(artifact => ({
      id: artifact.id,
      label: artifact.label,
      ...(artifact.mimeType === undefined ? {} : { mimeType: artifact.mimeType }),
      ...(artifact.accessUrl === undefined ? {} : { accessUrl: artifact.accessUrl }),
    }))
  }
  return value
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new LoomApiError(400, `${field} is required`)
  return value.trim()
}

function requireAgent(agent: object | undefined): object {
  if (agent === undefined) throw new LoomApiError(503, 'Loomloom execution is available only inside an active DSH chat session')
  return agent
}

export function registerLoomTools(ctx: Context, service: LoomSkillbotService): () => void {
  const disposers = [
    ctx.tools.register(defineTool({
      name: 'loomloom_list_skillbots',
      description: 'List available Loomloom SkillBots. Use this to discover an appropriate SkillBot before preparing an execution.',
      parameters: {},
      output: {
        schema: { type: 'array', items: SKILLBOT_SCHEMA },
        render: (_args, value) => [{
          type: 'text',
          text: value.length === 0
            ? 'No available Loomloom SkillBots were found.'
            : value.map(skillbot => `${skillbot.name} (${skillbot.id})${skillbot.fixedFee === undefined ? '' : ` — fixed fee ${skillbot.fixedFee}`}`).join('\n'),
        }],
      },
      async execute(_args, exec) {
        return (await service.list(exec.signal)).map(skillbotValue)
      },
    })),
    ctx.tools.register(defineTool({
      name: 'loomloom_get_skillbot',
      description: 'Get one Loomloom SkillBot including its input fields. Use before preparing an execution and ask the user for any missing required input.',
      parameters: {
        listing_id: { type: 'string', required: true, description: 'Opaque SkillBot listing id returned by loomloom_list_skillbots.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            skillbot: { ...SKILLBOT_SCHEMA, required: true },
            fields: {
              type: 'array', required: true,
              items: {
                type: 'object', additionalProperties: false,
                properties: {
                  key: { type: 'string', required: true },
                  label: { type: 'string', required: true },
                  required: { type: 'boolean', required: true },
                  valueType: { type: 'string', required: true },
                  description: { type: 'string' },
                  enumValues: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
        render: (_args, value) => [{ type: 'text', text: `${value.skillbot.name} accepts: ${value.fields.map(field => `${field.key}${field.required ? ' (required)' : ''}`).join(', ') || 'no declared fields'}` }],
      },
      async execute(args, exec) {
        const detail = await service.get(asString(args.listing_id, 'listing_id'), exec.signal)
        return {
          skillbot: skillbotValue(detail),
          fields: detail.fields.map(field => ({
            key: field.key,
            label: field.label,
            required: field.required,
            valueType: field.valueType,
            ...(field.description === undefined ? {} : { description: field.description }),
            ...(field.enumValues === undefined ? {} : { enumValues: [...field.enumValues] }),
          })),
        }
      },
    })),
    ctx.tools.register(defineTool({
      name: 'loomloom_prepare_execution',
      description: 'Validate Loomloom SkillBot inputs and create a short-lived execution draft. This tool has no side effect and never starts a paid run.',
      parameters: {
        listing_id: { type: 'string', required: true, description: 'Opaque SkillBot listing id.' },
        listing_version_id: { type: 'string', description: 'Optional opaque published version id.' },
        input_rows: { type: 'json', required: true, description: 'An array of 1-100 input objects matching the SkillBot input schema.' },
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            draftId: { type: 'string', required: true },
            expiresAt: { type: 'string', required: true },
            rowCount: { type: 'integer', required: true },
            skillbot: { ...SKILLBOT_SCHEMA, required: true },
            quote: {
              type: 'object', required: true, additionalProperties: false,
              properties: {
                estimatedBuyerPayable: { type: 'string', required: true },
                currency: { type: 'string' },
                taskFixedFee: { type: 'string' },
              },
            },
          },
        },
        render: (_args, value) => [{ type: 'text', text: `Prepared ${value.rowCount} row(s) for ${value.skillbot.name}. Market estimate: ${value.quote.estimatedBuyerPayable}${value.quote.currency === undefined ? ' (currency unknown)' : ` ${value.quote.currency}`}. Ask the user to confirm before calling loomloom_execute_skillbot. Draft expires at ${value.expiresAt}.` }],
      },
      async execute(args, exec) {
        const draft = await service.prepare(
          requireAgent(exec.agent),
          asString(args.listing_id, 'listing_id'),
          typeof args.listing_version_id === 'string' ? args.listing_version_id : undefined,
          args.input_rows,
          exec.signal,
        )
        return draftValue(draft)
      },
    })),
    ctx.tools.register(defineTool({
      name: 'loomloom_execute_skillbot',
      description: 'Request explicit user approval and, only when approved, execute a prepared Loomloom SkillBot draft. This may incur a fee.',
      parameters: {
        draft_id: { type: 'string', required: true, description: 'Short-lived draftId returned by loomloom_prepare_execution.' },
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            draftId: { type: 'string', required: true },
            accepted: { type: 'boolean', required: true },
            runId: { type: 'string' },
            status: { type: 'string' },
            pending: { type: 'boolean' },
            pollAttempts: { type: 'integer' },
            totalRows: { type: 'integer' },
            completedRows: { type: 'integer' },
            failedRows: { type: 'integer' },
            artifacts: {
              type: 'array',
              items: {
                type: 'object', additionalProperties: false,
                properties: {
                  id: { type: 'string', required: true },
                  label: { type: 'string', required: true },
                  mimeType: { type: 'string' },
                  accessUrl: { type: 'string' },
                },
              },
            },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: value.runId === undefined
            ? 'Loomloom accepted the execution request.'
            : value.pending === true
              ? `Loomloom accepted the execution request. Run ID: ${value.runId} is still ${value.status ?? 'pending'}; polling stopped before completion.`
              : `Loomloom run ${value.runId} finished with status ${value.status ?? 'unknown'}${value.completedRows === undefined ? '' : ` (${value.completedRows}/${value.totalRows} rows completed, ${value.failedRows} failed)`}.`,
        }],
      },
      async execute(args, exec) {
        const agent = requireAgent(exec.agent)
        const draftId = asString(args.draft_id, 'draft_id')
        const draft = service.describeDraft(draftId, agent)
        if (draft === undefined) throw new LoomApiError(404, 'execution draft is unavailable or expired')
        const approval = ctx.get('approval')
        if (approval === undefined) throw new LoomApiError(503, 'DSH user approval is unavailable; execution is blocked')
        const estimate = `${draft.quote.estimatedBuyerPayable}${draft.quote.currency === undefined ? ' (currency unknown)' : ` ${draft.quote.currency}`}`
        const outcome = await approval.request({
          agent: exec.agent!,
          toolName: 'loomloom_execute_skillbot',
          callId: exec.callId,
          reason: `Execute ${draft.skillbot.name} for ${draft.rowCount} row(s). Market estimate: ${estimate}.`,
          signal: exec.signal,
        })
        if (outcome !== 'allowed-once') throw new LoomApiError(403, 'Loomloom execution was not approved by the user')
        const receipt = await service.execute(agent, draftId, exec.signal)
        if (receipt.runId === undefined) return executionResultValue(receipt, undefined, undefined)
        const poll = await service.pollRunUntilTerminal(receipt.runId, {}, exec.signal)
        if (!poll.terminal) return executionResultValue(receipt, poll, undefined)
        const result = await service.getRunResults(receipt.runId, exec.signal)
        return executionResultValue(receipt, poll, result)
      },
    })),
    ctx.tools.register(defineTool({
      name: 'loomloom_get_run',
      description: 'Get the current status and display name of a Loomloom SkillBot run.',
      parameters: { run_id: { type: 'string', required: true, description: 'Opaque Loomloom run id.' } },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            runId: { type: 'string', required: true },
            status: { type: 'string', required: true },
            displayName: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: `${value.displayName}: ${value.status} (${value.runId})` }],
      },
      execute(args, exec) {
        return service.getRun(asString(args.run_id, 'run_id'), exec.signal)
      },
    })),
    ctx.tools.register(defineTool({
      name: 'loomloom_get_run_results',
      description: 'Get a Loomloom run result summary and its output artifacts after or while a SkillBot run completes. Do not expose input rows.',
      parameters: { run_id: { type: 'string', required: true, description: 'Opaque Loomloom run id.' } },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            runId: { type: 'string', required: true }, status: { type: 'string', required: true },
            totalRows: { type: 'integer', required: true }, completedRows: { type: 'integer', required: true }, failedRows: { type: 'integer', required: true },
            artifacts: {
              type: 'array', required: true,
              items: {
                type: 'object', additionalProperties: false,
                properties: {
                  id: { type: 'string', required: true }, label: { type: 'string', required: true },
                  mimeType: { type: 'string' }, accessUrl: { type: 'string' },
                },
              },
            },
          },
        },
        render: (_args, value) => [{ type: 'text', text: `${value.status}: ${value.completedRows}/${value.totalRows} completed, ${value.failedRows} failed. ${value.artifacts.length} output artifact(s) available.` }],
      },
      async execute(args, exec) {
        const result = await service.getRunResults(asString(args.run_id, 'run_id'), exec.signal)
        return {
          runId: result.runId,
          status: result.status,
          totalRows: result.totalRows,
          completedRows: result.completedRows,
          failedRows: result.failedRows,
          artifacts: result.artifacts.map(artifact => ({
            id: artifact.id,
            label: artifact.label,
            ...(artifact.mimeType === undefined ? {} : { mimeType: artifact.mimeType }),
            ...(artifact.accessUrl === undefined ? {} : { accessUrl: artifact.accessUrl }),
          })),
        }
      },
    })),
  ]
  return () => disposers.forEach(dispose => dispose())
}
