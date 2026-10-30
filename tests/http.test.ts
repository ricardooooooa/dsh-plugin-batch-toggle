import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHandlers } from '../src/http.ts'
import type { BatchStatus } from '../src/types.ts'

const initial = (): BatchStatus => ({ busy: false, phase: 'idle', total: 0, completed: 0, candidates: ['example'], protected: [], pendingRestore: [], snapshotCreatedAt: null, results: [], lastError: null })
test('starts a job without waiting and rejects duplicate requests', async () => {
  let release!: () => void
  const wait = new Promise<void>(resolve => { release = resolve })
  const state = initial()
  const handlers = createHandlers({ status: async () => state, disable: async () => { state.busy = true; await wait; state.busy = false }, restore: async () => {}, dispose() {} })
  assert.equal((await handlers.disable(new Request('http://localhost/api/disable', { method: 'POST' }))).status, 202)
  assert.equal((await handlers.disable(new Request('http://localhost/api/disable', { method: 'POST' }))).status, 409)
  release()
  handlers.dispose()
})
test('status never caches and surfaces job failure to the user', async () => {
  const handlers = createHandlers({ status: async () => initial(), disable: async () => { throw new Error('disk unavailable') }, restore: async () => {}, dispose() {} })
  await handlers.disable(new Request('http://localhost/api/disable', { method: 'POST' }))
  await new Promise(resolve => setTimeout(resolve, 0))
  const response = await handlers.status()
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.ok((await response.json()).lastError)
  handlers.dispose()
})
test('preserves an unfinished snapshot and refuses a second disable', async () => {
  const state = initial(); state.pendingRestore = ['old-plugin']
  const handlers = createHandlers({ status: async () => state, disable: async () => { throw new Error('must not run') }, restore: async () => {}, dispose() {} })
  assert.equal((await handlers.disable(new Request('http://localhost', { method: 'POST' }))).status, 409)
  handlers.dispose()
})
test('a disposed plugin refuses new jobs and does not wait for the running one', async () => {
  const handlers = createHandlers({ status: async () => initial(), disable: async () => new Promise<void>(() => {}), restore: async () => {}, dispose() {} })
  await handlers.disable(new Request('http://localhost', { method: 'POST' }))
  handlers.dispose()
  assert.equal((await handlers.restore(new Request('http://localhost', { method: 'POST' }))).status, 503)
})
test('read-only methods cannot start jobs; empty restore is rejected', async () => {
  const handlers = createHandlers({ status: async () => initial(), disable: async () => {}, restore: async () => {}, dispose() {} })
  assert.equal((await handlers.disable(new Request('http://localhost'))).status, 405)
  assert.equal((await handlers.restore(new Request('http://localhost', { method: 'POST' }))).status, 409)
  handlers.dispose()
})
test('an interrupted queued snapshot can be cleared but cannot be overwritten', async () => {
  const state = initial(); state.snapshotCreatedAt = new Date().toISOString()
  const handlers = createHandlers({ status: async () => state, disable: async () => {}, restore: async () => {}, dispose() {} })
  assert.equal((await handlers.disable(new Request('http://localhost', { method: 'POST' }))).status, 409)
  assert.equal((await handlers.restore(new Request('http://localhost', { method: 'POST' }))).status, 202)
  handlers.dispose()
})
