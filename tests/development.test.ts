import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { TestContext } from 'node:test'

interface Installation {
  desktopExecutable: string
  desktopCli: string
  desktopCliEntry: string
}
interface DevelopmentConfig extends Installation {
  baseline: string
  desktopVersion: string
  profile: string
}
interface Options {
  env?: NodeJS.ProcessEnv
  /** Additional fallback executables after LOCALAPPDATA's preferred installation. */
  candidates?: string[]
  probe?: (installation: Installation) => Promise<string>
}

const helperUrl = new URL('../tooling/development.mjs', import.meta.url).href
async function load(root: string, options: Options): Promise<DevelopmentConfig> {
  let helper: { loadDevelopmentConfig: (root: string, options: Options) => Promise<DevelopmentConfig> }
  try { helper = await import(helperUrl) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND') assert.fail('The development installation resolver must exist')
    throw error
  }
  return helper.loadDevelopmentConfig(root, options)
}

async function project(t: TestContext, values: Record<string, unknown> = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-development-'))
  assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, 'config'))
  const config = { baseline: '0.2.1-rc.5', desktopExecutable: 'auto', desktopCli: 'auto', profile: 'plugin-lab', ...values }
  await writeFile(path.join(root, 'config/development.json'), JSON.stringify(config))
  return root
}

async function installation(root: string, directory: string) {
  const appRoot = path.join(root, directory)
  const desktopExecutable = path.join(appRoot, 'DeepSeek Harness.exe')
  const desktopCli = path.join(appRoot, 'resources/runtime/cli/bin/dsh.cmd')
  await mkdir(path.dirname(desktopCli), { recursive: true })
  await writeFile(desktopExecutable, '')
  await writeFile(desktopCli, '')
  return { desktopExecutable, desktopCli }
}

test('auto prefers the LOCALAPPDATA installation over a matching legacy fallback', async t => {
  const root = await project(t)
  const local = path.join(root, 'local-app-data')
  const current = await installation(root, 'local-app-data/Programs/DeepSeek Harness')
  const legacy = await installation(root, 'legacy')
  const config = await load(root, { env: { LOCALAPPDATA: local }, candidates: [legacy.desktopExecutable], probe: async () => '0.2.1-rc.5' })
  assert.equal(config.desktopExecutable, current.desktopExecutable)
  assert.equal(config.desktopCli, current.desktopCli)
  assert.equal(config.desktopVersion, config.baseline)
  assert.equal(config.profile, 'plugin-lab')
  assert.equal(config.desktopCliEntry, path.join(path.dirname(current.desktopExecutable), 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'))
})

test('auto excludes an old rc.3 installation and selects a verified rc.5 fallback', async t => {
  const root = await project(t)
  const legacy = await installation(root, 'legacy')
  const current = await installation(root, 'current')
  const config = await load(root, {
    env: {}, candidates: [legacy.desktopExecutable, current.desktopExecutable],
    probe: async value => value.desktopExecutable === legacy.desktopExecutable ? '0.2.1-rc.3' : '0.2.1-rc.5',
  })
  assert.equal(config.desktopExecutable, current.desktopExecutable)
})

test('auto fails clearly when every available installation has the wrong version', async t => {
  const root = await project(t)
  const legacy = await installation(root, 'legacy')
  await assert.rejects(() => load(root, { env: {}, candidates: [legacy.desktopExecutable], probe: async () => '0.2.1-rc.3' }), /0\.2\.1-rc\.5.*0\.2\.1-rc\.3/s)
})

test('a wrong explicitly configured version fails instead of silently falling back', async t => {
  const root = await project(t, { desktopExecutable: 'legacy/DeepSeek Harness.exe' })
  const legacy = await installation(root, 'legacy')
  const current = await installation(root, 'current')
  await assert.rejects(() => load(root, {
    env: {}, candidates: [current.desktopExecutable],
    probe: async value => value.desktopExecutable === legacy.desktopExecutable ? '0.2.1-rc.3' : '0.2.1-rc.5',
  }), /configured.*0\.2\.1-rc\.5.*0\.2\.1-rc\.3/is)
})

test('environment executable overrides a differently configured installation as one coherent pair', async t => {
  const root = await project(t, { desktopExecutable: 'legacy/DeepSeek Harness.exe', desktopCli: 'legacy/resources/runtime/cli/bin/dsh.cmd' })
  await installation(root, 'legacy')
  const current = await installation(root, 'current')
  const config = await load(root, { env: { DSH_DESKTOP_EXECUTABLE: current.desktopExecutable }, candidates: [], probe: async () => '0.2.1-rc.5' })
  assert.equal(config.desktopExecutable, current.desktopExecutable)
  assert.equal(config.desktopCli, current.desktopCli)
})

test('environment CLI alone selects its own installation and overrides config', async t => {
  const root = await project(t, { desktopExecutable: 'legacy/DeepSeek Harness.exe' })
  await installation(root, 'legacy')
  const current = await installation(root, 'current')
  const config = await load(root, { env: { DSH_DESKTOP_CLI: current.desktopCli }, candidates: [], probe: async () => '0.2.1-rc.5' })
  assert.equal(config.desktopExecutable, current.desktopExecutable)
  assert.equal(config.desktopCli, current.desktopCli)
})

test('an explicitly configured CLI can select its paired executable', async t => {
  const root = await project(t, { desktopCli: 'current/resources/runtime/cli/bin/dsh.cmd' })
  const current = await installation(root, 'current')
  const config = await load(root, { env: {}, candidates: [], probe: async () => '0.2.1-rc.5' })
  assert.equal(config.desktopExecutable, current.desktopExecutable)
})

test('explicit executable and CLI paths from different installations are rejected', async t => {
  const root = await project(t)
  const first = await installation(root, 'first')
  const second = await installation(root, 'second')
  await assert.rejects(() => load(root, {
    env: { DSH_DESKTOP_EXECUTABLE: first.desktopExecutable, DSH_DESKTOP_CLI: second.desktopCli },
    candidates: [], probe: async () => '0.2.1-rc.5',
  }), /same.*installation/i)
})

test('auto skips incomplete installations even if their executable exists', async t => {
  const root = await project(t)
  const incomplete = await installation(root, 'incomplete')
  await rm(incomplete.desktopCli)
  const complete = await installation(root, 'complete')
  const config = await load(root, { env: {}, candidates: [incomplete.desktopExecutable, complete.desktopExecutable], probe: async () => '0.2.1-rc.5' })
  assert.equal(config.desktopExecutable, complete.desktopExecutable)
})

test('environment version mismatch remains explicit and cannot fall back to another installation', async t => {
  const root = await project(t)
  const legacy = await installation(root, 'legacy')
  const current = await installation(root, 'current')
  await assert.rejects(() => load(root, {
    env: { DSH_DESKTOP_EXECUTABLE: legacy.desktopExecutable }, candidates: [current.desktopExecutable],
    probe: async value => value.desktopExecutable === legacy.desktopExecutable ? '0.2.1-rc.3' : '0.2.1-rc.5',
  }), /environment.*0\.2\.1-rc\.5.*0\.2\.1-rc\.3/is)
})
