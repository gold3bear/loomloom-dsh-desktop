import assert from 'node:assert/strict'
import test from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import { LoomApiError } from '../src/loom-api.js'
import { LoomSkillbotService } from '../src/skillbots.js'
import { registerLoomTools } from '../src/tools.js'

interface RegisteredTool {
  readonly name: string
  execute(args: unknown, exec: unknown): Promise<unknown>
}

function listing() {
  return {
    id: 'listing-1', displayName: 'Copywriter', description: 'Generates copy',
    executionAvailabilityStatus: 'available', taskFixedFee: { amount: '0.5' }, listingVersionId: 'version-1',
    inputSchemaSnapshot: JSON.stringify({ fields: [{ key: 'topic', label: 'Topic', required: true, value_type: 'string' }] }),
  }
}

function fakeApi() {
  const calls: { path: string, init?: RequestInit }[] = []
  return {
    calls,
    async request(path: string, init?: RequestInit): Promise<unknown> {
      calls.push({ path, ...(init === undefined ? {} : { init }) })
      if (path === '/marketListings/listing-1') return listing()
      if (path.endsWith(':quote')) return { estimatedBuyerPayable: { amount: '1.50', currency: 'CNY' } }
      if (path.endsWith(':execute')) return { runId: 'run-1', status: 'queued' }
      if (path.endsWith('/resultRows?pageSize=100')) return { items: [{ status: 'completed' }, { status: 'failed' }] }
      if (path.endsWith('/artifacts?pageSize=100')) return { items: [{ artifactId: 'artifact-1', stepLabel: 'Copy', mimeType: 'text/plain', accessUrl: 'https://files.example/result.txt' }] }
      if (path.startsWith('/users/me/runs/')) return { runId: 'run-1', status: 'completed', displayName: 'Copywriter' }
      if (path === '/marketListings?pageSize=100') return { items: [listing()] }
      throw new Error(`unexpected path ${path}`)
    },
  }
}

function harness(outcome: 'allowed-once' | 'rejected') {
  const registered: RegisteredTool[] = []
  const requests: Record<string, unknown>[] = []
  let disposals = 0
  const context = {
    tools: {
      register(tool: unknown): () => void {
        registered.push(tool as RegisteredTool)
        return () => { disposals += 1 }
      },
    },
    get(name: string): unknown {
      if (name !== 'approval') return undefined
      return {
        async request(request: Record<string, unknown>): Promise<'allowed-once' | 'rejected'> {
          requests.push(request)
          return outcome
        },
      }
    },
  } as unknown as Context
  return { context, registered, requests, disposeCount: () => disposals }
}

function tool(tools: readonly RegisteredTool[], name: string): RegisteredTool {
  const found = tools.find(candidate => candidate.name === name)
  assert.ok(found, `missing ${name}`)
  return found
}

function execution(agent: object): unknown {
  return { agent, callId: 'call-1', signal: new AbortController().signal }
}

test('registers the six model-visible Loomloom tools and disposes all registrations', () => {
  const setup = harness('allowed-once')
  const dispose = registerLoomTools(setup.context, new LoomSkillbotService(fakeApi() as never))
  assert.deepEqual(setup.registered.map(item => item.name), [
    'loomloom_list_skillbots', 'loomloom_get_skillbot', 'loomloom_prepare_execution',
    'loomloom_execute_skillbot', 'loomloom_get_run', 'loomloom_get_run_results',
  ])
  dispose()
  assert.equal(setup.disposeCount(), 6)
})

test('returns only run-result counts and output artifacts, never submitted input rows', async () => {
  const setup = harness('allowed-once')
  registerLoomTools(setup.context, new LoomSkillbotService(fakeApi() as never))
  const result = await tool(setup.registered, 'loomloom_get_run_results').execute({ run_id: 'run-1' }, execution({}))
  assert.deepEqual(result, {
    runId: 'run-1', status: 'completed', totalRows: 2, completedRows: 1, failedRows: 1,
    artifacts: [{ id: 'artifact-1', label: 'Copy', mimeType: 'text/plain', accessUrl: 'https://files.example/result.txt' }],
  })
})

