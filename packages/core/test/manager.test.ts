/* eslint-disable no-await-in-loop -- Exercise ordered state transitions on a single npm environment. */
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Manager, type Request } from '../src/manager.js'
import { AppError, type Environment, type ToolId, toolIds } from '../src/model.js'
import { tools } from '../src/tools.js'
import { canonical, inspect, parseCommandVersion } from '../src/environment.js'
import { compatibility, exactVersion, Npm } from '../src/npm.js'
import { HistoryStore } from '../src/history.js'
import { npmError, redact, type Runner } from '../src/process.js'

const temporary: string[] = []
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'agent-manager-test-'))
  temporary.push(directory)
  const prefix = join(directory, 'prefix')
  await mkdir(prefix, { recursive: true })
  const env: Environment = {
    id: 'test-environment',
    node: process.execPath,
    nodeVersion: '24.16.0',
    npmFile: 'fixture-npm',
    npmArgs: [],
    npmVersion: '11.13.0',
    prefix,
    root: join(prefix, 'node_modules'),
    platform: 'win32',
    arch: 'x64',
    path: prefix,
  }
  const state = join(directory, 'state')
  const calls: string[][] = []
  const config = {
    failTool: '',
    networkTool: '',
    mismatch: false,
    cancel: false,
    tag: '2.0.0',
    node: '>=22',
    registry: 'https://registry.npmjs.org/',
    scopeRegistry: 'undefined',
  }
  async function install(id: ToolId, version: string) {
    const tool = tools[id]
    const packagePath = join(env.root, tool.package)
    await mkdir(packagePath, { recursive: true })
    await writeFile(
      join(packagePath, 'package.json'),
      JSON.stringify({ name: tool.package, version, bin: { [id]: 'cli.js' } }),
    )
    await writeFile(join(packagePath, 'cli.js'), config.mismatch ? '99.0.0' : version)
    for (const extension of ['', '.cmd', '.ps1'])
      await writeFile(
        join(prefix, id + extension),
        `node "%dp0%\\node_modules\\${tool.package.replaceAll('/', '\\')}\\cli.js" %*`,
      )
  }
  const runner: Runner = {
    async run(file, args) {
      if (file !== env.npmFile)
        return { code: 0, stdout: `codex-cli ${await readFile(args[0]!, 'utf8')}\n`, stderr: '' }
      calls.push(args)
      const id = toolIds.find((value) =>
        args.some(
          (arg) => arg === tools[value].package || arg.startsWith(`${tools[value].package}@`),
        ),
      )
      if (args[0] === 'config')
        return {
          code: 0,
          stdout: args[2] === 'registry' ? config.registry : config.scopeRegistry,
          stderr: '',
        }
      if (!id) throw new Error(`Unexpected npm call: ${args.join(' ')}`)
      if (args[0] === 'view') {
        if (id === config.networkTool)
          return { code: 1, stdout: '', stderr: 'ENOTFOUND registry.example' }
        let data: unknown
        if (args.includes('dist-tags')) data = { [tools[id].stableTag]: config.tag }
        else if (args.includes('versions'))
          data = ['1.0.0', '2.0.0', '2.1.0-beta.1', 'invalid', '1.10.0']
        else {
          const spec = args.find((arg) => arg.startsWith(`${tools[id].package}@`))!
          const version = spec.slice(tools[id].package.length + 1)
          if (version === '9.9.9')
            return { code: 1, stdout: '', stderr: 'ETARGET No matching version found' }
          data = {
            version,
            engines: { node: config.node },
            os: ['win32', 'linux', 'darwin'],
            cpu: ['x64', 'arm64'],
          }
        }
        return { code: 0, stdout: JSON.stringify(data), stderr: '' }
      }
      if (args[0] === 'install') {
        const version = args[2]!.slice(tools[id].package.length + 1)
        await install(id, version)
        if (config.cancel) throw new AppError('CANCELLED', '用户中断', 130)
        if (id === config.failTool)
          return { code: 1, stdout: '', stderr: 'EPERM installation failed' }
      } else if (args[0] === 'uninstall') {
        await rm(join(env.root, tools[id].package), { recursive: true })
        for (const extension of ['', '.cmd', '.ps1']) await rm(join(prefix, id + extension))
      } else throw new Error(`Unexpected command: ${args[0]}`)
      return { code: 0, stdout: '', stderr: '' }
    },
  }
  const manager = new Manager(env, runner, undefined, state)
  const mutate = (request: Request) =>
    manager.mutate(request, { yes: true, interactive: false, confirm: async () => false })
  return { directory, state, env, runner, config, calls, manager, mutate, install }
}

