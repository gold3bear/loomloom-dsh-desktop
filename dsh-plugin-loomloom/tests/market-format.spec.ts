import assert from 'node:assert/strict'
import test from 'node:test'
import type { LoomStorefrontEntry } from '../src/client/api.js'
import { feeText, filterEntries, monogram, updatedText } from '../src/client/market-format.js'

function entry(overrides: Partial<LoomStorefrontEntry> & { readonly id: string }): LoomStorefrontEntry {
  return {
    name: overrides.id,
    description: '',
    available: true,
    fields: [],
    ...overrides,
  }
}

const resume = entry({
  id: 'a',
  name: 'Recruitment Specialist',
  description: 'Batch resume screening',
  creatorNickname: 'daf',
  fixedFee: '0.0100000',
  currency: 'CNY',
})
const slides = entry({ id: 'b', name: 'Slide Maker', description: 'Deck generation', creatorNickname: 'Lin' })

test('a blank query keeps every entry in storefront order', () => {
  assert.deepEqual(filterEntries([resume, slides], '   ').map(item => item.id), ['a', 'b'])
})

test('the query matches name, description and creator, case-insensitively', () => {
  assert.deepEqual(filterEntries([resume, slides], 'SLIDE').map(item => item.id), ['b'])
  assert.deepEqual(filterEntries([resume, slides], 'resume').map(item => item.id), ['a'])
  assert.deepEqual(filterEntries([resume, slides], 'lin').map(item => item.id), ['b'])
  assert.deepEqual(filterEntries([resume, slides], 'nothing'), [])
})

test('an entry without a creator nickname cannot be matched by one', () => {
  assert.deepEqual(filterEntries([entry({ id: 'c' })], 'undefined'), [])
})

test('the fee carries its currency, and a free listing carries the label', () => {
  assert.equal(feeText(resume, 'Free'), '0.0100000 CNY')
  assert.equal(feeText(slides, 'Free'), 'Free')
  assert.equal(feeText(entry({ id: 'd', fixedFee: '2' }), 'Free'), '2')
})

test('a publication date is rendered for the viewer, and an unparsable one is dropped', () => {
  assert.equal(updatedText(undefined), undefined)
  assert.equal(updatedText('  '), undefined)
  assert.equal(updatedText('not a date'), undefined)
  assert.equal(updatedText('2026-08-07T10:26:25.000Z'), new Date('2026-08-07T10:26:25.000Z').toLocaleDateString())
})

test('the avatar tile takes the first character of the creator or the name', () => {
  assert.equal(monogram('daf'), 'D')
  assert.equal(monogram('林雪松'), '林')
  assert.equal(monogram(undefined), '?')
  assert.equal(monogram('   '), '?')
})
