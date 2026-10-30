import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import { createBatchStore, updateView } from '../src/ui/store.ts'
import type { ClientState } from '../src/ui/store.ts'
import type { BatchStatus, UpdateStatus, UpdateResult } from '../src/types.ts'

const updateStatus = (extra: Partial<UpdateStatus> = {}): UpdateStatus => ({
  busy: false, phase: 'idle', total: 0, completed: 0, current: null, stage: null,
  results: [], lastError: null, startedAt: null, finishedAt: null, stopRequested: false, ...extra,
})
const status = (extra: Partial<BatchStatus> = {}): BatchStatus => ({
  busy: false, phase: 'idle', total: 0, completed: 0, candidates: ['a'], protected: ['dshmarket'],
  pendingRestore: [], snapshotCreatedAt: null, results: [], lastError: null, update: updateStatus(), ...extra,
})
const item = (extra: Partial<UpdateResult> = {}): UpdateResult => ({
  name: 'a', beforeVersion: '1.0.0', targetVersion: '1.1.0', installedVersion: '1.1.0',
  outcome: 'updated', message: '更新成功', enabled: false, rollback: 'not-needed', restartRequired: false, recoveryNeeded: false, ...extra,
})
const clientState = (value: BatchStatus): ClientState => ({ status: value, loading: false, submitting: null, error: null })

async function api(t: TestContext, handler: (request: IncomingMessage, response: ServerResponse) => void) {
  const server = createServer(handler)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing listener')
  t.after(async () => {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  })
  return `http://127.0.0.1:${address.port}/api/dsh-plugin-batch-toggle`
}
function reply(response: ServerResponse, body: unknown, code = 200) {
  response.writeHead(code, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(body))
}

test('one-click update remains available with a legacy recovery snapshot and no disable candidates', () => {
  const view = updateView(clientState(status({ candidates: [], pendingRestore: ['a'], snapshotCreatedAt: '2026-10-30T00:00:00Z' })))
  assert.equal(view.label, '一键更新')
  assert.equal(view.action, 'update')
  assert.equal(view.disabled, false)
  assert.equal(view.recoveryNeeded, true)
  assert.match(view.message, /恢复|接续/)
})

test('updating phase shows current stage and offers only safe stop; acknowledged stop cannot be repeated', () => {
  const running = status({ busy: true, phase: 'updating', update: updateStatus({ busy: true, phase: 'updating', total: 3, completed: 1, current: 'plugin-b', stage: 'installing', results: [item({ outcome: 'failed' })] }) })
  let view = updateView(clientState(running))
  assert.equal(view.label, '停止更新')
  assert.equal(view.action, 'stop')
  assert.equal(view.disabled, false)
  assert.match(view.message, /plugin-b/)
  assert.match(view.message, /1\/3/)
  assert.match(view.message, /安装/)
  running.update!.stopRequested = true
  view = updateView(clientState(running))
  assert.match(view.label, /正在停止/)
  assert.equal(view.disabled, true)
})

test('update summaries do not mix legacy failure history or lose outstanding recovery responsibility', () => {
  const view = updateView(clientState(status({
    pendingRestore: ['a'], snapshotCreatedAt: '2026-10-30T00:00:00Z',
    results: [{ name: 'a', action: 'restore', outcome: 'failed' }],
    update: updateStatus({ total: 3, completed: 3, results: [item(), item({ name: 'b', outcome: 'failed', rollback: 'succeeded' }), item({ name: 'c' })] }),
  })))
  assert.equal(view.updated, 2)
  assert.equal(view.failed, 1)
  assert.equal(view.recoveryNeeded, true)
  assert.match(view.message, /失败 1/)
})

test('missing update capability is explicitly unavailable, while legacy busy does not become stop-update', () => {
  let view = updateView(clientState(status({ update: undefined })))
  assert.equal(view.disabled, true)
  assert.match(view.message, /不支持|不可用|升级|更新本插件/)
  view = updateView(clientState(status({ busy: true, phase: 'restoring' })))
  assert.equal(view.disabled, true)
  assert.equal(view.action, 'update')
})

test('a finished stopped batch permits a fresh one-click update', () => {
  const view = updateView(clientState(status({ update: updateStatus({ stopRequested: true, total: 3, completed: 1, finishedAt: '2026-10-30T00:05:00Z', results: [item()] }) })))
  assert.equal(view.label, '一键更新')
  assert.equal(view.disabled, false)
  assert.match(view.message, /已停止/)
})

