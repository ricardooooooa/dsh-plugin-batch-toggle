import { API_PREFIX } from '../types.ts'
import type { BatchStatus } from '../types.ts'

export interface ClientState {
  status: BatchStatus | null
  loading: boolean
  submitting: 'disable' | 'restore' | null
  error: string | null
  notice?: string | null
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
function validStatus(value: unknown): value is BatchStatus {
  if (!record(value)) return false
  return typeof value.busy === 'boolean' && ['idle', 'disabling', 'restoring'].includes(String(value.phase))
    && Number.isInteger(value.total) && Number(value.total) >= 0
    && Number.isInteger(value.completed) && Number(value.completed) >= 0
    && stringList(value.candidates) && stringList(value.protected) && stringList(value.pendingRestore)
    && (value.snapshotCreatedAt === null || typeof value.snapshotCreatedAt === 'string')
    && (value.lastError === null || typeof value.lastError === 'string')
    && Array.isArray(value.results) && value.results.every(item => record(item) && typeof item.name === 'string'
      && ['disable', 'restore'].includes(String(item.action))
      && ['applied', 'restart-required', 'overridden', 'failed', 'cancelled', 'skipped'].includes(String(item.outcome))
      && (item.detail === undefined || typeof item.detail === 'string'))
}
function failureMessage(body: unknown, status: number): string {
  if (record(body) && typeof body.message === 'string' && body.message) return body.message
  if (status === 409) return '另一个批操作正在执行，请等待完成后重试。'
  if (status === 401 || status === 403) return '无法访问插件管理服务，请检查登录状态并刷新页面。'
  return `请求失败（HTTP ${status}），请刷新状态后重试。`
}

/** A single observable and polling loop shared by every rendered entry point. */
export function createBatchStore(options: { baseUrl?: string; pollIntervalMs?: number } = {}) {
  // The page's base element carries --public-url prefixes and the Desktop
  // dsh-app://app/ origin. A leading slash would discard that deployment path.
  const baseUrl = options.baseUrl ?? new URL(API_PREFIX.slice(1), document.baseURI).href
  let state: ClientState = { status: null, loading: true, submitting: null, error: null, notice: null }
  let disposed = false
  let request: Promise<void> | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  const listeners = new Set<() => void>()
  const controllers = new Set<AbortController>()
  const publish = (patch: Partial<ClientState>) => {
    if (disposed) return
    state = { ...state, ...patch }
    for (const listener of listeners) listener()
  }
  const schedule = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    if (!disposed && listeners.size > 0) {
      timer = setTimeout(() => { timer = null; void refresh() }, options.pollIntervalMs ?? (state.status?.busy || state.submitting ? 600 : 2500))
    }
  }
  const refresh = (): Promise<void> => {
    if (disposed) return Promise.resolve()
    if (request !== null) return request
    const controller = new AbortController()
    controllers.add(controller)
    request = (async () => {
      try {
        const response = await fetch(`${baseUrl}/status`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
        const body: unknown = await response.json()
        if (!response.ok) throw new Error(failureMessage(body, response.status))
        if (!validStatus(body)) throw new Error('状态响应无效，已暂停操作。请刷新状态后重试。')
        publish({ status: body, loading: false, error: null })
      } catch (error) {
        if (!controller.signal.aborted) publish({ loading: false, error: `无法读取插件状态：${error instanceof Error ? error.message : String(error)}` })
      } finally {
        controllers.delete(controller)
        request = null
        schedule()
      }
    })()
    return request
  }
  const run = async (action: 'disable' | 'restore'): Promise<void> => {
    const view = actionView(state)
    if (disposed || (action === 'disable' ? view.disableDisabled : view.restoreDisabled)) return
    publish({ submitting: action, error: null, notice: null })
    const controller = new AbortController()
    controllers.add(controller)
    try {
      const response = await fetch(`${baseUrl}/${action}`, { method: 'POST', credentials: 'same-origin', signal: controller.signal })
      const body: unknown = await response.json()
      if (response.status !== 202 || !record(body) || body.accepted !== true) throw new Error(failureMessage(body, response.status))
      // A read started before the POST may be stale. Join it, then read afresh.
      if (request !== null) await request
      await refresh()
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : String(error)
        publish({ error: message, notice: message })
      }
    } finally {
      controllers.delete(controller)
      publish({ submitting: null })
      schedule()
    }
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
    refresh: () => { publish({ notice: null }); return refresh() },
    run,
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
