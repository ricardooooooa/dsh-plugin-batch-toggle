import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { JSDOM } from 'jsdom'
import { observePlacements } from '../src/ui/placement.ts'
import { actionView, createBatchStore } from '../src/ui/store.ts'
import type { BatchStatus } from '../src/types.ts'

const idle = (extra: Partial<BatchStatus> = {}): BatchStatus => ({
  busy: false, phase: 'idle', total: 0, completed: 0,
  candidates: ['plugin-a', 'plugin-b'], protected: ['dshmarket'], pendingRestore: [],
  snapshotCreatedAt: null, results: [], lastError: null, ...extra,
})
const tick = async () => { await new Promise(resolve => setTimeout(resolve, 0)) }

test('official plugin page appends one owned toolbar inside its existing header without moving host controls', () => {
  const dom = new JSDOM('<section data-plugin-panel><header data-window-drag><button>Install</button></header><main>Keep me</main></section>')
  let targets: HTMLElement[] = []
  const stop = observePlacements(dom.window.document, next => { targets = next })
  const panel = dom.window.document.querySelector('section')!
  const header = panel.querySelector('header')!
  assert.equal(targets.length, 1)
  assert.equal(panel.firstElementChild, header)
  assert.equal(header.lastElementChild, targets[0])
  assert.equal(header.firstElementChild?.tagName, 'BUTTON')
  assert.equal(panel.children[1].tagName, 'MAIN')
  assert.equal(panel.querySelector('button')?.textContent, 'Install')
  stop()
  assert.equal(panel.querySelectorAll('[data-batch-toggle-toolbar]').length, 0)
  assert.equal(panel.firstElementChild?.tagName, 'HEADER')
  assert.equal(header.children.length, 1)
  dom.window.close()
})

test('market inside official page shares the common toolbar; standalone markets get their own', () => {
  const dom = new JSDOM('<section data-plugin-panel><header data-window-drag></header><div data-dsh-market-root></div></section><div data-dsh-market-root id="standalone"><p>Original</p></div><div data-dsh-market-root data-dsh-market-crashed></div>')
  const stop = observePlacements(dom.window.document, () => {})
  assert.equal(dom.window.document.querySelectorAll('[data-batch-toggle-toolbar]').length, 2)
  assert.equal(dom.window.document.querySelector('#standalone')?.firstElementChild?.hasAttribute('data-batch-toggle-toolbar'), true)
  assert.equal(dom.window.document.querySelector('[data-dsh-market-crashed]')?.children.length, 0)
  stop()
  dom.window.close()
})

test('navigation, repeated observation and own mutations never duplicate toolbars or spin', async () => {
  const dom = new JSDOM('<main></main>')
  let updates = 0
  let last: HTMLElement[] = []
  const stop = observePlacements(dom.window.document, targets => { updates++; last = targets })
  const main = dom.window.document.querySelector('main')!
  main.innerHTML = '<div data-dsh-market-root><span>Market</span></div>'
  await tick()
  assert.equal(last.length, 1)
  const stopSecond = observePlacements(dom.window.document, () => {})
  await tick()
  assert.equal(dom.window.document.querySelectorAll('[data-batch-toggle-toolbar]').length, 1)
  assert.ok(updates <= 3, 'an observer must not repeatedly react to its own mutations')
  stopSecond()
  const removed = main.firstElementChild!
  removed.remove()
  await tick()
  assert.equal(last.length, 0)
  assert.equal(removed.querySelectorAll('[data-batch-toggle-toolbar]').length, 0)
  main.innerHTML = '<section data-plugin-panel><header data-window-drag></header></section>'
  await tick()
  assert.equal(last.length, 1)
  stop()
  main.innerHTML = '<div data-dsh-market-root></div>'
  await tick()
  assert.equal(dom.window.document.querySelectorAll('[data-batch-toggle-toolbar]').length, 0)
  dom.window.close()
})

test('pending snapshot prevents another disable while keeping restore available', () => {
  const view = actionView({ status: idle({ pendingRestore: ['plugin-a'], snapshotCreatedAt: '2026-10-30T00:00:00Z' }), loading: false, submitting: null, error: null })
  assert.equal(view.disableDisabled, true)
  assert.equal(view.restoreDisabled, false)
  assert.match(view.message, /1/)
})

test('an interrupted snapshot with no pending targets blocks disable and allows safe record cleanup', () => {
  const view = actionView({ status: idle({ pendingRestore: [], snapshotCreatedAt: '2026-10-30T00:00:00Z' }), loading: false, submitting: null, error: null })
  assert.equal(view.disableDisabled, true)
  assert.equal(view.restoreDisabled, false)
  assert.equal(view.hasSnapshot, true)
  assert.match(view.message, /未完成|清理|恢复记录/)
})

test('host busy and pending HTTP requests block both actions', () => {
  for (const state of [
    { status: idle({ busy: true, phase: 'disabling', total: 2, completed: 1 }), submitting: null },
    { status: idle(), submitting: 'disable' as const },
  ]) {
    const view = actionView({ ...state, loading: false, error: null })
    assert.equal(view.disableDisabled, true)
    assert.equal(view.restoreDisabled, true)
    assert.equal(view.busy, true)
  }
})