test('malformed update fields fail closed instead of enabling mutation', async t => {
  const malformed = status()
  ;(malformed.update! as unknown as Record<string, unknown>).stopRequested = 'false'
  const baseUrl = await api(t, (_request, response) => reply(response, malformed))
  const store = createBatchStore({ baseUrl })
  t.after(() => store.dispose())
  await store.refresh()
  assert.ok(store.getSnapshot().error)
  assert.equal(updateView(store.getSnapshot()).disabled, true)
})

test('store accepts update state and submits update then stop without using old recovery endpoints', async t => {
  let state = status({ pendingRestore: ['a'], snapshotCreatedAt: '2026-10-30T00:00:00Z' })
  const paths: string[] = []
  const baseUrl = await api(t, (request, response) => {
    if (request.method === 'POST') {
      paths.push(request.url!)
      state = status({ busy: true, phase: 'updating', update: updateStatus({ busy: true, phase: 'updating', total: 2, current: 'a', stage: 'checking', stopRequested: request.url!.endsWith('/stop') }) })
      reply(response, { accepted: true }, 202)
    } else reply(response, state)
  })
  const store = createBatchStore({ baseUrl })
  t.after(() => store.dispose())
  await store.refresh()
  await store.update()
  assert.equal(store.getSnapshot().error, null)
  assert.equal(store.getSnapshot().status?.update?.busy, true)
  await store.stop()
  await store.stop()
  assert.deepEqual(paths, ['/api/dsh-plugin-batch-toggle/update', '/api/dsh-plugin-batch-toggle/stop'])
  assert.equal(updateView(store.getSnapshot()).disabled, true)
})

test('legacy run refuses an update action instead of reusing restore permission', async t => {
  const paths: string[] = []
  const baseUrl = await api(t, (request, response) => {
    if (request.method === 'POST') paths.push(request.url!)
    reply(response, status({ pendingRestore: ['a'], snapshotCreatedAt: '2026-10-30T00:00:00Z' }))
  })
  const store = createBatchStore({ baseUrl })
  t.after(() => store.dispose())
  await store.refresh()
  await (store.run as (action: string) => Promise<void>)('update')
  assert.deepEqual(paths, [])
})

test('HTML authentication errors retain their HTTP meaning', async t => {
  const baseUrl = await api(t, (_request, response) => {
    response.writeHead(403, { 'Content-Type': 'text/html' })
    response.end('<html>Forbidden</html>')
  })
  const store = createBatchStore({ baseUrl })
  t.after(() => store.dispose())
  await store.refresh()
  assert.match(store.getSnapshot().error ?? '', /登录|权限|访问/)
  assert.doesNotMatch(store.getSnapshot().error ?? '', /Unexpected token/)
})

test('a hung status request reaches its deadline and a later refresh can recover', async t => {
  let stalled = true
  const baseUrl = await api(t, (_request, response) => { if (!stalled) reply(response, status()) })
  const store = createBatchStore({ baseUrl, requestTimeoutMs: 30 })
  t.after(() => store.dispose())
  const finished = await Promise.race([store.refresh().then(() => true), new Promise<boolean>(resolve => setTimeout(() => resolve(false), 300))])
  assert.equal(finished, true)
  assert.match(store.getSnapshot().error ?? '', /超时/)
  stalled = false
  await store.refresh()
  assert.equal(store.getSnapshot().error, null)
})

test('an automatic successful idle read clears a stale busy-conflict notice', async t => {
  const baseUrl = await api(t, (request, response) => request.method === 'POST'
    ? reply(response, { error: 'busy', message: '批量操作正在进行，请稍候。' }, 409)
    : reply(response, status()))
  const store = createBatchStore({ baseUrl, pollIntervalMs: 10 })
  t.after(() => store.dispose())
  await store.refresh()
  await store.run('disable')
  assert.ok(store.getSnapshot().notice)
  const cleared = new Promise<boolean>(resolve => {
    const off = store.subscribe(() => {
      if (!store.getSnapshot().error && !store.getSnapshot().notice) { off(); resolve(true) }
    })
    t.after(off)
  })
  assert.equal(await Promise.race([cleared, new Promise<boolean>(resolve => setTimeout(() => resolve(false), 300))]), true)
})

test('a missing update endpoint reports that the plugin service needs upgrading', async t => {
  const baseUrl = await api(t, (request, response) => {
    if (request.method === 'POST') { response.writeHead(404); response.end('Not found') }
    else reply(response, status())
  })
  const store = createBatchStore({ baseUrl })
  t.after(() => store.dispose())
  await store.refresh()
  await store.update()
  assert.match(store.getSnapshot().error ?? '', /接口|更新本插件|重新加载/)
})

