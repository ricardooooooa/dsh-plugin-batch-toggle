import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { BatchMenuActions, BatchPanel, PlacementPortals } from './ui/components.tsx'
import { createBatchStore } from './ui/store.ts'
import { installStyles } from './ui/styles.ts'

export const name = 'dsh-plugin-batch-toggle-client'
export const inject = ['slots']

/** Adds native entry points and owned toolbar portals; consumes the authenticated Host API. */
export function apply(ctx: Context): void {
  const store = createBatchStore()
  ctx.effect(() => () => { store.dispose() }, 'batch-toggle: shared state')
  ctx.effect(() => installStyles(document), 'batch-toggle: styles')
  ctx.slots.inject('plugins.tab', () => ctx.slots.register({
    name: 'plugins.tab', id: 'batch-toggle', order: 90, label: () => '批量更新',
  }, () => <BatchPanel store={store} />))
  ctx.slots.inject('plugins.add.actions', () => ctx.slots.register({
    name: 'plugins.add.actions', id: 'batch-toggle.actions', order: 90,
  }, ({ onDismiss }) => <BatchMenuActions store={store} onDismiss={onDismiss} />))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'batch-toggle.toolbars',
  }, () => <PlacementPortals store={store} />))
}
