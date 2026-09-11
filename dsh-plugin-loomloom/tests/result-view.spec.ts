import assert from 'node:assert/strict'
import test from 'node:test'
import { readRunResultMeta, textFromContent } from '../src/client/result-view.js'

/** A payload in the shape the Host writes through `output.presentationMeta`. */
function meta(overrides: Record<string, unknown> = {}): unknown {
  return {
    v: 1,
    status: 'completed',
    counts: { total: 2, completed: 2, failed: 0 },
    artifacts: [{
      id: 'a1',
      label: 'rows',
      mimeType: 'application/json',
      accessUrl: 'https://example.test/out',
      view: { kind: 'table', columns: ['n'], rows: [['1'], ['2']], totalRows: 2, omittedColumns: 0 },
    }],
    ...overrides,
  }
}

test('a well-formed payload is read as the card needs it', () => {
  const value = readRunResultMeta(meta({ runId: 'run-1' }))
  assert.ok(value !== undefined)
  assert.equal(value.runId, 'run-1')
  assert.equal(value.status, 'completed')
  assert.deepEqual([value.total, value.completed, value.failed], [2, 2, 0])
  assert.equal(value.artifacts.length, 1)
  assert.equal(value.artifacts[0]?.label, 'rows')
  assert.equal(value.artifacts[0]?.view?.kind, 'table')
})

test('an unknown revision, a missing status or a non-object is refused', () => {
  assert.equal(readRunResultMeta(meta({ v: 99 })), undefined)
  assert.equal(readRunResultMeta({ v: 1, counts: {} }), undefined)
  assert.equal(readRunResultMeta(undefined), undefined)
  assert.equal(readRunResultMeta(null), undefined)
  assert.equal(readRunResultMeta('completed'), undefined)
  assert.equal(readRunResultMeta([1, 2]), undefined)
})

test('a malformed artifact is dropped, never half-drawn', () => {
  const value = readRunResultMeta(meta({
    artifacts: [
      { id: 'good', label: 'ok', view: { kind: 'text', text: 'hello' } },
      { id: 'no-label' },
      { id: 'bad-view', label: 'x', view: { kind: 'table', columns: ['a'], rows: 'nope' } },
      'not an object',
    ],
  }))
  assert.ok(value !== undefined)
  assert.deepEqual(value.artifacts.map(artifact => artifact.id), ['good', 'bad-view'])
  assert.equal(value.artifacts[1]?.view, undefined)
})

test('every payload view kind survives a round trip through the session log', () => {
  const view = (payload: unknown): unknown => readRunResultMeta(meta({
    artifacts: [{ id: 'a', label: 'l', view: payload }],
  }))?.artifacts[0]?.view

  assert.deepEqual(view({ kind: 'table', columns: ['a'], rows: [['1']], totalRows: 1, omittedColumns: 2 }), {
    kind: 'table', columns: ['a'], rows: [['1']], totalRows: 1, omittedColumns: 2,
  })
  assert.deepEqual(view({ kind: 'fields', rows: [['k', 'v']] }), { kind: 'fields', rows: [['k', 'v']] })
  assert.deepEqual(view({ kind: 'scalars', rows: ['x'] }), { kind: 'scalars', rows: ['x'] })
  assert.deepEqual(view({ kind: 'text', text: 'body' }), { kind: 'text', text: 'body' })
  assert.deepEqual(view({ kind: 'empty', reason: 'empty-list' }), { kind: 'empty', reason: 'empty-list' })
  assert.equal(view({ kind: 'future' }), undefined)
})

test('counting fields default instead of leaking undefined into the card', () => {
  const value = readRunResultMeta({ v: 1, status: 'queued', counts: { total: 'many' }, artifacts: [] })
  assert.ok(value !== undefined)
  assert.deepEqual([value.total, value.completed, value.failed], [0, 0, 0])
  assert.equal(value.pending, undefined)
})

test('the model-facing text is the fallback for a call with no payload', () => {
  assert.equal(textFromContent([{ type: 'text', text: 'completed: 1/1 completed.' }]), 'completed: 1/1 completed.')
  assert.equal(textFromContent([
    { type: 'text', text: 'first' },
    { type: 'image', text: 'ignored' },
    { type: 'text', text: 'second' },
  ]), 'first\n\nsecond')
  assert.equal(textFromContent([]), '')
})
