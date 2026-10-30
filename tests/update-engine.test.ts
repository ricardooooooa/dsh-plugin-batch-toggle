import assert from 'node:assert/strict'
import test from 'node:test'
import { UpdateEngine } from '../src/update-engine.ts'
import { npmSource } from '../src/npm-update-adapter.ts'
import type { UpdateAdapter, UpdateItem, UpdateSnapshot } from '../src/update-engine.ts'
import type { Snapshot } from '../src/engine.ts'
import type { ChangeOutcome, ManagedBundle } from '../src/types.ts'

const applied: ChangeOutcome = { application: 'applied', changed: true }
const failed: ChangeOutcome = { application: 'failed', changed: false, error: { code: 'install-failed' } }
const bundle = (name: string, enabled = true): ManagedBundle => ({ name, enabled, version: '1.0.0', source: `${name}@^1.0.0`, installed: true, availability: 'profile', official: false, rows: [], overrides: [] })
class Records<T> {
  value: T | null = null
  saveError = false
  locked = false
  async load() { return structuredClone(this.value) }
  async save(value: T) { if (this.saveError) throw new Error('disk full'); this.value = structuredClone(value) }
  async clear() { this.value = null }
  async withLock<R>(action: () => Promise<R>) {
    if (this.locked) throw Object.assign(new Error('busy'), { code: 'busy' })
    this.locked = true
    try { return await action() } finally { this.locked = false }
  }
}
class Adapter implements UpdateAdapter {
  bundles: ManagedBundle[]
  latestVersion = '2.0.0'
  installedVersion: string | null = null
  installedEnabled: boolean | null = null
  failures = new Set<string>()
  enableFailures = new Set<string>()
  unsupported = new Set<string>()
  installations: string[] = []
  cancelled: string[] = []
  before?: (operation: string, name: string, version?: string, enabled?: boolean) => Promise<void>
  constructor(bundles: ManagedBundle[]) { this.bundles = bundles }
  async listBundles() { return structuredClone(this.bundles) }
  async latest(item: ManagedBundle) {
    await this.before?.('latest', item.name)
    if (this.unsupported.has(item.name) || !npmSource(item)) throw Object.assign(new Error('non-npm source'), { code: 'unsupported-source' })
    return { version: this.latestVersion, registry: 'http://127.0.0.1:12345/' }
  }
  async setBundleEnabled(name: string, enabled: boolean) {
    await this.before?.('enable', name, undefined, enabled)
    if (this.enableFailures.has(name)) return failed
    this.bundles.find(item => item.name === name)!.enabled = enabled
    return applied
  }
  async removeBundle(name: string) {
    await this.before?.('remove', name)
    this.bundles = this.bundles.filter(item => item.name !== name)
    return applied
  }
  async install(name: string, version: string, enabled: boolean, _requestId: string, _registry?: string | null, mode?: 'update' | 'rollback') {
    await this.before?.('install', name, version)
    if (this.bundles.some(item => item.name === name && item.installed)) return { application: 'failed' as const, changed: false, error: { code: 'already-installed' } }
    if (this.failures.has(`${name}@${version}`)) return failed
    this.bundles.push({ ...bundle(name, mode === 'update' ? this.installedEnabled ?? enabled : enabled), version: mode === 'update' ? this.installedVersion ?? version : version })
    this.installations.push(`${name}@${version}`)
    return applied
  }
  async cancelInstall(requestId: string) { this.cancelled.push(requestId) }
}
function setup(bundles: ManagedBundle[]) {
  const adapter = new Adapter(bundles)
  const store = new Records<UpdateSnapshot>()
  const legacyStore = new Records<Snapshot>()
  const engine = new UpdateEngine({ adapter, store, legacyStore, profile: 'test' })
  return { adapter, store, legacyStore, engine }
}
const legacy = (): Snapshot => ({ version: 1, profile: 'test', createdAt: '2026-10-30T04:00:00.000Z', order: ['legacy'], items: [{ name: 'legacy', state: 'disabled' }], results: [], lastError: null })

