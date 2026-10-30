import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const config = JSON.parse(await readFile(path.join(root, 'config/development.json'), 'utf8'))
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const home = path.join(root, '.dev/integration/home')
const agents = path.join(root, '.dev/integration/agents')
const cwd = path.join(root, '.dev/integration/workspace')
const profile = path.join(home, 'profiles/batch-integration')
const manifestPath = path.join(profile, 'package.json')
const cli = path.join(path.dirname(config.desktopExecutable), 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js')
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/(API[_-]?KEY|TOKEN|SECRET|CREDENTIAL|PASSWORD)/i.test(key) && !/^(DSH_|DEEPSEEK_|ANTHROPIC_|OPENAI_|GEMINI_|GOOGLE_|AZURE_|AWS_|NODE_OPTIONS|ELECTRON_RUN_AS_NODE)/i.test(key)))
Object.assign(env, { ELECTRON_RUN_AS_NODE: '1', DSH_HOME: home, DSH_AGENTS_HOME: agents, DSH_TELEMETRY_DISABLED: '1' })
for (const dir of [home, agents, cwd]) await mkdir(dir, { recursive: true })
const redact = text => text.replace(/([?&]token=)[^&\s"'<>\x1b]+/gi, '$1[redacted]')
const checks = []
const record = name => { checks.push(name); console.log(`PASS ${name}`) }
const run = async args => {
  const child = spawn(config.desktopExecutable, ['--expose-internals', cli, ...args], { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', data => { output += data.toString() })
  child.stderr.on('data', data => { output += data.toString() })
  const timer = setTimeout(() => spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }), 90000)
  const [code] = await once(child, 'close')
  clearTimeout(timer)
  if (code !== 0) throw new Error(`DSH CLI failed: ${redact(output).slice(-5000)}`)
}
const bundle = async (suffix) => {
  const name = `dsh-batch-fixture-${suffix}`
  const directory = path.join(root, '.dev/integration/fixtures', name)
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name, version: '1.0.0', type: 'module', main: 'index.js', dsh: { bundle: { patch: './cordis.patch.yml' } } }, null, 2))
  await writeFile(path.join(directory, 'index.js'), `export const name = ${JSON.stringify(name)}; export function apply(ctx) { ctx.on('dispose', () => {}); }\n`)
  await writeFile(path.join(directory, 'cordis.patch.yml'), `- insert:\n    - id: ${name}\n      name: ${name}\n`)
  return { name, directory }
}
const tgz = path.join(root, 'artifacts', `${pkg.name}-${pkg.version}.tgz`)
await access(tgz)
await run(['--profile', 'batch-integration', '--from-default-profile', 'web', '--dump-default-config'])
const alpha = await bundle('alpha')
const dormant = await bundle('dormant')
await run(['plugin', '--profile', 'batch-integration', 'add', '--ignore-scripts', tgz, `file:${alpha.directory}`, `file:${dormant.directory}`])
if (process.argv.includes('--market')) await run(['plugin', '--profile', 'batch-integration', 'add', '--ignore-scripts', 'dshmarket@1.73.1'])
const initial = JSON.parse(await readFile(manifestPath, 'utf8'))
initial.dsh.profile.bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', pkg.name, alpha.name]
if (process.argv.includes('--market')) initial.dsh.profile.bundles.push('dshmarket')
await writeFile(manifestPath, JSON.stringify(initial, null, 2) + '\n')
const patch = path.join(root, '.dev/integration/isolation.patch.yml')
await writeFile(patch, `- id: workspace-controller\n  config:\n    documentsDirectory: ${JSON.stringify(path.join(root, '.dev/integration/documents').replaceAll('\\', '/'))}\n`)
let active
const launch = async () => {
  let output = ''
  const child = spawn(config.desktopExecutable, ['--expose-internals', cli, '--profile', 'batch-integration', '--patch', patch, '--host', '127.0.0.1', '--port', '0', '--no-open'], { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  active = child
  const collect = data => { output += data.toString() }
  child.stdout.on('data', collect); child.stderr.on('data', collect)
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`DSH exited: ${redact(output)}`)
    const launchUrl = output.match(/http:\/\/127\.0\.0\.1:\d+[^\s\x1b]*/)?.[0]
    if (launchUrl) {
      const bootstrap = await fetch(launchUrl, { redirect: 'manual' })
      const cookie = bootstrap.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ')
      assert.equal(bootstrap.status, 303)
      const origin = new URL(launchUrl).origin
      const request = (route, options = {}) => fetch(`${origin}/api/dsh-plugin-batch-toggle/${route}`, { ...options, headers: { Cookie: cookie, ...options.headers } })
      const status = await request('status')
      if (status.status !== 200) throw new Error(`Plugin status ${status.status}: ${redact(output)}`)
      return { origin, launchUrl, request }
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`DSH startup timed out: ${redact(output)}`)
}
const stop = async () => {
  if (!active || active.exitCode !== null) return
  const child = active; active = null
  const closed = once(child, 'close')
  spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 5000 })
  let timer
  await Promise.race([closed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('DSH cleanup timed out')), 8000) })])
  clearTimeout(timer)
}
const settled = async runtime => {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    const response = await runtime.request('status')
    assert.equal(response.status, 200)
    const state = await response.json()
    if (!state.busy) return state
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Batch operation did not settle')
}
const selected = async () => JSON.parse(await readFile(manifestPath, 'utf8')).dsh.profile.bundles
try {
  let runtime = await launch()
  record('install prebuilt release into clean isolated DSH profile')
  if (process.argv.includes('--serve')) {
    // This local-only review link is never written to reports or package files.
    console.log(`REVIEW_URL=${runtime.launchUrl}`)
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void stop() })
    await once(active, 'close')
  } else {
    assert.ok([401, 403].includes((await fetch(`${runtime.origin}/api/dsh-plugin-batch-toggle/status`)).status))
    assert.ok([401, 403].includes((await fetch(`${runtime.origin}/api/dsh-plugin-batch-toggle/disable`, { method: 'POST' })).status))
    assert.equal((await runtime.request('disable', { method: 'POST', headers: { Origin: 'https://evil.invalid', 'Sec-Fetch-Site': 'cross-site' } })).status, 403)
    record('owner authentication and cross-origin mutation rejection')
    let state = await settled(runtime)
    assert.deepEqual(state.candidates, [alpha.name])
    assert.ok(!state.candidates.includes(pkg.name)); assert.ok(!state.candidates.includes(dormant.name))
    record('core/self and previously disabled bundle protection')
    assert.equal((await runtime.request('disable', { method: 'POST' })).status, 202)
    state = await settled(runtime)
    assert.deepEqual(state.pendingRestore, [alpha.name])
    assert.ok(!(await selected()).includes(alpha.name))
    assert.ok((await selected()).includes(pkg.name))
    record('real manager/HMR batch disable keeps recovery plugin alive')
    await stop()
    runtime = await launch()
    state = await settled(runtime)
    assert.deepEqual(state.pendingRestore, [alpha.name])
    record('persistent recovery survives DSH process restart')
    assert.equal((await runtime.request('restore', { method: 'POST' })).status, 202)
    state = await settled(runtime)
    assert.deepEqual(state.pendingRestore, [])
    assert.ok((await selected()).includes(alpha.name))
    assert.ok(!(await selected()).includes(dormant.name))
    assert.ok(state.results.every(item => ['applied', 'restart-required', 'skipped'].includes(item.outcome)))
    record('real restore re-enables the prior list and leaves dormant plugin off')
    await writeFile(path.join(root, '.dev/integration-report.json'), JSON.stringify({ checkedAt: new Date().toISOString(), runtimeVersion: config.baseline, release: path.basename(tgz), checks, result: 'passed', realUserProfileChanged: false }, null, 2) + '\n')
  }
} finally { await stop() }
