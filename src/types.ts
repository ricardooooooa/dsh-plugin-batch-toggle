export const PACKAGE_NAME = 'dsh-plugin-batch-toggle'
export const HOST_ROW_ID = 'dsh-plugin-batch-toggle-host'
export const CLIENT_ROW_ID = 'dsh-plugin-batch-toggle-client'
export const API_PREFIX = '/api/dsh-plugin-batch-toggle'

export interface ManagedBundle {
  name: string
  enabled: boolean
  version?: string
  source?: string
  removable?: boolean
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
  phase: 'idle' | 'disabling' | 'restoring' | 'updating'
  total: number
  completed: number
  candidates: string[]
  protected: string[]
  pendingRestore: string[]
  snapshotCreatedAt: string | null
  results: ItemResult[]
  lastError: string | null
  update?: UpdateStatus
}

export interface LatestPackage {
  version: string
  registry?: string | null
}
export interface UpdateResult {
  name: string
  beforeVersion: string | null
  targetVersion: string | null
  installedVersion: string | null
  outcome: 'updated' | 'up-to-date' | 'failed' | 'skipped' | 'cancelled'
  message: string
  enabled: boolean
  rollback: 'not-needed' | 'succeeded' | 'failed' | null
  restartRequired: boolean
  recoveryNeeded: boolean
}
export interface UpdateStatus {
  busy: boolean
  phase: 'idle' | 'checking' | 'updating' | 'stopping'
  total: number
  completed: number
  current: string | null
  stage: 'checking' | 'disabling' | 'removing' | 'installing' | 'restoring' | 'rollback' | null
  results: UpdateResult[]
  lastError: string | null
  startedAt: string | null
  finishedAt: string | null
  stopRequested: boolean
}