describe('local detection and registry', () => {
  it('lists without npm or network queries and merges Windows wrappers', async () => {
    const f = await fixture()
    await f.install('pi', '1.0.0')
    const output = await f.manager.read({ operation: 'list' })
    expect(f.calls).toHaveLength(0)
    expect(output.results.find((item) => item.tool === 'pi')?.installation).toMatchObject({
      status: 'managed',
      packageVersion: '1.0.0',
      commandVersion: '1.0.0',
      manageable: true,
    })
    expect(output.results.find((item) => item.tool === 'pi')?.installation?.paths).toHaveLength(3)
  })
  it('blocks a conflicting PATH without touching packages', async () => {
    const f = await fixture()
    await f.install('codex', '1.0.0')
    const other = join(f.directory, 'other')
    await mkdir(other)
    await writeFile(join(other, 'codex.exe'), 'external')
    f.env.path += `;${other}`
    const output = await f.mutate({ operation: 'upgrade', tool: 'codex' })
    expect(output.exitCode).toBe(3)
    expect(output.results[0]?.errorCode).toBe('PATH_CONFLICT')
    expect(f.calls).toHaveLength(0)
  })
  it('does not migrate the legacy Pi package', async () => {
    const f = await fixture()
    const path = join(f.env.root, '@mariozechner/pi-coding-agent')
    await mkdir(path, { recursive: true })
    await writeFile(join(path, 'package.json'), '{}')
    const output = await f.mutate({ operation: 'install', tool: 'pi' })
    expect(output.results[0]?.errorCode).toBe('UNMANAGED_INSTALL')
    expect(f.calls).toHaveLength(0)
  })
  it('detects broken entrypoints and mismatched CLI versions', async () => {
    const f = await fixture()
    f.config.mismatch = true
    await f.install('claude', '1.0.0')
    expect((await inspect(tools.claude, f.env, f.runner)).status).toBe('conflict')
    await rm(join(f.env.root, tools.claude.package, 'cli.js'))
    expect((await inspect(tools.claude, f.env, f.runner)).status).toBe('broken')
  })
  it('sorts stable history and explicitly includes prereleases', async () => {
    const f = await fixture()
    const npm = new Npm(f.env, f.runner)
    expect(await npm.versions(tools.pi)).toEqual(['2.0.0', '1.10.0', '1.0.0'])
    expect((await npm.versions(tools.pi, true))[0]).toBe('2.1.0-beta.1')
  })
  it('uses and redacts the scoped registry', async () => {
    const f = await fixture()
    f.config.scopeRegistry = 'https://user:secret@registry.example/?token=private'
    const registry = await new Npm(f.env, f.runner).registry(tools.pi)
    expect(registry).toBe('https://[REDACTED]@registry.example/?token=[REDACTED]')
    expect(f.calls).toEqual([['config', 'get', '@earendil-works:registry', '--global']])
  })
  it('rejects missing or prerelease stable tags', async () => {
    const f = await fixture()
    for (const tag of ['2.1.0-beta.1', 'invalid', '']) {
      f.config.tag = tag
      const output = await f.mutate({ operation: 'install', tool: 'claude' })
      expect(output.results[0]?.errorCode).toBe('STABLE_TAG_INVALID')
    }
    expect(f.calls.some((args) => args[0] === 'install')).toBe(false)
  })
  it('reports partial checks instead of declaring every tool current', async () => {
    const f = await fixture()
    f.config.networkTool = 'pi'
    const output = await f.manager.read({ operation: 'check' })
    expect(output.exitCode).toBe(4)
    expect(output.results.find((item) => item.tool === 'pi')?.errorCode).toBe('NETWORK_ERROR')
  })
})

