import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button, MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ItemResult, UpdateResult } from '../types.ts'
import { observePlacements } from './placement.ts'
import { updateView } from './store.ts'
import type { BatchStore } from './store.ts'

const legacyLabels: Record<ItemResult['outcome'], string> = {
  applied: '已生效', 'restart-required': '需要重启', overridden: '被其他设置覆盖',
  failed: '失败', cancelled: '已取消', skipped: '已跳过',
}
const updateLabels: Record<UpdateResult['outcome'], string> = {
  updated: '更新完成', 'up-to-date': '已是最新', failed: '更新失败', skipped: '已跳过', cancelled: '已取消',
}

function useBatch(store: BatchStore) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}

/** One primary action owns the complete check, update and restore workflow. */
export function BatchControls({ store, detail = false }: { store: BatchStore; detail?: boolean }): ReactNode {
  const state = useBatch(store)
  const view = updateView(state)
  return <div className="dbt-controls" data-batch-toggle-controls
    data-batch-toggle-state={view.busy ? 'busy' : state.error ? 'error' : view.recoveryNeeded ? 'pending' : 'ready'}
    aria-busy={view.busy}>
    <div className="dbt-buttons">
      <Button type="button" variant="primary" size="sm" data-batch-toggle-action={view.action}
        disabled={view.disabled} onClick={() => { void (view.action === 'stop' ? store.stop() : store.update()) }}>
        {view.label}
      </Button>
    </div>
    <span className="dbt-status" data-batch-toggle-status data-tone={view.tone}
      role={view.tone === 'error' ? 'alert' : 'status'} title={view.message}>{view.message}</span>
    {detail || state.error || state.notice ? <Button type="button" variant="ghost" size="sm"
      data-batch-toggle-action="refresh" onClick={() => { void store.refresh() }}>刷新状态</Button> : null}
  </div>
}

function UpdateResultRow({ item }: { item: UpdateResult }): ReactNode {
  return <li data-batch-toggle-update-result={item.outcome} data-batch-toggle-recovery={item.recoveryNeeded ? 'needed' : undefined}>
    <div><code>{item.name}</code><span className="dbt-result-label">{updateLabels[item.outcome]}</span></div>
    <p className="dbt-version">更新前：{item.beforeVersion ?? '未安装'} · 查询最新：{item.targetVersion ?? '未确定'} · 当前版本：{item.installedVersion ?? '未安装'}</p>
    <p>当前状态：{item.enabled ? '已启用' : '已停用'}</p>
    {item.message ? <p>{item.message}</p> : null}
    {item.rollback === 'succeeded' ? <p className="dbt-warning">更新未完成，已成功回滚旧版本。</p> : null}
    {item.rollback === 'failed' ? <p className="dbt-error">回滚失败，仍需恢复；再次一键更新会优先接续处理。</p> : null}
    {item.recoveryNeeded ? <p className="dbt-error">此项尚未恢复完成，恢复记录已保留。</p> : null}
    {item.restartRequired ? <p className="dbt-warning">此项更改需要重启 DSH 后生效。</p> : null}
  </li>
}

/** The stable native tab remains available if a host changes its DOM structure. */
export function BatchPanel({ store }: { store: BatchStore }): ReactNode {
  const state = useBatch(store)
  const status = state.status
  const update = status?.update
  const view = updateView(state)
  const visibleResults = update?.results.filter(item => item.outcome !== 'skipped') ?? []
  const excluded = update?.results.filter(item => item.outcome === 'skipped') ?? []
  return <section className="dbt-panel" data-batch-toggle-panel data-window-no-drag>
    <h2>插件批量更新</h2>
    <p className="dbt-description">一个按钮完成检查、取消使用、逐项更新和恢复原启用状态。原先关闭的插件会保持关闭；单项失败后继续处理其余插件。</p>
    <BatchControls store={store} detail />
    <p className="dbt-hint">核心组件、插件市场和本插件不会自动更新。停止更新会等待当前项安全收尾或回滚，再结束批次。</p>
    {update ? <>
      <dl className="dbt-counts">
        <div><dt>已处理</dt><dd>{update.completed} / {update.total}</dd></div>
        <div><dt>已更新</dt><dd>{view.updated}</dd></div>
        <div><dt>失败</dt><dd>{view.failed}</dd></div>
      </dl>
      {update.busy && update.total > 0 ? <progress className="dbt-progress" aria-label="批量更新进度" max={update.total} value={update.completed} /> : null}
      {update.startedAt ? <p className="dbt-hint">本次开始于 {new Date(update.startedAt).toLocaleString()}{update.finishedAt ? ` · 结束于 ${new Date(update.finishedAt).toLocaleString()}` : ''}</p> : null}
      {view.restartRequired ? <p className="dbt-warning" role="note">部分更改需要重启 DSH 后生效。此处不会自动重启应用。</p> : null}
      {visibleResults.length ? <div className="dbt-results">
        <h3>更新结果</h3>
        <ul>{visibleResults.map((item, index) => <UpdateResultRow key={`${item.name}:${index}`} item={item} />)}</ul>
      </div> : null}
    </> : null}
    {status?.snapshotCreatedAt ? <div className="dbt-recovery" role="note">
      <strong>检测到旧版待恢复记录</strong>
      <p>一键更新会先接续处理这些插件的原启用意图，无需再手动停用或启用。</p>
      {status.pendingRestore.length ? <details className="dbt-details">
        <summary>待接续恢复的插件（{status.pendingRestore.length}）</summary>
        <ul>{status.pendingRestore.map(name => <li key={name}><code>{name}</code></li>)}</ul>
      </details> : <p>尚未完成的记录将在接续处理后清理。</p>}
    </div> : null}
    {excluded.length || status?.protected.length ? <details className="dbt-details">
      <summary>已跳过或受保护的插件</summary>
      <ul>{excluded.map((item, index) => <li key={`excluded:${item.name}:${index}`}><code>{item.name}</code>：{item.message}</li>)}
        {status?.protected.filter(name => !excluded.some(item => item.name === name)).map(name => <li key={name}><code>{name}</code>：受保护或不可自动更新</li>)}
      </ul>
    </details> : null}
    {status?.results.length ? <details className="dbt-details dbt-results">
      <summary>旧版停用 / 恢复历史</summary>
      <ul>{status.results.map((item, index) => <li key={`${item.action}:${item.name}:${index}`} data-batch-toggle-result={item.outcome}>
        <div><code>{item.name}</code><span className="dbt-result-label">{item.action === 'restore' ? '恢复' : '停用'}：{legacyLabels[item.outcome]}</span></div>
        {item.detail ? <p>{item.detail}</p> : null}
      </li>)}</ul>
    </details> : null}
  </section>
}

export function BatchMenuActions({ store, onDismiss }: { store: BatchStore; onDismiss: () => void }): ReactNode {
  const state = useBatch(store)
  const view = updateView(state)
  return <MenuItemButton separatorBefore disabled={view.disabled || view.busy} onSelect={() => { onDismiss(); void store.update() }}>
    <span className="dbt-menu-label"><span>一键更新</span><small>自动检查、逐项更新并恢复原启用状态</small></span>
  </MenuItemButton>
}

/** All toolbar portals use the same React instance and observable as the native tab. */
export function PlacementPortals({ store }: { store: BatchStore }): ReactNode {
  const [targets, setTargets] = useState<HTMLElement[]>([])
  useEffect(() => observePlacements(document, setTargets), [])
  return <>{targets.map((target, index) => createPortal(<BatchControls store={store} />, target, String(index)))}</>
}
