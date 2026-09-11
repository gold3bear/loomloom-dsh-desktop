import assert from 'node:assert/strict'
import test from 'node:test'
import type { LoomField } from '../src/client/api.js'
import { fieldControl, initialValues, missingRequired, payloadRow } from '../src/client/field-input.js'

function field(overrides: Partial<LoomField> & { readonly key: string }): LoomField {
  return { label: overrides.key, required: false, valueType: 'string', order: 10, ...overrides }
}

test('each published widget and value type draws the control the author asked for', () => {
  const cases: readonly [LoomField, string][] = [
    [field({ key: 'a', valueType: 'asset_ref' }), 'file'],
    [field({ key: 'b', valueType: 'enum' }), 'select'],
    [field({ key: 'c', widget: 'select' }), 'select'],
    [field({ key: 'd', valueType: 'string', enumValues: ['x', 'y'] }), 'select'],
    [field({ key: 'e', widget: 'textarea' }), 'textarea'],
    [field({ key: 'f', valueType: 'integer' }), 'number'],
    [field({ key: 'g', widget: 'input' }), 'text'],
    [field({ key: 'h', valueType: 'text_reference' }), 'text'],
    [field({ key: 'i' }), 'text'],
  ]
  for (const [input, expected] of cases) {
    assert.equal(fieldControl(input), expected, `${input.key} (${input.valueType}/${String(input.widget)})`)
  }
})

test('a select wins over the textarea widget because the value set is closed', () => {
  assert.equal(fieldControl(field({ key: 'a', widget: 'textarea', valueType: 'enum', enumValues: ['x'] })), 'select')
})

test('published defaults seed the form instead of leaving every field empty', () => {
  const values = initialValues([
    field({ key: 'style', defaultValue: 'linear' }),
    field({ key: 'slide_count', valueType: 'integer', defaultValue: '8' }),
    field({ key: 'flag', valueType: 'boolean', defaultValue: 'true' }),
    field({ key: 'empty', defaultValue: '' }),
    field({ key: 'none' }),
  ])

  assert.deepEqual(values, { style: 'linear', slide_count: 8, flag: true })
})

test('a non-numeric integer default stays usable text rather than becoming NaN', () => {
  assert.deepEqual(initialValues([field({ key: 'n', valueType: 'integer', defaultValue: 'auto' })]), { n: 'auto' })
})

test('missing required fields are reported before a quote is spent', () => {
  const fields = [
    field({ key: 'topic', required: true }),
    field({ key: 'audience', required: true }),
    field({ key: 'notes' }),
  ]

  assert.deepEqual(missingRequired(fields, { topic: 'x', notes: '' }).map(item => item.key), ['audience'])
  assert.deepEqual(missingRequired(fields, { topic: 'x', audience: 'y' }), [])
  assert.deepEqual(missingRequired(fields, { topic: '   ', audience: 'y' }).map(item => item.key), ['topic'])
  assert.deepEqual(missingRequired(fields, { topic: 'x', audience: 'y', notes: '' }), [])
})

test('an uploaded file id satisfies a required file field', () => {
  const fields = [field({ key: 'brief', required: true, valueType: 'asset_ref' })]

  assert.deepEqual(missingRequired(fields, {}).map(item => item.key), ['brief'])
  assert.deepEqual(missingRequired(fields, { brief: 'asset-1' }), [])
})

test('the submitted row omits blank optional fields and types integers as numbers', () => {
  const fields = [
    field({ key: 'topic' }),
    field({ key: 'slide_count', valueType: 'integer' }),
    field({ key: 'audience' }),
    field({ key: 'brief', valueType: 'asset_ref' }),
  ]

  const row = payloadRow(fields, { topic: 'launch', slide_count: '8', audience: '', brief: 'asset-1' })

  assert.deepEqual(row, { topic: 'launch', slide_count: 8, brief: 'asset-1' })
  assert.equal(typeof row.slide_count, 'number')
})

test('an integer that cannot be parsed is forwarded as written instead of dropped', () => {
  assert.deepEqual(payloadRow([field({ key: 'n', valueType: 'integer' })], { n: 'auto' }), { n: 'auto' })
})

test('a boolean false is a real value and survives the payload build', () => {
  assert.deepEqual(payloadRow([field({ key: 'flag', valueType: 'boolean' })], { flag: false }), { flag: false })
})
