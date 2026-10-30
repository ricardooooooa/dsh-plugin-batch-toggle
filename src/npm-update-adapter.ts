import type { ManagedBundle } from './types.ts'
import type { UpdateAdapter } from './update-engine.ts'
import type { PluginInstallRequestId } from '@deepseek-ai/dsh-plugin-manager/types'
import { valid } from 'semver'
interface ViewResult { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }
interface ViewOptions { command?: string; args?: readonly string[]; env?: Readonly<Record<string,string>>; timeoutMs: number; registry?: string | null }
interface Profile { dir: string; packageManager?: { command: string; args: readonly string[]; env: Readonly<Record<string,string>> } }
interface Manager {
  listBundles: UpdateAdapter['listBundles']
  setBundleEnabled: UpdateAdapter['setBundleEnabled']
  removeBundle: UpdateAdapter['removeBundle']
  installBundle(spec: string, options: { enabled?: boolean; saveExact?: boolean; requestId?: PluginInstallRequestId; registry?: string | null }): ReturnType<UpdateAdapter['install']>
  cancelInstall(requestId: PluginInstallRequestId): Promise<unknown>
  registries(): Promise<{ registry: string | null; fallbackRegistries: readonly string[] }>
}
function problem(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}
export function npmSource(bundle: ManagedBundle): boolean {
  if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(bundle.name) || !bundle.source) return false
  if (bundle.source === bundle.name) return true
  if (!bundle.source.startsWith(`${bundle.name}@`)) return false
  const range = bundle.source.slice(bundle.name.length + 1)
  return range.length > 0 && /^[a-z0-9.*^~<>=|+\s_-]+$/i.test(range)
}
export function createNpmUpdateAdapter(manager: Manager, profile: Profile, view: (dir: string, spec: string, options: ViewOptions) => Promise<ViewResult>): UpdateAdapter {
  return {
    listBundles: () => manager.listBundles(),
    setBundleEnabled: (name, enabled) => manager.setBundleEnabled(name, enabled),
    removeBundle: name => manager.removeBundle(name),
    install: (name, version, enabled, requestId, registry, mode = 'update') => {
      if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name) || !valid(version)) throw problem('invalid-package', '插件名称或目标版本无效，未执行安装。')
      return manager.installBundle(`${name}@${mode === 'update' ? 'latest' : version}`, { enabled, saveExact: true, requestId: requestId as PluginInstallRequestId, ...(registry === undefined ? {} : { registry }) })
    },
    cancelInstall: requestId => manager.cancelInstall(requestId as PluginInstallRequestId),
    latest: async bundle => {
      if (!npmSource(bundle)) throw problem('unsupported-source', 'Git、本地文件、安装包URL或别名来源暂不自动更新，请从原来源更新。')
      const registries = await manager.registries()
      const choices = [...new Set([registries.registry, ...registries.fallbackRegistries])]
      let timedOut = false
      for (const registry of choices) {
        const result = await view(profile.dir, `${bundle.name}@latest`, { ...profile.packageManager, timeoutMs: 15000, registry })
        timedOut ||= result.timedOut
        if (result.exitCode !== 0 || result.timedOut) continue
        let data: Record<string, unknown>
        try { data = JSON.parse(result.stdout) } catch { throw problem('invalid-package', '更新源返回的插件元数据无效。') }
        const dsh = data !== null && typeof data === 'object' ? data.dsh : undefined
        const bundleMeta = dsh !== null && typeof dsh === 'object' && 'bundle' in dsh ? dsh.bundle : undefined
        if (data?.name !== bundle.name || typeof data?.version !== 'string' || !valid(data.version) || !bundleMeta) throw problem('invalid-package', '更新源中的名称、版本或DSH插件声明不匹配，已跳过。')
        return { version: data.version, registry }
      }
      throw problem(timedOut ? 'lookup-timeout' : 'lookup-failed', timedOut ? '检查版本超时，已跳过此插件。' : '无法从配置的更新源获取版本，已跳过此插件。')
    },
  }
}
