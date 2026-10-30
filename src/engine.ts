import { CLIENT_ROW_ID, HOST_ROW_ID, PACKAGE_NAME } from './types.ts'
import type { BatchStatus, BundleManager, ChangeOutcome, ItemResult, ManagedBundle } from './types.ts'

export type SnapshotItemState = 'queued' | 'disabling' | 'disabled' | 'restoring' | 'restored' | 'skipped' | 'unchanged'
export interface Snapshot {
  version: 1
  profile: string
  createdAt: string
  order: string[]
  items: { name: string; state: SnapshotItemState }[]
  results: ItemResult[]
  lastError: string | null
}
export interface SnapshotStore {
  load(): Promise<Snapshot | null>
  save(snapshot: Snapshot): Promise<void>
  clear(): Promise<void>
  withLock<T>(action: () => Promise<T>): Promise<T>
}
export interface BatchEngineOptions {
  manager: BundleManager
  store: SnapshotStore
  profile: string
  getOrder?: () => Promise<readonly string[]>
}

export class BatchError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'BatchError'
    this.code = code
  }
}

const pendingStates = new Set<SnapshotItemState>(['disabling', 'disabled', 'restoring'])
const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error)
function pendingNames(snapshot: Snapshot | null): string[] {
  if (!snapshot) return []
  const names = new Set(snapshot.items.filter(item => pendingStates.has(item.state)).map(item => item.name))
  return snapshot.order.filter(name => names.has(name))
}

function protectedBundle(bundle: ManagedBundle): boolean {
  return bundle.name === PACKAGE_NAME
    || bundle.name === 'dshmarket' || bundle.name === '@dsh-external/dshmarket'
    || bundle.name.startsWith('@deepseek-ai/')
    || bundle.official || !bundle.installed
    || bundle.availability === 'missing' || bundle.availability === 'installation'
    || bundle.readOnlyReason !== undefined || bundle.error !== undefined
    || bundle.rows.some(row => row.rowId === HOST_ROW_ID || row.rowId === CLIENT_ROW_ID || row.rowId === PACKAGE_NAME || row.moduleName === PACKAGE_NAME || row.moduleName.startsWith(`${PACKAGE_NAME}/`))
    || bundle.overrides.some(rowId => rowId === HOST_ROW_ID || rowId === CLIENT_ROW_ID || rowId === PACKAGE_NAME)
}

function describe(outcome: ChangeOutcome): string | undefined {
  if (outcome.error) return [outcome.error.code, outcome.error.diagnostic].filter(Boolean).join(': ')
  if (outcome.application === 'restart-required') return outcome.restartReason ?? 'Restart required to apply the saved change.'
  if (outcome.application === 'overridden') return 'The saved change is overridden by another layer.'
  if (outcome.application === 'cancelled') return 'The operation was cancelled.'
  if (outcome.application === 'failed') return 'The operation failed.'
  if (!outcome.changed) return 'No configuration change was made.'
  return undefined
}

export class BatchEngine {
  private readonly options: BatchEngineOptions
  private busy = false
  private phase: BatchStatus['phase'] = 'idle'
  private aborted = false
  private revision = 0
  private total = 0
  private completed = 0
  private snapshot: Snapshot | null = null
  private candidates: string[] = []
  private protected: string[] = []
  private results: ItemResult[] = []
  private lastError: string | null = null

  constructor(options: BatchEngineOptions) { this.options = options }

