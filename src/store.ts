import { randomUUID } from 'node:crypto'
import { link, mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { Snapshot, SnapshotStore } from './engine.ts'

const MAX_BYTES = 2 * 1024 * 1024
const STATES = new Set(['queued', 'disabling', 'disabled', 'restoring', 'restored', 'skipped', 'unchanged'])
const OUTCOMES = new Set(['applied', 'restart-required', 'overridden', 'failed', 'cancelled', 'skipped'])

export class StoreError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'StoreError'
    this.code = code
  }
}

function codeOf(error: unknown): string | undefined {
  return error !== null && typeof error === 'object' && 'code' in error ? String(error.code) : undefined
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  return required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key))
}

function text(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= limit
}

function name(value: unknown): value is string {
  return text(value, 512) && !/[\u0000-\u0020\u007f]/u.test(value)
}

function timestamp(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}

function validSnapshot(value: unknown, profile: string): value is Snapshot {
  if (!record(value) || !exactKeys(value, ['version', 'profile', 'createdAt', 'order', 'items', 'results', 'lastError'])) return false
  if (value.version !== 1 || value.profile !== profile || !text(value.profile, 4096) || !timestamp(value.createdAt)) return false
  if (!Array.isArray(value.order) || value.order.length > 10000 || !value.order.every(name) || new Set(value.order).size !== value.order.length) return false
  if (!Array.isArray(value.items) || value.items.length !== value.order.length) return false
  const names = new Set<string>()
  for (const item of value.items) {
    if (!record(item) || !exactKeys(item, ['name', 'state']) || !name(item.name) || !STATES.has(String(item.state)) || typeof item.state !== 'string' || names.has(item.name)) return false
    names.add(item.name)
  }
  if (!value.order.every(item => names.has(item))) return false
  if (!Array.isArray(value.results) || value.results.length > 50000) return false
  for (const result of value.results) {
    if (!record(result) || !exactKeys(result, ['name', 'action', 'outcome'], ['detail'])) return false
    if (!name(result.name) || !names.has(result.name) || (result.action !== 'disable' && result.action !== 'restore') || typeof result.outcome !== 'string' || !OUTCOMES.has(result.outcome)) return false
    if (Object.hasOwn(result, 'detail') && (typeof result.detail !== 'string' || result.detail.length > 10000)) return false
  }
  return value.lastError === null || (typeof value.lastError === 'string' && value.lastError.length <= 10000)
}

interface Lock {
  version: 1
  pid: number
  token: string
  createdAt: string
}

function validLock(value: unknown): value is Lock {
  return record(value) && exactKeys(value, ['version', 'pid', 'token', 'createdAt']) && value.version === 1 && Number.isSafeInteger(value.pid) && Number(value.pid) > 0 && Number(value.pid) <= 2147483647 && typeof value.token === 'string' && /^[a-z\d-]{1,80}$/iu.test(value.token) && timestamp(value.createdAt)
}

function processIsAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true }
  catch (error) { return codeOf(error) !== 'ESRCH' }
}

/** A profile-owned recovery file. Mutations are performed inside withLock by the engine. */
export class FileSnapshotStore implements SnapshotStore {
  private readonly directory: string
  private readonly profile: string
  private readonly snapshotPath: string
  private readonly lockPath: string

  constructor(directory: string, profile: string) {
    if (!text(profile, 4096)) throw new StoreError('snapshot-invalid', 'A profile identity is required')
    this.directory = directory
    this.profile = profile
    this.snapshotPath = join(directory, 'snapshot.json')
    this.lockPath = join(directory, 'batch.lock')
  }

  async load(): Promise<Snapshot | null> {
    let handle
    try { handle = await open(this.snapshotPath, 'r') }
    catch (error) { if (codeOf(error) === 'ENOENT') return null; throw error }
    try {
      if ((await handle.stat()).size > MAX_BYTES) throw new StoreError('snapshot-invalid', 'Recovery snapshot exceeds the size limit')
      const source = await handle.readFile('utf8')
      let value: unknown
      try { value = JSON.parse(source) }
      catch { throw new StoreError('snapshot-invalid', 'Recovery snapshot contains invalid JSON; the original file was kept') }
      if (!validSnapshot(value, this.profile)) throw new StoreError('snapshot-invalid', 'Recovery snapshot is invalid or belongs to another profile; the original file was kept')
      return value
    } finally { await handle.close() }
  }

