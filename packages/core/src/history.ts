import { appendFile, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import lockfile from 'proper-lockfile'
import { z } from 'zod'
import {
  AppError,
  systemErrorCode,
  type Environment,
  type Operation,
  type ToolResult,
  type ToolId,
} from './model.js'
import { canonical, hash } from './environment.js'
import { redact } from './process.js'

const historySchema = z.object({
  schemaVersion: z.literal(1),
  environmentId: z.string(),
  tools: z.record(
    z.string(),
    z.object({
      package: z.string(),
      current: z.string(),
      previous: z.string().nullable(),
      at: z.string(),
    }),
  ),
})
type History = z.infer<typeof historySchema>

function stateDirectory(): string {
  if (process.env.AGENT_CLI_MANAGER_STATE_DIR)
    return resolve(process.env.AGENT_CLI_MANAGER_STATE_DIR)
  if (process.platform === 'win32')
    return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData/Local'), 'agent-cli-manager')
  if (process.platform === 'darwin')
    return join(homedir(), 'Library/Application Support/agent-cli-manager')
  return join(process.env.XDG_STATE_HOME ?? join(homedir(), '.local/state'), 'agent-cli-manager')
}

export class HistoryStore {
  private lockFailure: AppError | null = null
  constructor(
    private env: Environment,
    private directory = stateDirectory(),
  ) {}

  private get file(): string {
    return join(this.directory, `${this.env.id}.json`)
  }

  async load(): Promise<History> {
    try {
      const history = historySchema.parse(JSON.parse(await readFile(this.file, 'utf8')))
      if (history.environmentId !== this.env.id) throw new Error('环境标识不一致')
      return history
    } catch (error) {
      if (systemErrorCode(error) === 'ENOENT')
        return { schemaVersion: 1, environmentId: this.env.id, tools: {} }
      throw new AppError(
        'HISTORY_UNAVAILABLE',
        '本地历史记录损坏或无法读取；当前状态仍以实时检测为准，回退不可用。',
        3,
      )
    }
  }

  async previous(tool: ToolId, packageName: string): Promise<string> {
    const item = (await this.load()).tools[tool]
    if (!item || item.package !== packageName || !item.previous)
      throw new AppError(
        'ROLLBACK_NOT_FOUND',
        '当前 npm 环境没有可信回退目标；请使用 versions 查看历史版本，再显式安装。',
        3,
      )
    return item.previous
  }

  async warnings(tool: ToolId, currentVersion: string | null): Promise<string[]> {
    try {
      const known = (await this.load()).tools[tool]
      return known && known.current !== currentVersion
        ? ['记录与实时版本不同，工具可能已被外部命令或自带更新修改。']
        : []
    } catch (error) {
      return [redact(error instanceof Error ? error.message : String(error))]
    }
  }

  async record(
    operation: Operation,
    packageName: string,
    before: string | null,
    output: ToolResult,
  ): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const at = new Date().toISOString()
    await appendFile(
      join(this.directory, `${this.env.id}.ndjson`),
      JSON.stringify({
        schemaVersion: 1,
        environmentId: this.env.id,
        tool: output.tool,
        package: packageName,
        operation,
        beforeVersion: before,
        afterVersion: output.installation?.packageVersion ?? null,
        targetVersion: output.targetVersion,
        at,
        status: output.status,
        errorCode: output.errorCode,
      }) + '\n',
      { mode: 0o600 },
    )
    if (output.status !== 'success' || !output.changed) return
    const history = await this.load()
    if (operation === 'uninstall') delete history.tools[output.tool]
    else {
      const old = history.tools[output.tool]
      history.tools[output.tool] = {
        package: packageName,
        current: output.targetVersion!,
        previous:
          before && before !== output.targetVersion
            ? before
            : before
              ? (old?.previous ?? null)
              : null,
        at,
      }
    }
    const temporary = `${this.file}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, JSON.stringify(history, null, 2) + '\n', {
        mode: 0o600,
        flag: 'wx',
      })
      await rename(temporary, this.file)
    } finally {
      await unlink(temporary).catch(() => undefined)
    }
  }

  async lock(): Promise<() => Promise<void>> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    // All Node runtimes sharing the same global directories must share this lock.
    const key = hash(
      JSON.stringify(await Promise.all([canonical(this.env.prefix), canonical(this.env.root)])),
    )
    const path = join(this.directory, `global-${key}`)
    try {
      return await lockfile.lock(path, {
        realpath: false,
        stale: 30_000,
        update: 5000,
        retries: 0,
        onCompromised: () => {
          this.lockFailure = new AppError('ENV_LOCKED', '全局环境锁已失效，停止后续变更。', 3)
        },
      })
    } catch (error) {
      if (systemErrorCode(error) === 'ELOCKED')
        throw new AppError('ENV_LOCKED', '另一个管理器正在修改同一 npm 全局目录，请稍后重试。', 3)
      throw new AppError('HISTORY_UNAVAILABLE', '无法创建环境锁，请检查用户数据目录权限。', 3)
    }
  }

  assertLock(): void {
    if (this.lockFailure) throw this.lockFailure
  }
}
