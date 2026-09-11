import assert from 'node:assert/strict'
import test from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import { LoomApiError } from '../src/loom-api.js'
import { LoomSkillbotService } from '../src/skillbots.js'
import { registerLoomTools } from '../src/tools.js'

interface RegisteredTool {
  readonly name: string
  execute(args: unknown, exec: unknown): Promise<unknown>
  readonly output: {
    render(args: unknown, value: unknown): unknown
  }
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
      if (path.endsWith('/artifacts?pageSize=100')) return { items: [{ artifactId: 'artifact-1', stepLabel: 'Copy', mimeType: 'text/plain', accessUrl: 'https://files.example/result.txt', inlineText: '{"score": 95}' }] }
      if (path.startsWith('/users/me/runs/')) return { runId: 'run-1', status: 'completed', displayName: 'Copywriter' }
      if (path.startsWith('/marketListings?')) return { items: [listing()] }
      if (path === '/users/me/balance') return { availableBalanceT: 12_500_000, currency: 'CNY' }
      if (path === '/creators/me/marketListings?pageSize=100') {
        return {
          items: [{
            id: 'my-listing-1', displayName: 'My SkillBot', description: 'Mine',
            executionAvailabilityStatus: 'available', taskFixedFeeT: 2_000_000, currency: 'CNY',
            status: 'published', saleStatus: 'listed', reviewStatus: 'approved',
          }],
        }
      }
      if (path === '/creators/me/marketTransactions?pageSize=100') {
        return {
          items: [{
            runTransactionId: 'txn-1', runId: 'run-1', listingId: 'listing-1', skillName: 'Copywriter',
            taskFixedFeeT: 5_000_000, finalBuyerPayableT: 15_000_000, currency: 'CNY',
            transactionStatus: 'settled',
          }],
        }
      }
      if (path === '/marketListings' && init?.method === 'POST') {
        return { id: 'new-listing-1', status: 'published', reviewStatus: 'pending', reviewRequestId: 'review-1' }
      }
      if (path === '/officialTemplates') {
        return { templates: [{ templateId: 'official-1', name: 'Report Writer', scenario: 'reporting', outputType: 'xlsx', version: 'v1' }] }
      }
      if (path === '/users/me/templates?pageSize=50') {
        return {
          items: [{
            templateId: 'my-template-1', name: 'cv-portfolio-review', status: 'active',
            latestVersionId: 'version-9', publishedVersionId: 'version-8', primaryOutputType: 'text',
          }],
          totalCount: 1,
        }
      }
      if (path === '/officialTemplates/official-1/schema') {
        return {
          templateId: 'official-1', name: 'Report Writer', description: 'Writes a report',
          scenario: 'reporting', outputType: 'xlsx',
          fields: [
            { key: 'topic', label: 'Topic', required: true, type: 'string', inputHint: 'What to write about' },
            { key: 'tone', label: 'Tone', required: false, type: 'enum', enumValues: ['warm', 'formal'] },
          ],
        }
      }
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

test('registers the thirteen model-visible Loomloom tools and disposes all registrations', () => {
  const setup = harness('allowed-once')
  const dispose = registerLoomTools(setup.context, new LoomSkillbotService(fakeApi() as never))
  assert.deepEqual(setup.registered.map(item => item.name), [
    'loomloom_list_skillbots', 'loomloom_get_skillbot', 'loomloom_prepare_execution',
    'loomloom_execute_skillbot', 'loomloom_get_run', 'loomloom_get_run_results',
    'loomloom_get_balance', 'loomloom_list_my_listings', 'loomloom_list_creator_transactions',
    'loomloom_publish_listing', 'loomloom_list_official_templates', 'loomloom_get_template_schema',
    'loomloom_list_my_templates',
  ])
  dispose()
  assert.equal(setup.disposeCount(), 13)
})

test('returns only run-result counts and output artifacts, never submitted input rows', async () => {
  const setup = harness('allowed-once')
  registerLoomTools(setup.context, new LoomSkillbotService(fakeApi() as never))
  const result = await tool(setup.registered, 'loomloom_get_run_results').execute({ run_id: 'run-1' }, execution({}))
  assert.deepEqual(result, {
    runId: 'run-1', status: 'completed', totalRows: 2, completedRows: 1, failedRows: 1,
    artifacts: [{ id: 'artifact-1', label: 'Copy', mimeType: 'text/plain', accessUrl: 'https://files.example/result.txt', inlineText: '{"score": 95}' }],
  })
  // The inline artifact body is surfaced in the render text, not just a count.
  // A JSON body is drawn as a field/value table, so the field and its value must
  // both appear; the raw payload deliberately no longer does.
  const rendered = tool(setup.registered, 'loomloom_get_run_results').output.render({}, result) as Array<{ text: string }>
  assert.match(rendered.map(block => block.text).join('\n'), /\|\s*score\s*\|\s*95\s*\|/u)
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
  // A keyword is matched locally over the full dataset and never forwarded upstream.
  const search = await tool(setup.registered, 'loomloom_list_skillbots').execute(
    { keyword: 'copy' }, execution(agent),
  ) as unknown[]
  assert.equal(api.calls.some(call => call.path.includes('keyword=')), false)
  assert.equal(search.length, 1)

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
  assert.deepEqual(results.artifacts, [{ id: 'artifact-1', label: 'Copy', mimeType: 'text/plain', accessUrl: 'https://files.example/result.txt', inlineText: '{"score": 95}' }])
})

test('surfaces the draft_id in the prepare render text so the model can feed it back to execute', async () => {
  const api = fakeApi()
  const setup = harness('allowed-once')
  registerLoomTools(setup.context, new LoomSkillbotService(api as never))
  const agent = {}
  const draft = await tool(setup.registered, 'loomloom_prepare_execution').execute(
    { listing_id: 'listing-1', input_rows: [{ topic: 'Coffee' }] }, execution(agent),
  ) as { draftId: string }
  const rendered = tool(setup.registered, 'loomloom_prepare_execution').output.render({}, draft) as Array<{ type: string, text: string }>
  const text = rendered.map(block => block.text).join('\n')
  // The model sees only the render text (never the structured value), so the draft id must be visible there.
  assert.match(text, new RegExp(draft.draftId))
  // Executing with the draft id must resolve to a real execution draft.
  const receipt = await tool(setup.registered, 'loomloom_execute_skillbot').execute(
    { draft_id: draft.draftId }, execution(agent),
  ) as { accepted: boolean }
  assert.equal(receipt.accepted, true)
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
    artifacts: [{ id: 'artifact-1', label: 'Copy', mimeType: 'text/plain', accessUrl: 'https://files.example/result.txt', inlineText: '{"score": 95}' }],
  })
  assert.equal(api.calls.filter(call => call.path.endsWith(':execute')).length, 1)
})

