import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'

// Build probe only: never registered, displayed, or installed in DSH.
export const inject = ['slots', 'remote', 'remote.pluginManager']
export const serviceSurface = (ctx: Context) => ({ slots: ctx.get('slots'), manager: ctx.get('remote').pluginManager })
export const RenderProbe = () => <Button>Development probe</Button>