test('updates serially, rolls a failed target back, continues later items, and preserves disabled intent', async () => {
  const { adapter, engine, store } = setup([bundle('A'), bundle('B'), bundle('C', false)])
  adapter.failures.add('B@2.0.0')
  adapter.before = async (operation, name, version) => {
    const current = store.value?.items.find(item => item.name === name)
    if (operation === 'remove') assert.equal(current?.state, 'removing')
    if (operation === 'install') assert.equal(current?.state, version === '1.0.0' ? 'rollback' : 'installing')
    if (name === 'C') assert.equal(adapter.bundles.find(item => item.name === 'B')?.version, '1.0.0')
  }
  await engine.run()
  assert.deepEqual(adapter.installations, ['A@2.0.0', 'B@1.0.0', 'C@2.0.0'])
  assert.equal(adapter.bundles.find(item => item.name === 'C')?.enabled, false)
  const status = await engine.status()
  assert.deepEqual(status.results.map(item => item.outcome), ['updated', 'failed', 'updated'])
  assert.equal(status.results[1].rollback, 'succeeded')
  assert.equal(status.results[1].recoveryNeeded, false)
})
test('legacy pending restore becomes enabled intent while originally disabled plugins remain disabled', async () => {
  const { adapter, engine, legacyStore } = setup([bundle('legacy', false), bundle('off', false)])
  await legacyStore.save(legacy())
  await engine.run()
  assert.equal(adapter.bundles.find(item => item.name === 'legacy')?.enabled, true)
  assert.equal(adapter.bundles.find(item => item.name === 'off')?.enabled, false)
  assert.equal(await legacyStore.load(), null)
})
test('unsupported sources are skipped without replacing them and legacy enable responsibility is still restored', async () => {
  const { adapter, engine, legacyStore } = setup([bundle('legacy', false)])
  adapter.unsupported.add('legacy')
  await legacyStore.save(legacy())
  await engine.run()
  assert.deepEqual(adapter.installations, [])
  assert.equal(adapter.bundles[0].version, '1.0.0')
  assert.equal(adapter.bundles[0].enabled, true)
  assert.equal((await engine.status()).results[0].outcome, 'skipped')
  assert.equal(await legacyStore.load(), null)
})
test('initial Git or local sources are skipped, while their legacy enable selection can still be restored', async () => {
  for (const source of ['github:owner/example', 'file:/tmp/example']) {
    for (const restore of [false, true]) {
      const { adapter, engine, legacyStore } = setup([{ ...bundle('legacy', false), source }])
      if (restore) await legacyStore.save(legacy())
      await engine.run()
      assert.equal(adapter.bundles[0].source, source)
      assert.equal(adapter.bundles[0].enabled, restore)
      assert.deepEqual(adapter.installations, [])
      const result = (await engine.status()).results[0]
      assert.equal(result.outcome, 'skipped'); assert.equal(result.recoveryNeeded, false)
      assert.equal(await legacyStore.load(), null)
    }
  }
})
test('an unconfirmed legacy restoring intent must be acknowledged even when already selected', async () => {
  const { adapter, engine, legacyStore } = setup([bundle('legacy')])
  const record = legacy(); record.items[0].state = 'restoring'
  await legacyStore.save(record)
  adapter.latestVersion = '1.0.0'; adapter.enableFailures.add('legacy')
  await engine.run()
  assert.equal((await engine.status()).results[0].recoveryNeeded, true)
  assert.equal((await legacyStore.load())?.items[0].state, 'restoring')
})
test('legacy failed restoration remains unconfirmed across an intervening protected skip', async () => {
  const { adapter, engine, legacyStore } = setup([bundle('legacy')])
  const record = legacy()
  record.results = [{ name: 'legacy', action: 'restore', outcome: 'failed' }, { name: 'legacy', action: 'restore', outcome: 'skipped' }]
  await legacyStore.save(record)
  adapter.latestVersion = '1.0.0'; adapter.enableFailures.add('legacy')
  await engine.run()
  assert.equal((await engine.status()).results[0].recoveryNeeded, true)
  assert.ok(await legacyStore.load())
})
test('restart completes legacy cleanup when a confirmed update result was saved before the old snapshot was cleared', async () => {
  const { adapter, engine, store, legacyStore } = setup([{ ...bundle('legacy'), version: '2.0.0' }])
  await legacyStore.save(legacy())
  const item: UpdateItem = {
    name: 'legacy', beforeVersion: '1.0.0', targetVersion: '2.0.0', desiredEnabled: true, registry: null,
    state: 'done', requestId: null, restartRequired: false, removalStarted: true,
    result: { name: 'legacy', beforeVersion: '1.0.0', targetVersion: '2.0.0', installedVersion: '2.0.0', outcome: 'updated', message: 'confirmed', enabled: true, rollback: 'not-needed', restartRequired: false, recoveryNeeded: false },
  }
  await store.save({ version: 1, profile: 'test', startedAt: '2026-10-30T04:00:00.000Z', finishedAt: null, items: [item], lastError: null })
  await engine.run()
  assert.equal(await legacyStore.load(), null)
  assert.deepEqual(adapter.installations, [])
  assert.equal((await engine.status()).results[0].outcome, 'updated')
})
test('a selection-only failure never turns a missing unsupported source into an npm installation', async () => {
  const { adapter, engine, legacyStore } = setup([bundle('legacy', false)])
  await legacyStore.save(legacy())
  adapter.unsupported.add('legacy'); adapter.enableFailures.add('legacy')
  await engine.run()
  assert.equal((await engine.status()).results[0].recoveryNeeded, true)
  adapter.bundles = []; adapter.enableFailures.clear()
  await engine.run()
  assert.deepEqual(adapter.installations, [])
  assert.equal(adapter.bundles.length, 0)
  assert.equal(await legacyStore.load(), null)
})
test('does not downgrade or disturb an up-to-date disabled bundle', async () => {
  const { adapter, engine } = setup([bundle('A', false)])
  adapter.latestVersion = '0.9.0'
  await engine.run()
  assert.deepEqual(adapter.installations, [])
  assert.equal(adapter.bundles[0].version, '1.0.0')
  assert.equal(adapter.bundles[0].enabled, false)
  assert.equal((await engine.status()).results[0].outcome, 'up-to-date')
})
test('accepts release-policy versions newer than the original while rolling non-advancing installs back', async () => {
  for (const version of ['0.9.0', '1.0.0', '1.5.0', '2.1.0']) {
    const { adapter, engine } = setup([bundle('A')])
    adapter.installedVersion = version
    await engine.run()
    const result = (await engine.status()).results[0]
    const advances = version === '1.5.0' || version === '2.1.0'
    assert.equal(result.outcome, advances ? 'updated' : 'failed')
    assert.equal(adapter.bundles[0].version, advances ? version : '1.0.0')
    if (version === '1.5.0') {
      assert.equal(result.installedVersion, '1.5.0'); assert.equal(result.targetVersion, '2.0.0')
      assert.match(result.message, /policy/i)
    }
  }
})
test('rollback removes a newly installed bundle before reinstalling old when enable restoration fails', async () => {
  const { adapter, engine, store } = setup([bundle('A'), bundle('C')])
  adapter.installedEnabled = false
  adapter.before = async (operation, name, _version, enabled) => {
    const current = adapter.bundles.find(item => item.name === name)
    if (operation === 'enable') {
      if (name === 'A' && current?.version === '2.0.0' && enabled) adapter.enableFailures.add(name)
      else adapter.enableFailures.delete(name)
    }
    if (operation === 'remove' && current?.version === '2.0.0') {
      assert.equal(current.enabled, false)
      assert.equal(store.value?.items.find(item => item.name === name)?.state, 'rollback')
    }
  }
  await engine.run()
  assert.equal(adapter.bundles.find(item => item.name === 'A')?.version, '1.0.0')
  assert.equal(adapter.bundles.find(item => item.name === 'A')?.enabled, true)
  const result = (await engine.status()).results.find(item => item.name === 'A')!
  assert.equal(result.outcome, 'failed'); assert.equal(result.rollback, 'succeeded'); assert.equal(result.recoveryNeeded, false)
  assert.equal(adapter.bundles.find(item => item.name === 'C')?.version, '2.0.0')
})
test('rollback does not remove a replacement bundle if deselection cannot be confirmed', async () => {
  for (const protection of ['refused', 'protected']) {
    const { adapter, engine } = setup([bundle('A')])
    adapter.installedVersion = '0.9.0'
    adapter.before = async (operation, name) => {
      if (operation === 'enable' && adapter.bundles.find(item => item.name === name)?.version === '0.9.0') adapter.enableFailures.add(name)
    }
    if (protection === 'protected') {
      const originalList = adapter.listBundles.bind(adapter)
      adapter.listBundles = async () => {
        const current = adapter.bundles.find(item => item.version === '0.9.0')
        if (current) current.readOnlyReason = 'management-required'
        return originalList()
      }
    }
    await engine.run()
    assert.equal(adapter.bundles[0].version, '0.9.0'); assert.equal(adapter.bundles[0].enabled, true)
    const result = (await engine.status()).results[0]
    assert.equal(result.rollback, 'failed'); assert.equal(result.recoveryNeeded, true)
  }
})
test('rollback failure remains recoverable and is repaired before another batch can begin', async () => {
  const { adapter, engine, store, legacyStore } = setup([bundle('A'), bundle('B')])
  adapter.failures.add('A@2.0.0'); adapter.failures.add('A@1.0.0')
  await engine.run()
  assert.equal(adapter.bundles.some(item => item.name === 'A'), false)
  assert.equal((await engine.status()).results[0].recoveryNeeded, true)
  adapter.failures.delete('A@1.0.0')
  const restarted = new UpdateEngine({ adapter, store, legacyStore, profile: 'test' })
  await restarted.run()
  assert.equal(adapter.bundles.find(item => item.name === 'A')?.version, '1.0.0')
  assert.equal(adapter.bundles.find(item => item.name === 'A')?.enabled, true)
  assert.equal((await restarted.status()).results[0].recoveryNeeded, false)
  assert.equal(adapter.installations.filter(item => item === 'B@2.0.0').length, 1)
})
test('stop cancels only the current owned install and waits for rollback without starting the next item', async () => {
  const { adapter, engine } = setup([bundle('A'), bundle('B')])
  let enter!: () => void; let release!: () => void
  const entered = new Promise<void>(resolve => { enter = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  adapter.before = async (operation, name, version) => { if (operation === 'install' && name === 'A' && version === '2.0.0') { enter(); await gate } }
  adapter.failures.add('A@2.0.0')
  const active = engine.run(); await entered
  let stopped = false
  const stopping = engine.stop().then(() => { stopped = true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(stopped, false); assert.equal(adapter.cancelled.length, 1)
  assert.equal((await engine.status()).phase, 'stopping')
  release(); await Promise.all([active, stopping])
  assert.equal(adapter.bundles.find(item => item.name === 'A')?.version, '1.0.0')
  assert.equal(adapter.bundles.find(item => item.name === 'B')?.version, '1.0.0')
})
test('status is responsive during an SDK mutation and rejects concurrent runs synchronously', async () => {
  const { adapter, engine } = setup([bundle('A')])
  let enter!: () => void; let release!: () => void
  const entered = new Promise<void>(resolve => { enter = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  adapter.before = async operation => { if (operation === 'remove') { enter(); await gate } }
  const active = engine.run(); await assert.rejects(() => engine.run(), { code: 'busy' }); await entered
  assert.equal((await engine.status()).busy, true); assert.equal((await engine.status()).stage, 'removing')
  release(); await active
})
test('storage failure stops the batch before a destructive SDK operation', async () => {
  const { adapter, engine, store } = setup([bundle('A'), bundle('B')])
  adapter.before = async operation => { if (operation === 'latest') store.saveError = true }
  await assert.rejects(() => engine.run(), /disk full/)
  assert.equal(adapter.bundles.find(item => item.name === 'A')?.version, '1.0.0')
  assert.equal(adapter.bundles.find(item => item.name === 'A')?.enabled, true)
  assert.equal(adapter.bundles.find(item => item.name === 'B')?.version, '1.0.0')
})
test('restart repairs missing installation after a persisted destructive intent', async () => {
  const { adapter, engine, store } = setup([bundle('A')])
  const item: UpdateItem = { name: 'A', beforeVersion: '1.0.0', targetVersion: '2.0.0', desiredEnabled: true, registry: null, state: 'removing', requestId: null, restartRequired: false, removalStarted: true, result: null }
  await store.save({ version: 1, profile: 'test', startedAt: '2026-10-30T04:00:00.000Z', finishedAt: null, items: [item], lastError: null })
  adapter.bundles = []; await engine.run()
  assert.equal(adapter.bundles[0].version, '1.0.0'); assert.equal(adapter.bundles[0].enabled, true)
  assert.equal((await engine.status()).results[0].rollback, 'succeeded')
  assert.equal((await store.load())?.items[0].state, 'done')
})
test('unfinished recovery preserves an externally substituted Git or local bundle without changing its selection', async () => {
  for (const source of ['github:owner/example', 'file:/tmp/example']) {
    for (const state of ['rollback', 'installing'] as const) {
      const replacement = { ...bundle('A', false), version: '2.0.0', source }
      const expected = structuredClone(replacement)
      const { adapter, engine, store } = setup([replacement])
      const item: UpdateItem = { name: 'A', beforeVersion: '1.0.0', targetVersion: '2.0.0', desiredEnabled: true, registry: null, state, requestId: null, restartRequired: false, removalStarted: true, result: null }
      await store.save({ version: 1, profile: 'test', startedAt: '2026-10-30T04:00:00.000Z', finishedAt: null, items: [item], lastError: null })
      await engine.run()
      assert.deepEqual(adapter.bundles, [expected])
      assert.deepEqual(adapter.installations, [])
      const result = (await engine.status()).results[0]
      assert.equal(result.recoveryNeeded, true); assert.equal(result.outcome, 'failed')
      assert.match(result.message, /source.*chang|chang.*source/i)
    }
  }
})
test('forward removal rereads source after persisting its intent and preserves an external replacement', async () => {
  const { adapter, engine, store } = setup([bundle('A')])
  const save = store.save.bind(store)
  store.save = async record => {
    await save(record)
    if (record.items[0]?.state === 'removing') {
      adapter.bundles[0] = { ...bundle('A'), source: 'github:owner/example' }
    }
  }
  await engine.run()
  assert.equal(adapter.bundles[0].source, 'github:owner/example')
  assert.equal(adapter.bundles[0].enabled, true)
  assert.deepEqual(adapter.installations, [])
  const result = (await engine.status()).results[0]
  assert.equal(result.recoveryNeeded, true); assert.match(result.message, /source.*chang|chang.*source/i)
})
test('stop requested while loading recovery records does not begin a new recovery item', async () => {
  const { adapter, engine, store } = setup([])
  const item: UpdateItem = { name: 'A', beforeVersion: '1.0.0', targetVersion: '2.0.0', desiredEnabled: true, registry: null, state: 'removing', requestId: null, restartRequired: false, removalStarted: true, result: null }
  await store.save({ version: 1, profile: 'test', startedAt: '2026-10-30T04:00:00.000Z', finishedAt: null, items: [item], lastError: null })
  let enter!: () => void; let release!: () => void
  const entered = new Promise<void>(resolve => { enter = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  const originalLoad = store.load.bind(store)
  let first = true
  store.load = async () => { if (first) { first = false; enter(); await gate }; return originalLoad() }
  const active = engine.run(); await entered
  const stopping = engine.stop(); release(); await Promise.all([active, stopping])
  assert.deepEqual(adapter.installations, [])
  assert.equal((await store.load())?.items[0].state, 'removing')
})
test('dispose never joins an SDK mutation and leaves its persisted intent available to a new engine', async () => {
  const { adapter, engine, store, legacyStore } = setup([bundle('A')])
  let enter!: () => void; let release!: () => void
  const entered = new Promise<void>(resolve => { enter = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  adapter.before = async operation => { if (operation === 'remove') { enter(); await gate } }
  const active = engine.run(); await entered
  assert.equal(engine.dispose(), undefined)
  release(); await active
  assert.equal(adapter.bundles.length, 0)
  assert.equal((await store.load())?.items[0].state, 'removing')
  const restarted = new UpdateEngine({ adapter, store, legacyStore, profile: 'test' })
  await restarted.run()
  assert.equal(adapter.bundles[0].version, '1.0.0')
  assert.equal(adapter.bundles[0].enabled, true)
})
