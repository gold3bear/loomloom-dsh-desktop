// These specs render real components, so the suite runs under
// `tsconfig.tests.json` (see the package `test` script): tsx picks its JSX
// transform from a single tsconfig, and the host face has no `jsx` setting.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { LoomloomMarketPage } from '../src/client/LoomloomMarketPage.js'
import { LoomloomRunResultCard } from '../src/client/LoomloomRunResultCard.js'
import { zh } from '../src/client/locales.js'

/**
 * The real dictionary, with `{name}` placeholders filled, so these assertions
 * read the copy a user actually sees instead of locale keys.
 */
function t(key: keyof typeof zh, params?: Record<string, unknown>): string {
  const template = zh[key]
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/gu, (_match, name: string) => String(params[name] ?? ''))
}

/** A settled tool result, as the conversation hands it to a registered view. */
function settled(overrides: Record<string, unknown> = {}): unknown {
  return {
    kind: 'tool-result',
    seq: 1,
    time: 0,
    callId: 'call-1',
    call: { name: 'loomloom_get_run_results', argsRaw: '{}' },
    callTime: 0,
    content: [{ type: 'text', text: 'completed: 2/2 completed, 0 failed.' }],
    isError: false,
    subCalls: [],
    ...overrides,
  }
}

/** A payload in the shape the Host writes through `output.presentationMeta`. */
function meta(overrides: Record<string, unknown> = {}): unknown {
  return {
    v: 1,
    runId: 'run-1',
    status: 'completed',
    counts: { total: 12, completed: 11, failed: 1 },
    artifacts: [{
      id: 'a1',
      label: 'Ranked candidates',
      mimeType: 'application/json',
      accessUrl: 'https://loom.example/out.csv',
      view: {
        kind: 'table',
        columns: ['name', 'score'],
        rows: [['Ada', '91'], ['Lin', '88']],
        totalRows: 12,
        omittedColumns: 1,
      },
    }],
    ...overrides,
  }
}

test('the result card draws status, counts, the artifact table and its download link', () => {
  const markup = renderToStaticMarkup(createElement(
    LoomloomRunResultCard,
    { block: settled({ meta: meta() }), t } as never,
  ))

  assert.match(markup, /SkillBot 运行结果/u)
  assert.match(markup, /completed/u)
  assert.match(markup, /Ranked candidates/u)
  assert.match(markup, /<th[^>]*>name<\/th>/u)
  assert.match(markup, /<td[^>]*>Ada<\/td>/u)
  assert.match(markup, /href="https:\/\/loom\.example\/out\.csv"/u)
  assert.match(markup, /下载/u)
  // Elision is stated rather than silently applied.
  assert.match(markup, /显示 2 \/ 12 行/u)
  assert.match(markup, /省略 1 列/u)
})

test('the result card reports artifacts it did not draw', () => {
  const markup = renderToStaticMarkup(createElement(
    LoomloomRunResultCard,
    { block: settled({ meta: meta({ omittedArtifacts: 2, truncated: true }) }), t } as never,
  ))
  assert.match(markup, /另有 2 个产物未展示/u)
  assert.match(markup, /内容已截断/u)
})

test('a call with no readable payload falls back to the model-facing text', () => {
  const markup = renderToStaticMarkup(createElement(
    LoomloomRunResultCard,
    { block: settled(), t } as never,
  ))
  assert.match(markup, /completed: 2\/2 completed, 0 failed\./u)
})

test('a running call and a failed call each render their own state', () => {
  const running = renderToStaticMarkup(createElement(
    LoomloomRunResultCard,
    { block: { callId: 'call-1', name: 'loomloom_get_run_results', argsRaw: '{}', turn: 1, step: 1, time: 0, subCalls: [] }, t } as never,
  ))
  assert.match(running, /正在运行/u)

  const failed = renderToStaticMarkup(createElement(
    LoomloomRunResultCard,
    { block: settled({ isError: true, content: [{ type: 'text', text: 'run not found' }] }), t } as never,
  ))
  assert.match(failed, /run not found/u)
})

test('the market page renders its header, search and loading skeleton before data arrives', () => {
  const markup = renderToStaticMarkup(createElement(LoomloomMarketPage, {
    t,
    sessions: { list: { getSnapshot: () => ({}), subscribe: () => () => {} } },
    workspaceOf: () => undefined,
  } as never))

  assert.match(markup, /云端 SkillBot 市场/u)
  assert.match(markup, /每位创作者的一方 SkillBot 工作站/u)
  assert.match(markup, /搜索名称或简介/u)
  assert.match(markup, /正在加载/u)
  // The old preview affordance was a bare glyph in an empty box; it must not return.
  assert.ok(!markup.includes('☰'))
})
