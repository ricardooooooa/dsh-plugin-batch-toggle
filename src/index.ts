import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-plugin-manager'
import { viewProfilePackage } from '@deepseek-ai/dsh-plugin-manager/operations'
import { join, resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { BatchEngine } from './engine.ts'
import { FileSnapshotStore } from './store.ts'
import { createHandlers } from './http.ts'
import { API_PREFIX, PACKAGE_NAME } from './types.ts'
import { UpdateEngine } from './update-engine.ts'
import { FileUpdateStore } from './update-store.ts'
import { createNpmUpdateAdapter } from './npm-update-adapter.ts'

export const name = PACKAGE_NAME
export const inject = ['connection', 'pluginManager', 'profileContext']

export function apply(ctx: Context) {
  const profile = ctx.get('profileContext')
  const manager = ctx.get('pluginManager')
  const connection = ctx.get('connection')
  if (!profile || !manager || !connection) throw new Error('DSH profile and plugin management services are required')
  const identity = resolve(profile.dir)
  const store = new FileSnapshotStore(join(profile.dir, '.dsh-plugin-batch-toggle'), identity)
  const engine = new BatchEngine({ manager, store, profile: identity, getOrder: async () => {
    const manifest = JSON.parse(await readFile(join(profile.dir, 'package.json'), 'utf8'))
    const selected: unknown = manifest.dsh?.profile?.bundles
    if (!Array.isArray(selected) || !selected.every(value => typeof value === 'string')) throw new Error('Invalid profile bundle selection')
    return selected
  } })
  const updater = new UpdateEngine({
    adapter: createNpmUpdateAdapter(manager, profile, viewProfilePackage),
    store: new FileUpdateStore(join(profile.dir, '.dsh-plugin-batch-toggle'), identity, store),
    legacyStore: store, profile: identity,
  })
  const handlers = createHandlers(engine, updater)
  connection.fetch.register({ path: `${API_PREFIX}/status`, methods: ['GET'], requestBody: 'buffered', fetch: () => handlers.status() })
  connection.fetch.register({ path: `${API_PREFIX}/disable`, methods: ['POST'], requestBody: 'buffered', fetch: request => handlers.disable(request) })
  connection.fetch.register({ path: `${API_PREFIX}/restore`, methods: ['POST'], requestBody: 'buffered', fetch: request => handlers.restore(request) })
  connection.fetch.register({ path: `${API_PREFIX}/update`, methods: ['POST'], requestBody: 'buffered', fetch: request => handlers.update(request) })
  connection.fetch.register({ path: `${API_PREFIX}/stop`, methods: ['POST'], requestBody: 'buffered', fetch: request => handlers.stop(request) })
  ctx.effect(() => () => { handlers.dispose() })
}