test('partial failure and restart results are not presented as full success', () => {
  const view = actionView({ status: idle({ pendingRestore: ['plugin-b'], results: [
    { name: 'plugin-a', action: 'disable', outcome: 'restart-required' },
    { name: 'plugin-b', action: 'disable', outcome: 'failed', detail: 'write refused' },
  ] }), loading: false, submitting: null, error: null })
  assert.equal(view.tone, 'warning')
  assert.match(view.message, /失败|未完成|部分/)
  assert.equal(view.restartRequired, true)
})

test('successful restore retry clears historical failure and restart warnings after snapshot completion', () => {
  const history: BatchStatus['results'] = [
    { name: 'plugin-a', action: 'disable', outcome: 'restart-required' },
    { name: 'plugin-a', action: 'restore', outcome: 'failed', detail: 'temporary error' },
    { name: 'plugin-a', action: 'restore', outcome: 'applied' },
  ]
  const view = actionView({ status: idle({ pendingRestore: [], snapshotCreatedAt: null, results: history }), loading: false, submitting: null, error: null })
  assert.equal(view.tone, 'normal')
  assert.equal(view.restartRequired, false)
  assert.match(view.message, /已完成/)
  assert.doesNotMatch(view.message, /失败|未完成|重启/)
  assert.equal(history.length, 3, 'historical entries remain available to the detailed results panel')
})

test('a still-pending failure stays visible while another plugin has recovered successfully', () => {
  const view = actionView({ status: idle({ pendingRestore: ['plugin-b'], snapshotCreatedAt: '2026-10-30T00:00:00Z', results: [
    { name: 'plugin-a', action: 'disable', outcome: 'restart-required' },
    { name: 'plugin-b', action: 'restore', outcome: 'failed' },
    { name: 'plugin-a', action: 'restore', outcome: 'applied' },
    { name: 'plugin-b', action: 'restore', outcome: 'failed' },
  ] }), loading: false, submitting: null, error: null })
  assert.equal(view.tone, 'warning')
  assert.match(view.message, /1 项/)
  assert.equal(view.restartRequired, false)
})

test('status fetch failure disables both actions even when stale status was ready', () => {
  const view = actionView({ status: idle({ pendingRestore: ['a'] }), loading: false, submitting: null, error: '无法读取状态' })
  assert.equal(view.disableDisabled, true)
  assert.equal(view.restoreDisabled, true)
  assert.equal(view.tone, 'error')
  assert.match(view.message, /无法读取状态/)
})

test('empty candidate list never enables disable; empty restore never enables restore', () => {
  const view = actionView({ status: idle({ candidates: [] }), loading: false, submitting: null, error: null })
  assert.equal(view.disableDisabled, true)
  assert.equal(view.restoreDisabled, true)
})

test('shared store coalesces simultaneous reads and exposes a server busy conflict', async () => {
  let reads = 0
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json')
    if (request.method === 'GET') {
      reads++
      setTimeout(() => response.end(JSON.stringify(idle())), 20)
    } else {
      response.statusCode = 409
      response.end(JSON.stringify({ error: 'busy', message: '另一个批操作正在执行' }))
    }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/dsh-plugin-batch-toggle`
  const store = createBatchStore({ baseUrl })
  try {
    await Promise.all([store.refresh(), store.refresh()])
    assert.equal(reads, 1)
    await store.run('disable')
    assert.match(store.getSnapshot().error ?? '', /另一个批操作/)
    assert.equal(store.getSnapshot().submitting, null)
  } finally {
    store.dispose()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})

test('accepted operation refreshes status and an invalid later response fails closed', async () => {
  let accepted = false
  let invalid = false
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json')
    if (request.method === 'POST') {
      assert.equal(request.url, '/api/dsh-plugin-batch-toggle/disable')
      accepted = true
      response.statusCode = 202
      response.end('{"accepted":true}')
    } else response.end(JSON.stringify(invalid ? { success: true } : idle({ busy: accepted, phase: accepted ? 'disabling' : 'idle' })))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const store = createBatchStore({ baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/dsh-plugin-batch-toggle` })
  try {
    await store.refresh()
    await store.run('disable')
    assert.equal(store.getSnapshot().status?.phase, 'disabling')
    invalid = true
    await store.refresh()
    assert.ok(store.getSnapshot().error)
    assert.equal(actionView(store.getSnapshot()).restoreDisabled, true)
  } finally {
    store.dispose()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})

test('default API requests retain the application baseURI prefix instead of reaching the origin root', async () => {
  const paths: string[] = []
  const server = createServer((request, response) => {
    paths.push(request.url ?? '')
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify(idle()))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const dom = new JSDOM('', { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/harness/` })
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document })
  const store = createBatchStore()
  try {
    await store.refresh()
    assert.deepEqual(paths, ['/harness/api/dsh-plugin-batch-toggle/status'])
    assert.equal(store.getSnapshot().error, null)
  } finally {
    store.dispose()
    if (previous) Object.defineProperty(globalThis, 'document', previous)
    else Reflect.deleteProperty(globalThis, 'document')
    dom.window.close()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
