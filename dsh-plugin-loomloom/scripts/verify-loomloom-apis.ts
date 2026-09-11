/**
 * Loomloom API surface verification script.
 *
 * A standalone acceptance runner for the Loomloom integration. It exercises
 * every newly-added capability through a mocked upstream API and reports a
 * pass/fail table. Unlike the spec files under tests/ it does not use the
 * node:test runner, so it can be run directly during development or in CI:
 *
 *   cd dsh-plugin-loomloom
 *   node --import tsx scripts/verify-loomloom-apis.ts
 *
 * Exit code is non-zero when any check fails.
 */
import assert from 'node:assert/strict'
import type { Context } from '@deepseek-ai/cordis'
import { LoomSkillbotService, type CreatorListing, type CreatorTransaction } from '../src/skillbots.js'
import type { LoomApi } from '../src/loom-api.js'
import { registerLoomTools } from '../src/tools.js'

let passed = 0
let failed = 0
const failures: string[] = []

function check(name: string, run: () => void): void {
  try {
    run()
    passed += 1
    console.log(`  ✅ ${name}`)
  } catch (cause) {
    failed += 1
    const message = cause instanceof Error ? cause.message : String(cause)
    failures.push(`${name}: ${message}`)
    console.log(`  ❌ ${name}`)
    console.log(`     ${message}`)
  }
}

async function checkAsync(name: string, run: () => Promise<void>): Promise<void> {
  try {
    await run()
    passed += 1
    console.log(`  ✅ ${name}`)
  } catch (cause) {
    failed += 1
    const message = cause instanceof Error ? cause.message : String(cause)
    failures.push(`${name}: ${message}`)
    console.log(`  ❌ ${name}`)
    console.log(`     ${message}`)
  }
}

interface FakeLoomApi {
  calls: { path: string, init?: RequestInit }[]
  api: LoomApi
}

function fakeApi(): FakeLoomApi {
  const calls: { path: string, init?: RequestInit }[] = []
  const listing = {
    id: 'listing-1', displayName: 'Copywriter', description: 'Generates copy',
    executionAvailabilityStatus: 'available', taskFixedFee: { amount: '0.5', currency: 'CNY' },
    listingVersionId: 'version-1',
    inputSchemaSnapshot: JSON.stringify({ fields: [{ key: 'topic', label: 'Topic', required: true, value_type: 'string' }] }),
  }
  const api = {
    async request(path: string, init?: RequestInit): Promise<unknown> {
      calls.push({ path, ...(init === undefined ? {} : { init }) })
      if (path === '/marketListings/listing-1') return listing
      if (path.endsWith(':quote')) return { estimatedBuyerPayable: { amount: '1.50', currency: 'CNY' }, taskFixedFee: { amount: '0.5', currency: 'CNY' } }
      if (path.endsWith(':execute')) return { runId: 'run-1', status: 'queued' }
      if (path.startsWith('/users/me/runs/')) return { runId: 'run-1', status: 'completed', displayName: 'Copywriter' }
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
            taskFixedFeeT: 5_000_000, finalBuyerPayableT: 15_000_000, currency: 'CNY', transactionStatus: 'settled',
          }],
        }
      }
      if (path === '/marketListings' && init?.method === 'POST') return { id: 'new-listing-1', status: 'published', reviewStatus: 'pending' }
      if (path === '/officialTemplates') return { templates: [{ templateId: 'official-1', name: 'Report Writer', scenario: 'reporting', outputType: 'xlsx', version: 'v1' }] }
      if (path === '/officialTemplates/official-1/schema') {
        return {
          templateId: 'official-1', name: 'Report Writer', scenario: 'reporting',
          fields: [{ key: 'topic', label: 'Topic', required: true, type: 'string', inputHint: 'What to write about' }],
        }
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
      if (path === '/orchestrationInputs:upload') return { inputFileId: 'input-1', rowCount: 2 }
      throw new Error(`unexpected path ${path}`)
    },
    async requestBinary(path: string): Promise<unknown> {
      calls.push({ path })
      if (path === '/marketListings/listing-1/workbook') {
        return {
          base64: Buffer.from('workbook-bytes').toString('base64'),
          byteLength: 14,
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          filename: 'input.xlsx',
        }
      }
      if (path === '/officialTemplates/official-1/workbook') {
        return {
          base64: Buffer.from('template-workbook').toString('base64'),
          byteLength: 17,
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          filename: 'official-1.xlsx',
        }
      }
      throw new Error(`unexpected binary path ${path}`)
    },
  } as unknown as LoomApi
  return { calls, api }
}

/** A minimal tools registry that records what is registered (mirrors Cordis). */
function harness() {
  const registered: string[] = []
  let disposals = 0
  const context = {
    tools: {
      register(tool: { name: string }): () => void {
        registered.push(tool.name)
        return () => { disposals += 1 }
      },
    },
    get(): unknown {
      return undefined
    },
  } as unknown as Context
  return { context, registered, disposeCount: () => disposals }
}

console.log('Loomloom API surface verification')
console.log('─────────────────────────────────')

const { calls, api } = fakeApi()
const service = new LoomSkillbotService(api)

console.log('\n• service layer (skillbots.ts)')