test('reads the account balance and converts raw-unit *T values', async () => {
  const setup = harness('allowed-once')
  registerLoomTools(setup.context, new LoomSkillbotService(fakeApi() as never))
  const balance = await tool(setup.registered, 'loomloom_get_balance').execute({}, execution({}))
  assert.deepEqual(balance, { currency: 'CNY', availableBalance: '1.25' })
  const rendered = tool(setup.registered, 'loomloom_get_balance').output.render({}, balance) as Array<{ text: string }>
  assert.match(rendered.map(block => block.text).join('\n'), /1\.25 CNY/)
})

test('lists creator-owned listings with review state and converted fees', async () => {
  const setup = harness('allowed-once')
  registerLoomTools(setup.context, new LoomSkillbotService(fakeApi() as never))
  const listings = await tool(setup.registered, 'loomloom_list_my_listings').execute({}, execution({}))
  assert.deepEqual(listings, [{
    id: 'my-listing-1', name: 'My SkillBot', description: 'Mine', available: true,
    status: 'published', saleStatus: 'listed', fixedFee: '0.2', currency: 'CNY',
    reviewStatus: 'approved',
  }])
})

test('lists creator transactions with converted amounts', async () => {
  const setup = harness('allowed-once')
  registerLoomTools(setup.context, new LoomSkillbotService(fakeApi() as never))
  const transactions = await tool(setup.registered, 'loomloom_list_creator_transactions').execute({}, execution({}))
  assert.deepEqual(transactions, [{
    runTransactionId: 'txn-1', runId: 'run-1', listingId: 'listing-1', skillName: 'Copywriter',
    taskFixedFee: '0.5', finalBuyerPayable: '1.5', currency: 'CNY', transactionStatus: 'settled',
  }])
})

