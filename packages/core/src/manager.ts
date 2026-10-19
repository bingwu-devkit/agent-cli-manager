/* eslint-disable no-await-in-loop -- Global npm mutations, confirmations, cancellation and recovery are deliberately serial. */
import { compare } from 'semver'
import {
  AppError,
  asError,
  report,
  result,
  toolIds,
  type Environment,
  type Operation,
  type Report,
  type ToolId,
  type ToolResult,
} from './model.js'
import { tools } from './tools.js'
import { inspect } from './environment.js'
import { Npm, compatibility, exactVersion } from './npm.js'
import { HistoryStore } from './history.js'
import { redact, type Runner } from './process.js'

export interface Request {
  operation: Operation
  tool?: ToolId | undefined
  all?: boolean | undefined
  version?: string | undefined
  includePrerelease?: boolean | undefined
}
export interface Execution {
  yes: boolean
  interactive: boolean
  confirm: (plans: ToolResult[], environment: Environment) => Promise<boolean>
  preview?: ((plans: ToolResult[], environment: Environment) => void) | undefined
}

export class Manager {
  private npm: Npm
  private history: HistoryStore
  constructor(
    private env: Environment,
    private runner: Runner,
    private signal?: AbortSignal,
    directory?: string,
  ) {
    this.npm = new Npm(env, runner, signal)
    this.history = new HistoryStore(env, directory)
  }

  private async local(id: ToolId): Promise<ToolResult> {
    const installation = await inspect(tools[id], this.env, this.runner)
    return result(id, {
      installation,
      currentVersion: installation.commandVersion,
      message: installation.message,
      warnings: await this.history.warnings(
        id,
        installation.commandVersion ?? installation.packageVersion,
      ),
    })
  }

  private failure(output: ToolResult, error: unknown): ToolResult {
    const failure = asError(error)
    return {
      ...output,
      status:
        failure.exitCode === 130 ? 'cancelled' : failure.exitCode === 3 ? 'blocked' : 'failed',
      errorCode: failure.code,
      message: redact(failure.message),
    }
  }

  async read(request: Request): Promise<Report> {
    const ids = request.tool ? [request.tool] : toolIds
    const results: ToolResult[] = []
    for (const id of ids) {
      let output = result(id)
      try {
        if (this.signal?.aborted) throw new AppError('CANCELLED', '操作已取消。', 130)
        output = await this.local(id)
        if (
          request.operation === 'check' ||
          request.operation === 'versions' ||
          request.operation === 'doctor'
        )
          output.registry = await this.npm.registry(tools[id])
        if (request.operation === 'versions') {
          output.versions = await this.npm.versions(tools[id], request.includePrerelease)
          output.message = `找到 ${output.versions.length} 个${request.includePrerelease ? '' : '稳定'}版本；可见不代表当前环境一定可安装。`
        } else if (request.operation === 'check') {
          const target = await this.npm.target(tools[id])
          output.targetVersion = target.version
          output.compatibility = compatibility(target, this.env)
          output.updateAvailable = output.currentVersion
            ? compare(target.version, output.currentVersion) > 0
            : null
          output.message = !output.currentVersion
            ? '当前命令版本未知；已查询稳定目标。'
            : output.updateAvailable
              ? '有稳定更新可用。'
              : '当前版本无需升级。'
        }
      } catch (error) {
        output = this.failure(output, error)
      }
      results.push(output)
      if (output.status === 'cancelled') break
    }
    return report(request.operation, results, this.env)
  }

  private async plan(id: ToolId, request: Request): Promise<ToolResult> {
    let output = result(id)
    try {
      output = await this.local(id)
      const installation = output.installation!
      const tool = tools[id]
      if (installation.status !== 'managed' && installation.status !== 'not-installed')
        throw new AppError(
          installation.status === 'conflict'
            ? 'PATH_CONFLICT'
            : installation.status === 'broken'
              ? 'INSTALL_BROKEN'
              : 'UNMANAGED_INSTALL',
          `${installation.message}\n已知路径：${installation.paths.join('、') || '无'}`,
          3,
        )
      if (installation.status === 'not-installed' && request.operation !== 'install') {
        if (request.operation === 'upgrade' || request.operation === 'uninstall')
          return { ...output, status: 'skipped', message: '未安装，已跳过；升级不会隐式安装。' }
        throw new AppError('NOT_INSTALLED', '当前环境未安装该工具，请先显式安装。', 3)
      }
      output.registry = await this.npm.registry(tool)
      if (request.operation === 'uninstall')
        return { ...output, message: '仅卸载当前 npm 包；保留配置、凭据及会话。' }
      let version = request.version
      if (request.operation === 'rollback') version = await this.history.previous(id, tool.package)
      const target = await this.npm.target(tool, version)
      output.targetVersion = target.version
      output.compatibility = compatibility(target, this.env)
      if (Object.values(output.compatibility).includes('incompatible'))
        throw new AppError(
          'ENV_UNSUPPORTED',
          `目标 ${target.version} 不支持当前 Node/操作系统/架构，请检查版本要求。`,
          3,
        )
      if (Object.values(output.compatibility).includes('unknown'))
        output.warnings.push('部分环境约束未声明，兼容性未知。')
      if (
        request.operation === 'downgrade' &&
        (!output.currentVersion || compare(target.version, output.currentVersion) >= 0)
      )
        throw new AppError(
          'NOT_A_DOWNGRADE',
          '降级目标必须低于当前版本；其他替换请使用 install --version。',
          3,
        )
      if (
        request.operation === 'upgrade' &&
        output.currentVersion &&
        compare(target.version, output.currentVersion) <= 0
      )
        return { ...output, status: 'noop', message: '当前版本等于或高于稳定目标，无需升级。' }
      if (
        target.version === output.currentVersion &&
        !(request.operation === 'install' && request.version)
      )
        return { ...output, status: 'noop', message: '目标版本与当前版本相同，无需变更。' }
      output.message =
        target.version === output.currentVersion
          ? '将修复性重装当前精确版本。'
          : `将${request.operation === 'rollback' ? '回退' : request.operation === 'downgrade' ? '降级' : request.operation === 'upgrade' ? '升级' : output.currentVersion ? '替换' : '安装'}为精确版本 ${target.version}。`
      if (output.currentVersion && compare(target.version, output.currentVersion) < 0)
        output.warnings.push('旧版本可能不兼容现有配置或会话；CLI 自带更新可能再次改变版本。')
      return output
    } catch (error) {
      return this.failure(output, error)
    }
  }

