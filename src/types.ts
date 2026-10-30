export const PACKAGE_NAME = 'dsh-plugin-batch-toggle'
export const HOST_ROW_ID = 'dsh-plugin-batch-toggle-host'
export const CLIENT_ROW_ID = 'dsh-plugin-batch-toggle-client'
export const API_PREFIX = '/api/dsh-plugin-batch-toggle'

export interface ManagedBundle {
  name: string
  enabled: boolean
  installed: boolean
  official: boolean
  availability: 'installation' | 'profile' | 'missing'
  readOnlyReason?: string
  error?: unknown
  rows: { rowId: string; moduleName: string }[]
  overrides: string[]
}
export interface ChangeOutcome {
  changed: boolean
  application: 'applied' | 'restart-required' | 'overridden' | 'failed' | 'cancelled'
  error?: { code: string; diagnostic?: string }
  restartReason?: string
}
export interface BundleManager {
  listBundles(): Promise<ManagedBundle[]>
  setBundleEnabled(name: string, enabled: boolean): Promise<ChangeOutcome>
}
export interface ItemResult {
  name: string
  action: 'disable' | 'restore'
  outcome: ChangeOutcome['application'] | 'skipped'
  detail?: string
}
export interface BatchStatus {
  busy: boolean
  phase: 'idle' | 'disabling' | 'restoring'
  total: number
  completed: number
  candidates: string[]
  protected: string[]
  pendingRestore: string[]
  snapshotCreatedAt: string | null
  results: ItemResult[]
  lastError: string | null
}
