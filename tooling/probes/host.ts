import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-plugin-manager'
import type { BundleInfo, PluginInfo, ChangeResult, PluginEntryId } from '@deepseek-ai/dsh-plugin-manager/types'

// Compile against the actual rc.3 API without invoking any mutation.
export function apiSurface(ctx: Context, entryId: PluginEntryId) {
  const manager = ctx.get('pluginManager')
  if (!manager) throw new Error('pluginManager service is unavailable')
  const listBundles: () => Promise<BundleInfo[]> = () => manager.listBundles()
  const listPlugins: () => Promise<PluginInfo[]> = () => manager.listPlugins()
  const setBundleEnabled: (name: string, enabled: boolean) => Promise<ChangeResult> = (name, enabled) => manager.setBundleEnabled(name, enabled)
  const setPluginEnabled: (enabled: boolean) => Promise<ChangeResult> = enabled => manager.setPluginEnabled(entryId, enabled)
  return { listBundles, listPlugins, setBundleEnabled, setPluginEnabled }
}
