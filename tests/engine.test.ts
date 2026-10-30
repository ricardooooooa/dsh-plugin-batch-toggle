import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { TestContext } from 'node:test'
import { BatchEngine } from '../src/engine.ts'
import type { Snapshot, SnapshotStore } from '../src/engine.ts'
import { FileSnapshotStore } from '../src/store.ts'
import { CLIENT_ROW_ID, HOST_ROW_ID, PACKAGE_NAME } from '../src/types.ts'
import type { BundleManager, ChangeOutcome, ManagedBundle } from '../src/types.ts'

const bundle = (name: string, values: Partial<ManagedBundle> = {}): ManagedBundle => ({ name, enabled: true, installed: true, official: false, availability: 'profile', rows: [], overrides: [], ...values })

class Manager implements BundleManager {
  bundles: ManagedBundle[]
  outcomes = new Map<string, ChangeOutcome | Error>()
  beforeChange?: (name: string, enabled: boolean) => Promise<void>
  enabledOrder: string[] = []
  constructor(bundles: ManagedBundle[]) { this.bundles = bundles }
  async listBundles() { return structuredClone(this.bundles) }
  async setBundleEnabled(name: string, enabled: boolean): Promise<ChangeOutcome> {
    await this.beforeChange?.(name, enabled)
    const result = this.outcomes.get(`${name}:${enabled}`) ?? { application: 'applied', changed: true }
    if (result instanceof Error) throw result
    if (result.changed) {
      this.bundles.find(item => item.name === name)!.enabled = enabled
      if (enabled) this.enabledOrder.push(name)
    }
    return result
  }
}