describe('mutations and trusted rollback', () => {
  it('requires confirmation authorization before making noninteractive changes', async () => {
    const f = await fixture()
    const output = await f.manager.mutate(
      { operation: 'install', tool: 'pi' },
      { yes: false, interactive: false, confirm: async () => true },
    )
    expect(output.exitCode).toBe(2)
    expect(f.calls).toHaveLength(0)
  })
  it('cancels a concrete interactive plan without changes', async () => {
    const f = await fixture()
    const output = await f.manager.mutate(
      { operation: 'install', tool: 'pi' },
      {
        yes: false,
        interactive: true,
        confirm: async (plans) => {
          expect(plans[0]?.targetVersion).toBe('2.0.0')
          return false
        },
      },
    )
    expect(output.exitCode).toBe(130)
    expect(f.calls.some((args) => args[0] === 'install')).toBe(false)
  })
  it('pins targets, uses Pi installation arguments and creates no first-install rollback', async () => {
    const f = await fixture()
    const output = await f.mutate({ operation: 'install', tool: 'pi' })
    expect(output.exitCode).toBe(0)
    expect(output.results[0]).toMatchObject({
      changed: true,
      targetVersion: '2.0.0',
      status: 'success',
    })
    expect(f.calls.find((args) => args[0] === 'install')).toContain(
      '@earendil-works/pi-coding-agent@2.0.0',
    )
    expect(f.calls.find((args) => args[0] === 'install')).toContain('--ignore-scripts')
    expect((await f.mutate({ operation: 'rollback', tool: 'pi' })).results[0]?.errorCode).toBe(
      'ROLLBACK_NOT_FOUND',
    )
  })
  it('supports A → B → C → rollback B → rollback C', async () => {
    const f = await fixture()
    for (const version of ['1.0.0', '2.0.0', '3.0.0'])
      expect((await f.mutate({ operation: 'install', tool: 'codex', version })).exitCode).toBe(0)
    const first = await f.mutate({ operation: 'rollback', tool: 'codex' })
    const second = await f.mutate({ operation: 'rollback', tool: 'codex' })
    expect(first.results[0]?.targetVersion).toBe('2.0.0')
    expect(second.results[0]?.targetVersion).toBe('3.0.0')
  })
  it('keeps rollback through same-version reinstall and failure after partial modification', async () => {
    const f = await fixture()
    for (const version of ['1.0.0', '2.0.0', '2.0.0'])
      await f.mutate({ operation: 'install', tool: 'gemini', version })
    f.config.failTool = 'gemini'
    const failure = await f.mutate({ operation: 'install', tool: 'gemini', version: '3.0.0' })
    expect(failure.results[0]).toMatchObject({
      errorCode: 'PERMISSION_DENIED',
      changed: true,
      installation: { packageVersion: '3.0.0' },
    })
    expect(await new HistoryStore(f.env, f.state).previous('gemini', tools.gemini.package)).toBe(
      '1.0.0',
    )
  })
  it('does not claim successful verification for wrong command output', async () => {
    const f = await fixture()
    f.config.mismatch = true
    const output = await f.mutate({ operation: 'install', tool: 'pi' })
    expect(output.results[0]?.errorCode).toBe('VERIFY_FAILED')
    await expect(
      new HistoryStore(f.env, f.state).previous('pi', tools.pi.package),
    ).rejects.toMatchObject({ code: 'ROLLBACK_NOT_FOUND' })
  })
  it('never installs missing tools implicitly or downgrades during upgrade', async () => {
    const f = await fixture()
    expect((await f.mutate({ operation: 'upgrade', tool: 'pi' })).results[0]?.status).toBe(
      'skipped',
    )
    await f.install('codex', '3.0.0')
    expect((await f.mutate({ operation: 'upgrade', tool: 'codex' })).results[0]?.status).toBe(
      'noop',
    )
    expect(
      (await f.mutate({ operation: 'downgrade', tool: 'codex', version: '3.0.0' })).results[0]
        ?.errorCode,
    ).toBe('NOT_A_DOWNGRADE')
    expect(f.calls.some((args) => args[0] === 'install')).toBe(false)
  })
  it('blocks nonexistent versions and known engine incompatibility', async () => {
    const f = await fixture()
    expect(
      (await f.mutate({ operation: 'install', tool: 'pi', version: '9.9.9' })).results[0]
        ?.errorCode,
    ).toBe('VERSION_NOT_FOUND')
    f.config.node = '>=26'
    expect((await f.mutate({ operation: 'install', tool: 'pi' })).results[0]?.errorCode).toBe(
      'ENV_UNSUPPORTED',
    )
    expect(f.calls.some((args) => args[0] === 'install')).toBe(false)
  })
  it('continues batch upgrades after a failure', async () => {
    const f = await fixture()
    for (const tool of ['claude', 'pi', 'gemini'] as const) await f.install(tool, '1.0.0')
    f.config.failTool = 'claude'
    const output = await f.mutate({ operation: 'upgrade', all: true })
    expect(output.exitCode).toBe(4)
    expect(output.results.map((item) => item.status)).toEqual([
      'failed',
      'skipped',
      'success',
      'success',
    ])
  })
  it('rechecks interruption and cancels unstarted batch entries', async () => {
    const f = await fixture()
    for (const tool of toolIds) await f.install(tool, '1.0.0')
    f.config.cancel = true
    const output = await f.mutate({ operation: 'upgrade', all: true })
    expect(output.exitCode).toBe(130)
    expect(output.results[0]?.installation?.packageVersion).toBe('2.0.0')
    expect(output.results.every((item) => item.status === 'cancelled')).toBe(true)
    expect(f.calls.filter((args) => args[0] === 'install')).toHaveLength(1)
  })
  it('uninstalls only its package and requires explicit installation afterwards', async () => {
    const f = await fixture()
    await f.mutate({ operation: 'install', tool: 'pi', version: '1.0.0' })
    await f.mutate({ operation: 'install', tool: 'pi', version: '2.0.0' })
    const credentials = join(f.directory, 'credentials.json')
    await writeFile(credentials, 'preserved')
    expect(
      (await f.mutate({ operation: 'uninstall', tool: 'pi' })).results[0]?.installation?.status,
    ).toBe('not-installed')
    expect(await readFile(credentials, 'utf8')).toBe('preserved')
    expect((await f.mutate({ operation: 'rollback', tool: 'pi' })).results[0]?.errorCode).toBe(
      'NOT_INSTALLED',
    )
  })
  it('separates history by environment and reports external updates', async () => {
    const f = await fixture()
    await f.mutate({ operation: 'install', tool: 'pi', version: '1.0.0' })
    await f.mutate({ operation: 'install', tool: 'pi', version: '2.0.0' })
    await f.install('pi', '3.0.0')
    expect(
      (await f.manager.read({ operation: 'list', tool: 'pi' })).results[0]?.warnings.join(),
    ).toContain('记录与实时版本不同')
    await expect(
      new HistoryStore({ ...f.env, id: 'another-environment' }, f.state).previous(
        'pi',
        tools.pi.package,
      ),
    ).rejects.toMatchObject({ code: 'ROLLBACK_NOT_FOUND' })
  })
  it('keeps listing available when history is corrupt', async () => {
    const f = await fixture()
    await f.install('pi', '1.0.0')
    await mkdir(f.state)
    await writeFile(join(f.state, `${f.env.id}.json`), '{broken')
    expect((await f.manager.read({ operation: 'list' })).exitCode).toBe(0)
    expect((await f.mutate({ operation: 'rollback', tool: 'pi' })).results[0]?.errorCode).toBe(
      'HISTORY_UNAVAILABLE',
    )
  })
  it('locks the same global directory across distinct Node environment identifiers', async () => {
    const f = await fixture()
    const release = await new HistoryStore(f.env, f.state).lock()
    try {
      await expect(
        new HistoryStore({ ...f.env, id: 'other-node' }, f.state).lock(),
      ).rejects.toMatchObject({ code: 'ENV_LOCKED' })
    } finally {
      await release()
    }
  })
})

