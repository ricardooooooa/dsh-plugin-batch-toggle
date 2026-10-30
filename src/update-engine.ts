import { randomUUID } from 'node:crypto'
import semver from 'semver'
import { npmSource } from './npm-update-adapter.ts'
import { CLIENT_ROW_ID, HOST_ROW_ID, PACKAGE_NAME } from './types.ts'
import type { ChangeOutcome, LatestPackage, ManagedBundle, UpdateResult, UpdateStatus } from './types.ts'
import type { Snapshot, SnapshotStore } from './engine.ts'

export interface UpdateAdapter {
  listBundles(): Promise<ManagedBundle[]>
  setBundleEnabled(name: string, enabled: boolean): Promise<ChangeOutcome>
  removeBundle(name: string): Promise<ChangeOutcome>
  install(name: string, version: string, enabled: boolean, requestId: string, registry?: string | null, mode?: 'update' | 'rollback'): Promise<ChangeOutcome>
  latest(bundle: ManagedBundle): Promise<LatestPackage>
  cancelInstall(requestId: string): Promise<unknown>
}
export type UpdateItemState = 'queued' | 'checking' | 'disabling' | 'removing' | 'installing' | 'restoring' | 'rollback' | 'done'
export interface UpdateItem {
  name: string
  beforeVersion: string | null
  targetVersion: string | null
  desiredEnabled: boolean
  registry: string | null
  state: UpdateItemState
  requestId: string | null
  restartRequired: boolean
  removalStarted: boolean
  result: UpdateResult | null
}
export interface UpdateSnapshot {
  version: 1
  profile: string
  startedAt: string
  finishedAt: string | null
  items: UpdateItem[]
  lastError: string | null
}
export interface UpdateStore {
  load(): Promise<UpdateSnapshot | null>
  save(snapshot: UpdateSnapshot): Promise<void>
  clear(): Promise<void>
  withLock<T>(action: () => Promise<T>): Promise<T>
}
export interface UpdateEngineOptions {
  adapter: UpdateAdapter
  store: UpdateStore
  legacyStore: SnapshotStore
  profile: string
}

export class UpdateError extends Error {
  readonly code: string
  constructor(code: string, message: string) { super(message); this.name = 'UpdateError'; this.code = code }
}
const legacyPending = new Set(['disabling', 'disabled', 'restoring'])
const pending = (item: UpdateItem) => !['queued', 'checking', 'done'].includes(item.state)
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 4000)
const codeOf = (error: unknown) => error !== null && typeof error === 'object' && 'code' in error ? String(error.code) : undefined
const good = (outcome: ChangeOutcome) => outcome.application === 'applied' || outcome.application === 'restart-required'
const installed = (bundle: ManagedBundle | undefined): bundle is ManagedBundle => !!bundle && bundle.installed && bundle.availability !== 'missing'
const sourceChanged = 'The bundle source has changed from npm or is no longer supported; it was not changed, and recovery remains pending.'
function eligible(bundle: ManagedBundle): boolean {
  return installed(bundle) && bundle.availability === 'profile' && !bundle.official
    && !bundle.name.startsWith('@deepseek-ai/') && bundle.name !== PACKAGE_NAME
    && bundle.name !== 'dshmarket' && bundle.name !== '@dsh-external/dshmarket'
    && bundle.readOnlyReason === undefined && bundle.error === undefined
    && !bundle.rows.some(row => [HOST_ROW_ID, CLIENT_ROW_ID, PACKAGE_NAME].includes(row.rowId) || row.moduleName === PACKAGE_NAME || row.moduleName.startsWith(`${PACKAGE_NAME}/`))
    && !bundle.overrides.some(id => [HOST_ROW_ID, CLIENT_ROW_ID, PACKAGE_NAME].includes(id))
}

