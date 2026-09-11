import assert from 'node:assert/strict'
import test from 'node:test'
import { describePayload, emptyMarker } from '../src/payload-view.js'

test('a record array becomes a table with the payload own column order', () => {
  const view = describePayload([{ title: 'A', words: 10 }, { title: 'B', tone: 'warm' }])
  assert.equal(view.kind, 'table')
  assert.deepEqual(view.kind === 'table' ? view.columns : [], ['title', 'words', 'tone'])
  assert.deepEqual(view.kind === 'table' ? view.rows : [], [['A', '10', ''], ['B', '', 'warm']])
  assert.equal(view.kind === 'table' ? view.totalRows : 0, 2)
  assert.equal(view.kind === 'table' ? view.omittedColumns : 0, 0)
})

test('row and column caps are reported instead of silently dropping data', () => {
  const rows = Array.from({ length: 25 }, (_, index) => ({ a: index, b: index, c: index, d: index }))
  const view = describePayload(rows, { maxRows: 3, maxColumns: 2 })
  assert.equal(view.kind, 'table')
  if (view.kind !== 'table') return
  assert.equal(view.rows.length, 3)
  assert.equal(view.totalRows, 25)
  assert.equal(view.omittedColumns, 2)
})

test('cells are escaped, collapsed and elided so a value cannot break the table', () => {
  const view = describePayload([{ text: 'a|b', note: 'line1\nline2', long: 'x'.repeat(400) }])
  assert.equal(view.kind, 'table')
  if (view.kind !== 'table') return
  assert.deepEqual(view.rows[0]?.[0], 'a\\|b')
  assert.deepEqual(view.rows[0]?.[1], 'line1 line2')
  assert.ok((view.rows[0]?.[2] ?? '').endsWith('…'))
  assert.equal((view.rows[0]?.[2] ?? '').length, 120)
})

test('a single record becomes dot-path fields, with containers kept as shape hints', () => {
  const view = describePayload({ topic: 'launch', slides: [{}, {}], meta: { author: 'daf' } })
  assert.equal(view.kind, 'fields')
  assert.deepEqual(view.kind === 'fields' ? view.rows : [], [
    ['topic', 'launch'],
    ['slides', '[2 items]'],
    ['meta.author', 'daf'],
  ])
})

test('a scalar array becomes one column and a bare scalar becomes text', () => {
  const scalars = describePayload(['x', 'y'])
  assert.equal(scalars.kind, 'scalars')
  assert.deepEqual(scalars.kind === 'scalars' ? scalars.rows : [], ['x', 'y'])
  assert.deepEqual(describePayload('done'), { kind: 'text', text: 'done' })
})

test('every empty payload names why it is empty', () => {
  assert.deepEqual(describePayload(null), { kind: 'empty', reason: 'no-result' })
  assert.deepEqual(describePayload(undefined), { kind: 'empty', reason: 'no-result' })
  assert.deepEqual(describePayload([]), { kind: 'empty', reason: 'empty-list' })
  assert.deepEqual(describePayload({}), { kind: 'empty', reason: 'empty-object' })
  assert.deepEqual(describePayload([{}]), { kind: 'empty', reason: 'no-fields' })
})

test('each empty reason has a marker the Markdown renderer can draw', () => {
  assert.equal(emptyMarker('no-result'), '_(no result)_')
  assert.equal(emptyMarker('empty-list'), '_(empty list)_')
  assert.equal(emptyMarker('empty-object'), '_(empty object)_')
  assert.equal(emptyMarker('no-fields'), '_(no fields)_')
})

test('a described payload is plain JSON, so it can be persisted and re-read', () => {
  const view = describePayload([{ a: 1 }])
  assert.deepEqual(JSON.parse(JSON.stringify(view)), view)
})