describe('input and process boundaries', () => {
  it('keeps the canonical directory identity stable when first install creates a symlinked root', async () => {
    const f = await fixture()
    const real = join(f.directory, 'real')
    const alias = join(f.directory, 'alias')
    await mkdir(real)
    await symlink(real, alias, process.platform === 'win32' ? 'junction' : 'dir')
    const before = await canonical(join(alias, 'new-root'))
    await mkdir(join(real, 'new-root'))
    expect(await canonical(join(alias, 'new-root'))).toBe(before)
  })
  it('accepts exact prereleases and SemVer build metadata without converting to a range', () => {
    expect(exactVersion('1.2.3-beta.1+build.2')).toBe('1.2.3-beta.1+build.2')
  })
  it.each(['latest', '^1.0.0', 'v1.0.0', '1.0.0; echo secret', 'https://example.com/package.tgz'])(
    'rejects non-exact input %s',
    (value) => {
      expect(() => exactVersion(value)).toThrow(AppError)
    },
  )
  it('keeps unspecified compatibility unknown and supports negative platform lists', async () => {
    const f = await fixture()
    expect(compatibility({ version: '1.0.0' }, f.env)).toEqual({
      node: 'unknown',
      os: 'unknown',
      cpu: 'unknown',
    })
    expect(
      compatibility({ version: '1.0.0', os: ['!win32'], cpu: ['arm64'] }, f.env),
    ).toMatchObject({ os: 'incompatible', cpu: 'incompatible' })
  })
  it('parses known version formats without guessing ambiguous output', () => {
    expect(parseCommandVersion('2.1.301 (Claude Code)\n')).toBe('2.1.301')
    expect(parseCommandVersion('codex-cli 0.163.0')).toBe('0.163.0')
    expect(parseCommandVersion('1.3.0\n')).toBe('1.3.0')
    expect(parseCommandVersion('1.0.0 2.0.0')).toBeNull()
  })
  it('derives supported target pairs only from the official native package metadata', async () => {
    const f = await fixture()
    const metadata = {
      version: '0.163.0',
      optionalDependencies: { '@openai/codex-linux-x64': 'npm:@openai/codex@0.163.0-linux-x64' },
    }
    expect(compatibility(metadata, f.env)).toMatchObject({
      os: 'incompatible',
      cpu: 'incompatible',
    })
    expect(compatibility(metadata, { ...f.env, platform: 'linux' })).toMatchObject({
      os: 'compatible',
      cpu: 'compatible',
    })
    expect(
      compatibility(
        { version: '1.0.0', optionalDependencies: { '@unrelated/native-win32-x64': '1.0.0' } },
        f.env,
      ),
    ).toMatchObject({ os: 'unknown', cpu: 'unknown' })
  })
  it('redacts credentials and assigns stable npm error codes', () => {
    const raw =
      'E401 https://name:password@example.com/path?token=private _authToken=secret Authorization: Bearer private'
    expect(redact(raw)).not.toContain('password')
    expect(redact(raw)).not.toContain('private')
    expect(redact(raw)).not.toContain('secret')
    expect(npmError(raw).code).toBe('AUTH_ERROR')
  })
})
