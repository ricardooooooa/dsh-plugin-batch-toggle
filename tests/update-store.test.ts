import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { TestContext } from 'node:test'
import type { Snapshot } from '../src/engine.ts'
import { FileSnapshotStore } from '../src/store.ts'
import type { UpdateItem, UpdateSnapshot } from '../src/update-engine.ts'
import { FileUpdateStore } from '../src/update-store.ts'

const item = (values: Partial<UpdateItem> = {}): UpdateItem => ({
  name: 'alpha', beforeVersion: '1.0.0', targetVersion: '1.1.0', desiredEnabled: true,
  registry: 'https://registry.npmjs.org/', state: 'done', requestId: null, restartRequired: false, removalStarted: false,
  result: {
    name: 'alpha', beforeVersion: '1.0.0', targetVersion: '1.1.0', installedVersion: '1.1.0',
    outcome: 'updated', message: 'Updated successfully.', enabled: true,
    rollback: 'not-needed', restartRequired: false, recoveryNeeded: false,
  },
  ...values,
})
const snapshot = (profile = 'isolated'): UpdateSnapshot => ({
  version: 1, profile, startedAt: '2026-10-30T04:00:00.000Z', finishedAt: '2026-10-30T04:01:00.000Z',
  items: [item()], lastError: null,
})

async function setup(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'batch-update-store-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const legacy = new FileSnapshotStore(directory, 'isolated')
  return { directory, legacy, store: new FileUpdateStore(directory, 'isolated', legacy) }
}

test('update record round trips independently of the legacy recovery snapshot', async t => {
  const { directory, legacy, store } = await setup(t)
  const old: Snapshot = {
    version: 1, profile: 'isolated', createdAt: '2026-10-30T03:00:00.000Z',
    order: ['old-plugin'], items: [{ name: 'old-plugin', state: 'disabled' }], results: [], lastError: null,
  }
  await legacy.withLock(() => legacy.save(old))
  assert.equal(await store.load(), null)
  await store.withLock(() => store.save(snapshot()))
  assert.deepEqual(await new FileUpdateStore(directory, 'isolated', legacy).load(), snapshot())
  assert.deepEqual(await legacy.load(), old)
  assert.deepEqual((await readdir(directory)).sort(), ['snapshot.json', 'update.json'])
  await store.withLock(() => store.clear())
  assert.equal(await store.load(), null)
  assert.deepEqual(await legacy.load(), old)
  assert.deepEqual(await readdir(directory), ['snapshot.json'])
})

test('corrupt, foreign-profile, or unknown-field update records cannot be replaced or cleared', async t => {
  const { directory, store } = await setup(t)
  const contents = [
    '{invalid', JSON.stringify(snapshot('other')),
    JSON.stringify({ ...snapshot(), unexpected: true }),
    JSON.stringify({ ...snapshot(), items: [{ ...item(), extra: true }] }),
    JSON.stringify({ ...snapshot(), items: [item({ result: { ...item().result!, extra: true } as unknown as UpdateItem['result'] })] }),
  ]
  for (const source of contents) {
    await writeFile(join(directory, 'update.json'), source)
    await assert.rejects(() => store.load(), { code: 'snapshot-invalid' })
    await assert.rejects(() => store.save(snapshot()), { code: 'snapshot-invalid' })
    await assert.rejects(() => store.clear(), { code: 'snapshot-invalid' })
    assert.equal(await readFile(join(directory, 'update.json'), 'utf8'), source)
  }
})

