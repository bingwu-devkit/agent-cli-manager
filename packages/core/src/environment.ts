/* eslint-disable no-await-in-loop -- Preserve PATH precedence while checking a small ordered set of candidates. */
import { access, readFile, realpath, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, delimiter, dirname, extname, join, normalize, resolve } from 'node:path'
import { valid } from 'semver'
import { z } from 'zod'
import {
  AppError,
  systemErrorCode,
  type Environment,
  type Installation,
  type Tool,
} from './model.js'
import { type Runner, redact, npmError } from './process.js'

export function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
export async function canonical(path: string): Promise<string> {
  const absolute = resolve(path)
  const resolved = await realpath(absolute).catch(async () => {
    const parent = dirname(absolute)
    return parent === absolute ? absolute : join(await canonical(parent), basename(absolute))
  })
  return process.platform === 'win32' ? normalize(resolved).toLowerCase() : normalize(resolved)
}
async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  )
}

const packageSchema = z.object({
  name: z.string(),
  version: z.string(),
  bin: z.union([z.string(), z.record(z.string(), z.string())]).optional(),
})
async function readPackage(path: string): Promise<z.infer<typeof packageSchema> | null> {
  let content: string
  try {
    content = await readFile(join(path, 'package.json'), 'utf8')
  } catch (error) {
    if (systemErrorCode(error) === 'ENOENT') return null
    throw new AppError('PACKAGE_UNREADABLE', `无法读取包信息：${path}`)
  }
  const parsed = packageSchema.safeParse(JSON.parse(content))
  if (!parsed.success) throw new AppError('PACKAGE_INVALID', `包元数据损坏：${path}`)
  return parsed.data
}

async function findCommands(
  command: string,
  pathValue = process.env.PATH ?? '',
  platform: string = process.platform,
): Promise<string[]> {
  const extensions = platform === 'win32' ? ['.ps1', '.exe', '.com', '.cmd', '.bat', ''] : ['']
  const found: string[] = []
  const seen = new Set<string>()
  for (const directory of pathValue.split(platform === 'win32' ? ';' : delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = resolve(directory.replace(/^"|"$/g, ''), command + extension)
      try {
        if (!(await stat(candidate)).isFile()) continue
        await access(candidate, platform === 'win32' ? constants.F_OK : constants.X_OK)
        const key = platform === 'win32' ? candidate.toLowerCase() : candidate
        if (!seen.has(key)) {
          seen.add(key)
          found.push(candidate)
        }
      } catch {
        /* PATH entries can be missing or inaccessible. */
      }
    }
  }
  return found
}

export async function detectEnvironment(runner: Runner): Promise<Environment> {
  const candidates = await findCommands('npm')
  const npmPath = candidates[0]
  if (!npmPath)
    throw new AppError('NPM_NOT_FOUND', '未找到 npm，请安装受支持的 Node.js/npm，并检查 PATH。', 3)
  const resolved = await realpath(npmPath).catch(() => npmPath)
  const cliCandidates = [join(dirname(npmPath), 'node_modules/npm/bin/npm-cli.js'), resolved]
  const cli = (
    await Promise.all(
      cliCandidates.map(async (path) =>
        path.endsWith('npm-cli.js') && (await exists(path)) ? path : null,
      ),
    )
  ).find(Boolean)
  let npmFile: string
  let npmArgs: string[]
  let node = process.execPath
  if (cli) {
    const adjacentNode = join(dirname(npmPath), process.platform === 'win32' ? 'node.exe' : 'node')
    if (await exists(adjacentNode)) node = adjacentNode
    npmFile = node
    npmArgs = [cli]
  } else if (extname(npmPath).toLowerCase() === '.exe') {
    npmFile = npmPath
    npmArgs = []
  } else
    throw new AppError(
      'NPM_UNSUPPORTED',
      `无法安全解析 npm 入口：${npmPath}。请使用标准 Node.js/npm 安装。`,
      3,
    )
  const run = async (args: string[]) => {
    const output = await runner.run(npmFile, [...npmArgs, ...args], { timeout: 30_000 })
    if (output.code !== 0) throw npmError(output.stderr + output.stdout)
    return output.stdout.trim()
  }
  const [npmVersion, prefix, root, nodeInfo] = await Promise.all([
    run(['--version']),
    run(['prefix', '--global']),
    run(['root', '--global']),
    runner.run(node, [
      '-p',
      'JSON.stringify({version:process.versions.node,platform:process.platform,arch:process.arch})',
    ]),
  ])
  if (nodeInfo.code !== 0)
    throw new AppError('NODE_NOT_FOUND', '无法验证 npm 使用的 Node.js 运行时。', 3)
  const runtime = z
    .object({ version: z.string(), platform: z.string(), arch: z.string() })
    .parse(JSON.parse(nodeInfo.stdout))
  const id = hash(
    JSON.stringify(
      await Promise.all([
        canonical(node),
        canonical(cli ?? npmFile),
        canonical(prefix),
        canonical(root),
      ]),
    ),
  )
  return {
    id,
    node,
    nodeVersion: runtime.version,
    npmFile,
    npmArgs,
    npmVersion,
    prefix,
    root,
    platform: runtime.platform,
    arch: runtime.arch,
    path: process.env.PATH ?? '',
  }
}

