import { prerelease, rcompare, satisfies, valid, validRange } from 'semver'
import { z } from 'zod'
import { AppError, type Compatibility, type Environment, type Tool } from './model.js'
import { npmError, redact, type Runner } from './process.js'

const metadataSchema = z.object({
  version: z.string(),
  engines: z.object({ node: z.string().optional() }).optional(),
  os: z.array(z.string()).optional(),
  cpu: z.array(z.string()).optional(),
  optionalDependencies: z.record(z.string(), z.string()).optional(),
})
export type Metadata = z.infer<typeof metadataSchema>

function compatibleList(values: string[] | undefined, current: string): Compatibility['os'] {
  if (!values?.length) return 'unknown'
  if (values.includes(`!${current}`)) return 'incompatible'
  const positive = values.filter((value) => !value.startsWith('!'))
  return positive.length === 0 || positive.includes(current) || positive.includes('any')
    ? 'compatible'
    : 'incompatible'
}

export function compatibility(metadata: Metadata, env: Environment): Compatibility {
  const range = metadata.engines?.node
  // Official native package names encode the target pairs for these precise releases.
  const nativeTargets = Object.keys(metadata.optionalDependencies ?? {}).flatMap((name) => {
    const match =
      /^@(?:anthropic-ai\/claude-code|openai\/codex)-(linux|darwin|win32)-(x64|arm64)(?:-musl)?$/.exec(
        name,
      )
    return match ? [{ os: match[1], cpu: match[2] }] : []
  })
  let os = compatibleList(metadata.os, env.platform)
  let cpu = compatibleList(metadata.cpu, env.arch)
  if (nativeTargets.length) {
    if (os === 'unknown')
      os = nativeTargets.some((target) => target.os === env.platform)
        ? 'compatible'
        : 'incompatible'
    if (cpu === 'unknown')
      cpu = nativeTargets.some((target) => target.os === env.platform && target.cpu === env.arch)
        ? 'compatible'
        : 'incompatible'
  }
  return {
    node:
      range && validRange(range)
        ? satisfies(env.nodeVersion, range)
          ? 'compatible'
          : 'incompatible'
        : 'unknown',
    os,
    cpu,
  }
}

export function exactVersion(input: string): string {
  if (!valid(input) || !/^\d/.test(input) || input.trim() !== input)
    throw new AppError(
      'INVALID_VERSION',
      '版本必须是精确 SemVer（例如 1.2.3 或 1.2.3-beta.1），不能使用范围、标签或 URL。',
      2,
    )
  return input
}

export class Npm {
  constructor(
    private env: Environment,
    private runner: Runner,
    private signal?: AbortSignal,
  ) {}

  async run(args: string[], mutation = false): Promise<string> {
    const output = await this.runner.run(this.env.npmFile, [...this.env.npmArgs, ...args], {
      signal: this.signal,
      timeout: mutation ? 15 * 60_000 : 60_000,
    })
    if (output.code !== 0) throw npmError(output.stderr + '\n' + output.stdout)
    return output.stdout.trim()
  }

  private async query(args: string[]): Promise<unknown> {
    const output = await this.run(['view', '--global', ...args, '--json'])
    try {
      return JSON.parse(output)
    } catch {
      throw new AppError('REGISTRY_INVALID', '当前 registry 返回的数据不是有效 JSON。')
    }
  }

  async registry(tool: Tool): Promise<string> {
    const scope = tool.package.split('/')[0]
    const scoped = await this.run(['config', 'get', `${scope}:registry`, '--global'])
    const registry =
      !scoped || scoped === 'undefined' || scoped === 'null'
        ? await this.run(['config', 'get', 'registry', '--global'])
        : scoped
    try {
      const url = new URL(registry)
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error()
      return redact(registry)
    } catch {
      throw new AppError('REGISTRY_INVALID', '当前 npm registry 地址无效。', 3)
    }
  }

  async target(tool: Tool, version?: string): Promise<Metadata> {
    let exact = version ? exactVersion(version) : null
    if (!exact) {
      const tags = z
        .record(z.string(), z.string())
        .safeParse(await this.query([tool.package, 'dist-tags']))
      const tagged = tags.success ? tags.data[tool.stableTag] : null
      if (!tagged || !valid(tagged) || prerelease(tagged))
        throw new AppError(
          'STABLE_TAG_INVALID',
          `${tool.package} 的 ${tool.stableTag} 标签缺失或不是稳定版本；不会猜测替代版本。`,
        )
      exact = tagged
    }
    const parsed = metadataSchema.safeParse(
      await this.query([
        `${tool.package}@${exact}`,
        'version',
        'engines',
        'os',
        'cpu',
        'optionalDependencies',
      ]),
    )
    if (!parsed.success || parsed.data.version !== exact)
      throw new AppError('REGISTRY_INVALID', '目标版本元数据无效或与精确目标不一致。')
    return parsed.data
  }

  async versions(tool: Tool, includePrerelease = false): Promise<string[]> {
    const raw = await this.query([tool.package, 'versions'])
    const parsed = z.union([z.string(), z.array(z.string())]).safeParse(raw)
    if (!parsed.success) throw new AppError('REGISTRY_INVALID', 'registry 版本列表格式无效。')
    const versions = typeof parsed.data === 'string' ? [parsed.data] : parsed.data
    return [
      ...new Set(
        versions.filter((version) => valid(version) && (includePrerelease || !prerelease(version))),
      ),
    ].toSorted(rcompare)
  }

  async install(tool: Tool, version: string): Promise<void> {
    await this.run(
      [
        'install',
        '--global',
        `${tool.package}@${exactVersion(version)}`,
        ...tool.installArgs,
        '--no-fund',
        '--no-audit',
        '--loglevel=error',
      ],
      true,
    )
  }

  async uninstall(tool: Tool): Promise<void> {
    await this.run(
      ['uninstall', '--global', tool.package, '--no-fund', '--no-audit', '--loglevel=error'],
      true,
    )
  }
}
