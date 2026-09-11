import assert from 'node:assert/strict'
import test, { afterEach } from 'node:test'
import { readSkillbot } from '../src/client/api.js'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  delete (globalThis as { window?: unknown }).window
})

function stubOrigin(): void {
  Object.defineProperty(globalThis, 'window', {
    value: { location: { origin: 'http://127.0.0.1:4312' } },
    configurable: true,
    writable: true,
  })
}

function stubDetail(snapshot: unknown): void {
  stubOrigin()
  globalThis.fetch = async () => new Response(JSON.stringify({
    id: 'listing-1',
    displayName: '视觉演示生成器',
    executionAvailabilityStatus: 'available',
    inputSchemaSnapshot: typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot),
  }))
}

/**
 * The published schema shape measured across the live public market (916 fields
 * over 224 listings). Every key here was observed on the wire; none are invented.
 */
const PUBLISHED_FIELDS = {
  fields: [
    {
      key: 'topic',
      label: 'Topic (主题)',
      order: 10,
      presentation: { hint: 'One-line presentation subject', widget: 'textarea' },
      required: true,
      source_kind: 'user_input',
      value_type: 'string',
    },
    {
      key: 'mode',
      label: 'Mode',
      order: 5,
      presentation: { widget: 'select' },
      required: true,
      source_kind: 'user_input',
      value_type: 'enum',
      enum_values: ['fast', 'thorough'],
    },
    {
      key: 'slide_count',
      label: 'Slide count',
      order: 30,
      presentation: { placeholder: '8 or 12' },
      default_value: '8',
      source_kind: 'user_input',
      value_type: 'integer',
    },
    {
      key: 'style',
      label: 'Visual style',
      order: 40,
      presentation: { hint: 'Style key (default linear). Options: modern, linear, vercel-mesh.' },
      default_value: 'linear',
      source_kind: 'user_input',
      value_type: 'string',
    },
    {
      key: 'brief',
      label: 'Brief file',
      order: 60,
      presentation: { hint: 'Upload a brief' },
      source_kind: 'user_input',
      value_type: 'asset_ref',
      accepted_mime_types: ['application/pdf', 'text/markdown'],
      max_values: 3,
    },
  ],
}

test('the published input schema reaches the form with its hints, widgets and defaults intact', async () => {
  stubDetail(PUBLISHED_FIELDS)

  const detail = await readSkillbot('listing-1')

  assert.deepEqual(detail.fields.map(field => field.key), ['mode', 'topic', 'slide_count', 'style', 'brief'])
  assert.deepEqual(detail.fields[0], {
    key: 'mode',
    label: 'Mode',
    required: true,
    valueType: 'enum',
    order: 5,
    widget: 'select',
    enumValues: ['fast', 'thorough'],
  })
  assert.deepEqual(detail.fields[1], {
    key: 'topic',
    label: 'Topic (主题)',
    required: true,
    valueType: 'string',
    order: 10,
    widget: 'textarea',
    description: 'One-line presentation subject',
  })
  assert.equal(detail.fields[2].placeholder, '8 or 12')
  assert.equal(detail.fields[2].defaultValue, '8')
  assert.equal(detail.fields[2].valueType, 'integer')
  // The authoring hint is the only place a 26-option vocabulary is published.
  assert.match(String(detail.fields[3].description), /vercel-mesh/u)
  assert.equal(detail.fields[3].defaultValue, 'linear')
})

test('file inputs keep the mime types and arity the value must satisfy', async () => {
  stubDetail(PUBLISHED_FIELDS)

  const brief = (await readSkillbot('listing-1')).fields.find(field => field.key === 'brief')

  assert.equal(brief?.valueType, 'asset_ref')
  assert.deepEqual(brief?.acceptedMimeTypes, ['application/pdf', 'text/markdown'])
  assert.equal(brief?.maxValues, 3)
})

test('a schema-level description still outranks the presentation hint', async () => {
  stubDetail({
    fields: [{
      key: 'topic',
      label: 'Topic',
      description: 'Authoritative description',
      presentation: { hint: 'Secondary hint' },
      value_type: 'string',
    }],
  })

  assert.equal((await readSkillbot('listing-1')).fields[0].description, 'Authoritative description')
})

test('fields without a published order keep their schema position and sort last', async () => {
  stubDetail({
    fields: [
      { key: 'first', label: 'First', value_type: 'string' },
      { key: 'ordered', label: 'Ordered', order: 1, value_type: 'string' },
      { key: 'second', label: 'Second', value_type: 'string' },
    ],
  })

  assert.deepEqual((await readSkillbot('listing-1')).fields.map(field => field.key), ['ordered', 'first', 'second'])
})

test('a malformed or absent snapshot yields no fields instead of failing the detail', async () => {
  stubDetail('{not json')
  assert.deepEqual((await readSkillbot('listing-1')).fields, [])

  stubDetail({})
  assert.deepEqual((await readSkillbot('listing-1')).fields, [])
})

test('a field without a key is dropped rather than rendered unaddressable', async () => {
  stubDetail({ fields: [{ label: 'Nameless', value_type: 'string' }, { key: 'kept', label: 'Kept', value_type: 'string' }] })

  assert.deepEqual((await readSkillbot('listing-1')).fields.map(field => field.key), ['kept'])
})

test('scalar defaults from the wire are normalized to display strings', async () => {
  stubDetail({
    fields: [
      { key: 'count', label: 'Count', value_type: 'integer', default_value: 8 },
      { key: 'flag', label: 'Flag', value_type: 'string', default_value: true },
      { key: 'empty', label: 'Empty', value_type: 'string', default_value: '' },
    ],
  })

  const fields = (await readSkillbot('listing-1')).fields
  assert.equal(fields[0].defaultValue, '8')
  assert.equal(fields[1].defaultValue, 'true')
  assert.equal(fields[2].defaultValue, undefined)
})