  /** Polling never joins the active job or waits for a manager mutation. */
  async status(): Promise<BatchStatus> {
    if (!this.busy) {
      const revision = this.revision
      const [snapshot, bundles] = await Promise.all([this.options.store.load(), this.options.manager.listBundles()])
      if (revision !== this.revision) return this.status()
      this.checkProfile(snapshot)
      this.snapshot = snapshot
      this.inventory(bundles)
      if (snapshot) {
        this.results = structuredClone(snapshot.results)
        this.lastError = this.lastError ?? snapshot.lastError
        if (this.total === 0) {
          this.total = snapshot.items.length
          this.completed = snapshot.items.filter(item => !['queued', 'disabling', 'restoring'].includes(item.state)).length
        }
      }
    }
    return structuredClone({
      busy: this.busy, phase: this.phase, total: this.total, completed: this.completed,
      candidates: this.candidates, protected: this.protected,
      pendingRestore: pendingNames(this.snapshot), snapshotCreatedAt: this.snapshot?.createdAt ?? null,
      results: this.results, lastError: this.lastError,
    })
  }

  async disable(): Promise<void> { return this.run('disabling', () => this.disableSelected()) }
  async restore(): Promise<void> { return this.run('restoring', () => this.restoreSelected()) }

  /** HMR may be waiting for this disposal inside setBundleEnabled. Never join it. */
  dispose(): void { this.aborted = true }

  private async run(phase: 'disabling' | 'restoring', action: () => Promise<void>): Promise<void> {
    if (this.aborted) throw new BatchError('disposed', 'This batch controller has been disposed.')
    if (this.busy) throw new BatchError('busy', 'Another batch operation is running.')
    // Set synchronously, before lock acquisition or any other await.
    this.busy = true
    this.phase = phase
    this.revision++
    this.total = 0
    this.completed = 0
    this.lastError = null
    try {
      await this.options.store.withLock(async () => {
        if (!this.aborted) await action()
      })
    } catch (error) {
      this.lastError = messageOf(error)
      throw error
    } finally {
      this.busy = false
      this.phase = 'idle'
      this.revision++
    }
  }

  private checkProfile(snapshot: Snapshot | null): void {
    if (snapshot && snapshot.profile !== this.options.profile) throw new BatchError('snapshot-invalid', 'The snapshot belongs to another profile.')
  }

  private inventory(bundles: ManagedBundle[]): void {
    this.candidates = bundles.filter(bundle => bundle.enabled && !protectedBundle(bundle)).map(bundle => bundle.name)
    this.protected = bundles.filter(protectedBundle).map(bundle => bundle.name)
  }

  private async persist(snapshot: Snapshot): Promise<void> {
    await this.options.store.save(snapshot)
    this.snapshot = structuredClone(snapshot)
    this.results = structuredClone(snapshot.results)
    this.lastError = snapshot.lastError
  }

  private async record(snapshot: Snapshot, item: Snapshot['items'][number], state: SnapshotItemState, result: ItemResult): Promise<void> {
    item.state = state
    snapshot.results.push(result)
    if (result.outcome === 'failed' || result.outcome === 'overridden' || result.outcome === 'cancelled') snapshot.lastError = `${result.name}: ${result.detail ?? result.outcome}`
    await this.persist(snapshot)
    this.completed++
  }

  private async finish(snapshot: Snapshot): Promise<void> {
    if (pendingNames(snapshot).length === 0) {
      await this.options.store.clear()
      this.snapshot = null
    }
  }