async function setup(t: TestContext, bundles: ManagedBundle[]) {
  const directory = await mkdtemp(join(tmpdir(), 'batch-engine-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const manager = new Manager(bundles)
  const store = new FileSnapshotStore(directory, 'isolated')
  const engine = new BatchEngine({ manager, store, profile: 'isolated' })
  return { manager, store, engine }
}

const interrupted = (items: Snapshot['items']): Snapshot => ({ version: 1, profile: 'isolated', createdAt: '2026-10-30T04:00:00.000Z', order: items.map(item => item.name), items, results: [], lastError: null })

test('disables only manageable third-party bundles then restores original enabled targets', async t => {
  const { manager, store, engine } = await setup(t, [
    bundle('alpha'), bundle('originally-off', { enabled: false }), bundle('beta'),
    bundle('official', { official: true }), bundle('readonly', { readOnlyReason: 'management-required' }),
    bundle('missing', { availability: 'missing' }), bundle('not-installed', { installed: false }),
    bundle('bad', { error: { code: 'bad' } }), bundle(PACKAGE_NAME), bundle('dshmarket'), bundle('@dsh-external/dshmarket'),
    bundle('insertion', { rows: [{ rowId: HOST_ROW_ID, moduleName: 'anything' }] }),
    bundle('override', { overrides: [CLIENT_ROW_ID] }), bundle('shipped', { availability: 'installation' }), bundle('@deepseek-ai/core'),
  ])
  assert.deepEqual((await engine.status()).candidates, ['alpha', 'beta'])
  await engine.disable()
  assert.deepEqual(manager.bundles.filter(item => !item.enabled).map(item => item.name), ['alpha', 'originally-off', 'beta'])
  assert.deepEqual((await engine.status()).pendingRestore, ['alpha', 'beta'])
  await assert.rejects(() => engine.disable(), { code: 'pending-restore' })
  await engine.restore()
  assert.equal(manager.bundles.find(item => item.name === 'originally-off')!.enabled, false)
  assert.deepEqual(manager.enabledOrder, ['alpha', 'beta'])
  assert.equal(await store.load(), null)
})

test('persists each intent before change and each result before the next change', async t => {
  const { manager, store, engine } = await setup(t, [bundle('alpha'), bundle('beta')])
  manager.beforeChange = async (name, enabled) => {
    const saved = await store.load()
    assert.ok(saved)
    assert.equal(saved.items.find(item => item.name === name)?.state, enabled ? 'restoring' : 'disabling')
    if (name === 'beta' && !enabled) assert.equal(saved.items[0].state, 'disabled')
    if (name === 'beta' && enabled) assert.equal(saved.items[0].state, 'restored')
  }
  await engine.disable()
  await engine.restore()
})

test('status remains responsive and concurrent jobs are rejected before initial await', async t => {
  const { manager, engine } = await setup(t, [bundle('alpha'), bundle('beta')])
  let enter!: () => void
  let release!: () => void
  const entered = new Promise<void>(resolve => { enter = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  manager.beforeChange = async name => { if (name === 'alpha') { enter(); await gate } }
  const job = engine.disable()
  await assert.rejects(() => engine.restore(), { code: 'busy' })
  await entered
  const status = await engine.status()
  assert.equal(status.busy, true)
  assert.equal(status.phase, 'disabling')
  assert.equal(status.total, 2)
  assert.equal(status.completed, 0)
  release()
  await job
  assert.equal((await engine.status()).busy, false)
})

test('uses manifest order for restore even when inventory has another order', async t => {
  const { manager, store } = await setup(t, [bundle('beta'), bundle('alpha')])
  const engine = new BatchEngine({ manager, store, profile: 'isolated', getOrder: async () => ['protected', 'alpha', 'beta'] })
  await engine.disable()
  await engine.restore()
  assert.deepEqual(manager.enabledOrder, ['alpha', 'beta'])
})

test('changed is independent of application and all persisted mutations remain recoverable', async t => {
  const { manager, engine } = await setup(t, ['applied', 'restart', 'overridden', 'failed', 'cancelled', 'unchanged'].map(name => bundle(name)))
  manager.outcomes.set('restart:false', { changed: true, application: 'restart-required', restartReason: 'no-hmr' })
  manager.outcomes.set('overridden:false', { changed: true, application: 'overridden' })
  manager.outcomes.set('failed:false', { changed: true, application: 'failed', error: { code: 'partial' } })
  manager.outcomes.set('cancelled:false', { changed: false, application: 'cancelled' })
  manager.outcomes.set('unchanged:false', { changed: false, application: 'applied' })
  await engine.disable()
  const status = await engine.status()
  assert.deepEqual(status.pendingRestore, ['applied', 'restart', 'overridden', 'failed'])
  assert.deepEqual(status.results.map(item => item.outcome), ['applied', 'restart-required', 'overridden', 'failed', 'cancelled', 'applied'])
  assert.equal(manager.bundles.find(item => item.name === 'cancelled')!.enabled, true)
  await engine.restore()
  assert.deepEqual(manager.enabledOrder, ['applied', 'restart', 'overridden', 'failed'])
})

test('restart recovers interrupted disable intent but never starts untouched queued targets', async t => {
  const { manager, store } = await setup(t, [bundle('changed', { enabled: false }), bundle('uncertain', { enabled: false }), bundle('queued', { enabled: false }), bundle('originally-off', { enabled: false })])
  await store.save(interrupted([{ name: 'changed', state: 'disabled' }, { name: 'uncertain', state: 'disabling' }, { name: 'queued', state: 'queued' }]))
  const restarted = new BatchEngine({ manager, store, profile: 'isolated' })
  await restarted.restore()
  assert.deepEqual(manager.enabledOrder, ['changed', 'uncertain'])
  assert.equal(manager.bundles.find(item => item.name === 'queued')!.enabled, false)
  assert.equal(manager.bundles.find(item => item.name === 'originally-off')!.enabled, false)
  assert.equal(await store.load(), null)
})

test('an unfinished restoration is retried even when its profile selection is already enabled', async t => {
  const { manager, store } = await setup(t, [bundle('alpha')])
  const snapshot = interrupted([{ name: 'alpha', state: 'restoring' }])
  snapshot.results = [{ name: 'alpha', action: 'disable', outcome: 'applied' }]
  await store.save(snapshot)
  manager.outcomes.set('alpha:true', { changed: false, application: 'failed', error: { code: 'hmr-unconfirmed' } })
  const restarted = new BatchEngine({ manager, store, profile: 'isolated' })
  await restarted.restore()
  assert.deepEqual((await restarted.status()).pendingRestore, ['alpha'])
  assert.equal((await store.load())?.results.at(-1)?.outcome, 'failed')
  manager.outcomes.set('alpha:true', { changed: false, application: 'applied' })
  await restarted.restore()
  assert.equal(await store.load(), null)
  assert.deepEqual((await restarted.status()).pendingRestore, [])
})

test('temporary protection cannot confirm an interrupted restoration', async t => {
  const { manager, store } = await setup(t, [bundle('alpha', { readOnlyReason: 'temporary-protection' })])
  const snapshot = interrupted([{ name: 'alpha', state: 'restoring' }])
  snapshot.results = [{ name: 'alpha', action: 'disable', outcome: 'applied' }]
  await store.save(snapshot)
  const restarted = new BatchEngine({ manager, store, profile: 'isolated' })
  await restarted.restore()
  assert.deepEqual((await restarted.status()).pendingRestore, ['alpha'])
  delete manager.bundles[0].readOnlyReason
  manager.outcomes.set('alpha:true', { changed: false, application: 'failed', error: { code: 'hmr-unconfirmed' } })
  await restarted.restore()
  assert.deepEqual((await restarted.status()).pendingRestore, ['alpha'])
  assert.equal((await store.load())?.results.at(-1)?.outcome, 'failed')
})

test('skips uninstalled targets and retains failed restoration for a later retry', async t => {
  const { manager, store, engine } = await setup(t, [bundle('removed'), bundle('fails'), bundle('works')])
  await engine.disable()
  manager.bundles = manager.bundles.filter(item => item.name !== 'removed')
  manager.outcomes.set('fails:true', { changed: false, application: 'failed', error: { code: 'cannot-start' } })
  await engine.restore()
  assert.deepEqual((await engine.status()).pendingRestore, ['fails'])
  assert.ok((await engine.status()).results.some(item => item.name === 'removed' && item.outcome === 'skipped'))
  assert.equal(manager.bundles.find(item => item.name === 'works')!.enabled, true)
  assert.ok(await store.load())
  manager.outcomes.delete('fails:true')
  await engine.restore()
  assert.equal(manager.bundles.find(item => item.name === 'fails')!.enabled, true)
  assert.equal(await store.load(), null)
})

test('failed or overridden restore remains pending even if it changed disk', async t => {
  const { manager, engine } = await setup(t, [bundle('failed'), bundle('overridden')])
  await engine.disable()
  manager.outcomes.set('failed:true', { changed: true, application: 'failed', error: { code: 'runtime-error' } })
  manager.outcomes.set('overridden:true', { changed: true, application: 'overridden' })
  await engine.restore()
  assert.deepEqual((await engine.status()).pendingRestore, ['failed', 'overridden'])
})

test('a temporarily protected retry cannot discard a previous unapplied restoration', async t => {
  const { manager, engine } = await setup(t, [bundle('alpha')])
  await engine.disable()
  manager.outcomes.set('alpha:true', { changed: true, application: 'failed', error: { code: 'runtime-error' } })
  await engine.restore()
  manager.bundles[0].readOnlyReason = 'temporary-protection'
  await engine.restore()
  assert.deepEqual((await engine.status()).pendingRestore, ['alpha'])
  delete manager.bundles[0].readOnlyReason
  await engine.restore()
  assert.deepEqual((await engine.status()).pendingRestore, ['alpha'])
  manager.outcomes.delete('alpha:true')
  await engine.restore()
  assert.deepEqual((await engine.status()).pendingRestore, [])
})

test('dispose during a manager change returns immediately and leaves recoverable intent', async t => {
  const { manager, store, engine } = await setup(t, [bundle('alpha'), bundle('beta')])
  let enter!: () => void
  let release!: () => void
  const entered = new Promise<void>(resolve => { enter = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  manager.beforeChange = async name => { if (name === 'alpha') { enter(); await gate } }
  const active = engine.disable()
  await entered
  assert.equal(engine.dispose(), undefined)
  release()
  await active
  assert.equal(manager.bundles.find(item => item.name === 'beta')!.enabled, true)
  const restarted = new BatchEngine({ manager, store, profile: 'isolated' })
  await restarted.restore()
  assert.deepEqual(manager.enabledOrder, ['alpha'])
  await assert.rejects(() => engine.disable(), { code: 'disposed' })
})

test('storage failure before the intent leaves manager state untouched', async t => {
  const { manager, store } = await setup(t, [bundle('alpha')])
  const failing: SnapshotStore = { load: () => store.load(), clear: () => store.clear(), withLock: action => store.withLock(action), save: async () => { throw new Error('disk full') } }
  const engine = new BatchEngine({ manager, store: failing, profile: 'isolated' })
  await assert.rejects(() => engine.disable(), /disk full/)
  assert.equal(manager.bundles[0].enabled, true)
  assert.equal((await engine.status()).busy, false)
  assert.match((await engine.status()).lastError ?? '', /disk full/)
})
