import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createNpmUpdateAdapter } from '../src/npm-update-adapter.ts'
import type { ManagedBundle } from '../src/types.ts'

const bundle = (extra: Partial<ManagedBundle> = {}): ManagedBundle => ({ name: 'example', version: '1.0.0', source: 'example@1.0.0', installed: true, enabled: true, official: false, availability: 'profile', rows: [], overrides: [], ...extra })
const applied = { changed: true, application: 'applied' as const }
function manager() {
  return { listBundles: async () => [], setBundleEnabled: async () => applied, removeBundle: async () => applied,
    installBundle: async (_spec: string, _options: object) => applied, cancelInstall: async (_id: string) => ({ status: 'cancelled' }),
    registries: async () => ({ registry: null, fallbackRegistries: [] as string[], resolved: null }) }
}
test('reads latest for an installed npm bundle with the profile runtime and configuration', async () => {
  let querySpec = ''
  const adapter = createNpmUpdateAdapter(manager(), { dir: '/profile', packageManager: { command: 'bundled-node', args: ['pnpm.mjs'], env: { TEST_RUNTIME: '1' } } }, async (dir, spec, options) => {
    assert.equal(dir, '/profile'); querySpec = spec; assert.equal(options.command, 'bundled-node'); assert.equal(options.env?.TEST_RUNTIME, '1')
    return { exitCode: 0, stdout: JSON.stringify({ name: '@scope/example', version: '1.2.0', dsh: { bundle: { patch: './cordis.patch.yml' } } }), stderr: '', timedOut: false }
  })
  assert.deepEqual(await adapter.latest(bundle({ name: '@scope/example', source: '@scope/example@^1.0.0' })), { version: '1.2.0', registry: null })
  assert.equal(querySpec, '@scope/example@latest')
})
test('never substitutes a git, URL, local or aliased dependency with an npm package', async () => {
  const adapter = createNpmUpdateAdapter(manager(), { dir: '/profile' }, async () => { throw new Error('must not query') })
  for (const source of ['github:owner/example', 'https://example.invalid/pkg.tgz', 'file:/tmp/pkg', 'example@npm:other@1.0.0', undefined]) {
    await assert.rejects(adapter.latest(bundle({ source })), error => (error as { code?: string }).code === 'unsupported-source')
  }
})
test('validates registry package identity and bundle metadata before any removal', async () => {
  for (const answer of [{ name: 'impostor', version: '2.0.0', dsh: { bundle: { patch: 'x' } } }, { name: 'example', version: 'bad', dsh: { bundle: { patch: 'x' } } }, { name: 'example', version: '2.0.0' }]) {
    const adapter = createNpmUpdateAdapter(manager(), { dir: '/profile' }, async () => ({ exitCode: 0, stdout: JSON.stringify(answer), stderr: '', timedOut: false }))
    await assert.rejects(adapter.latest(bundle()), error => (error as { code?: string }).code === 'invalid-package')
  }
})
test('registry fallback stays within the manager configured list and has a deadline', async () => {
  const sdk = manager(); sdk.registries = async () => ({ registry: null, fallbackRegistries: ['https://fallback.invalid'], resolved: null })
  const adapter = createNpmUpdateAdapter(sdk, { dir: '/profile' }, async (_dir, _spec, options) => {
    assert.ok(options.timeoutMs > 0 && options.timeoutMs <= 20000)
    return options.registry === null ? { exitCode: 1, stdout: '', stderr: '', timedOut: true } : { exitCode: 0, stdout: JSON.stringify({ name: 'example', version: '1.1.0', dsh: { bundle: true } }), stderr: '', timedOut: false }
  })
  assert.equal((await adapter.latest(bundle())).registry, 'https://fallback.invalid')
})
test('forward updates respect latest release policy while rollback pins the exact old version', async () => {
  const sdk = manager(); const installed: {spec:string;options:Record<string,unknown>}[] = []
  sdk.installBundle = async (spec, options) => { installed.push({ spec, options: options as Record<string,unknown> }); return applied }
  const adapter = createNpmUpdateAdapter(sdk, { dir: '/profile' }, async () => ({ exitCode: 1, stdout: '', stderr: '', timedOut: false }))
  await adapter.install('example', '2.0.0', false, 'forward-id', null, 'update')
  await adapter.install('example', '1.0.0', true, 'rollback-id', null, 'rollback')
  assert.equal(installed[0].spec, 'example@latest'); assert.equal(installed[0].options.enabled, false)
  assert.equal(installed[0].options.requestId, 'forward-id'); assert.equal(installed[0].options.saveExact, true)
  assert.equal(installed[1].spec, 'example@1.0.0'); assert.equal(installed[1].options.enabled, true)
  assert.ok(!('approvedBuilds' in installed[0].options))
})