test('strict update item schema rejects malformed fields and duplicate names without overwriting recovery', async t => {
  const { directory, store } = await setup(t)
  await store.save(snapshot())
  const invalids: unknown[] = [
    { ...snapshot(), version: 2 }, { ...snapshot(), profile: 'other' },
    { ...snapshot(), startedAt: 'yesterday' }, { ...snapshot(), finishedAt: false },
    { ...snapshot(), lastError: 123 }, { ...snapshot(), items: [item(), item()] },
    ...[
      { name: '' }, { name: 'bad name' }, { beforeVersion: 1 }, { targetVersion: false },
      { desiredEnabled: 'yes' }, { registry: {} }, { state: 'unknown' },
      { requestId: 3 }, { restartRequired: 1 }, { removalStarted: 'false' }, { removalStarted: null }, { result: [] },
    ].map(fields => ({ ...snapshot(), items: [{ ...item(), ...fields }] })),
  ]
  for (const value of invalids) {
    await assert.rejects(() => store.save(value as UpdateSnapshot), { code: 'snapshot-invalid' })
  }
  assert.deepEqual(await store.load(), snapshot())
  assert.deepEqual(await readdir(directory), ['update.json'])
})

test('every update result field is validated, including closed outcomes and matching item identity', async t => {
  const { store } = await setup(t)
  const invalidResults: Record<string, unknown>[] = [
    { name: 'foreign' }, { beforeVersion: 1 }, { beforeVersion: '9.0.0' }, { targetVersion: 2 }, { targetVersion: '9.1.0' }, { installedVersion: true },
    { outcome: 'success' }, { message: false }, { enabled: 1 }, { rollback: 'complete' },
    { restartRequired: 'false' }, { recoveryNeeded: null },
  ]
  const withoutMessage = { ...item().result! } as Record<string, unknown>
  delete withoutMessage.message
  for (const fields of invalidResults) {
    const value = { ...snapshot(), items: [{ ...item(), result: { ...item().result!, ...fields } }] }
    await assert.rejects(() => store.save(value as UpdateSnapshot), { code: 'snapshot-invalid' })
  }
  await assert.rejects(() => store.save({ ...snapshot(), items: [{ ...item(), result: withoutMessage }] } as unknown as UpdateSnapshot), { code: 'snapshot-invalid' })
  assert.equal(await store.load(), null)
})

test('all update stages and nullable fields survive interrupted-record round trips', async t => {
  const { store } = await setup(t)
  for (const state of ['queued', 'checking', 'disabling', 'removing', 'installing', 'restoring', 'rollback', 'done'] as const) {
    const value: UpdateSnapshot = {
      ...snapshot(), finishedAt: null, items: [item({
        beforeVersion: null, targetVersion: null, registry: null, state,
        requestId: state === 'installing' ? 'batch-update-test' : null, result: null,
      })],
    }
    await store.save(value)
    assert.deepEqual(await store.load(), value)
  }
})

test('oversized update records are rejected before reading or replacing existing data', async t => {
  const { directory, store } = await setup(t)
  await store.save(snapshot())
  const tooMuchText = { ...snapshot(), lastError: 'x'.repeat(10001) }
  await assert.rejects(() => store.save(tooMuchText), { code: 'snapshot-invalid' })
  const large = { ...snapshot(), items: Array.from({ length: 1000 }, (_, index) => item({ name: `plugin-${index}`, result: null, registry: 'x'.repeat(3000) })) }
  await assert.rejects(() => store.save(large), { code: 'snapshot-invalid' })
  assert.deepEqual(await store.load(), snapshot())
  await writeFile(join(directory, 'update.json'), ' '.repeat(2 * 1024 * 1024 + 1))
  await assert.rejects(() => store.load(), { code: 'snapshot-invalid' })
})

test('legacy and update operations share the same exclusive lock in both directions', async t => {
  const { directory, legacy, store } = await setup(t)
  for (const [first, second] of [[legacy, store], [store, legacy]] as const) {
    let enter!: () => void
    let release!: () => void
    const entered = new Promise<void>(resolve => { enter = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    const active = first.withLock(async () => { enter(); await gate })
    await entered
    assert.deepEqual(await readdir(directory), ['batch.lock'])
    await assert.rejects(() => second.withLock(async () => {}), { code: 'busy' })
    release()
    await active
  }
  await store.withLock(() => store.save(snapshot()))
  assert.deepEqual(await store.load(), snapshot())
})
