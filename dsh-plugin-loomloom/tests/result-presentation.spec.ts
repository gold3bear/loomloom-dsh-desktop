import assert from 'node:assert/strict'
import test from 'node:test'
import { jsonToMarkdown, parseInlineJson } from '../src/result-presentation.js'

test('an artifact that is not JSON is left for the caller to render as text', () => {
  assert.equal(parseInlineJson('a plain sentence'), undefined)
  assert.equal(parseInlineJson('{ not json'), undefined)
  // A scalar payload is already its own best presentation; a one-cell table is worse.
  assert.equal(parseInlineJson('42'), undefined)
  assert.equal(parseInlineJson('"done"'), undefined)
})

test('a JSON object or array payload is recognized', () => {
  assert.deepEqual(parseInlineJson('{"a":1}'), { a: 1 })
  assert.deepEqual(parseInlineJson('  [1,2]  '), [1, 2])
})

test('a row array becomes a table whose columns follow first appearance', () => {
  const markdown = jsonToMarkdown([{ title: 'A', words: 10 }, { title: 'B', tone: 'warm' }])

  assert.equal(markdown, [
    '| title | words | tone |',
    '| --- | --- | --- |',
    '| A | 10 |  |',
    '| B |  | warm |',
  ].join('\n'))
})

test('a single object becomes a field/value table with dotted paths', () => {
  const markdown = jsonToMarkdown({ topic: 'launch', slides: [{}, {}], meta: { author: 'daf' } })

  assert.match(markdown, /\| field \| value \|/u)
  assert.match(markdown, /\| topic \| launch \|/u)
  assert.match(markdown, /\| meta\.author \| daf \|/u)
  assert.match(markdown, /\| slides \| \[2 items\] \|/u)
})

test('nesting stops at a fixed depth instead of exploding a wide payload', () => {
  const markdown = jsonToMarkdown({ a: { b: { c: { d: 1 } } } })

  assert.match(markdown, /\| a\.b \| \{…\} \|/u)
  assert.doesNotMatch(markdown, /a\.b\.c/u)
})

test('a scalar array becomes a one-column table', () => {
  assert.equal(jsonToMarkdown(['x', 'y']), '| value |\n| --- |\n| x |\n| y |')
})

test('rows beyond the cap are summarised rather than dropped silently', () => {
  const rows = Array.from({ length: 25 }, (_, index) => ({ index }))
  const markdown = jsonToMarkdown(rows)

  assert.match(markdown, /_showing 20 of 25 rows_/u)
  assert.match(markdown, /\| 19 \|/u)
  assert.doesNotMatch(markdown, /\| 20 \|/u)
})

test('columns beyond the cap are reported', () => {
  const wide = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`k${String(index)}`, index]))
  const markdown = jsonToMarkdown([wide])

  assert.match(markdown, /_2 more column\(s\) omitted_/u)
})

test('a pipe or a newline inside a value cannot break the table', () => {
  const markdown = jsonToMarkdown([{ text: 'a|b', note: 'line1\nline2' }])

  assert.match(markdown, /a\\\|b/u)
  assert.match(markdown, /line1 line2/u)
  assert.equal(markdown.split('\n').length, 3)
})

test('a long value is elided so one cell cannot dominate the card', () => {
  const markdown = jsonToMarkdown([{ body: 'x'.repeat(400) }])
  const cellText = markdown.split('\n')[2] ?? ''

  assert.ok(cellText.length < 140, `cell was ${String(cellText.length)} chars`)
  assert.match(cellText, /…/u)
})

test('containers inside a cell are shape hints, not raw dumps', () => {
  const markdown = jsonToMarkdown([{ nested: { a: 1 }, list: [1, 2, 3], empty: [] }])

  assert.match(markdown, /\{…\}/u)
  assert.match(markdown, /\[3 items\]/u)
  assert.match(markdown, /\[\]/u)
})

test('null stays visible as null rather than becoming an empty cell', () => {
  assert.equal(jsonToMarkdown([{ a: null }]), '| a |\n| --- |\n| null |')
})

test('empty containers produce a readable marker, never a malformed table', () => {
  assert.equal(jsonToMarkdown([]), '_(empty list)_')
  assert.equal(jsonToMarkdown({}), '_(empty object)_')
  assert.equal(jsonToMarkdown(null), '_(no result)_')
  assert.equal(jsonToMarkdown(undefined), '_(no result)_')
})

test('a bare scalar falls back to a fenced block rather than a one-cell table', () => {
  assert.equal(jsonToMarkdown('done'), '```\ndone\n```')
})

test('columns are capped only by the requested option, not a fixed shape', () => {
  const markdown = jsonToMarkdown([{ a: 1, b: 2 }], { maxColumns: 1 })

  assert.match(markdown, /_1 more column\(s\) omitted_/u)
  assert.doesNotMatch(markdown, /\| b \|/u)
})
