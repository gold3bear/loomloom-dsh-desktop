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
