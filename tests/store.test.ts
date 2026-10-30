import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { TestContext } from 'node:test'
import { pathToFileURL } from 'node:url'
import { FileSnapshotStore } from '../src/store.ts'
import type { Snapshot } from '../src/engine.ts'

const snapshot = (profile = 'test'): Snapshot => ({
  version: 1, profile, createdAt: '2026-10-30T04:00:00.000Z',
  order: ['alpha'], items: [{ name: 'alpha', state: 'disabled' }],
  results: [{ name: 'alpha', action: 'disable', outcome: 'applied' }], lastError: null,
})

async function directory(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'batch-store-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

test('atomic snapshots survive new store instances and clear only their own file', async t => {
  const dir = await directory(t)
  const store = new FileSnapshotStore(dir, 'test')
  assert.equal(await store.load(), null)
  await store.withLock(() => store.save(snapshot()))
  await writeFile(join(dir, 'unrelated.txt'), 'keep')
  assert.deepEqual(await new FileSnapshotStore(dir, 'test').load(), snapshot())
  assert.deepEqual((await readdir(dir)).sort(), ['snapshot.json', 'unrelated.txt'])
  await store.withLock(() => store.clear())
  assert.equal(await store.load(), null)
  assert.equal(await readFile(join(dir, 'unrelated.txt'), 'utf8'), 'keep')
})

test('corrupt or foreign-profile snapshots are rejected and never overwritten', async t => {
  const dir = await directory(t)
  const store = new FileSnapshotStore(dir, 'test')
  for (const contents of ['{broken', JSON.stringify(snapshot('other')), JSON.stringify({ ...snapshot(), extra: true }), JSON.stringify({ ...snapshot(), items: [{ name: 'alpha', state: 'unknown' }] })]) {
    await writeFile(join(dir, 'snapshot.json'), contents)
    await assert.rejects(() => store.load(), { code: 'snapshot-invalid' })
    await assert.rejects(() => store.save(snapshot()), { code: 'snapshot-invalid' })
    await assert.rejects(() => store.clear(), { code: 'snapshot-invalid' })
    assert.equal(await readFile(join(dir, 'snapshot.json'), 'utf8'), contents)
  }
})

test('invalid new snapshot cannot replace a valid recovery snapshot', async t => {
  const dir = await directory(t)
  const store = new FileSnapshotStore(dir, 'test')
  await store.save(snapshot())
  const invalids = [
    { ...snapshot(), profile: 'other' },
    { ...snapshot(), createdAt: 'yesterday' },
    { ...snapshot(), order: ['alpha', 'alpha'] },
    { ...snapshot(), order: ['beta'] },
    { ...snapshot(), results: [{ name: 'alpha', action: 'disable', outcome: 'successful' }] },
  ]
  for (const value of invalids) await assert.rejects(() => store.save(value as Snapshot), { code: 'snapshot-invalid' })
  assert.deepEqual(await store.load(), snapshot())
})

test('exclusive lock rejects another instance and releases after thrown work', async t => {
  const dir = await directory(t)
  const first = new FileSnapshotStore(dir, 'test')
  const second = new FileSnapshotStore(dir, 'test')
  let enter!: () => void
  let release!: () => void
  const entered = new Promise<void>(resolve => { enter = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  const active = first.withLock(async () => { enter(); await gate; throw new Error('work failed') })
  await entered
  await assert.rejects(() => second.withLock(async () => {}), { code: 'busy' })
  release()
  await assert.rejects(() => active, /work failed/)
  await second.withLock(() => second.save(snapshot()))
  assert.deepEqual(await first.load(), snapshot())
})

test('dead process lock is reclaimed while malformed lock is kept', async t => {
  const dir = await directory(t)
  const store = new FileSnapshotStore(dir, 'test')
  await writeFile(join(dir, 'batch.lock'), JSON.stringify({ version: 1, pid: 2147483647, token: 'dead', createdAt: '2026-10-30T04:00:00.000Z' }))
  await store.withLock(() => store.save(snapshot()))
  assert.deepEqual(await store.load(), snapshot())
  await writeFile(join(dir, 'batch.lock'), 'unreadable')
  await assert.rejects(() => store.withLock(async () => {}), { code: 'busy' })
  assert.equal(await readFile(join(dir, 'batch.lock'), 'utf8'), 'unreadable')
})

test('schema rejects duplicate items, foreign result names, and oversized snapshots', async t => {
  const dir = await directory(t)
  const store = new FileSnapshotStore(dir, 'test')
  const invalids = [
    { ...snapshot(), order: ['alpha', 'beta'], items: [{ name: 'alpha', state: 'disabled' }, { name: 'alpha', state: 'queued' }] },
    { ...snapshot(), results: [{ name: 'foreign', action: 'disable', outcome: 'applied' }] },
    { ...snapshot(), results: [{ name: 'alpha', action: 'disable', outcome: 'applied', secret: 'unknown-field' }] },
    { ...snapshot(), lastError: 'x'.repeat(10001) },
  ]
  for (const value of invalids) {
    await writeFile(join(dir, 'snapshot.json'), JSON.stringify(value))
    await assert.rejects(() => store.load(), { code: 'snapshot-invalid' })
  }
  await writeFile(join(dir, 'snapshot.json'), ' '.repeat(2 * 1024 * 1024 + 1))
  await assert.rejects(() => store.load(), { code: 'snapshot-invalid' })
})

test('recovers a lock whose previous reclaimer also crashed', async t => {
  const dir = await directory(t)
  const dead = { version: 1, pid: 2147483647, token: 'original', createdAt: '2026-10-30T04:00:00.000Z' }
  await writeFile(join(dir, 'batch.lock'), JSON.stringify(dead))
  await writeFile(join(dir, '.reclaim-original.lock'), JSON.stringify({ ...dead, token: 'previous-claim' }))
  const store = new FileSnapshotStore(dir, 'test')
  await store.withLock(() => store.save(snapshot()))
  assert.deepEqual(await readdir(dir), ['snapshot.json'])
})

test('a live separate process excludes writers and its abrupt exit permits recovery', { timeout: 10000 }, async t => {
  const dir = await directory(t)
  const moduleUrl = pathToFileURL(join(process.cwd(), 'src', 'store.ts')).href
  const program = `import { FileSnapshotStore } from ${JSON.stringify(moduleUrl)}; const store = new FileSnapshotStore(${JSON.stringify(dir)}, 'test'); await store.withLock(async () => { process.stdout.write('LOCKED'); await new Promise(resolve => process.stdin.once('data', resolve)); });`
  const child = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', program], { stdio: ['pipe', 'pipe', 'pipe'] })
  t.after(() => { child.kill() })
  let errors = ''
  child.stderr.on('data', data => { errors += String(data) })
  await new Promise<void>((resolve, reject) => {
    child.stdout.once('data', data => String(data).includes('LOCKED') ? resolve() : reject(new Error('Child did not acquire lock')))
    child.once('error', reject)
    child.once('exit', code => { if (code !== null) reject(new Error(`Child exited before acquiring lock: ${errors}`)) })
  })
  const store = new FileSnapshotStore(dir, 'test')
  await assert.rejects(() => store.withLock(() => store.save(snapshot())), { code: 'busy' })
  const exited = once(child, 'exit')
  child.kill('SIGKILL')
  await exited
  await store.withLock(() => store.save(snapshot()))
  assert.deepEqual(await store.load(), snapshot())
})

for (const reclaim of [false, true]) {
  test(`${reclaim ? 'reclamation' : 'main'} lock publication exposes a complete owner record before a process can crash`, { timeout: 10000 }, async t => {
    const dir = await directory(t)
    if (reclaim) {
      await writeFile(join(dir, 'batch.lock'), JSON.stringify({ version: 1, pid: 2147483647, token: 'dead', createdAt: '2026-10-30T04:00:00.000Z' }))
    }
    const moduleUrl = pathToFileURL(join(process.cwd(), 'src', 'store.ts')).href
    // Pause the real filesystem immediately after an exclusive official-lock
    // open. This reproduces termination before the next async write, without
    // replacing filesystem side effects or changing the production class.
    const program = `
      import fs from 'node:fs/promises';
      import { syncBuiltinESMExports } from 'node:module';
      const emit = path => process.stdout.write(JSON.stringify({ path }) + '\\n');
      const pause = () => new Promise(resolve => process.stdin.once('data', resolve));
      const originalOpen = fs.open;
      fs.open = async (path, ...args) => {
        const handle = await originalOpen(path, ...args);
        if (typeof path === 'string' && path.endsWith('.lock') && args[0] === 'wx') {
          emit(path);
          await pause();
        }
        return handle;
      };
      syncBuiltinESMExports();
      const { FileSnapshotStore } = await import(${JSON.stringify(moduleUrl)});
      const store = new FileSnapshotStore(${JSON.stringify(dir)}, 'test');
      await store.withLock(async () => { emit(${JSON.stringify(join(dir, 'batch.lock'))}); await pause(); });
    `
    const child = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', program], { stdio: ['pipe', 'pipe', 'pipe'] })
    t.after(() => { child.kill() })
    let errors = ''
    child.stderr.on('data', data => { errors += String(data) })
    const published = await new Promise<{ path: string }>((resolve, reject) => {
      let output = ''
      child.stdout.on('data', data => {
        output += String(data)
        if (output.includes('\n')) {
          try { resolve(JSON.parse(output.slice(0, output.indexOf('\n')))) }
          catch (error) { reject(error) }
        }
      })
      child.once('error', reject)
      child.once('exit', () => { reject(new Error(`Child exited before publishing a lock: ${errors}`)) })
    })
    try {
      const source = await readFile(published.path, 'utf8')
      assert.doesNotThrow(() => JSON.parse(source), 'An observable lock must already contain its complete owner record')
      const owner = JSON.parse(source)
      assert.equal(owner.version, 1)
      assert.equal(owner.pid, child.pid)
      assert.match(owner.token, /^[a-z\d-]{1,80}$/iu)
      assert.equal(new Date(owner.createdAt).toISOString(), owner.createdAt)
    } finally {
      const exited = once(child, 'exit')
      child.kill('SIGKILL')
      await exited
    }
    const store = new FileSnapshotStore(dir, 'test')
    await store.withLock(() => store.save(snapshot()))
    assert.deepEqual(await store.load(), snapshot())
  })
}
