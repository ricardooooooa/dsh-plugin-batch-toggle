import { API_PREFIX } from '../types.ts'
import type { BatchStatus, UpdateResult, UpdateStatus } from '../types.ts'

export interface ClientState {
  status: BatchStatus | null
  loading: boolean
  submitting: 'disable' | 'restore' | 'update' | 'stop' | null
  error: string | null
  notice?: string | null
  stopRequested?: boolean
}
// Update presentation is kept separate from the legacy recovery summary.
export function updateView(state: ClientState) {
  const status = state.status
  const update = status?.update
  const latest = [...new Map(update?.results.map(item => [item.name, item])).values()]
  const failed = latest.filter(item => item.outcome === 'failed').length
  const updated = latest.filter(item => item.outcome === 'updated').length
  const restartRequired = latest.some(item => item.restartRequired)
  const recoveryNeeded = status?.snapshotCreatedAt != null || latest.some(item => item.recoveryNeeded)
  const updateBusy = update?.busy === true || status?.phase === 'updating'
  const stopping = updateBusy && (update?.stopRequested === true || update?.phase === 'stopping' || state.stopRequested === true || state.submitting === 'stop')
  const legacyBusy = status?.busy === true && !updateBusy
  const busy = updateBusy || legacyBusy || state.submitting !== null
  const action: 'update' | 'stop' = updateBusy ? 'stop' : 'update'
  const disabled = state.loading || status === null || update === undefined || state.error !== null || legacyBusy
    || stopping || state.submitting !== null
  let label = updateBusy ? '停止更新' : '一键更新'
  if (state.submitting === 'update' && !updateBusy) label = '正在启动…'
  if (stopping) label = '正在停止…'
  let tone: 'normal' | 'warning' | 'error' = failed || recoveryNeeded || restartRequired ? 'warning' : 'normal'
  let message = '逐个检查并更新插件，自动恢复原启用状态'
  if (recoveryNeeded) message = '存在待恢复记录，一键更新会先接续恢复'
  if (update && latest.length) {
    message = `${update.stopRequested ? '已停止更新' : '已处理'} ${update.completed}/${update.total} · 更新 ${updated} 项 · 失败 ${failed} 项`
    if (recoveryNeeded) message += ' · 仍有项目需要恢复'
    if (restartRequired) message += ' · 部分更改需要重启 DSH'
  }
  if (update?.lastError && !updateBusy) { tone = 'error'; message += ` · ${update.lastError}` }
  if (state.notice) { tone = 'error'; message = state.notice }
  if (updateBusy && update) {
    message = `${stopping ? '等待当前项安全收尾' : updateStageLabel(update.stage)}${update.current ? `：${update.current}` : ''} · ${update.completed}/${update.total} · 失败 ${failed} 项`
  }
  if (legacyBusy) message = '兼容操作正在进行，请等待完成后更新'
  if (state.loading && status === null) message = '正在读取更新状态…'
  else if (status && update === undefined) { tone = 'error'; message = '当前服务不支持一键更新，请更新本插件并重新加载 DSH。' }
  if (state.error) { tone = 'error'; message = state.error }
  return { label, action, disabled, busy, tone, message, failed, updated, restartRequired, recoveryNeeded }
}