  private async disableSelected(): Promise<void> {
    const previous = await this.options.store.load()
    this.checkProfile(previous)
    this.snapshot = previous
    if (previous) throw new BatchError('pending-restore', 'Restore the previous batch before disabling another one.')
    const bundles = await this.options.manager.listBundles()
    this.inventory(bundles)
    const selection = new Set(this.candidates)
    const preferred = this.options.getOrder ? await this.options.getOrder() : this.candidates
    const order = [...new Set([...preferred, ...this.candidates])].filter(name => selection.has(name))
    this.total = order.length
    this.results = []
    if (this.aborted || order.length === 0) return
    const snapshot: Snapshot = {
      version: 1, profile: this.options.profile, createdAt: new Date().toISOString(),
      order, items: order.map(name => ({ name, state: 'queued' })), results: [], lastError: null,
    }
    await this.persist(snapshot)
    for (const item of snapshot.items) {
      if (this.aborted) break
      const bundle = (await this.options.manager.listBundles()).find(bundle => bundle.name === item.name)
      if (this.aborted) break
      if (!bundle || !bundle.enabled || protectedBundle(bundle)) {
        await this.record(snapshot, item, 'skipped', { name: item.name, action: 'disable', outcome: 'skipped', detail: 'The bundle is no longer an eligible enabled target.' })
        continue
      }
      item.state = 'disabling'
      await this.persist(snapshot)
      if (this.aborted) break
      let outcome: ChangeOutcome
      try {
        outcome = await this.options.manager.setBundleEnabled(item.name, false)
      } catch (error) {
        // A thrown call gives no reliable persisted-change answer. Keep its intent recoverable.
        await this.record(snapshot, item, 'disabling', { name: item.name, action: 'disable', outcome: 'failed', detail: messageOf(error) })
        continue
      }
      await this.record(snapshot, item, outcome.changed ? 'disabled' : 'unchanged', { name: item.name, action: 'disable', outcome: outcome.application, ...describe(outcome) === undefined ? {} : { detail: describe(outcome) } })
    }
    await this.finish(snapshot)
  }

  private async restoreSelected(): Promise<void> {
    const snapshot = await this.options.store.load()
    this.checkProfile(snapshot)
    this.snapshot = snapshot
    if (!snapshot) return
    this.results = structuredClone(snapshot.results)
    const targets = pendingNames(snapshot)
    this.total = targets.length
    snapshot.lastError = null
    for (const name of targets) {
      if (this.aborted) break
      const item = snapshot.items.find(item => item.name === name)!
      const bundle = (await this.options.manager.listBundles()).find(bundle => bundle.name === name)
      if (this.aborted) break
      if (!bundle || !bundle.installed || bundle.availability === 'missing') {
        await this.record(snapshot, item, 'skipped', { name, action: 'restore', outcome: 'skipped', detail: 'The bundle is missing or uninstalled; it was not reinstalled.' })
        continue
      }
      const latest = [...snapshot.results].reverse().find(result => result.name === name && result.outcome !== 'skipped')
      // A saved restore intent may have changed selection before an interrupted
      // HMR call returned. Enabled selection alone cannot confirm that call.
      const retryUnapplied = item.state === 'restoring'
        || latest?.action === 'restore' && ['failed', 'overridden', 'cancelled'].includes(latest.outcome)
      if (bundle.enabled && !retryUnapplied) {
        await this.record(snapshot, item, 'restored', { name, action: 'restore', outcome: 'skipped', detail: 'The bundle is already enabled.' })
        continue
      }
      if (protectedBundle(bundle)) {
        await this.record(snapshot, item, item.state, { name, action: 'restore', outcome: 'skipped', detail: 'The bundle is currently protected or unavailable; restoration remains pending.' })
        continue
      }
      item.state = 'restoring'
      await this.persist(snapshot)
      if (this.aborted) break
      let outcome: ChangeOutcome
      try {
        outcome = await this.options.manager.setBundleEnabled(name, true)
      } catch (error) {
        await this.record(snapshot, item, 'restoring', { name, action: 'restore', outcome: 'failed', detail: messageOf(error) })
        continue
      }
      // Disk changes alone cannot prove a successful application. Failures keep recovery responsibility.
      const successful = outcome.application === 'applied' || outcome.application === 'restart-required'
      let detail = describe(outcome)
      let restored = false
      if (successful) {
        const current = (await this.options.manager.listBundles()).find(bundle => bundle.name === name)
        restored = current?.enabled === true
        if (!restored) {
          detail = 'The manager reported success, but the bundle is still disabled; restoration remains pending.'
          snapshot.lastError = `${name}: ${detail}`
        }
      }
      await this.record(snapshot, item, restored ? 'restored' : 'disabled', { name, action: 'restore', outcome: outcome.application, ...detail === undefined ? {} : { detail } })
    }
    await this.finish(snapshot)
  }
}