await checkAsync('getBalance converts availableBalanceT / 1e7', async () => {
  const balance = await service.getBalance()
  assert.deepEqual(balance, { currency: 'CNY', availableBalance: '1.25' })
})

await checkAsync('listMyListings parses review state and converted fee', async () => {
  const listings = await service.listMyListings()
  assert.deepEqual(listings as unknown as CreatorListing[], [{
    id: 'my-listing-1', name: 'My SkillBot', description: 'Mine', available: true,
    status: 'published', saleStatus: 'listed', fixedFee: '0.2', currency: 'CNY', reviewStatus: 'approved',
  }])
})

await checkAsync('listCreatorTransactions converts both amounts', async () => {
  const transactions = await service.listCreatorTransactions()
  assert.deepEqual(transactions as unknown as CreatorTransaction[], [{
    runTransactionId: 'txn-1', runId: 'run-1', listingId: 'listing-1', skillName: 'Copywriter',
    taskFixedFee: '0.5', finalBuyerPayable: '1.5', currency: 'CNY', transactionStatus: 'settled',
  }])
})

await checkAsync('publishListing converts decimal fee into taskFixedFeeT', async () => {
  await service.publishListing({
    displayName: 'My Bot', templateId: 'template-1', templateVersionId: 'version-1', taskFixedFee: 0.5,
  })
  const post = calls.filter(entry => entry.path === '/marketListings' && entry.init?.method === 'POST').at(-1)
  assert.ok(post, 'expected POST /marketListings')
  const body = JSON.parse(String(post.init?.body)) as Record<string, unknown>
  assert.equal(body.taskFixedFeeT, 5_000_000)
  assert.equal(body.displayName, 'My Bot')
})

await checkAsync('publishListing rejects a missing display name before writing', async () => {
  await assert.rejects(
    () => service.publishListing({ displayName: '', templateId: 'template-1', templateVersionId: 'version-1', taskFixedFee: 0.5 }),
    /displayName is required/,
  )
})

await checkAsync('listOfficialTemplates tolerates templates/items wrappers', async () => {
  const templates = await service.listOfficialTemplates()
  assert.deepEqual(templates, [{ templateId: 'official-1', name: 'Report Writer', scenario: 'reporting', outputType: 'xlsx', version: 'v1' }])
})

await checkAsync('getTemplateSchema surfaces field hints', async () => {
  const schema = await service.getTemplateSchema('official-1')
  assert.equal(schema.templateId, 'official-1')
  assert.deepEqual(schema.fields, [{ key: 'topic', label: 'Topic', required: true, valueType: 'string', inputHint: 'What to write about' }])
})

await checkAsync('listMyTemplates supplies the version id needed to publish', async () => {
  const templates = await service.listMyTemplates()
  assert.deepEqual(templates, [{
    templateId: 'my-template-1', name: 'cv-portfolio-review', status: 'active',
    latestVersionId: 'version-9', publishedVersionId: 'version-8', outputType: 'text',
  }])
})

await checkAsync('uploadOrchestrationInput base64 encodes JSONL content', async () => {
  const result = await service.uploadOrchestrationInput('rows.jsonl', '{"a":1}\n{"a":2}\n')
  assert.deepEqual(result, { inputFileId: 'input-1', rowCount: 2 })
  const upload = calls.filter(entry => entry.path === '/orchestrationInputs:upload').at(-1)
  const body = JSON.parse(String(upload?.init?.body)) as Record<string, unknown>
  assert.equal(Buffer.from(String(body.content), 'base64').toString('utf8'), '{"a":1}\n{"a":2}\n')
})

await checkAsync('downloadMarketWorkbook returns decodable bytes', async () => {
  const download = await service.downloadMarketWorkbook('listing-1')
  assert.equal(Buffer.from(download.base64, 'base64').toString('utf8'), 'workbook-bytes')
  assert.equal(download.filename, 'input.xlsx')
})

await checkAsync('downloadTemplateWorkbook returns decodable bytes', async () => {
  const download = await service.downloadTemplateWorkbook('official-1')
  assert.equal(Buffer.from(download.base64, 'base64').toString('utf8'), 'template-workbook')
})

console.log('\n• tool layer (tools.ts)')

const setup = harness()
const dispose = registerLoomTools(setup.context, service)
check('registers exactly 13 model-visible tools', () => {
  assert.deepEqual(setup.registered, [
    'loomloom_list_skillbots', 'loomloom_get_skillbot', 'loomloom_prepare_execution',
    'loomloom_execute_skillbot', 'loomloom_get_run', 'loomloom_get_run_results',
    'loomloom_get_balance', 'loomloom_list_my_listings', 'loomloom_list_creator_transactions',
    'loomloom_publish_listing', 'loomloom_list_official_templates', 'loomloom_get_template_schema',
    'loomloom_list_my_templates',
  ])
})
check('dispose releases all tool registrations', () => {
  dispose()
  assert.equal(setup.disposeCount(), 13)
})

console.log('\n• summary')
console.log(`passed: ${passed}`)
console.log(`failed: ${failed}`)
if (failures.length > 0) {
  console.log('\nFailures:')
  for (const failure of failures) console.log(`  - ${failure}`)
  process.exitCode = 1
}