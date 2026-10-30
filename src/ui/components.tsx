import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button, MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ItemResult } from '../types.ts'
import { observePlacements } from './placement.ts'
import { actionView } from './store.ts'
import type { BatchStore } from './store.ts'

const resultLabels: Record<ItemResult['outcome'], string> = {
  applied: '已生效', 'restart-required': '需要重启', overridden: '被其他设置覆盖',
  failed: '失败', cancelled: '已取消', skipped: '已跳过',
}

function useBatch(store: BatchStore) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}

export function BatchControls({ store, detail = false }: { store: BatchStore; detail?: boolean }): ReactNode {
  const state = useBatch(store)
  const view = actionView(state)
  return <div className="dbt-controls" data-batch-toggle-controls
    data-batch-toggle-state={view.busy ? 'busy' : state.error ? 'error' : view.hasSnapshot ? 'pending' : 'ready'}
    aria-busy={view.busy}>
    <div className="dbt-buttons">
      <Button type="button" variant="outline" size="sm" data-batch-toggle-action="disable"
        disabled={view.disableDisabled} onClick={() => { void store.run('disable') }}>
        {view.busy && (state.submitting === 'disable' || state.status?.phase === 'disabling') ? '正在停用…' : '一键停用'}
      </Button>
      <Button type="button" variant="outline" size="sm" data-batch-toggle-action="restore"
        disabled={view.restoreDisabled} onClick={() => { void store.run('restore') }}>
        {view.busy && (state.submitting === 'restore' || state.status?.phase === 'restoring') ? '正在启用…' : '一键启用'}
      </Button>
    </div>
    <span className="dbt-status" data-batch-toggle-status data-tone={view.tone}
      role={view.tone === 'error' ? 'alert' : 'status'} title={view.message}>{view.message}</span>
    {detail || state.error || state.notice ? <Button type="button" variant="ghost" size="sm"
      data-batch-toggle-action="refresh" disabled={view.busy} onClick={() => { void store.refresh() }}>刷新状态</Button> : null}
  </div>
}

/** The stable native tab remains available if a host changes its DOM structure. */
export function BatchPanel({ store }: { store: BatchStore }): ReactNode {
  const state = useBatch(store)
  const status = state.status
  const view = actionView(state)
  return <section className="dbt-panel" data-batch-toggle-panel data-window-no-drag>
    <h2>插件批量开关</h2>
    <p className="dbt-description">一键停用当前可管理的第三方插件。一键启用只恢复这次批量停用前开启的插件，保留原先关闭的插件。</p>
    <BatchControls store={store} detail />
    <p className="dbt-hint">核心组件、插件管理入口、插件市场和本插件会保持可用。恢复完成前，不能开始新的批量停用。</p>
    {status ? <>
      <dl className="dbt-counts">
        <div><dt>可停用</dt><dd>{status.candidates.length}</dd></div>
        <div><dt>待恢复</dt><dd>{status.pendingRestore.length}</dd></div>
        <div><dt>本次进度</dt><dd>{status.completed} / {status.total}</dd></div>
      </dl>
      {status.snapshotCreatedAt ? <p className="dbt-hint">恢复记录建立于 {new Date(status.snapshotCreatedAt).toLocaleString()}</p> : null}
      {view.restartRequired
        ? <p className="dbt-warning" role="note">部分更改已保存，需要重新启动 DSH 后生效。此处不会自动重启应用。</p> : null}
      {status.pendingRestore.length ? <details className="dbt-details">
        <summary>待恢复的插件（{status.pendingRestore.length}）</summary>
        <ul>{status.pendingRestore.map(name => <li key={name}><code>{name}</code></li>)}</ul>
      </details> : null}
      {status.results.length ? <div className="dbt-results">
        <h3>操作结果</h3>
        <ul>{status.results.map((item, index) => <li key={`${item.action}:${item.name}:${index}`} data-batch-toggle-result={item.outcome}>
          <div><code>{item.name}</code><span className="dbt-result-label">{resultLabels[item.outcome]}</span></div>
          {item.detail ? <p>{item.detail}</p> : null}
        </li>)}</ul>
      </div> : null}
      {status.protected.length ? <details className="dbt-details">
        <summary>保持可用的插件（{status.protected.length}）</summary>
        <ul>{status.protected.map(name => <li key={name}><code>{name}</code></li>)}</ul>
      </details> : null}
    </> : null}
  </section>
}

export function BatchMenuActions({ store, onDismiss }: { store: BatchStore; onDismiss: () => void }): ReactNode {
  const state = useBatch(store)
  const view = actionView(state)
  return <>
    <MenuItemButton separatorBefore disabled={view.disableDisabled} onSelect={() => { onDismiss(); void store.run('disable') }}>
      <span className="dbt-menu-label"><span>一键停用</span><small>暂停当前开启的第三方插件，保留恢复记录</small></span>
    </MenuItemButton>
    <MenuItemButton disabled={view.restoreDisabled} onSelect={() => { onDismiss(); void store.run('restore') }}>
      <span className="dbt-menu-label"><span>一键启用</span><small>恢复批量停用前的插件列表</small></span>
    </MenuItemButton>
  </>
}

/** All toolbar portals use the same React instance and observable as the native tab. */
export function PlacementPortals({ store }: { store: BatchStore }): ReactNode {
  const [targets, setTargets] = useState<HTMLElement[]>([])
  useEffect(() => observePlacements(document, setTargets), [])
  return <>{targets.map((target, index) => createPortal(<BatchControls store={store} />, target, String(index)))}</>
}
