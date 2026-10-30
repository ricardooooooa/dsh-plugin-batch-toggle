import type { BatchStatus } from './types.ts'
export interface BatchOperations {
  status(): Promise<BatchStatus>
  disable(): Promise<void>
  restore(): Promise<void>
  dispose(): void
}
export function createHandlers(engine: BatchOperations) {
  let active = false
  let disposed = false
  let jobError: string | null = null
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
  const error = (code: string, message: string, status: number) => json({ error: code, message }, status)
  const start = async (action: 'disable' | 'restore', request: Request) => {
    if (request.method !== 'POST') return error('method-not-allowed', '此操作需要 POST 请求。', 405)
    if (disposed) return error('unavailable', '插件已停止，请重新启用。', 503)
    if (active) return error('busy', '批量操作正在进行，请稍候。', 409)
    let state: BatchStatus
    try { state = await engine.status() } catch { return error('state-unavailable', '无法读取恢复记录；未执行任何插件操作。', 503) }
    // status() is asynchronous, so check the gate again after it resolves.
    if (active || state.busy) return error('busy', '批量操作正在进行，请稍候。', 409)
    if (disposed) return error('unavailable', '插件已停止，请重新启用。', 503)
    if (action === 'disable' && (state.pendingRestore.length || state.snapshotCreatedAt !== null)) return error('recovery-pending', '请先恢复上一轮插件，避免覆盖恢复记录。', 409)
    if (action === 'restore' && !state.pendingRestore.length && state.snapshotCreatedAt === null) return error('nothing-to-restore', '没有需要恢复的插件。', 409)
    if (action === 'disable' && !state.candidates.length) return error('nothing-to-disable', '没有可以停用的插件。', 409)
    active = true
    jobError = null
    void Promise.resolve().then(() => engine[action]()).catch(() => {
      jobError = '操作未全部完成。已保留恢复记录，请检查结果后重试。'
    }).finally(() => { active = false })
    return json({ accepted: true }, 202)
  }
  return {
    status: async () => {
      try {
        const state = await engine.status()
        return json({ ...state, busy: active || state.busy, lastError: jobError ?? state.lastError })
      } catch { return error('state-unavailable', '无法读取恢复记录；请检查当前 profile 的插件状态文件。', 503) }
    },
    disable: (request: Request) => start('disable', request),
    restore: (request: Request) => start('restore', request),
    dispose() { disposed = true; engine.dispose() },
  }
}
