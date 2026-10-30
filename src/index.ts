import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-plugin-manager'
import { join, resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { BatchEngine } from './engine.ts'
import { FileSnapshotStore } from './store.ts'
import { createHandlers } from './http.ts'
import { API_PREFIX, PACKAGE_NAME } from './types.ts'

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
  const handlers = createHandlers(engine)
  connection.fetch.register({ path: `${API_PREFIX}/status`, methods: ['GET'], requestBody: 'buffered', fetch: () => handlers.status() })
  connection.fetch.register({ path: `${API_PREFIX}/disable`, methods: ['POST'], requestBody: 'buffered', fetch: request => handlers.disable(request) })
  connection.fetch.register({ path: `${API_PREFIX}/restore`, methods: ['POST'], requestBody: 'buffered', fetch: request => handlers.restore(request) })
  ctx.effect(() => () => { handlers.dispose() })
}
