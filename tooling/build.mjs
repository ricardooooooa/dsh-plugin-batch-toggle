import { build } from 'esbuild'
import { readFile, mkdir, access, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import vm from 'node:vm'

const root = fileURLToPath(new URL('../', import.meta.url))
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const probe = process.argv.includes('--probe')
const outdir = path.join(root, probe ? '.dev/build-probe' : 'lib')
const entries = probe ? ['tooling/probes/host.ts', 'tooling/probes/client.tsx'] : ['src/index.ts', 'src/client.tsx']
for (const entry of entries) {
  try { await access(path.join(root, entry)) } catch {
    throw new Error(`Missing ${entry}: this project currently contains preparation only. Run check:build to verify the toolchain.`)
  }
}
await mkdir(outdir, { recursive: true })
await build({ entryPoints: [path.join(root, entries[0])], outfile: path.join(outdir, 'index.js'), bundle: true, platform: 'node', format: 'esm', packages: 'external', target: 'node24', sourcemap: true })

// rc.3 shared browser module table; do not replace this with external: ['*'].
const platformModules = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis', 'zod', '@tanstack/react-virtual', '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-dockkit']
const result = await build({ entryPoints: [path.join(root, entries[1])], bundle: true, write: false, platform: 'browser', format: 'cjs', target: 'es2022', jsx: 'automatic', external: platformModules, define: { 'process.env.NODE_ENV': '"production"' } })
const code = `window.__ModuleLoader__.load({ id: ${JSON.stringify(pkg.name)}, factory: (require) => { var module = { exports: {} }; var exports = module.exports;\n${result.outputFiles[0].text}\nreturn module.exports; } });\n`
new vm.Script(code, { filename: 'client.js' })
if (probe) {
  let registered = false
  new vm.Script(code).runInNewContext({ window: { __ModuleLoader__: { load(record) { if (record.id !== pkg.name || typeof record.factory !== 'function') throw new Error('Invalid client module registration'); registered = true } } } })
  if (!registered) throw new Error('Client module not registered')
}
await writeFile(path.join(outdir, 'client.js'), code)
console.log(`${probe ? 'Toolchain probe' : 'Plugin build'}: host ESM and rc.3 client ModuleLoader bundle verified.`)
