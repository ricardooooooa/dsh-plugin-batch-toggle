import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const CLI_PATH = 'resources/runtime/cli/bin/dsh.cmd'
const ENTRY_PATH = 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'

function selectedPath(value) {
  return typeof value === 'string' && value.trim() && value.trim().toLowerCase() !== 'auto'
    ? value.trim()
    : undefined
}

function pathIdentity(value) {
  const normalized = path.resolve(value)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function installation(root, executable, cli) {
  const desktopExecutable = executable
    ? path.resolve(root, executable)
    : path.join(path.resolve(path.dirname(path.resolve(root, cli)), '../../../..'), 'DeepSeek Harness.exe')
  const appRoot = path.dirname(desktopExecutable)
  const desktopCli = cli ? path.resolve(root, cli) : path.join(appRoot, CLI_PATH)
  if (pathIdentity(desktopCli) !== pathIdentity(path.join(appRoot, CLI_PATH))) {
    throw new Error('desktopExecutable and desktopCli must refer to the same Desktop installation.')
  }
  return { desktopExecutable, desktopCli, desktopCliEntry: path.join(appRoot, ENTRY_PATH) }
}

/** Version-only invocation exits before DSH reads profile, credentials, or sessions. */
async function probeVersion(candidate, env) {
  const childEnv = Object.fromEntries(Object.entries(env).filter(([key, value]) => value !== undefined
    && !/(API[_-]?KEY|TOKEN|SECRET|CREDENTIAL|PASSWORD)/i.test(key)
    && !/^(DSH_|DEEPSEEK_|ANTHROPIC_|OPENAI_|GEMINI_|GOOGLE_|AZURE_|AWS_|NODE_OPTIONS$|ELECTRON_RUN_AS_NODE$)/i.test(key)))
  const result = await execute(candidate.desktopExecutable,
    ['--expose-internals', candidate.desktopCliEntry, '--version'], {
      cwd: path.dirname(candidate.desktopExecutable),
      env: { ...childEnv, ELECTRON_RUN_AS_NODE: '1' },
      encoding: 'utf8', windowsHide: true, timeout: 10_000, maxBuffer: 16 * 1024,
    })
  return result.stdout.trim()
}

/**
 * Resolve one coherent, version-verified Desktop installation.
 * DSH_DESKTOP_* overrides the configured installation as a pair; explicit
 * selections never silently fall back. Relative paths resolve against root.
 * options.candidates replaces the legacy fallback list, after LOCALAPPDATA's
 * preferred installation. options.probe receives the three resolved paths and
 * returns a version string, allowing tests to use temporary installation files.
 * No user-data directories are inspected by this helper.
 */
export async function loadDevelopmentConfig(root, options = {}) {
  const config = JSON.parse(await readFile(path.join(root, 'config/development.json'), 'utf8'))
  if (typeof config.baseline !== 'string' || !config.baseline.trim()) {
    throw new Error('Development configuration requires an exact DSH baseline version.')
  }
  const env = options.env ?? process.env
  const probe = options.probe ?? (candidate => probeVersion(candidate, env))
  const environmentExe = selectedPath(env.DSH_DESKTOP_EXECUTABLE)
  const environmentCli = selectedPath(env.DSH_DESKTOP_CLI)
  const configuredExe = selectedPath(config.desktopExecutable)
  const configuredCli = selectedPath(config.desktopCli)
  let source = 'automatic'
  let candidates
  if (environmentExe || environmentCli) {
    source = 'environment'
    candidates = [installation(root, environmentExe, environmentCli)]
  } else if (configuredExe || configuredCli) {
    source = 'configured'
    candidates = [installation(root, configuredExe, configuredCli)]
  } else {
    const local = selectedPath(env.LOCALAPPDATA)
    const paths = [
      ...(local ? [path.join(local, 'Programs/DeepSeek Harness/DeepSeek Harness.exe')] : []),
      ...options.candidates ?? ['C:/dsh/DeepSeek Harness.exe'],
    ]
    const unique = new Set()
    candidates = paths.map(executable => installation(root, executable)).filter(candidate => {
      const key = pathIdentity(candidate.desktopExecutable)
      if (unique.has(key)) return false
      unique.add(key)
      return true
    })
  }

  const rejected = []
  for (const candidate of candidates) {
    let detail
    try {
      for (const filename of [candidate.desktopExecutable, candidate.desktopCli]) {
        if (!(await stat(filename)).isFile()) throw Object.assign(new Error('Not a file'), { code: 'NOT_FILE' })
      }
      const version = String(await probe(candidate)).trim()
      if (version === config.baseline) return { ...config, ...candidate, desktopVersion: version }
      detail = /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/.test(version)
        ? `reported ${version}` : 'returned an invalid version response'
    } catch (error) {
      detail = `could not be verified (${typeof error?.code === 'string' ? error.code : 'version probe failed'})`
    }
    rejected.push(`${candidate.desktopExecutable}: ${detail}`)
    if (source !== 'automatic') break
  }
  throw new Error(`No ${source} Desktop installation matches baseline ${config.baseline}. ${rejected.join('; ') || 'No candidates were configured.'}`)
}
