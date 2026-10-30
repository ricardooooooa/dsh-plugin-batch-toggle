import { createServer } from 'node:http'
import { gzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { once } from 'node:events'

function archive(files) {
  const blocks = []
  for (const [name, source] of Object.entries(files)) {
    const content = Buffer.from(source)
    const header = Buffer.alloc(512)
    const text = (value, offset, length) => header.write(value, offset, length, 'ascii')
    text(`package/${name}`, 0, 100); text('0000644\0', 100, 8); text('0000000\0', 108, 8); text('0000000\0', 116, 8)
    text(content.length.toString(8).padStart(11, '0') + '\0', 124, 12); text('00000000000\0', 136, 12)
    header.fill(32, 148, 156); header[156] = 48; text('ustar\0', 257, 6); text('00', 263, 2)
    text([...header].reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148, 8)
    blocks.push(header, content, Buffer.alloc((512 - content.length % 512) % 512))
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]))
}

/** Controlled npm registry: B has an incompatible new release; A/C/D update normally. */
export async function createFixtureRegistry() {
  const names = ['a', 'b', 'c', 'd'].map(suffix => `dsh-update-fixture-${suffix}`)
  const tarballs = new Map()
  const versions = new Map()
  for (const name of names) {
    const records = {}
    for (const version of ['1.0.0', '1.1.0']) {
      const manifest = { name, version, type: 'module', main: 'index.js', dsh: { bundle: { patch: './cordis.patch.yml' } }, ...(name.endsWith('-b') && version === '1.1.0' ? { engines: { dsh: '>=99.0.0' } } : {}) }
      const body = archive({
        'package.json': JSON.stringify(manifest),
        'cordis.patch.yml': `- insert:\n    - id: ${name}\n      name: ${name}\n`,
        'index.js': `import {appendFileSync} from 'node:fs'; import {join} from 'node:path'; export const name=${JSON.stringify(name)}; export function apply(ctx){const record=(event)=>appendFileSync(join(process.env.DSH_HOME,'fixture-events.jsonl'),JSON.stringify({name,version:${JSON.stringify(version)},event})+String.fromCharCode(10));record('apply');ctx.effect(()=>()=>record('dispose'));}\n`,
      })
      const key = `${name}-${version}.tgz`
      tarballs.set(key, body)
      records[version] = { ...manifest, dist: { tarball: key, shasum: createHash('sha1').update(body).digest('hex') } }
    }
    versions.set(name, records)
  }
  let origin
  const server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)
    const filename = pathname.split('/').at(-1)
    if (tarballs.has(filename)) { response.writeHead(200, { 'content-type': 'application/octet-stream' }); response.end(tarballs.get(filename)); return }
    const name = pathname.split('/').filter(Boolean)[0]
    if (versions.has(name)) {
      const records = Object.fromEntries(Object.entries(versions.get(name)).map(([version, manifest]) => [version, { ...manifest, dist: { ...manifest.dist, tarball: `${origin}/${name}/-/${manifest.dist.tarball}` } }]))
      const wanted = pathname.split('/').filter(Boolean)[1]
      const data = wanted ? records[wanted === 'latest' ? '1.1.0' : wanted] : { name, 'dist-tags': { latest: '1.1.0' }, versions: records, time: { created: '2020-01-01T00:00:00.000Z', modified: '2020-02-01T00:00:00.000Z', '1.0.0': '2020-01-01T00:00:00.000Z', '1.1.0': '2020-02-01T00:00:00.000Z' } }
      response.writeHead(data ? 200 : 404, { 'content-type': 'application/json' }); response.end(JSON.stringify(data ?? { error: 'Not found' })); return
    }
    // The plugin's one small public runtime dependency may be queried by pnpm.
    if (!versions.has(name)) {
      try { const upstream = await fetch(`https://registry.npmjs.org${pathname}`, { signal: AbortSignal.timeout(15000) }); response.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' }); response.end(Buffer.from(await upstream.arrayBuffer())); return } catch { /* Normal 404 below. */ }
    }
    response.writeHead(404, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: 'Not found' }))
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  origin = `http://127.0.0.1:${server.address().port}`
  return { names, origin, close: () => new Promise(resolve => server.close(resolve)) }
}
