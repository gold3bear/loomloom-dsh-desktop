import assert from 'node:assert/strict'
import test from 'node:test'
import { LoomApiError } from '../src/loom-api.js'
import { LoomSkillbotService } from '../src/skillbots.js'

function listing() {
  return {
    id: 'listing-1',
    displayName: 'Copywriter',
    description: 'Generates copy',
    executionAvailabilityStatus: 'available',
    taskFixedFee: { amount: '0.5' },
    listingVersionId: 'version-1',
    inputSchemaSnapshot: JSON.stringify({
      fields: [
        { key: 'topic', label: 'Topic', required: true, value_type: 'string' },
        { key: 'count', label: 'Count', required: true, value_type: 'integer' },
        { key: 'tone', label: 'Tone', value_type: 'enum', enum_values: ['warm', 'formal'] },
      ],
    }),
  }
}

function fakeApi() {
  const calls: { path: string, init?: RequestInit }[] = []
  return {
    calls,
    async request(path: string, init?: RequestInit): Promise<unknown> {
      calls.push({ path, ...(init === undefined ? {} : { init }) })
      if (path === '/marketListings/listing-1') return listing()
      if (path === '/marketListings?pageSize=100') return { items: [listing()] }
      if (path.endsWith(':quote')) return { estimatedBuyerPayable: { amount: '1.50', currency: 'CNY' }, taskFixedFee: { amount: '0.5', currency: 'CNY' } }
      if (path.startsWith('/marketListings/')) return { runId: 'run-1', status: 'queued' }
      if (path.startsWith('/users/me/runs/')) return { runId: 'run-1', status: 'completed', displayName: 'Copywriter' }
      throw new Error(`unexpected path ${path}`)
    },
  }
}

test('prepares a draft only for schema-valid SkillBot input', async () => {
  const api = fakeApi()
  const service = new LoomSkillbotService(api as never)
  const agent = {}
  const draft = await service.prepare(agent, 'listing-1', undefined, [{ topic: 'Coffee', count: 3, tone: 'warm' }])
  assert.equal(draft.rowCount, 1)
  assert.equal(draft.skillbot.fixedFee, '0.5')
  assert.deepEqual(draft.quote, { estimatedBuyerPayable: '1.50', currency: 'CNY', taskFixedFee: '0.5' })
  await assert.rejects(
    () => service.prepare(agent, 'listing-1', undefined, [{ topic: 'Coffee', count: '3' }]),
    (error: unknown) => error instanceof LoomApiError && error.status === 400 && error.message.includes('must be an integer'),
  )
})

test('quotes before executing an agent-owned draft once with confirm and a bound idempotency key', async () => {
  const api = fakeApi()
  const service = new LoomSkillbotService(api as never)
  const agent = {}
  const draft = await service.prepare(agent, 'listing-1', undefined, [{ topic: 'Coffee', count: 3 }])
  const receipt = await service.execute(agent, draft.id)
  assert.deepEqual(receipt, { draftId: draft.id, accepted: true, runId: 'run-1', status: 'queued' })
  const call = api.calls.at(-1)!
  assert.equal(call.path, '/marketListings/listing-1:execute')
  const body = JSON.parse(String(call.init?.body)) as Record<string, unknown>
  assert.deepEqual(body, {
    inputRows: [{ topic: 'Coffee', count: 3 }],
    listingVersionId: 'version-1',
    clientRequestId: body.clientRequestId,
    confirm: true,
  })
  assert.match(String(body.clientRequestId), /^loomloom-dsh-/)
  await assert.rejects(() => service.execute(agent, draft.id), /draft is unavailable/)
})

test('does not disclose a draft to another DSH chat agent', async () => {
  const service = new LoomSkillbotService(fakeApi() as never)
  const owner = {}
  const draft = await service.prepare(owner, 'listing-1', undefined, [{ topic: 'Coffee', count: 3 }])
  assert.equal(service.describeDraft(draft.id, {}), undefined)
})

test('polls a queued run until it reaches a terminal state with bounded backoff', async () => {
  let reads = 0
  const api = {
    async request(path: string): Promise<unknown> {
      if (path.startsWith('/users/me/runs/')) {
        reads += 1
        return { runId: 'run-1', status: reads === 1 ? 'queued' : 'completed', displayName: 'Copywriter' }
      }
      throw new Error(`unexpected path ${path}`)
    },
  }
  const service = new LoomSkillbotService(api as never)
  const delays: number[] = []
  const summary = await service.pollRunUntilTerminal('run-1', {
    initialDelayMs: 10,
    maxDelayMs: 20,
    jitterRatio: 0,
    maxWaitMs: 1000,
    sleep: async (delay) => { delays.push(delay) },
  })
  assert.deepEqual(summary, {
    runId: 'run-1',
    status: 'completed',
    displayName: 'Copywriter',
    terminal: true,
    pending: false,
    attempts: 2,
  })
  assert.deepEqual(delays, [10])
})

