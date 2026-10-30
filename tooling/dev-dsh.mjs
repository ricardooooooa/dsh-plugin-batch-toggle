import { spawn, spawnSync } from 'node:child_process'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const config = JSON.parse(await readFile(path.join(root, 'config/development.json'), 'utf8'))
const smoke = process.argv.includes('--smoke')
const dev = path.join(root, '.dev')
const home = path.join(dev, 'dsh-home')
const agentsHome = path.join(dev, 'agents-home')
const cwd = path.join(dev, 'workspace')
const documents = path.join(dev, 'documents')
for (const dir of [home, agentsHome, cwd, documents]) await mkdir(dir, { recursive: true })
for (const dir of [home, cwd]) {
  try { await access(path.join(dir, '.env')) } catch { continue }
  throw new Error('The isolated runtime directory contains .env; remove it before credential-free development.')
}
const patch = path.join(dev, 'isolation.patch.yml')
await writeFile(patch, `- id: workspace-controller\n  config:\n    documentsDirectory: ${JSON.stringify(documents.replaceAll('\\', '/'))}\n`)

// Never copy the daily profile or its credential-bearing process environment.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/(API[_-]?KEY|TOKEN|SECRET|CREDENTIAL|PASSWORD)/i.test(key) &&
  !/^(DSH_|DEEPSEEK_|ANTHROPIC_|OPENAI_|GEMINI_|GOOGLE_|AZURE_|AWS_)/i.test(key) &&
  !/^(NODE_OPTIONS|ELECTRON_RUN_AS_NODE)$/i.test(key)))
Object.assign(env, { DSH_HOME: home, DSH_AGENTS_HOME: agentsHome, ELECTRON_RUN_AS_NODE: '1' })
const cli = path.join(path.dirname(config.desktopExecutable), 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js')
const args = ['--expose-internals', cli, '--profile', config.profile]
try { await access(path.join(home, 'profiles', config.profile, 'package.json')) } catch {
  args.push('--from-default-profile', 'web')
}
args.push('--patch', patch, '--host', config.host, '--port', String(config.port), '--no-open')
console.log(`Starting isolated DSH ${config.baseline}; profile=${config.profile}; home=${home}`)
const child = spawn(config.desktopExecutable, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
let output = ''
let exitCode = null
let spawnError
let closed = false
child.on('close', () => { closed = true })
child.on('error', error => {
  spawnError = error
  if (!smoke) { console.error(`Could not start isolated DSH: ${error.code ?? 'spawn-error'}`); process.exitCode = 1 }
})
child.on('exit', code => { exitCode = code ?? 1 })
const redact = text => text.replace(/([?&]token=)[^&\s"'<>\x1b]+/gi, '$1[redacted]')
const collect = data => { output += data.toString(); if (!smoke) process.stdout.write(data) }
child.stdout.on('data', collect)
child.stderr.on('data', collect)
const stop = async () => {
  if (closed || !child.pid) return
  let timer
  const closeResult = new Promise(resolve => {
    child.once('close', () => resolve(true))
    timer = setTimeout(() => resolve(false), 8000)
  })
  const result = process.platform === 'win32'
    ? spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 5000 })
    : { status: child.kill('SIGTERM') ? 0 : 1 }
  const finished = await closeResult
  clearTimeout(timer)
  if (!finished) throw new Error(`Could not stop isolated DSH (termination status: ${result.status ?? 'timeout'})`)
}
let stopping = false
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  if (stopping) return
  stopping = true
  try { await stop() } catch (error) { console.error(error.message); process.exitCode = 1 }
})

if (!smoke) {
  child.on('exit', code => { process.exitCode = code ?? 1 })
} else {
  let report
  let lastHttpStatus
  try {
    const deadline = Date.now() + 45000
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError
      if (exitCode !== null) throw new Error(`Isolated DSH exited with status ${exitCode}`)
      const urls = [...output.matchAll(/http:\/\/127\.0\.0\.1:\d+[^\s\x1b]*/g)].map(match => match[0])
      for (const url of new Set(urls)) {
        try {
          // Node fetch has no browser cookie jar: exchange the launch token
          // without following its redirect, then keep the session cookie in memory.
          const bootstrap = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(1000) })
          const cookie = bootstrap.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ')
          const response = [302, 303].includes(bootstrap.status) && cookie
            ? await fetch(new URL(url).origin, { headers: { Cookie: cookie }, redirect: 'manual', signal: AbortSignal.timeout(1000) })
            : bootstrap
          lastHttpStatus = response.status
          const html = await response.text()
          if (response.ok && /<!doctype html|<html/i.test(html)) {
            report = { checkedAt: new Date().toISOString(), url: new URL(url).origin, bootstrapStatus: bootstrap.status, httpStatus: response.status, baseline: config.baseline, profile: config.profile, home, agentsHome, documents, workspace: cwd, credentialEnvironmentFiltered: true, productPluginInstalled: false, result: 'isolated-web-shell-ok' }
            break
          }
        } catch { /* Wait until the announced server has finished starting. */ }
      }
      if (report) break
      await new Promise(resolve => setTimeout(resolve, 300))
    }
    if (!report) throw new Error(`Isolated DSH did not serve its web shell within 45 seconds (last HTTP status: ${lastHttpStatus ?? 'unavailable'})`)
    await writeFile(path.join(dev, 'runtime-report.json'), JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify(report, null, 2))
  } catch (error) {
    console.error(redact(output.slice(-10000)))
    throw error
  } finally {
    await stop()
    await writeFile(path.join(dev, 'runtime.log'), redact(output))
  }
}
