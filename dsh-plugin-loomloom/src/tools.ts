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
  inlineText?: string
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
      ...(artifact.inlineText === undefined ? {} : { inlineText: artifact.inlineText }),
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
      description: 'List the first page of available Loomloom SkillBots for fast browsing. When a keyword is provided, scan the bounded market dataset and match locally by title, description and id.',
      parameters: {
        keyword: { type: 'string', description: 'Optional keyword matched locally against the full dataset (listing title, description and id; case-insensitive; multiple whitespace-separated terms are ranked by how many match).' },
      },
      output: {
        schema: { type: 'array', items: SKILLBOT_SCHEMA },
        render: (_args, value) => [{
          type: 'text',
          text: value.length === 0
            ? 'No available Loomloom SkillBots were found.'
            : value.map(skillbot => `${skillbot.name} (${skillbot.id})${skillbot.fixedFee === undefined ? '' : ` — fixed fee ${skillbot.fixedFee}`}`).join('\n'),
        }],
      },
      async execute(args, exec) {
        const options: { keyword?: string } = {}
        if (typeof args.keyword === 'string') options.keyword = args.keyword
        return (await service.list(exec.signal, options)).map(skillbotValue)
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
        render: (_args, value) => [{ type: 'text', text: `Prepared ${value.rowCount} row(s) for ${value.skillbot.name}. Market estimate: ${value.quote.estimatedBuyerPayable}${value.quote.currency === undefined ? ' (currency unknown)' : ` ${value.quote.currency}`}. Do NOT reuse the listing id: the execution draft id is ${value.draftId}. Ask the user to confirm before calling loomloom_execute_skillbot with draft_id=${value.draftId}. Draft expires at ${value.expiresAt}.` }],
      },
      async execute(args, exec) {
        const draft = await service.prepare(
          requireAgent(exec.agent),
          asString(args.listing_id, 'listing_id'),
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
                  inlineText: { type: 'string' },
                },
              },
            },
          },
        },
        render: (_args, value) => {
          const blocks: { type: 'text', text: string }[] = [{
            type: 'text',
            text: value.runId === undefined
              ? 'Loomloom accepted the execution request.'
              : value.pending === true
                ? `Loomloom accepted the execution request. Run ID: ${value.runId} is still ${value.status ?? 'pending'}; polling stopped before completion.`
                : `Loomloom run ${value.runId} finished with status ${value.status ?? 'unknown'}${value.completedRows === undefined ? '' : ` (${value.completedRows}/${value.totalRows} rows completed, ${value.failedRows} failed)`}.`,
          }]
          for (const artifact of value.artifacts ?? []) {
            if (typeof artifact.inlineText !== 'string' || artifact.inlineText.trim() === '') continue
            blocks.push({ type: 'text', text: `--- ${artifact.label} ---\n${artifact.inlineText}` })
          }
          return blocks
        },
      },
      async execute(args, exec) {
        const agent = requireAgent(exec.agent)
        const draftId = asString(args.draft_id, 'draft_id')
        const draft = service.describeDraft(draftId, agent)
        if (draft === undefined) throw new LoomApiError(404, `execution draft "${draftId}" is unavailable or expired (it must be the draft_id returned by loomloom_prepare_execution, not the listing id)`)
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
                  mimeType: { type: 'string' }, accessUrl: { type: 'string' }, inlineText: { type: 'string' },
                },
              },
            },
          },
        },
        render: (_args, value) => {
          const blocks: { type: 'text', text: string }[] = [{
            type: 'text',
            text: `${value.status}: ${value.completedRows}/${value.totalRows} completed, ${value.failedRows} failed. ${value.artifacts.length} output artifact(s) available.`,
          }]
          for (const artifact of value.artifacts) {
            if (typeof artifact.inlineText !== 'string' || artifact.inlineText.trim() === '') continue
            blocks.push({ type: 'text', text: `--- ${artifact.label} ---\n${artifact.inlineText}` })
          }
          return blocks
        },
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
            ...(artifact.inlineText === undefined ? {} : { inlineText: artifact.inlineText }),
          })),
        }
      },
    })),
    ctx.tools.register(defineTool({
      name: 'loomloom_get_balance',
      description: 'Read the current Loomloom settled balance snapshot for the signed-in account. Use it before preparing a paid execution when cost matters.',
      parameters: {},
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            currency: { type: 'string' },
            availableBalance: { type: 'string' },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: value.availableBalance === undefined
            ? 'Loomloom did not return an available balance.'
            : `Available balance: ${value.availableBalance}${value.currency === undefined ? ' (currency unknown)' : ` ${value.currency}`}`,
        }],
      },
      async execute(_args, exec) {
        const balance = await service.getBalance(exec.signal)
        return {
          ...(balance.currency === undefined ? {} : { currency: balance.currency }),
          ...(balance.availableBalance === undefined ? {} : { availableBalance: balance.availableBalance }),
        }
      },
    })),
    ctx.tools.register(defineTool({
      name: 'loomloom_list_my_listings',
      description: 'List the Market listings owned by the signed-in creator account, including sale status, review status and fixed fee. Read-only.',
      parameters: {},
      output: {
        schema: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              id: { type: 'string', required: true },
              name: { type: 'string', required: true },
              description: { type: 'string', required: true },
              available: { type: 'boolean', required: true },
              status: { type: 'string' },
              saleStatus: { type: 'string' },
              fixedFee: { type: 'string' },
              currency: { type: 'string' },
              listingVersionId: { type: 'string' },
              publishedVersionId: { type: 'string' },
              reviewStatus: { type: 'string' },
              reviewReason: { type: 'string' },
            },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: value.length === 0
            ? 'This account owns no Market listings.'
            : value.map(listing => `${listing.name} (${listing.id})${listing.saleStatus === undefined ? '' : ` — ${listing.saleStatus}`}${listing.reviewStatus === undefined ? '' : ` / review ${listing.reviewStatus}`}${listing.fixedFee === undefined ? '' : ` — fixed fee ${listing.fixedFee}`}`).join('\n'),
        }],
      },
      async execute(_args, exec) {
        return (await service.listMyListings(exec.signal)).map(listing => ({
          id: listing.id,
          name: listing.name,
          description: listing.description,
          available: listing.available,
          ...(listing.status === undefined ? {} : { status: listing.status }),
          ...(listing.saleStatus === undefined ? {} : { saleStatus: listing.saleStatus }),
          ...(listing.fixedFee === undefined ? {} : { fixedFee: listing.fixedFee }),
          ...(listing.currency === undefined ? {} : { currency: listing.currency }),
          ...(listing.listingVersionId === undefined ? {} : { listingVersionId: listing.listingVersionId }),
          ...(listing.publishedVersionId === undefined ? {} : { publishedVersionId: listing.publishedVersionId }),
          ...(listing.reviewStatus === undefined ? {} : { reviewStatus: listing.reviewStatus }),
          ...(listing.reviewReason === undefined ? {} : { reviewReason: listing.reviewReason }),
        }))
      },
    })),
    ctx.tools.register(defineTool({
      name: 'loomloom_list_creator_transactions',
      description: 'List the signed-in creator account Market transactions (who ran which listing and the associated fees). Read-only.',
      parameters: {},
      output: {
        schema: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              runTransactionId: { type: 'string' },
              runId: { type: 'string' },
              listingId: { type: 'string' },
              skillName: { type: 'string' },
              taskFixedFee: { type: 'string' },
              finalBuyerPayable: { type: 'string' },
              currency: { type: 'string' },
              transactionStatus: { type: 'string' },
            },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: value.length === 0
            ? 'This account has no Market transactions.'
            : value.map(transaction => `${transaction.skillName ?? transaction.listingId ?? 'transaction'}${transaction.transactionStatus === undefined ? '' : ` — ${transaction.transactionStatus}`}${transaction.taskFixedFee === undefined ? '' : ` — fee ${transaction.taskFixedFee}`}${transaction.runId === undefined ? '' : ` (run ${transaction.runId})`}`).join('\n'),
        }],
      },
      async execute(_args, exec) {
        return (await service.listCreatorTransactions(exec.signal)).map(transaction => ({
          ...(transaction.runTransactionId === undefined ? {} : { runTransactionId: transaction.runTransactionId }),
          ...(transaction.runId === undefined ? {} : { runId: transaction.runId }),
          ...(transaction.listingId === undefined ? {} : { listingId: transaction.listingId }),
          ...(transaction.skillName === undefined ? {} : { skillName: transaction.skillName }),
          ...(transaction.taskFixedFee === undefined ? {} : { taskFixedFee: transaction.taskFixedFee }),
          ...(transaction.finalBuyerPayable === undefined ? {} : { finalBuyerPayable: transaction.finalBuyerPayable }),
          ...(transaction.currency === undefined ? {} : { currency: transaction.currency }),
          ...(transaction.transactionStatus === undefined ? {} : { transactionStatus: transaction.transactionStatus }),
        }))
      },
    })),
    ctx.tools.register(defineTool({
      name: 'loomloom_publish_listing',
      description: 'Publish a creator template version as a Market listing for review. This writes to the account and starts a review; ask the user for the display name, template ids and fixed fee before calling it.',
      parameters: {
        display_name: { type: 'string', required: true, description: 'Public listing display name shown in the Market.' },
        template_id: { type: 'string', required: true, description: 'Template id to publish.' },
        template_version_id: { type: 'string', required: true, description: 'Template version id to publish.' },
        task_fixed_fee: { type: 'number', required: true, description: 'Creator fixed fee per billable task, in currency units (for example 0.5).' },
        description: { type: 'string', description: 'Optional listing description.' },
        listing_id: { type: 'string', description: 'Optional existing listing id when publishing a new version of it.' },
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            id: { type: 'string', required: true },
            status: { type: 'string' },
            reviewStatus: { type: 'string' },
            reviewRequestId: { type: 'string' },
            name: { type: 'string' },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: `Published listing ${value.id}${value.name === undefined ? '' : ` (${value.name})`}${value.status === undefined ? '' : ` with status ${value.status}`}${value.reviewStatus === undefined ? '' : `; review ${value.reviewStatus}`}${value.reviewRequestId === undefined ? '' : `; review request ${value.reviewRequestId}`}.`,
        }],
      },
      async execute(args, exec) {
        const fee = args.task_fixed_fee
        if (typeof fee !== 'number') throw new LoomApiError(400, 'task_fixed_fee is required')
        requireAgent(exec.agent)
        const approval = ctx.get('approval')
        if (approval === undefined) throw new LoomApiError(503, 'DSH user approval is unavailable; publishing is blocked')
        const displayName = asString(args.display_name, 'display_name')
        const templateId = asString(args.template_id, 'template_id')
        const templateVersionId = asString(args.template_version_id, 'template_version_id')
        const listingId = typeof args.listing_id === 'string' && args.listing_id.trim() !== '' ? args.listing_id.trim() : undefined
        const action = listingId === undefined ? 'Create a new Market listing' : `Update Market listing ${listingId}`
        const outcome = await approval.request({
          agent: exec.agent!,
          toolName: 'loomloom_publish_listing',
          callId: exec.callId,
          reason: `${action} using template ${templateId}, version ${templateVersionId}, display name "${displayName}", and fixed fee ${fee}. This submits the change for review.`,
          signal: exec.signal,
        })
        if (outcome !== 'allowed-once') throw new LoomApiError(403, 'Loomloom listing publication was not approved by the user')
        const published = await service.publishListing({
          displayName,
          templateId,
          templateVersionId,
          taskFixedFee: fee,
          ...(typeof args.description === 'string' ? { description: args.description } : {}),
          ...(typeof args.listing_id === 'string' ? { listingId: args.listing_id } : {}),
        }, exec.signal)
        return {
          id: published.id,
          ...(published.status === undefined ? {} : { status: published.status }),
          ...(published.reviewStatus === undefined ? {} : { reviewStatus: published.reviewStatus }),
          ...(published.reviewRequestId === undefined ? {} : { reviewRequestId: published.reviewRequestId }),
          ...(published.name === undefined ? {} : { name: published.name }),
        }
      },
    })),
    ctx.tools.register(defineTool({
      name: 'loomloom_list_official_templates',
      description: 'List the official (first-party) Loomloom templates that can be run or published. Use it to find a template id before reading its schema.',
      parameters: {},
      output: {
        schema: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              templateId: { type: 'string', required: true },
              name: { type: 'string', required: true },
              scenario: { type: 'string' },
              inputSummary: { type: 'string' },
              outputType: { type: 'string' },
              version: { type: 'string' },
            },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: value.length === 0
            ? 'No official Loomloom templates were found.'
            : value.map(template => `${template.name} (${template.templateId})${template.scenario === undefined ? '' : ` — ${template.scenario}`}${template.outputType === undefined ? '' : ` → ${template.outputType}`}`).join('\n'),
        }],
      },
      async execute(_args, exec) {
        return (await service.listOfficialTemplates(exec.signal)).map(template => ({
          templateId: template.templateId,
          name: template.name,
          ...(template.scenario === undefined ? {} : { scenario: template.scenario }),
          ...(template.inputSummary === undefined ? {} : { inputSummary: template.inputSummary }),
          ...(template.outputType === undefined ? {} : { outputType: template.outputType }),
          ...(template.version === undefined ? {} : { version: template.version }),
        }))
      },
    })),
    ctx.tools.register(defineTool({
      name: 'loomloom_get_template_schema',
      description: 'Read one official Loomloom template input schema, including every declared field and its hint. Use it before running or publishing that template.',
      parameters: {
        template_id: { type: 'string', required: true, description: 'Official template id returned by loomloom_list_official_templates.' },
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          properties: {
            templateId: { type: 'string', required: true },
            name: { type: 'string' },
            description: { type: 'string' },
            scenario: { type: 'string' },
            outputType: { type: 'string' },
            fields: {
              type: 'array', required: true,
              items: {
                type: 'object', additionalProperties: false,
                properties: {
                  key: { type: 'string', required: true },
                  label: { type: 'string', required: true },
                  required: { type: 'boolean', required: true },
                  valueType: { type: 'string', required: true },
                  inputHint: { type: 'string' },
                  enumValues: { type: 'array', items: { type: 'string' } },
                  examples: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: `${value.name ?? value.templateId} accepts: ${value.fields.map(field => `${field.key}${field.required ? ' (required)' : ''}`).join(', ') || 'no declared fields'}`,
        }],
      },
      async execute(args, exec) {
        const schema = await service.getTemplateSchema(asString(args.template_id, 'template_id'), exec.signal)
        return {
          templateId: schema.templateId,
          fields: schema.fields.map(field => ({
            key: field.key,
            label: field.label,
            required: field.required,
            valueType: field.valueType,
            ...(field.inputHint === undefined ? {} : { inputHint: field.inputHint }),
            ...(field.enumValues === undefined ? {} : { enumValues: [...field.enumValues] }),
            ...(field.examples === undefined ? {} : { examples: [...field.examples] }),
          })),
          ...(schema.name === undefined ? {} : { name: schema.name }),
          ...(schema.description === undefined ? {} : { description: schema.description }),
          ...(schema.scenario === undefined ? {} : { scenario: schema.scenario }),
          ...(schema.outputType === undefined ? {} : { outputType: schema.outputType }),
        }
      },
    })),
    ctx.tools.register(defineTool({
      name: 'loomloom_list_my_templates',
      description: 'List the private (creator-authored) templates owned by the signed-in account, including the version id required to publish a Market listing. Read-only.',
      parameters: {},
      output: {
        schema: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              templateId: { type: 'string', required: true },
              name: { type: 'string', required: true },
              description: { type: 'string' },
              status: { type: 'string' },
              latestVersionId: { type: 'string' },
              publishedVersionId: { type: 'string' },
              outputType: { type: 'string' },
            },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: value.length === 0
            ? 'This account owns no private templates.'
            : value.map(template => `${template.name} (${template.templateId})${template.status === undefined ? '' : ` — ${template.status}`}${template.latestVersionId === undefined ? '' : ` — latest version ${template.latestVersionId}`}`).join('\n'),
        }],
      },
      async execute(_args, exec) {
        return (await service.listMyTemplates(exec.signal)).map(template => ({
          templateId: template.templateId,
          name: template.name,
          ...(template.description === undefined ? {} : { description: template.description }),
          ...(template.status === undefined ? {} : { status: template.status }),
          ...(template.latestVersionId === undefined ? {} : { latestVersionId: template.latestVersionId }),
          ...(template.publishedVersionId === undefined ? {} : { publishedVersionId: template.publishedVersionId }),
          ...(template.outputType === undefined ? {} : { outputType: template.outputType }),
        }))
      },
    })),
  ]
  return () => disposers.forEach(dispose => dispose())
}