export class UpdateEngine {
  private readonly options: UpdateEngineOptions
  private snapshot: UpdateSnapshot | null = null
  private legacy: Snapshot | null = null
  private busy = false
  private aborted = false
  private stopRequested = false
  private active: Promise<void> | null = null
  private currentInstall: { requestId: string; rollback: boolean } | null = null
  private phase: UpdateStatus['phase'] = 'idle'
  private stage: UpdateStatus['stage'] = null
  private current: string | null = null
  private lastError: string | null = null
  private revision = 0

  constructor(options: UpdateEngineOptions) { this.options = options }

  async status(): Promise<UpdateStatus> {
    if (!this.busy) {
      const revision = this.revision
      const snapshot = await this.options.store.load()
      if (revision !== this.revision) return this.status()
      this.checkProfile(snapshot)
      this.snapshot = snapshot
    }
    return structuredClone({
      busy: this.busy, phase: this.phase, total: this.snapshot?.items.length ?? 0,
      completed: this.snapshot?.items.filter(item => item.result !== null).length ?? 0,
      current: this.current, stage: this.stage,
      results: this.snapshot?.items.flatMap(item => item.result ? [item.result] : []) ?? [],
      lastError: this.lastError ?? this.snapshot?.lastError ?? null,
      startedAt: this.snapshot?.startedAt ?? null, finishedAt: this.snapshot?.finishedAt ?? null,
      stopRequested: this.stopRequested,
    })
  }

  run(): Promise<void> {
    if (this.aborted) return Promise.reject(new UpdateError('disposed', 'This update controller has been disposed.'))
    if (this.busy) return Promise.reject(new UpdateError('busy', 'Another update is running.'))
    this.busy = true
    this.revision++
    this.stopRequested = false
    this.lastError = null
    this.phase = 'checking'
    const active = this.execute().catch(error => {
      if (codeOf(error) === 'disposed') return
      this.lastError = messageOf(error)
      throw error
    }).finally(() => {
      this.busy = false; this.phase = 'idle'; this.stage = null; this.current = null
      this.currentInstall = null; this.active = null; this.revision++
    })
    this.active = active
    return active
  }

  async stop(): Promise<void> {
    const active = this.active
    if (!active) return
    this.stopRequested = true
    this.phase = 'stopping'
    const install = this.currentInstall
    if (install && !install.rollback) {
      try { await this.options.adapter.cancelInstall(install.requestId) }
      catch (error) { this.lastError = `Cancellation request failed: ${messageOf(error)}` }
    }
    await active
  }

  /** The official mutation may itself be waiting for this HMR disposal. */
  dispose(): void { this.aborted = true; this.stopRequested = true }