test('an unconfirmed update request times out without retrying the mutation and status can reveal the running job', async t => {
  let posts = 0
  let running = false
  const baseUrl = await api(t, (request, response) => {
    if (request.method === 'POST') { posts++; running = true; return }
    reply(response, status({ busy: running, phase: running ? 'updating' : 'idle', update: updateStatus({ busy: running, phase: running ? 'updating' : 'idle' }) }))
  })
  const store = createBatchStore({ baseUrl, requestTimeoutMs: 50 })
  t.after(() => store.dispose())
  await store.refresh()
  await store.update()
  assert.match(store.getSnapshot().error ?? '', /超时/)
  await store.refresh()
  assert.equal(store.getSnapshot().status?.update?.busy, true)
  await store.update()
  assert.equal(posts, 1)
})

test('disposing the shared store aborts a hanging read without publishing a late error', async t => {
  let received!: () => void
  const entered = new Promise<void>(resolve => { received = resolve })
  const baseUrl = await api(t, () => { received() })
  const store = createBatchStore({ baseUrl })
  t.after(() => store.dispose())
  let notifications = 0
  store.subscribe(() => { notifications++ })
  await entered
  store.dispose()
  await store.refresh()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(notifications, 0)
  assert.equal(store.getSnapshot().error, null)
})

// Only the host's style-heavy primitive boundary is substituted. The real
// components, store, React rendering and resulting DOM are exercised below.
const renderedComponents = build({
  entryPoints: ['src/ui/components.tsx'], bundle: true, write: false, platform: 'node', format: 'cjs',
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  plugins: [{ name: 'host-primitives', setup(builder) {
    builder.onResolve({ filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ }, () => ({ path: 'primitives', namespace: 'host-primitives' }))
    builder.onLoad({ filter: /.*/, namespace: 'host-primitives' }, () => ({ contents: `
      import {createElement} from 'react';
      export const Button=({variant,size,icon,...props})=>createElement('button',props);
      export const MenuItemButton=({onSelect,separatorBefore,children,...props})=>createElement('button',{...props,role:'menuitem',onClick:onSelect},children);
    ` }))
  } }],
}).then(result => {
  const module = { exports: {} }
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
  return module.exports as typeof import('../src/ui/components.tsx')
})

test('toolbar renders one update button and the busy version renders one stop button', async t => {
  let state = status()
  const baseUrl = await api(t, (_request, response) => reply(response, state))
  const store = createBatchStore({ baseUrl })
  t.after(() => store.dispose())
  const { BatchControls } = await renderedComponents
  await store.refresh()
  let dom = new JSDOM(renderToStaticMarkup(createElement(BatchControls, { store })))
  assert.equal(dom.window.document.querySelectorAll('button').length, 1)
  assert.equal(dom.window.document.querySelector('[data-batch-toggle-action="update"]')?.textContent, '一键更新')
  assert.equal(dom.window.document.querySelector('[data-batch-toggle-action="disable"]'), null)
  dom.window.close()
  state = status({ busy: true, phase: 'updating', update: updateStatus({ busy: true, phase: 'updating', total: 1, current: 'a', stage: 'installing' }) })
  await store.refresh()
  dom = new JSDOM(renderToStaticMarkup(createElement(BatchControls, { store })))
  assert.equal(dom.window.document.querySelectorAll('button').length, 1)
  assert.equal(dom.window.document.querySelector('[data-batch-toggle-action="stop"]')?.textContent, '停止更新')
  dom.window.close()
})

test('detail view separates queried latest from installed version and reports current state, rollback and recovery', async t => {
  const baseUrl = await api(t, (_request, response) => reply(response, status({ update: updateStatus({ results: [item({ outcome: 'failed', rollback: 'failed', recoveryNeeded: true, installedVersion: null })] }) })))
  const store = createBatchStore({ baseUrl })
  t.after(() => store.dispose())
  const { BatchPanel } = await renderedComponents
  await store.refresh()
  const dom = new JSDOM(renderToStaticMarkup(createElement(BatchPanel, { store })))
  const row = dom.window.document.querySelector('[data-batch-toggle-update-result="failed"]')
  assert.ok(row)
  assert.match(row.textContent ?? '', /1\.0\.0/)
  assert.match(row.textContent ?? '', /1\.1\.0/)
  assert.match(row.textContent ?? '', /更新前：1\.0\.0/)
  assert.match(row.textContent ?? '', /查询最新：1\.1\.0/)
  assert.match(row.textContent ?? '', /当前状态：已停用/)
  assert.doesNotMatch(row.textContent ?? '', /原启用意图/)
  assert.match(row.textContent ?? '', /回滚失败/)
  assert.match(row.textContent ?? '', /恢复/)
  assert.equal(dom.window.document.querySelectorAll('[data-batch-toggle-action="restore"],[data-batch-toggle-action="disable"]').length, 0)
  dom.window.close()
})
