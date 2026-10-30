import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const destination = path.join(root, 'artifacts')
await mkdir(destination, { recursive: true })
const built = spawnSync(process.execPath, [path.join(root, 'tooling/build.mjs')], { cwd: root, stdio: 'inherit', windowsHide: true })
if (built.status !== 0) throw new Error('Release build failed')
const npmCli = process.platform === 'win32' ? path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js') : process.env.npm_execpath
if (!npmCli) throw new Error('Run this command through npm or on the configured Windows Node installation')
const result = spawnSync(process.execPath, [npmCli, 'pack', '--ignore-scripts', '--json', '--pack-destination', destination], { cwd: root, encoding: 'utf8', windowsHide: true })
if (result.status !== 0) { console.error(result.stderr); throw new Error('Package creation failed') }
const records = JSON.parse(result.stdout)
const item = records[0]
for (const required of ['lib/index.js', 'lib/client.js', 'cordis.patch.yml', 'README.md', 'LICENSE']) {
  if (!item.files.some(file => file.path === required)) throw new Error(`Release is missing ${required}`)
}
if (item.files.some(file => /^(node_modules|\.dev|\.tooling|tests|src)\//.test(file.path))) throw new Error('Development content leaked into release package')
const filename = path.join(destination, item.filename)
const digest = createHash('sha256').update(await readFile(filename)).digest('hex')
await writeFile(`${filename}.sha256`, `${digest}  ${item.filename}\n`)
await writeFile(path.join(destination, 'package-report.json'), JSON.stringify({ filename: item.filename, sha256: digest, files: item.files, size: item.size }, null, 2) + '\n')
console.log(JSON.stringify({ filename, size: item.size, sha256: digest }, null, 2))
