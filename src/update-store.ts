import { randomUUID } from 'node:crypto'
import { mkdir, open, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { SnapshotStore } from './engine.ts'
import type { UpdateSnapshot, UpdateStore } from './update-engine.ts'

const MAX_BYTES = 2 * 1024 * 1024
const STATES = new Set(['queued', 'checking', 'disabling', 'removing', 'installing', 'restoring', 'rollback', 'done'])
const OUTCOMES = new Set(['updated', 'up-to-date', 'failed', 'skipped', 'cancelled'])
const ROLLBACKS = new Set(['not-needed', 'succeeded', 'failed'])

export class UpdateStoreError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'UpdateStoreError'
    this.code = code
  }
}

function codeOf(error: unknown): string | undefined {
  return error !== null && typeof error === 'object' && 'code' in error ? String(error.code) : undefined
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function exactKeys(value: Record<string, unknown>, required: string[]): boolean {
  return required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key))
}
function boundedString(value: unknown, limit: number, empty = false): value is string {
  return typeof value === 'string' && (empty || value.length > 0) && value.length <= limit
}
function nullableString(value: unknown, limit: number): value is string | null {
  return value === null || (boundedString(value, limit) && !/[\u0000-\u001f\u007f]/u.test(value))
}
function validName(value: unknown): value is string {
  return boundedString(value, 512) && !/[\u0000-\u0020\u007f]/u.test(value)
}
function timestamp(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}
function validResult(value: unknown, item: Record<string, unknown>): boolean {
  if (!record(value) || !exactKeys(value, ['name', 'beforeVersion', 'targetVersion', 'installedVersion', 'outcome', 'message', 'enabled', 'rollback', 'restartRequired', 'recoveryNeeded'])) return false
  return validName(value.name) && value.name === item.name
    && nullableString(value.beforeVersion, 256) && value.beforeVersion === item.beforeVersion
    && nullableString(value.targetVersion, 256) && value.targetVersion === item.targetVersion
    && nullableString(value.installedVersion, 256)
    && typeof value.outcome === 'string' && OUTCOMES.has(value.outcome)
    && boundedString(value.message, 10000, true) && typeof value.enabled === 'boolean'
    && (value.rollback === null || (typeof value.rollback === 'string' && ROLLBACKS.has(value.rollback)))
    && typeof value.restartRequired === 'boolean' && typeof value.recoveryNeeded === 'boolean'
}
function validSnapshot(value: unknown, profile: string): value is UpdateSnapshot {
  if (!record(value) || !exactKeys(value, ['version', 'profile', 'startedAt', 'finishedAt', 'items', 'lastError'])) return false
  if (value.version !== 1 || value.profile !== profile || !boundedString(value.profile, 4096) || !timestamp(value.startedAt)) return false
  if (value.finishedAt !== null && !timestamp(value.finishedAt)) return false
  if (value.lastError !== null && !boundedString(value.lastError, 10000, true)) return false
  if (!Array.isArray(value.items) || value.items.length > 10000) return false
  const names = new Set<string>()
  for (const item of value.items) {
    if (!record(item) || !exactKeys(item, ['name', 'beforeVersion', 'targetVersion', 'desiredEnabled', 'registry', 'state', 'requestId', 'restartRequired', 'removalStarted', 'result'])) return false
    if (!validName(item.name) || names.has(item.name)) return false
    names.add(item.name)
    if (!nullableString(item.beforeVersion, 256) || !nullableString(item.targetVersion, 256) || typeof item.desiredEnabled !== 'boolean') return false
    if (!nullableString(item.registry, 4096) || typeof item.state !== 'string' || !STATES.has(item.state)) return false
    if (!nullableString(item.requestId, 512) || typeof item.restartRequired !== 'boolean' || typeof item.removalStarted !== 'boolean') return false
    if (item.result !== null && !validResult(item.result, item)) return false
  }
  return true
}

/** Separate update journal; batch and update operations share the legacy store's mutex. */
export class FileUpdateStore implements UpdateStore {
  private readonly directory: string
  private readonly profile: string
  private readonly path: string
  private readonly lockStore: SnapshotStore

  constructor(directory: string, profile: string, lockStore: SnapshotStore) {
    if (!boundedString(profile, 4096)) throw new UpdateStoreError('snapshot-invalid', 'A profile identity is required')
    this.directory = directory
    this.profile = profile
    this.path = join(directory, 'update.json')
    this.lockStore = lockStore
  }

  async load(): Promise<UpdateSnapshot | null> {
    let handle
    try { handle = await open(this.path, 'r') }
    catch (error) { if (codeOf(error) === 'ENOENT') return null; throw error }
    try {
      if ((await handle.stat()).size > MAX_BYTES) throw new UpdateStoreError('snapshot-invalid', 'Update record exceeds the size limit')
      const source = await handle.readFile('utf8')
      let value: unknown
      try { value = JSON.parse(source) }
      catch { throw new UpdateStoreError('snapshot-invalid', 'Update record contains invalid JSON; the original file was kept') }
      if (!validSnapshot(value, this.profile)) throw new UpdateStoreError('snapshot-invalid', 'Update record is invalid or belongs to another profile; the original file was kept')
      return value
    } finally { await handle.close() }
  }

  async save(snapshot: UpdateSnapshot): Promise<void> {
    if (!validSnapshot(snapshot, this.profile)) throw new UpdateStoreError('snapshot-invalid', 'Refusing to write an invalid update record')
    const source = `${JSON.stringify(snapshot, null, 2)}\n`
    if (Buffer.byteLength(source) > MAX_BYTES) throw new UpdateStoreError('snapshot-invalid', 'Update record exceeds the size limit')
    // Keep any damaged recovery record available for inspection instead of replacing it.
    await this.load()
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const temporary = join(this.directory, `.update-${randomUUID()}.tmp`)
    const handle = await open(temporary, 'wx', 0o600)
    try {
      try { await handle.writeFile(source, 'utf8'); await handle.sync() }
      finally { await handle.close() }
      await rename(temporary, this.path)
    } finally {
      try { await unlink(temporary) }
      catch (error) { if (codeOf(error) !== 'ENOENT') throw error }
    }
  }

  async clear(): Promise<void> {
    if (await this.load() === null) return
    try { await unlink(this.path) }
    catch (error) { if (codeOf(error) !== 'ENOENT') throw error }
  }

  withLock<T>(action: () => Promise<T>): Promise<T> {
    return this.lockStore.withLock(action)
  }
}