test('refuses an unapproved paid execution before the upstream execute call', async () => {
  const api = fakeApi()
  const setup = harness('rejected')
  registerLoomTools(setup.context, new LoomSkillbotService(api as never))
  const agent = {}
  const draft = await tool(setup.registered, 'loomloom_prepare_execution').execute(
    { listing_id: 'listing-1', input_rows: [{ topic: 'Coffee' }] }, execution(agent),
  ) as { draftId: string }
  await assert.rejects(
    () => tool(setup.registered, 'loomloom_execute_skillbot').execute({ draft_id: draft.draftId }, execution(agent)),
    (error: unknown) => error instanceof LoomApiError && error.status === 403,
  )
  assert.equal(api.calls.some(call => call.path.endsWith(':execute')), false)
  assert.match(String(setup.requests[0]?.reason), /1\.50 CNY/)
})

test('supports the complete no-charge chat smoke path from discovery through safe run reads', async () => {
  const api = fakeApi()
  const setup = harness('rejected')
  registerLoomTools(setup.context, new LoomSkillbotService(api as never))
  const agent = {}

  const listings = await tool(setup.registered, 'loomloom_list_skillbots').execute({}, execution(agent)) as Array<{ id: string }>
  assert.deepEqual(listings, [{
    id: 'listing-1', name: 'Copywriter', description: 'Generates copy', available: true, fixedFee: '0.5', versionId: 'version-1',
  }])

  const detail = await tool(setup.registered, 'loomloom_get_skillbot').execute(
    { listing_id: listings[0]!.id }, execution(agent),
  ) as { skillbot: { id: string }, fields: Array<{ key: string, required: boolean }> }
  assert.equal(detail.skillbot.id, 'listing-1')
  assert.deepEqual(detail.fields, [{ key: 'topic', label: 'Topic', required: true, valueType: 'string' }])

  const draft = await tool(setup.registered, 'loomloom_prepare_execution').execute(
    { listing_id: detail.skillbot.id, input_rows: [{ topic: 'Coffee' }] }, execution(agent),
  ) as { draftId: string, quote: { estimatedBuyerPayable: string, currency?: string } }
  assert.deepEqual(draft.quote, { estimatedBuyerPayable: '1.50', currency: 'CNY' })

  await assert.rejects(
    () => tool(setup.registered, 'loomloom_execute_skillbot').execute({ draft_id: draft.draftId }, execution(agent)),
    (error: unknown) => error instanceof LoomApiError && error.status === 403,
  )
  assert.equal(api.calls.some(call => call.path.endsWith(':execute')), false)
  assert.equal(setup.requests.length, 1)

  const status = await tool(setup.registered, 'loomloom_get_run').execute({ run_id: 'run-1' }, execution(agent))
  assert.deepEqual(status, { runId: 'run-1', status: 'completed', displayName: 'Copywriter' })
  const results = await tool(setup.registered, 'loomloom_get_run_results').execute({ run_id: 'run-1' }, execution(agent)) as Record<string, unknown>
  assert.equal('inputRows' in results, false)
  assert.deepEqual(results.artifacts, [{ id: 'artifact-1', label: 'Copy', mimeType: 'text/plain', accessUrl: 'https://files.example/result.txt' }])
})

test('executes only after DSH grants one approval for the prepared draft', async () => {
  const api = fakeApi()
  const setup = harness('allowed-once')
  registerLoomTools(setup.context, new LoomSkillbotService(api as never))
  const agent = {}
  const draft = await tool(setup.registered, 'loomloom_prepare_execution').execute(
    { listing_id: 'listing-1', input_rows: [{ topic: 'Coffee' }] }, execution(agent),
  ) as { draftId: string }
  const receipt = await tool(setup.registered, 'loomloom_execute_skillbot').execute(
    { draft_id: draft.draftId }, execution(agent),
  )
  assert.deepEqual(receipt, {
    draftId: draft.draftId,
    accepted: true,
    runId: 'run-1',
    status: 'completed',
    pending: false,
    pollAttempts: 1,
    totalRows: 2,
    completedRows: 1,
    failedRows: 1,
    artifacts: [{ id: 'artifact-1', label: 'Copy', mimeType: 'text/plain', accessUrl: 'https://files.example/result.txt' }],
  })
  assert.equal(api.calls.filter(call => call.path.endsWith(':execute')).length, 1)
})
