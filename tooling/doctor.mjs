import { readFile, access, mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(import.meta.url)
const config = JSON.parse(await readFile(path.join(root, 'config/development.json'), 'utf8'))
const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 24 || (major === 24 && minor < 9)) throw new Error('Node >=24.9.0 is required for this development environment.')
for (const file of [config.desktopExecutable, config.desktopCli]) await access(file)
const names = ['@deepseek-ai/cordis', '@deepseek-ai/dsh-plugin-manager', '@deepseek-ai/dsh-api-remotes', '@deepseek-ai/dsh-client-ui-plugin-manager', '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-slots', 'typescript', 'esbuild']
const dependencies = {}
for (const name of names) {
  const pkg = JSON.parse(await readFile(require.resolve(`${name}/package.json`), 'utf8'))
  if (name.startsWith('@deepseek-ai/dsh-') && pkg.version !== config.baseline) throw new Error(`Version mismatch for ${name}`)
  dependencies[name] = pkg.version
}
const cli = path.join(path.dirname(config.desktopExecutable), 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js')
const result = spawnSync(config.desktopExecutable, ['--expose-internals', cli, '--version'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', windowsHide: true, timeout: 10000 })
if (result.status !== 0 || result.stdout.trim() !== config.baseline) throw new Error('Installed DSH differs from the pinned baseline. Review configuration before proceeding.')
const report = { checkedAt: new Date().toISOString(), preparationOnly: config.preparationOnly, node: process.version, desktopVersion: result.stdout.trim(), packageManager: JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).packageManager, dependencies, isolatedHome: path.join(root, '.dev/dsh-home'), isolatedAgentsHome: path.join(root, '.dev/agents-home'), restoreMode: config.restoreMode }
await mkdir(path.join(root, '.dev'), { recursive: true })
await writeFile(path.join(root, '.dev/environment-report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
