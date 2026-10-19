/* eslint-disable no-await-in-loop -- Real installation acceptance must run serially in one global prefix. */
// Opt-in, real npm acceptance. Every global mutation is confined to a temporary prefix.
import { spawn } from 'node:child_process'
import { cp, copyFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir, release, type, version as osVersion } from 'node:os'
import { dirname, delimiter, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const repository = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(new URL('../packages/core/package.json', import.meta.url))
const { rcompare } = require('semver')
const directory = await mkdtemp(join(tmpdir(), 'agent-manager-acceptance-'))
const runtime = join(directory, 'runtime')
const prefix = join(directory, 'global')
await mkdir(runtime)
await mkdir(prefix)
const windows = process.platform === 'win32'
const node = join(runtime, windows ? 'node.exe' : 'node')
await copyFile(process.execPath, node)
const npmPackage = windows
  ? join(dirname(process.execPath), 'node_modules/npm')
  : await import('node:fs/promises').then(async (fs) =>
      dirname(dirname(await fs.realpath(join(dirname(process.execPath), 'npm')))),
    )
await cp(npmPackage, join(runtime, 'node_modules/npm'), { recursive: true })
if (windows)
  await writeFile(
    join(runtime, 'npm.cmd'),
    '@echo off\r\n"%~dp0%node.exe" "%~dp0%node_modules\\npm\\bin\\npm-cli.js" %*\r\n',
  )
else {
  const { chmod, symlink } = await import('node:fs/promises')
  await chmod(node, 0o755)
  await symlink(join(runtime, 'node_modules/npm/bin/npm-cli.js'), join(runtime, 'npm'))
}
const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
const path = windows
  ? [
      prefix,
      runtime,
      join(systemRoot, 'System32'),
      systemRoot,
      join(systemRoot, 'System32/WindowsPowerShell/v1.0'),
    ]
  : [join(prefix, 'bin'), runtime, '/usr/bin', '/bin']
const env = {
  ...process.env,
  PATH: path.join(delimiter),
  NPM_CONFIG_PREFIX: prefix,
  LOCALAPPDATA: join(directory, 'data'),
  XDG_STATE_HOME: join(directory, 'data'),
  AGENT_CLI_MANAGER_STATE_DIR: join(directory, 'manager-state'),
}
// Windows environment names are case-insensitive; avoid duplicate inherited Path keys.
for (const key of Object.keys(env))
  if (key !== 'PATH' && key.toLowerCase() === 'path') delete env[key]
const entry = join(repository, 'packages/cli/dist/cli.mjs')
const evidence = {
  at: new Date().toISOString(),
  platform: process.platform,
  operatingSystem: { type: type(), release: release(), version: osVersion() },
  arch: process.arch,
  node: process.version,
  temporaryDirectory: directory,
  results: [],
}
async function run(args) {
  process.stdout.write(`${args.join(' ')} … `)
  const output = await new Promise((done, reject) => {
    const child = spawn(node, [entry, ...args, '--json'], {
      env,
      cwd: directory,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (data) => {
      stdout += data
    })
    child.stderr.on('data', (data) => {
      stderr += data
    })
    child.on('error', reject)
    child.on('close', (code) => done({ code, stdout, stderr }))
  })
  const report = JSON.parse(output.stdout)
  evidence.results.push({ args, code: output.code, report })
  process.stdout.write(`${report.status}\n`)
  if (report.operation !== args[0] || report.results.length === 0)
    throw new Error('Unexpected CLI operation or missing per-tool results')
  if (output.code !== 0) throw new Error(`${args.join(' ')} failed: ${JSON.stringify(report)}`)
  return report
}
try {
  await run(['list'])
  for (const tool of ['claude', 'codex', 'pi', 'gemini']) {
    const first = await run(['install', tool, '--yes'])
    const version = first.results[0].targetVersion
    await run(['install', tool, '--version', version, '--yes'])
    const versions = (await run(['versions', tool])).results[0].versions
    const previous = versions.find((value) => rcompare(version, value) < 0)
    if (!previous) throw new Error(`No previous stable version for ${tool}`)
    await run(['downgrade', tool, '--version', previous, '--yes'])
    await run(['upgrade', tool, '--yes'])
    const rollback = await run(['rollback', tool, '--yes'])
    if (rollback.results[0].targetVersion !== previous) throw new Error('Rollback target mismatch')
    await run(['uninstall', tool, '--yes'])
  }
  await run(['list'])
  evidence.status = 'passed'
} catch (error) {
  evidence.status = 'failed'
  evidence.message = error.message
  process.exitCode = 1
} finally {
  const output = resolve(
    repository,
    'artifacts',
    `acceptance-${process.platform}-${process.arch}.json`,
  )
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, JSON.stringify(evidence, null, 2) + '\n')
  // Leave the isolated environment available for diagnosis; no user installations are changed.
  console.log(`验收记录：${output}\n隔离目录：${directory}`)
}