test('publishes a listing and converts the decimal fee into raw API units', async () => {
  const api = fakeApi()
  const setup = harness('allowed-once')
  registerLoomTools(setup.context, new LoomSkillbotService(api as never))
  const published = await tool(setup.registered, 'loomloom_publish_listing').execute(
    { display_name: 'My Bot', template_id: 'template-1', template_version_id: 'version-1', task_fixed_fee: 0.5 },
    execution({}),
  )
  assert.deepEqual(published, { id: 'new-listing-1', status: 'published', reviewStatus: 'pending', reviewRequestId: 'review-1' })
  const call = api.calls.find(entry => entry.path === '/marketListings' && entry.init?.method === 'POST')
  assert.ok(call, 'expected a POST /marketListings call')
  const body = JSON.parse(String(call.init?.body)) as Record<string, unknown>
  assert.equal(body.taskFixedFeeT, 5_000_000)
  assert.equal(body.displayName, 'My Bot')
  assert.equal(body.templateId, 'template-1')
  assert.equal(setup.requests.length, 1)
  assert.match(String(setup.requests[0]?.reason), /template template-1, version version-1/u)
  // A missing fee must be rejected before any upstream write (the tool schema
  // marks it required, so the framework rejects the call up front).
  const writesBefore = api.calls.filter(entry => entry.path === '/marketListings' && entry.init?.method === 'POST').length
  await assert.rejects(
    () => tool(setup.registered, 'loomloom_publish_listing').execute(
      { display_name: 'My Bot', template_id: 'template-1', template_version_id: 'version-1' }, execution({}),
    ),
  )
  assert.equal(api.calls.filter(entry => entry.path === '/marketListings' && entry.init?.method === 'POST').length, writesBefore)
})

test('refuses an unapproved listing publication before the upstream write', async () => {
  const api = fakeApi()
  const setup = harness('rejected')
  registerLoomTools(setup.context, new LoomSkillbotService(api as never))

  await assert.rejects(
    () => tool(setup.registered, 'loomloom_publish_listing').execute(
      { display_name: 'My Bot', template_id: 'template-1', template_version_id: 'version-1', task_fixed_fee: 0.5 },
      execution({}),
    ),
    (error: unknown) => error instanceof LoomApiError && error.status === 403,
  )

  assert.equal(api.calls.some(call => call.path === '/marketListings' && call.init?.method === 'POST'), false)
  assert.match(String(setup.requests[0]?.reason), /fixed fee 0\.5/u)
})

test('lists official templates and reads one schema with field hints', async () => {
  const setup = harness('allowed-once')
  registerLoomTools(setup.context, new LoomSkillbotService(fakeApi() as never))
  const templates = await tool(setup.registered, 'loomloom_list_official_templates').execute({}, execution({}))
  assert.deepEqual(templates, [{
    templateId: 'official-1', name: 'Report Writer', scenario: 'reporting', outputType: 'xlsx', version: 'v1',
  }])
  const schema = await tool(setup.registered, 'loomloom_get_template_schema').execute(
    { template_id: 'official-1' }, execution({}),
  ) as { templateId: string, fields: Array<Record<string, unknown>> }
  assert.equal(schema.templateId, 'official-1')
  assert.deepEqual(schema.fields, [
    { key: 'topic', label: 'Topic', required: true, valueType: 'string', inputHint: 'What to write about' },
    { key: 'tone', label: 'Tone', required: false, valueType: 'enum', enumValues: ['warm', 'formal'] },
  ])
})

test('lists private templates with the version id needed to publish', async () => {
  const setup = harness('allowed-once')
  registerLoomTools(setup.context, new LoomSkillbotService(fakeApi() as never))
  const templates = await tool(setup.registered, 'loomloom_list_my_templates').execute({}, execution({}))
  assert.deepEqual(templates, [{
    templateId: 'my-template-1', name: 'cv-portfolio-review', status: 'active',
    latestVersionId: 'version-9', publishedVersionId: 'version-8', outputType: 'text',
  }])
})

test('creator routes accept the real upstream transaction shape', async () => {
  const api = fakeApi()
  // Patch the fake to return the actual field names the upstream sent back.
  const original = api.request.bind(api)
  api.request = async (path: string, init?: RequestInit) => {
    if (path === '/creators/me/marketTransactions?pageSize=100') {
      return {
        items: [{
          runTransactionId: '01a08ab1-b6aa-7524-bc96-2ecc5e8b7276', runId: 'run-1',
          listingId: '019fad3b-8831-7986-bdd0-db4620e261b8', skillName: '美股价值投资初筛',
          creatorUserId: 62890, currency: 'CNY', taskFixedFeeT: 2000000,
          taskFixedFee: { amount: '0.2000000', currency: 'CNY' },
          estimatedExecutionCostT: 1114064, estimatedExecutionCost: { amount: '0.1114064', currency: 'CNY' },
          transactionStatus: 'settled',
        }],
      }
    }
    return await original(path, init)
  }
  const setup = harness('allowed-once')
  registerLoomTools(setup.context, new LoomSkillbotService(api as never))
  const transactions = await tool(setup.registered, 'loomloom_list_creator_transactions').execute({}, execution({}))
  assert.deepEqual(transactions, [{
    runTransactionId: '01a08ab1-b6aa-7524-bc96-2ecc5e8b7276', runId: 'run-1',
    listingId: '019fad3b-8831-7986-bdd0-db4620e261b8', skillName: '美股价值投资初筛',
    taskFixedFee: '0.2000000', currency: 'CNY', transactionStatus: 'settled',
  }])
})
