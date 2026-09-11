import assert from 'node:assert/strict'
import test from 'node:test'
import { MAX_META_CHARS, MAX_META_ARTIFACTS, runResultMeta } from '../src/run-result-meta.js'

function artifact(id: string, inlineText?: string): { id: string, label: string, inlineText?: string } {
  return { id, label: `artifact ${id}`, ...(inlineText === undefined ? {} : { inlineText }) }
}

test('row counts and status are projected without input rows', () => {
  const meta = runResultMeta({ runId: 'run-1', status: 'completed', totalRows: 4, completedRows: 3, failedRows: 1 })
  assert.deepEqual(meta.counts, { total: 4, completed: 3, failed: 1 })
  assert.equal(meta.status, 'completed')
  assert.equal(meta.runId, 'run-1')
  assert.deepEqual(meta.artifacts, [])
})

test('a status the Host cannot see is reported as unknown rather than empty', () => {
  assert.equal(runResultMeta({}).status, 'unknown')
  assert.deepEqual(runResultMeta({}).counts, { total: 0, completed: 0, failed: 0 })
})

test('a JSON artifact becomes a described table and keeps its download link', () => {
  const meta = runResultMeta({
    status: 'completed',
    artifacts: [{ id: 'a1', label: 'rows', mimeType: 'application/json', accessUrl: 'https://x/y', inlineText: '[{"n":1}]' }],
  })
  assert.equal(meta.artifacts[0]?.accessUrl, 'https://x/y')
  assert.equal(meta.artifacts[0]?.mimeType, 'application/json')
  assert.deepEqual(meta.artifacts[0]?.view, {
    kind: 'table', columns: ['n'], rows: [['1']], totalRows: 1, omittedColumns: 0,
  })
})

test('a non-JSON artifact is carried as text, capped by the artifact budget', () => {
  const meta = runResultMeta({ status: 'completed', artifacts: [artifact('a1', 'plain words')] })
  assert.deepEqual(meta.artifacts[0]?.view, { kind: 'text', text: 'plain words' })
  assert.equal(meta.artifacts[0]?.truncated, undefined)

  const huge = runResultMeta({ status: 'completed', artifacts: [artifact('a2', 'y'.repeat(MAX_META_CHARS + 100))] })
  assert.equal(huge.artifacts[0]?.truncated, true)
  assert.ok(JSON.stringify(huge).length <= MAX_META_CHARS + 200)
})

test('an artifact with no inline content has no view to draw', () => {
  const meta = runResultMeta({ status: 'completed', artifacts: [artifact('a1'), artifact('a2', '   ')] })
  assert.equal(meta.artifacts[0]?.view, undefined)
  assert.equal(meta.artifacts[1]?.view, undefined)
})

test('artifacts beyond the cap are counted, never dropped silently', () => {
  const artifacts = Array.from({ length: MAX_META_ARTIFACTS + 2 }, (_, index) => artifact(`a${String(index)}`, '[{"n":1}]'))
  const meta = runResultMeta({ status: 'completed', artifacts })
  assert.equal(meta.artifacts.length, MAX_META_ARTIFACTS)
  assert.equal(meta.omittedArtifacts, 2)
})

/** A record array wide and long enough that one table alone exceeds the budget. */
function oversizedRows(rows: number): string {
  const keys = ['k0', 'k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7']
  return JSON.stringify(Array.from({ length: rows }, (_, index) => {
    const row: Record<string, unknown> = { index }
    for (const key of keys) row[key] = `${key}-${String(index)}-${'z'.repeat(120)}`
    return row
  }))
}

test('the whole payload stays inside its session-log budget', () => {
  const wide = oversizedRows(80)
  const meta = runResultMeta({
    status: 'completed',
    artifacts: [artifact('a1', wide), artifact('a2', wide), artifact('a3', wide)],
  })
  assert.ok(JSON.stringify(meta).length <= MAX_META_CHARS, `meta grew to ${String(JSON.stringify(meta).length)}`)
  assert.equal(meta.truncated, true)
})

test('an oversized payload loses rows before it loses artifacts', () => {
  const wide = oversizedRows(80)
  const meta = runResultMeta({ status: 'completed', artifacts: [artifact('a1', wide), artifact('a2', wide)] })
  assert.equal(meta.artifacts.length, 2)
  const view = meta.artifacts[0]?.view
  assert.equal(view?.kind, 'table')
  assert.ok(view?.kind === 'table' && view.rows.length < 20)
  assert.equal(meta.artifacts[0]?.truncated, true)
  assert.ok(JSON.stringify(meta).length <= MAX_META_CHARS)
})

test('a payload that cannot fit even without rows drops views, then artifacts', () => {
  const hugeLabel = 'L'.repeat(MAX_META_CHARS + 1000)
  const meta = runResultMeta({
    status: 'completed',
    artifacts: [{ id: 'a1', label: hugeLabel, inlineText: '[{"n":1}]' }],
  })
  assert.deepEqual(meta.artifacts, [])
  assert.equal(meta.omittedArtifacts, 1)
  assert.equal(meta.truncated, true)
})

test('a payload with nothing to trim reports no truncation', () => {
  const meta = runResultMeta({ status: 'completed', totalRows: 1, completedRows: 1, failedRows: 0, artifacts: [artifact('a1', '[{"n":1}]')] })
  assert.equal(meta.truncated, undefined)
})