  private checkProfile(snapshot: { profile: string } | null): void {
    if (snapshot && snapshot.profile !== this.options.profile) throw new UpdateError('snapshot-invalid', 'The update record belongs to another profile.')
  }
  private checkAlive(): void { if (this.aborted) throw new UpdateError('disposed', 'Update interrupted by plugin disposal.') }
  private async write(): Promise<void> {
    try { await this.options.store.save(this.snapshot!) }
    catch (error) { throw new UpdateError('storage-error', messageOf(error)) }
  }
  private async intent(item: UpdateItem, state: UpdateItemState, requestId: string | null = null): Promise<void> {
    this.checkAlive()
    item.state = state; item.requestId = requestId
    this.current = item.name
    this.stage = state === 'queued' || state === 'done' ? null : state
    if (!this.stopRequested) this.phase = state === 'checking' ? 'checking' : 'updating'
    await this.write()
    this.checkAlive()
  }
  private async find(name: string): Promise<ManagedBundle | undefined> {
    return (await this.options.adapter.listBundles()).find(bundle => bundle.name === name)
  }
  private checkSource(item: UpdateItem, current: ManagedBundle | undefined, force = false): void {
    if (installed(current) && (force || item.removalStarted || item.targetVersion !== null) && !npmSource(current)) throw new UpdateError('source-changed', sourceChanged)
  }
  private observe(outcome: ChangeOutcome, item: UpdateItem): void {
    item.restartRequired ||= outcome.application === 'restart-required'
    if (!good(outcome)) throw new UpdateError(outcome.application, outcome.error?.diagnostic ?? outcome.error?.code ?? outcome.application)
  }
  private async selection(item: UpdateItem, force = false): Promise<ManagedBundle> {
    const legacyItem = this.legacy?.items.find(entry => entry.name === item.name && legacyPending.has(entry.state))
    const legacyResult = [...this.legacy?.results ?? []].reverse().find(result => result.name === item.name && result.outcome !== 'skipped')
    force ||= legacyItem?.state === 'restoring' || !!legacyItem && legacyResult?.action === 'restore' && ['failed', 'overridden', 'cancelled'].includes(legacyResult.outcome)
    let current = await this.find(item.name)
    if (!installed(current)) throw new UpdateError('missing', 'The bundle is missing.')
    this.checkSource(item, current)
    if (current.enabled === item.desiredEnabled && !force) return current
    if (!eligible(current)) throw new UpdateError('protected', 'The bundle is currently protected or unavailable.')
    await this.intent(item, 'restoring')
    current = await this.find(item.name)
    this.checkSource(item, current)
    if (!installed(current) || !eligible(current)) throw new UpdateError('protected', 'The bundle became protected or unavailable before restoring its selection.')
    const outcome = await this.options.adapter.setBundleEnabled(item.name, item.desiredEnabled)
    this.checkAlive(); this.observe(outcome, item)
    current = await this.find(item.name)
    this.checkSource(item, current)
    if (!installed(current) || current.enabled !== item.desiredEnabled) throw new UpdateError('enable-unconfirmed', 'The original enablement selection was not restored.')
    return current
  }
  private async acknowledgeLegacy(name: string, current: ManagedBundle | undefined): Promise<void> {
    const item = this.legacy?.items.find(item => item.name === name && legacyPending.has(item.state))
    if (!item) return
    if (!installed(current)) item.state = 'skipped'
    else if (current.enabled) item.state = 'restored'
    else return
    await this.saveLegacy()
  }
  private async saveLegacy(): Promise<void> {
    if (!this.legacy) return
    try {
      if (this.legacy.items.some(item => legacyPending.has(item.state))) await this.options.legacyStore.save(this.legacy)
      else { await this.options.legacyStore.clear(); this.legacy = null }
    } catch (error) { throw new UpdateError('storage-error', messageOf(error)) }
  }
  private async result(item: UpdateItem, outcome: UpdateResult['outcome'], message: string, rollback: UpdateResult['rollback'], recoveryNeeded: boolean): Promise<void> {
    const current = await this.find(item.name)
    if (installed(current) && (item.removalStarted || item.targetVersion !== null) && !npmSource(current)) {
      outcome = 'failed'; message = sourceChanged; rollback = 'failed'; recoveryNeeded = true
    }
    item.result = {
      name: item.name, beforeVersion: item.beforeVersion, targetVersion: item.targetVersion,
      installedVersion: installed(current) ? current.version ?? null : null,
      enabled: installed(current) && current.enabled,
      outcome, message: message.slice(0, 8000), rollback,
      restartRequired: item.restartRequired, recoveryNeeded,
    }
    item.state = recoveryNeeded ? 'rollback' : 'done'
    item.requestId = null
    if (outcome === 'failed' || recoveryNeeded) this.snapshot!.lastError = `${item.name}: ${message}`.slice(0, 8000)
    await this.write()
    if (!recoveryNeeded) await this.acknowledgeLegacy(item.name, current)
  }
  private async install(item: UpdateItem, version: string, rollback: boolean): Promise<void> {
    const requestId = `batch-update-${randomUUID()}`
    await this.intent(item, rollback ? 'rollback' : 'installing', requestId)
    this.checkSource(item, await this.find(item.name), true)
    this.currentInstall = { requestId, rollback }
    try {
      const outcome = await this.options.adapter.install(item.name, version, item.desiredEnabled, requestId, item.registry, rollback ? 'rollback' : 'update')
      this.checkAlive(); this.observe(outcome, item)
    } finally { this.currentInstall = null }
  }
  private targetMatches(item: UpdateItem, current: ManagedBundle | undefined): boolean {
    return installed(current) && npmSource(current) && !!item.targetVersion && !!item.beforeVersion && !!current.version && !!semver.valid(current.version)
      && semver.gt(current.version, item.beforeVersion)
  }
  private async rollback(item: UpdateItem, reason: string): Promise<void> {
    try {
      const current = await this.find(item.name)
      this.checkSource(item, current, true)
      // Enablement-only recovery never authorizes reinstalling a package, and
      // must not turn a formerly Git/local source into an npm installation.
      if (!item.removalStarted) {
        if (installed(current)) {
          await this.selection(item, true)
          await this.result(item, this.stopRequested ? 'cancelled' : 'failed', reason, 'not-needed', false)
        } else await this.result(item, 'skipped', 'The bundle was uninstalled before this updater began removing it; it was not reinstalled.', 'not-needed', false)
        return
      }
      if (!item.beforeVersion || !semver.valid(item.beforeVersion)) throw new UpdateError('unknown-version', 'The original exact version is unknown.')
      if (!installed(current) || current.version !== item.beforeVersion || current.error !== undefined) {
        if (installed(current)) {
          // The live SDK refuses installBundle for an existing dependency.
          // Confirm deselection (including an earlier unconfirmed HMR change)
          // before removing the replacement, rather than installing over it.
          if (!eligible({ ...current, error: undefined })) throw new UpdateError('protected', 'The replacement bundle is protected; automatic rollback cannot remove it.')
          await this.intent(item, 'rollback')
          const beforeDeselection = await this.find(item.name)
          this.checkSource(item, beforeDeselection, true)
          if (!installed(beforeDeselection) || !eligible({ ...beforeDeselection, error: undefined })) throw new UpdateError('protected', 'The replacement bundle became protected or unavailable before rollback.')
          const deselection = await this.options.adapter.setBundleEnabled(item.name, false)
          this.checkAlive(); this.observe(deselection, item)
          const deselected = await this.find(item.name)
          this.checkSource(item, deselected, true)
          if (installed(deselected)) {
            if (deselected.enabled !== false) throw new UpdateError('disable-unconfirmed', 'The replacement bundle could not be deselected for rollback.')
            if (!eligible({ ...deselected, error: undefined })) throw new UpdateError('protected', 'The replacement bundle became protected; rollback remains pending.')
            await this.intent(item, 'rollback')
            const beforeRemoval = await this.find(item.name)
            this.checkSource(item, beforeRemoval, true)
            if (!installed(beforeRemoval) || beforeRemoval.enabled || !eligible({ ...beforeRemoval, error: undefined })) throw new UpdateError('protected', 'The replacement bundle changed before rollback removal; recovery remains pending.')
            const removal = await this.options.adapter.removeBundle(item.name)
            this.checkAlive(); this.observe(removal, item)
            const remaining = await this.find(item.name)
            this.checkSource(item, remaining, true)
            if (installed(remaining)) throw new UpdateError('remove-unconfirmed', 'The replacement bundle is still installed; rollback remains pending.')
          }
        }
        await this.install(item, item.beforeVersion, true)
      }
      const restored = await this.selection(item, true)
      if (restored.version !== item.beforeVersion) throw new UpdateError('rollback-version', 'The installed version does not match the original version.')
      await this.result(item, this.stopRequested ? 'cancelled' : 'failed', reason, 'succeeded', false)
    } catch (error) {
      if (['storage-error', 'disposed'].includes(codeOf(error) ?? '')) throw error
      await this.result(item, this.stopRequested ? 'cancelled' : 'failed', `${reason}; rollback failed: ${messageOf(error)}`, 'failed', true)
    }
  }
  private async recover(item: UpdateItem): Promise<void> {
    this.current = item.name
    try {
      const current = await this.find(item.name)
      this.checkSource(item, current, true)
      if (item.removalStarted && item.state !== 'rollback' && this.targetMatches(item, current)) {
        await this.selection(item, true)
        await this.result(item, 'updated', 'Recovered and confirmed the interrupted update.', 'not-needed', false)
      } else await this.rollback(item, 'Recovered an interrupted update by restoring its original version and selection.')
    } catch (error) {
      if (['storage-error', 'disposed'].includes(codeOf(error) ?? '')) throw error
      await this.rollback(item, `Interrupted update recovery failed: ${messageOf(error)}`)
    }
  }
  private async process(item: UpdateItem): Promise<void> {
    let destructive = false
    try {
      await this.intent(item, 'checking')
      const current = await this.find(item.name)
      if (!installed(current)) { await this.result(item, 'skipped', 'The bundle was uninstalled; it was not reinstalled.', 'not-needed', false); return }
      if (!eligible(current)) { await this.result(item, 'skipped', 'The bundle is protected or unavailable.', 'not-needed', !!this.legacy?.items.some(entry => entry.name === item.name && legacyPending.has(entry.state))); return }
      if (!item.beforeVersion || !semver.valid(item.beforeVersion)) {
        await this.selection(item)
        await this.result(item, 'skipped', 'The original exact version is unknown, so an automatic rollback would be unsafe.', 'not-needed', false); return
      }
      let latest: LatestPackage
      try { latest = await this.options.adapter.latest(current) }
      catch (error) {
        if (codeOf(error) !== 'unsupported-source') throw error
        await this.selection(item)
        await this.result(item, 'skipped', messageOf(error), 'not-needed', false); return
      }
      this.checkAlive()
      if (!semver.valid(latest.version)) throw new UpdateError('invalid-version', 'The registry returned an invalid version.')
      item.targetVersion = latest.version; item.registry = latest.registry ?? null
      await this.write()
      if (this.stopRequested || !semver.gt(latest.version, item.beforeVersion)) {
        await this.selection(item)
        await this.result(item, this.stopRequested ? 'cancelled' : 'up-to-date', this.stopRequested ? 'Stopped before changing this bundle.' : 'The installed version is already current or newer.', 'not-needed', false); return
      }
      const beforeUpdate = await this.find(item.name)
      this.checkSource(item, beforeUpdate, true)
      if (!installed(beforeUpdate) || !eligible(beforeUpdate)) throw new UpdateError('protected', 'The bundle became protected or unavailable before updating.')
      if (beforeUpdate.enabled) {
        destructive = true
        await this.intent(item, 'disabling')
        const beforeDeselection = await this.find(item.name)
        this.checkSource(item, beforeDeselection, true)
        if (!installed(beforeDeselection) || !eligible(beforeDeselection)) throw new UpdateError('protected', 'The bundle became protected or unavailable before deselection.')
        const outcome = await this.options.adapter.setBundleEnabled(item.name, false)
        this.checkAlive(); this.observe(outcome, item)
        const deselected = await this.find(item.name)
        this.checkSource(item, deselected, true)
        if (deselected?.enabled !== false) throw new UpdateError('disable-unconfirmed', 'The bundle could not be deselected before removal.')
      }
      if (this.stopRequested) throw new UpdateError('cancelled', 'Stopped before removing the bundle.')
      destructive = true
      item.removalStarted = true
      await this.intent(item, 'removing')
      const beforeRemoval = await this.find(item.name)
      this.checkSource(item, beforeRemoval, true)
      if (installed(beforeRemoval) && (beforeRemoval.enabled || !eligible(beforeRemoval))) throw new UpdateError('protected', 'The bundle changed before removal; recovery remains pending.')
      const removal = await this.options.adapter.removeBundle(item.name)
      this.checkAlive(); this.observe(removal, item)
      const remaining = await this.find(item.name)
      this.checkSource(item, remaining, true)
      if (installed(remaining)) throw new UpdateError('remove-unconfirmed', 'The old installation is still present.')
      if (this.stopRequested) throw new UpdateError('cancelled', 'Stopped after removal; restoring the original bundle.')
      await this.install(item, latest.version, false)
      if (!this.targetMatches(item, await this.find(item.name))) throw new UpdateError('version-unconfirmed', 'The installed version did not advance beyond the original version.')
      const updated = await this.selection(item)
      const policy = updated.version && semver.lt(updated.version, latest.version)
        ? ` The installed version may reflect the configured release policy; the queried latest version was ${latest.version}.`
        : ''
      await this.result(item, 'updated', `Updated to ${updated.version ?? 'the selected version'} and restored the original enablement selection.${policy}`, 'not-needed', false)
    } catch (error) {
      if (['storage-error', 'disposed'].includes(codeOf(error) ?? '')) throw error
      if (destructive) await this.rollback(item, messageOf(error))
      else {
        try {
          await this.selection(item)
          await this.result(item, this.stopRequested ? 'cancelled' : 'failed', messageOf(error), 'not-needed', false)
        } catch (restoreError) {
          if (['storage-error', 'disposed'].includes(codeOf(restoreError) ?? '')) throw restoreError
          await this.result(item, 'failed', `${messageOf(error)}; restoring selection failed: ${messageOf(restoreError)}`, 'failed', true)
        }
      }
    }
  }
  private async execute(): Promise<void> {
    await this.options.store.withLock(async () => {
      const previous = await this.options.store.load()
      this.checkProfile(previous)
      this.legacy = await this.options.legacyStore.load(); this.checkProfile(this.legacy)
      if (previous && (!previous.finishedAt || previous.items.some(pending))) this.snapshot = previous
      else {
        const bundles = await this.options.adapter.listBundles()
        const legacyNames = this.legacy?.items.filter(item => legacyPending.has(item.state)).map(item => item.name) ?? []
        const names = [...new Set([...bundles.filter(eligible).map(item => item.name), ...legacyNames])]
        this.snapshot = {
          version: 1, profile: this.options.profile, startedAt: new Date().toISOString(), finishedAt: null, lastError: null,
          items: names.map(name => {
            const current = bundles.find(item => item.name === name)
            return { name, beforeVersion: current?.version ?? null, targetVersion: null, desiredEnabled: legacyNames.includes(name) || current?.enabled === true, registry: null, state: 'queued', requestId: null, restartRequired: false, removalStarted: false, result: null }
          }),
        }
        await this.write()
      }
      this.snapshot.finishedAt = null
      this.snapshot.lastError = null
      // The new journal and legacy snapshot are separate atomic files. A crash
      // between saving a confirmed result and clearing legacy responsibility
      // must be completed without starting a second update of that package.
      for (const item of this.snapshot.items.filter(item => item.state === 'done' && !item.result?.recoveryNeeded)) {
        if (this.stopRequested) break
        if (!this.legacy?.items.some(entry => entry.name === item.name && legacyPending.has(entry.state))) continue
        const current = await this.find(item.name)
        if (installed(current) && !npmSource(current)) {
          await this.result(item, 'failed', sourceChanged, 'failed', true)
          continue
        }
        if (!installed(current) || current.enabled) await this.acknowledgeLegacy(item.name, current)
        else { item.state = 'restoring'; await this.write() }
      }
      for (const item of this.snapshot.items.filter(pending)) {
        this.checkAlive()
        if (this.stopRequested) break
        await this.recover(item)
        if (this.stopRequested) break
      }
      for (const item of this.snapshot.items.filter(item => item.state === 'queued' || item.state === 'checking')) {
        this.checkAlive()
        if (this.stopRequested) break
        await this.process(item)
      }
      this.checkAlive()
      this.snapshot.finishedAt = new Date().toISOString()
      await this.write()
      if (this.legacy && !this.legacy.items.some(item => legacyPending.has(item.state))) await this.saveLegacy()
    })
  }
}