export function updateStageLabel(stage: UpdateStatus['stage']): string {
  return stage === null ? '正在检查更新' : {
    checking: '正在检查', disabling: '正在取消使用', removing: '正在移除旧版本',
    installing: '正在安装', restoring: '正在恢复启用状态', rollback: '正在回滚',
  }[stage]
}
export function actionView(state: ClientState) {
  const status = state.status
  const busy = state.submitting !== null || status?.busy === true
  const pending = status?.pendingRestore.length ?? 0
  const hasSnapshot = status?.snapshotCreatedAt != null
  const unavailable = status === null || state.error !== null || state.loading
  // Results are an append-only history. A successful retry supersedes a
  // package's earlier failure or restart requirement without erasing that history.
  const latest = new Map(status?.results.map(item => [item.name, item]))
  const latestResults = [...latest.values()]
  const failed = latestResults.filter(item => ['failed', 'overridden', 'cancelled'].includes(item.outcome)).length
  const restartRequired = latestResults.some(item => item.outcome === 'restart-required')
  let tone: 'normal' | 'warning' | 'error' = 'normal'
  let message = `可停用 ${status?.candidates.length ?? 0} 个 · 待恢复 ${pending} 个`
  if (status?.results.length && !pending && !failed && !busy) message = '操作已完成 · 已保留原先关闭的插件'
  if (pending && !busy) message = `待恢复 ${pending} 个插件`
  if (hasSnapshot && pending === 0 && !busy) message = '发现未完成的恢复记录，可一键启用以恢复或清理记录'
  if (restartRequired) {
    tone = 'warning'
    message += ' · 需要重启 DSH 后生效'
  }
  if (failed > 0 && !busy) {
    tone = 'warning'
    message = `部分操作未完成（${failed} 项） · 待恢复 ${pending} 个${restartRequired ? ' · 部分更改需要重启' : ''}`
  }
  if (status?.lastError) { tone = 'error'; message = status.lastError }
  if (state.notice) { tone = 'error'; message = state.notice }
  if (busy) message = `${state.submitting === 'restore' || status?.phase === 'restoring' ? '正在启用' : '正在停用'}… ${status?.completed ?? 0}/${status?.total ?? 0}`
  if (state.loading && status === null) message = '正在读取插件状态…'
  if (state.error) { tone = 'error'; message = state.error }
  return {
    disableDisabled: unavailable || busy || hasSnapshot || (status?.candidates.length ?? 0) === 0,
    restoreDisabled: unavailable || busy || !hasSnapshot,
    busy, tone, message, restartRequired, hasSnapshot,
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function stringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}
const nullableString = (value: unknown): value is string | null => value === null || typeof value === 'string'
const count = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0
function validUpdateResult(value: unknown): value is UpdateResult {
  return record(value) && typeof value.name === 'string' && typeof value.message === 'string'
    && nullableString(value.beforeVersion) && nullableString(value.targetVersion) && nullableString(value.installedVersion)
    && ['updated', 'up-to-date', 'failed', 'skipped', 'cancelled'].includes(String(value.outcome))
    && typeof value.enabled === 'boolean' && typeof value.restartRequired === 'boolean' && typeof value.recoveryNeeded === 'boolean'
    && (value.rollback === null || ['not-needed', 'succeeded', 'failed'].includes(String(value.rollback)))
}
function validUpdate(value: unknown): value is UpdateStatus {
  return record(value) && typeof value.busy === 'boolean' && ['idle', 'checking', 'updating', 'stopping'].includes(String(value.phase))
    && count(value.total) && count(value.completed) && nullableString(value.current)
    && (value.stage === null || ['checking', 'disabling', 'removing', 'installing', 'restoring', 'rollback'].includes(String(value.stage)))
    && nullableString(value.lastError) && nullableString(value.startedAt) && nullableString(value.finishedAt)
    && typeof value.stopRequested === 'boolean' && Array.isArray(value.results) && value.results.every(validUpdateResult)
}
function validStatus(value: unknown): value is BatchStatus {
  if (!record(value)) return false
  return typeof value.busy === 'boolean' && ['idle', 'disabling', 'restoring', 'updating'].includes(String(value.phase))
    && Number.isInteger(value.total) && Number(value.total) >= 0
    && Number.isInteger(value.completed) && Number(value.completed) >= 0
    && stringList(value.candidates) && stringList(value.protected) && stringList(value.pendingRestore)
    && (value.snapshotCreatedAt === null || typeof value.snapshotCreatedAt === 'string')
    && (value.lastError === null || typeof value.lastError === 'string')
    && Array.isArray(value.results) && value.results.every(item => record(item) && typeof item.name === 'string'
      && ['disable', 'restore'].includes(String(item.action))
      && ['applied', 'restart-required', 'overridden', 'failed', 'cancelled', 'skipped'].includes(String(item.outcome))
      && (item.detail === undefined || typeof item.detail === 'string'))
    && (value.update === undefined || validUpdate(value.update))
}
function failureMessage(body: unknown, status: number, path: string): string {
  if (status === 401 || status === 403) return '无法访问插件管理服务，请检查登录状态并刷新页面。'
  if ((status === 404 || status === 405) && (path === 'update' || path === 'stop')) return '一键更新接口不可用，请更新本插件的宿主组件并重新加载 DSH。'
  if (record(body) && typeof body.message === 'string' && body.message) return body.message
  if (status === 409) return '另一个批操作正在执行，请等待完成后重试。'
  return `请求失败（HTTP ${status}），请刷新状态后重试。`
}

class ApiFailure extends Error {
  status: number
  constructor(message: string, status = 0) { super(message); this.status = status }
}

/** A single observable and polling loop shared by every rendered entry point. */
export function createBatchStore(options: { baseUrl?: string; pollIntervalMs?: number; requestTimeoutMs?: number } = {}) {
  // The page's base element carries --public-url prefixes and the Desktop
  // dsh-app://app/ origin. A leading slash would discard that deployment path.
  const baseUrl = options.baseUrl ?? new URL(API_PREFIX.slice(1), document.baseURI).href
  let state: ClientState = { status: null, loading: true, submitting: null, error: null, notice: null }
  let disposed = false
  let request: Promise<void> | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let conflictNotice = false
  const listeners = new Set<() => void>()
  const controllers = new Set<AbortController>()
  const publish = (patch: Partial<ClientState>) => {
    if (disposed) return
    state = { ...state, ...patch }
    for (const listener of listeners) listener()
  }
  const requestJson = async (path: string, method: 'GET' | 'POST'): Promise<unknown> => {
    const controller = new AbortController()
    controllers.add(controller)
    let timedOut = false
    const deadline = setTimeout(() => { timedOut = true; controller.abort() }, options.requestTimeoutMs ?? 10000)
    try {
      const response = await fetch(`${baseUrl}/${path}`, { method, credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      if (!response.ok) {
        let body: unknown
        if (response.status !== 401 && response.status !== 403) {
          try { body = await response.json() } catch { /* HTML and empty errors still carry their HTTP meaning. */ }
        }
        throw new ApiFailure(failureMessage(body, response.status, path), response.status)
      }
      let body: unknown
      try { body = await response.json() } catch { throw new ApiFailure('服务响应格式无效，请刷新状态后重试。') }
      if (method === 'POST' && (response.status !== 202 || !record(body) || body.accepted !== true)) {
        throw new ApiFailure('服务未确认此操作，请刷新状态并检查结果后重试。')
      }
      return body
    } catch (error) {
      if (timedOut) throw new ApiFailure('请求超时，请刷新状态确认结果；后台操作可能仍在继续。')
      if (error instanceof ApiFailure) throw error
      throw new ApiFailure('无法连接插件服务，请检查连接并刷新状态。')
    } finally {
      clearTimeout(deadline)
      controllers.delete(controller)
    }
  }
  const schedule = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    if (!disposed && listeners.size > 0) {
      timer = setTimeout(() => { timer = null; void refresh() }, options.pollIntervalMs ?? (state.status?.busy || state.status?.update?.busy || state.submitting ? 600 : 2500))
    }
  }
  const refresh = (): Promise<void> => {
    if (disposed) return Promise.resolve()
    if (request !== null) return request
    request = (async () => {
      try {
        const body = await requestJson('status', 'GET')
        if (!validStatus(body)) throw new Error('状态响应无效，已暂停操作。请刷新状态后重试。')
        const idle = !body.busy && !body.update?.busy
        publish({ status: body, loading: false, error: null,
          ...(idle && conflictNotice ? { notice: null } : {}),
          stopRequested: !idle && (state.stopRequested || body.update?.stopRequested) })
        if (idle) conflictNotice = false
      } catch (error) {
        if (!disposed) publish({ loading: false, error: `无法读取插件状态：${error instanceof Error ? error.message : String(error)}` })
      } finally {
        request = null
        schedule()
      }
    })()
    return request
  }
  const command = async (action: 'disable' | 'restore' | 'update' | 'stop'): Promise<void> => {
    if (disposed) return
    conflictNotice = false
    publish({ submitting: action, error: null, notice: null, ...(action === 'update' ? { stopRequested: false } : {}) })
    try {
      await requestJson(action, 'POST')
      if (action === 'stop') publish({ stopRequested: true })
      // A read started before the POST may be stale. Join it, then read afresh.
      if (request !== null) await request
      await refresh()
    } catch (error) {
      if (!disposed) {
        const message = error instanceof Error ? error.message : String(error)
        conflictNotice = error instanceof ApiFailure && error.status === 409
        publish({ error: message, notice: message })
      }
    } finally {
      publish({ submitting: null })
      schedule()
    }
  }
  const run = async (action: 'disable' | 'restore'): Promise<void> => {
    // The compatibility API must never treat a new action as an implicit restore.
    if (action !== 'disable' && action !== 'restore') return
    const view = actionView(state)
    if (disposed || (action === 'disable' ? view.disableDisabled : view.restoreDisabled)) return
    await command(action)
  }
  const update = async (): Promise<void> => {
    const view = updateView(state)
    if (view.disabled || view.action !== 'update') return
    await command('update')
  }
  const stop = async (): Promise<void> => {
    const view = updateView(state)
    if (view.disabled || view.action !== 'stop') return
    await command('stop')
  }
  return {
    getSnapshot: (): ClientState => state,
    subscribe: (listener: () => void): (() => void) => {
      if (disposed) return () => {}
      listeners.add(listener)
      if (listeners.size === 1) void refresh()
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0 && timer !== null) { clearTimeout(timer); timer = null }
      }
    },
    refresh: () => { conflictNotice = false; publish({ notice: null }); return refresh() },
    run,
    update,
    stop,
    dispose: () => {
      disposed = true
      if (timer !== null) clearTimeout(timer)
      for (const controller of controllers) controller.abort()
      controllers.clear()
      listeners.clear()
    },
  }
}

export type BatchStore = ReturnType<typeof createBatchStore>