  async mutate(request: Request, execution: Execution): Promise<Report> {
    if (!execution.yes && !execution.interactive)
      return report(
        request.operation,
        [],
        this.env,
        new AppError(
          'CONFIRMATION_REQUIRED',
          '非交互变更必须提供 --yes；--json 不代表授权变更。',
          2,
        ),
      )
    if (request.version) exactVersion(request.version)
    let release: (() => Promise<void>) | undefined
    const results: ToolResult[] = []
    try {
      release = await this.history.lock()
      const ids = request.all ? toolIds : [request.tool!]
      for (const id of ids) results.push(await this.plan(id, request))
      const pending = results.filter((item) => item.status === 'success')
      if (pending.length) execution.preview?.(results, this.env)
      if (pending.length && !execution.yes && !(await execution.confirm(results, this.env))) {
        for (const item of pending) {
          item.status = 'cancelled'
          item.errorCode = 'CANCELLED'
          item.message = '用户取消，未执行变更。'
        }
        return report(request.operation, results, this.env)
      }
      for (const item of pending) {
        const index = results.indexOf(item)
        const before = item.installation!.packageVersion
        let attempted = false
        try {
          if (this.signal?.aborted)
            throw new AppError('CANCELLED', '用户中断，未执行后续变更。', 130)
          this.history.assertLock()
          const current = await inspect(tools[item.tool], this.env, this.runner)
          if (
            current.status !== item.installation!.status ||
            current.packageVersion !== before ||
            JSON.stringify(current.paths) !== JSON.stringify(item.installation!.paths)
          )
            throw new AppError('STATE_CHANGED', '确认后安装状态发生变化，请重新执行操作。', 3)
          attempted = true
          if (request.operation === 'uninstall') await this.npm.uninstall(tools[item.tool])
          else await this.npm.install(tools[item.tool], item.targetVersion!)
          const after = await inspect(tools[item.tool], this.env, this.runner)
          item.installation = after
          item.changed = true
          const verified =
            request.operation === 'uninstall'
              ? after.packageVersion === null &&
                (after.status === 'not-installed' || after.status === 'external')
              : after.manageable &&
                after.packageVersion === item.targetVersion &&
                after.commandVersion === item.targetVersion
          if (!verified)
            throw new AppError('VERIFY_FAILED', `执行后版本或命令来源验证失败：${after.message}`)
          item.status = 'success'
          item.message =
            request.operation === 'uninstall'
              ? `npm 包已卸载。${after.paths.length ? '仍存在其他来源命令，请查看路径。' : ''}配置、凭据及会话已保留。`
              : `已安装并验证 ${item.targetVersion}。`
        } catch (error) {
          results[index] = this.failure(item, error)
          if (attempted) {
            const after = await inspect(tools[item.tool], this.env, this.runner)
            const failed = results[index]
            if (!failed) throw new AppError('INTERNAL_ERROR', '操作结果缺失。')
            failed.installation = after
            failed.changed =
              item.changed ||
              after.packageVersion !== before ||
              after.commandVersion !== item.currentVersion ||
              after.status !== item.installation!.status
            failed.message += `\n重新检测：${after.message}（包版本 ${after.packageVersion ?? '无'}，命令版本 ${after.commandVersion ?? '未知'}）。请检查后重试或显式恢复。`
          }
        }
        try {
          await this.history.record(
            request.operation,
            tools[item.tool].package,
            before,
            results[index]!,
          )
        } catch {
          results[index]!.warnings.push(
            '历史记录无法更新；本次实际结果如上，未保证建立新的回退目标。',
          )
        }
        if (results[index]!.status === 'cancelled') {
          for (const rest of pending.slice(pending.indexOf(item) + 1))
            Object.assign(rest, {
              status: 'cancelled',
              errorCode: 'CANCELLED',
              message: '已中断，未执行。',
            })
          break
        }
      }
      return report(request.operation, results, this.env)
    } catch (error) {
      return report(request.operation, results, this.env, asError(error))
    } finally {
      await release?.().catch(() => undefined)
    }
  }
}
