import assert from 'node:assert/strict'
import test from 'node:test'
import { selectShengsuanyunDefaultModel } from '../src/default-model.js'

test('uses the DSH default-model service instead of local provider settings', async () => {
  let saved: unknown
  const agentDefaultModel = { async saveSelection(value: unknown): Promise<void> { saved = value } }
  await selectShengsuanyunDefaultModel({
    get(name: string) { return name === 'agentDefaultModel' ? agentDefaultModel : undefined },
  } as never)
  assert.deepEqual(saved, {
    provider: 'shengsuanyun',
    model: 'deepseek/deepseek-v4-flash',
  })
})
