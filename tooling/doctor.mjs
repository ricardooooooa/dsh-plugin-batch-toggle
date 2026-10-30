import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadDevelopmentConfig } from './development.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(import.meta.url)
const config = await loadDevelopmentConfig(root)
const projectPackage = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 24 || (major === 24 && minor < 9)) throw new Error('Node >=24.9.0 is required for this development environment.')
const names = ['@deepseek-ai/cordis', ...Object.keys(projectPackage.devDependencies ?? {}).filter(name => name.startsWith('@deepseek-ai/dsh-')), 'typescript', 'esbuild']
const dependencies = {}
for (const name of names) {
  const pkg = JSON.parse(await readFile(require.resolve(`${name}/package.json`), 'utf8'))
  if (name.startsWith('@deepseek-ai/dsh-') && pkg.version !== config.baseline) throw new Error(`Version mismatch for ${name}`)
  dependencies[name] = pkg.version
}
const report = { checkedAt: new Date().toISOString(), preparationOnly: config.preparationOnly, node: process.version, desktopVersion: config.desktopVersion, desktopExecutable: config.desktopExecutable, desktopCli: config.desktopCli, packageManager: projectPackage.packageManager, dependencies, isolatedHome: path.join(root, '.dev/dsh-home'), isolatedAgentsHome: path.join(root, '.dev/agents-home'), restoreMode: config.restoreMode }
await mkdir(path.join(root, '.dev'), { recursive: true })
await writeFile(path.join(root, '.dev/environment-report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