test('lists the full market dataset across pages and matches a keyword locally', async () => {
  function entry(id: string, name: string, description: string) {
    return {
      id, displayName: name, description,
      executionAvailabilityStatus: 'available',
      taskFixedFee: { amount: '0.5' }, listingVersionId: 'version-1',
    }
  }
  const calls: string[] = []
  const api = {
    async request(path: string): Promise<unknown> {
      calls.push(path)
      if (path === '/marketListings?pageSize=100') {
        return {
          items: [entry('listing-1', 'Copywriter', 'Generates copy')],
          nextPageToken: 'page-2',
        }
      }
      if (path === '/marketListings?pageSize=100&pageToken=page-2') {
        return {
          items: [entry('listing-2', '翻译助手', '把中文翻译成英文')],
          nextPageToken: 'page-3',
        }
      }
      if (path === '/marketListings?pageSize=100&pageToken=page-3') {
        return { items: [] }
      }
      throw new Error(`unexpected path ${path}`)
    },
  }
  const service = new LoomSkillbotService(api as never)

  const all = await service.list()
  assert.deepEqual(all.map(item => item.id), ['listing-1', 'listing-2'])
  assert.deepEqual(calls, [
    '/marketListings?pageSize=100',
    '/marketListings?pageSize=100&pageToken=page-2',
    '/marketListings?pageSize=100&pageToken=page-3',
  ])

  // Keyword matching is local, case-insensitive and non-ASCII aware.
  assert.deepEqual((await service.list(undefined, { keyword: 'COPY' })).map(item => item.id), ['listing-1'])
  assert.deepEqual((await service.list(undefined, { keyword: '翻译' })).map(item => item.id), ['listing-2'])
  assert.deepEqual(await service.list(undefined, { keyword: 'missing' }), [])
  // Multiple terms match against name/description/id and rank by hit count.
  const ranked = await service.list(undefined, { keyword: 'copy writer generator' })
  assert.deepEqual(ranked.map(item => item.id), ['listing-1'])
  // Unavailable listings are never returned even when the keyword matches.
  const withUnavailable = new LoomSkillbotService({
    async request(path: string): Promise<unknown> {
      if (path === '/marketListings?pageSize=100') {
        return {
          items: [
            { ...entry('listing-1', 'Copywriter', 'Generates copy'), executionAvailabilityStatus: 'unavailable' },
          ],
        }
      }
      throw new Error(`unexpected path ${path}`)
    },
  } as never)
  assert.deepEqual(await withUnavailable.list(), [])
})

test('converts raw-unit *T monetary fields when the converted object is absent', async () => {
  const rawUnitsListing = {
    ...listing(),
    taskFixedFee: undefined,
    taskFixedFeeT: 5_000_000, // 5,000,000 / 1e7 = 0.5
    currency: 'CNY',
  }
  delete rawUnitsListing.taskFixedFee
  const api = {
    async request(path: string): Promise<unknown> {
      if (path === '/marketListings/listing-1') return rawUnitsListing
      if (path.endsWith(':quote')) return { estimatedBuyerPayableT: 15_000_000, taskFixedFeeT: 5_000_000, currency: 'CNY' }
      throw new Error(`unexpected path ${path}`)
    },
  }
  const service = new LoomSkillbotService(api as never)
  const agent = {}
  const draft = await service.prepare(agent, 'listing-1', undefined, [{ topic: 'Coffee', count: 3 }])
  assert.equal(draft.skillbot.fixedFee, '0.5')
  assert.deepEqual(draft.quote, { estimatedBuyerPayable: '1.5', currency: 'CNY', taskFixedFee: '0.5' })
  // Converted object still wins over the raw-unit integer when both exist.
  const both = {
    async request(path: string): Promise<unknown> {
      if (path === '/marketListings/listing-1') return { ...rawUnitsListing, taskFixedFee: { amount: '0.75', currency: 'CNY' } }
      if (path.endsWith(':quote')) return { estimatedBuyerPayable: { amount: '2.25', currency: 'CNY' }, estimatedBuyerPayableT: 99_999_999, taskFixedFeeT: 5_000_000, currency: 'CNY' }
      throw new Error(`unexpected path ${path}`)
    },
  }
  const bothDraft = await new LoomSkillbotService(both as never).prepare(agent, 'listing-1', undefined, [{ topic: 'Coffee', count: 3 }])
  assert.equal(bothDraft.skillbot.fixedFee, '0.75')
  assert.deepEqual(bothDraft.quote, { estimatedBuyerPayable: '2.25', currency: 'CNY', taskFixedFee: '0.5' })
})