export function parseCommandVersion(value: string): string | null {
  const clean = value.replace(new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g'), '').trim()
  const matches = clean.match(
    /(?:^|\s)v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)(?=\s|$|\))/g,
  )
  const versions = [
    ...new Set(
      (matches ?? []).map((item) => item.trim().replace(/^v/, '')).filter((item) => valid(item)),
    ),
  ]
  return versions.length === 1 ? (versions[0] ?? null) : null
}

export async function inspect(tool: Tool, env: Environment, runner: Runner): Promise<Installation> {
  const paths = await findCommands(tool.command, env.path, env.platform)
  const packagePath = join(env.root, tool.package)
  let actualVersion: string | null = null
  const first = paths[0]
  if (first && (env.platform !== 'win32' || /\.(?:exe|com)$/i.test(first))) {
    try {
      const probe = await runner.run(first, ['--version'], { timeout: 15_000 })
      if (probe.code === 0) actualVersion = parseCommandVersion(probe.stdout)
    } catch {
      /* Unknown sources remain unmanageable even if probing fails. */
    }
  }
  let pkg: Awaited<ReturnType<typeof readPackage>>
  try {
    pkg = await readPackage(packagePath)
  } catch (error) {
    return {
      status: 'broken',
      packageVersion: null,
      commandVersion: null,
      commandPath: paths[0] ?? null,
      paths,
      manageable: false,
      message: redact(error instanceof Error ? error.message : String(error)),
    }
  }
  const base = {
    packageVersion: pkg?.version ?? null,
    commandVersion: actualVersion,
    commandPath: paths[0] ?? null,
    paths,
    manageable: false,
  }
  const legacy = (
    await Promise.all(
      tool.legacyPackages.map(async (name) =>
        (await exists(join(env.root, name, 'package.json'))) ? name : null,
      ),
    )
  ).filter(Boolean)
  if (!pkg && paths.length === 0 && legacy.length === 0)
    return { ...base, status: 'not-installed', message: '未安装。' }
  if (!pkg)
    return {
      ...base,
      status: 'external',
      message: `检测到其他来源或旧包${legacy.length ? `（${legacy.join('、')}）` : ''}；请手动处理后重试。`,
    }
  if (pkg.name !== tool.package || !valid(pkg.version))
    return { ...base, status: 'broken', message: '包名或版本元数据无法验证。' }
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.[tool.command]
  if (!bin || !(await exists(join(packagePath, bin))))
    return { ...base, status: 'broken', message: '包入口缺失或安装损坏。' }
  if (paths.length === 0)
    return {
      ...base,
      status: 'broken',
      message: '包已安装，但 PATH 无法解析命令；请手动检查全局 bin 目录。',
    }
  const entry = await canonical(join(packagePath, bin))
  const identities: string[] = []
  const binDirectory = env.platform === 'win32' ? env.prefix : join(env.prefix, 'bin')
  for (const path of paths) {
    let matches = (await canonical(path)) === entry
    if (
      !matches &&
      env.platform === 'win32' &&
      (await canonical(dirname(path))) === (await canonical(binDirectory))
    ) {
      const wrapper = await readFile(path, 'utf8').catch(() => '')
      const normalized = wrapper.replaceAll('\\', '/').toLowerCase()
      const expected = `node_modules/${tool.package}/${bin}`.replaceAll('\\', '/').toLowerCase()
      matches = normalized.includes(expected)
    }
    identities.push(matches ? entry : await canonical(path))
  }
  const unique = new Set(identities)
  if (legacy.length || unique.size > 1)
    return { ...base, status: 'conflict', message: '存在多个命令来源或旧包；请手动处理冲突路径。' }
  if (!unique.has(entry))
    return { ...base, status: 'external', message: '实际命令未指向当前 npm 包，请手动检查 PATH。' }
  let commandVersion: string | null = null
  try {
    // Resolve the PATH launcher to its verified package entry; never execute an unknown wrapper.
    const native = /\.(?:exe|com)$/i.test(bin)
    const probe = await runner.run(
      native ? join(packagePath, bin) : env.node,
      native ? ['--version'] : [join(packagePath, bin), '--version'],
      { timeout: 15_000 },
    )
    if (probe.code === 0) commandVersion = parseCommandVersion(probe.stdout)
  } catch {
    /* A broken CLI must not prevent listing the other tools. */
  }
  if (!commandVersion)
    return { ...base, status: 'broken', message: 'CLI 版本查询失败或输出无法验证。' }
  if (commandVersion !== pkg.version)
    return {
      ...base,
      commandVersion,
      status: 'conflict',
      message: 'npm 包版本与实际 CLI 版本不一致。',
    }
  return {
    ...base,
    commandVersion,
    status: 'managed',
    manageable: true,
    message: '当前 npm 环境安装，版本和命令来源已匹配。',
  }
}