  async save(snapshot: Snapshot): Promise<void> {
    if (!validSnapshot(snapshot, this.profile)) throw new StoreError('snapshot-invalid', 'Refusing to write an invalid recovery snapshot')
    const source = `${JSON.stringify(snapshot, null, 2)}\n`
    if (Buffer.byteLength(source) > MAX_BYTES) throw new StoreError('snapshot-invalid', 'Recovery snapshot exceeds the size limit')
    // Never replace unreadable recovery information with a new batch.
    await this.load()
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const temporary = join(this.directory, `.snapshot-${randomUUID()}.tmp`)
    const handle = await open(temporary, 'wx', 0o600)
    try {
      try { await handle.writeFile(source, 'utf8'); await handle.sync() }
      finally { await handle.close() }
      await rename(temporary, this.snapshotPath)
    } finally {
      try { await unlink(temporary) }
      catch (error) { if (codeOf(error) !== 'ENOENT') throw error }
    }
  }

  async clear(): Promise<void> {
    if (await this.load() === null) return
    try { await unlink(this.snapshotPath) }
    catch (error) { if (codeOf(error) !== 'ENOENT') throw error }
  }

  async withLock<T>(action: () => Promise<T>): Promise<T> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const owner: Lock = { version: 1, pid: process.pid, token: randomUUID(), createdAt: new Date().toISOString() }
    await this.acquire(owner)
    try { return await action() }
    finally { await this.removeOwnedLock(this.lockPath, owner.token) }
  }

  private async readLock(path: string): Promise<Lock | null> {
    try {
      const source = await readFile(path, 'utf8')
      if (source.length > 2048) return null
      const value: unknown = JSON.parse(source)
      return validLock(value) ? value : null
    } catch (error) {
      if (codeOf(error) === 'ENOENT' || error instanceof SyntaxError) return null
      throw error
    }
  }

  private async createLock(path: string, owner: Lock): Promise<boolean> {
    const temporary = join(this.directory, `.owner-${randomUUID()}.tmp`)
    const handle = await open(temporary, 'wx', 0o600)
    try {
      try { await handle.writeFile(JSON.stringify(owner), 'utf8'); await handle.sync() }
      finally { await handle.close() }
      // Publish a fully written owner record without replacing an existing lock.
      // A crash before publication leaves only an unrelated temporary file;
      // after publication, readers can always identify and recover its dead PID.
      try { await link(temporary, path); return true }
      catch (error) { if (codeOf(error) === 'EEXIST') return false; throw error }
    } finally {
      try { await unlink(temporary) }
      catch (error) { if (codeOf(error) !== 'ENOENT') throw error }
    }
  }

  private async removeOwnedLock(path: string, token: string): Promise<void> {
    if ((await this.readLock(path))?.token !== token) return
    try { await unlink(path) }
    catch (error) { if (codeOf(error) !== 'ENOENT') throw error }
  }

  private async acquire(owner: Lock): Promise<void> {
    if (await this.createLock(this.lockPath, owner)) return
    const stale = await this.readLock(this.lockPath)
    if (stale === null || processIsAlive(stale.pid)) throw new StoreError('busy', 'Another batch operation holds the recovery lock')

    // A wx claim for each stale token serializes reclaimers. A process that dies
    // during reclamation leaves a claim that the next process can follow, rather
    // than racing to unlink a newly acquired live process's main lock.
    let previous = stale
    const chain: { path: string; token: string }[] = []
    let claimPath = ''
    for (let depth = 0; depth < 32; depth++) {
      claimPath = join(this.directory, `.reclaim-${previous.token}.lock`)
      if (await this.createLock(claimPath, owner)) {
        chain.push({ path: claimPath, token: owner.token })
        break
      }
      const claimant = await this.readLock(claimPath)
      if (claimant === null || processIsAlive(claimant.pid)) throw new StoreError('busy', 'Another process is recovering the batch lock')
      chain.push({ path: claimPath, token: claimant.token })
      previous = claimant
      if (depth === 31) throw new StoreError('busy', 'Recovery lock has too many interrupted claims')
    }
    try {
      if ((await this.readLock(this.lockPath))?.token !== stale.token) throw new StoreError('busy', 'Another process acquired the batch lock')
      await unlink(this.lockPath)
      if (!await this.createLock(this.lockPath, owner)) throw new StoreError('busy', 'Another process acquired the batch lock')
    } finally {
      for (const claim of chain.reverse()) await this.removeOwnedLock(claim.path, claim.token)
    }
  }
}
