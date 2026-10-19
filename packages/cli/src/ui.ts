/* eslint-disable no-await-in-loop -- Menu navigation is sequential user interaction. */
import { confirm, select, text, updateSettings } from '@clack/prompts'
import {
  AppError,
  type Report,
  type ToolResult,
  type ToolId,
  tools,
  exactVersion,
  type Manager,
  type Request,
  redact,
} from '@agent-cli-manager/core'
import { state, toolName } from './colors.js'
import { Loading, loadingMessage } from './loading.js'

updateSettings({ messages: { cancel: '已取消', error: '操作失败' } })

const labels: Record<string, string> = {
  success: '成功',
  noop: '无需变更',
  skipped: '已跳过',
  blocked: '受阻',
  failed: '失败',
  cancelled: '已取消',
  'not-installed': '未安装',
  managed: 'npm 可管理',
  external: '其他来源',
  conflict: '存在冲突',
  broken: '安装损坏',
  unknown: '未知',
}

function answer<T>(value: T): Exclude<T, symbol> {
  if (typeof value === 'symbol') throw new AppError('CANCELLED', '用户取消。', 130)
  // eslint-disable-next-line typescript/no-unsafe-type-assertion -- The symbol branch above is excluded at runtime; TypeScript cannot narrow this generic conditional type.
  return value as Exclude<T, symbol>
}

function shortMessage(message: string): string {
  return (
    redact(message)
      .trim()
      .split(/[\r\n]/, 1)[0] ?? ''
  ).replace(/\s+/g, ' ')
}

function resultState(item: ToolResult): string {
  return item.status === 'success' ? (item.installation?.status ?? 'success') : item.status
}

function versionText(item: ToolResult, mode: 'result' | 'check' | 'plan'): string {
  const installation = item.installation
  const current = installation ? installation.commandVersion : item.currentVersion
  let version = state(
    installation?.status === 'not-installed' ? '未安装' : (current ?? '版本未知'),
    installation?.status === 'not-installed'
      ? 'not-installed'
      : current
        ? resultState(item)
        : 'unknown',
  )
  if (mode === 'plan' && item.status === 'success')
    version += ` → ${state(item.targetVersion ?? '未安装', item.targetVersion ? 'success' : 'not-installed')}`
  else if (mode === 'check' && item.updateAvailable && item.targetVersion)
    version += ` → ${state(item.targetVersion, 'success')}`
  return version
}

function printTool(item: ToolResult, mode: 'result' | 'check' | 'plan' = 'result'): void {
  const installation = item.installation
  let issue = ''
  if (['blocked', 'failed', 'cancelled'].includes(item.status))
    issue = `${labels[item.status]}：${shortMessage(item.message) || item.errorCode || '操作未完成。'}`
  else if (installation && ['external', 'conflict', 'broken'].includes(installation.status))
    issue = `${labels[installation.status]}：${shortMessage(installation.message)}`
  console.log(
    `${toolName(item.tool)} ${versionText(item, mode)}${issue ? ` · ${state(issue, resultState(item))}` : ''}`,
  )
}

function printDoctor(report: Report): void {
  if (report.message) console.log(state(shortMessage(report.message), report.status))
  if (report.environment) {
    console.log(`Node ${report.environment.nodeVersion} · npm ${report.environment.npmVersion}`)
    console.log(`全局位置：${redact(report.environment.prefix)}`)
  }
  const registries = new Map<string, ToolId[]>()
  for (const item of report.results) {
    if (!item.registry) continue
    const registry = redact(item.registry)
    const group = registries.get(registry) ?? []
    group.push(item.tool)
    registries.set(registry, group)
  }
  for (const [registry, group] of registries) {
    const shared = group.length === report.results.length
    console.log(`registry：${registry}${shared ? '' : `（${group.map(toolName).join('、')}）`}`)
  }
  if (report.results.length && (report.environment || registries.size)) console.log('')
  for (const item of report.results) {
    const installation = item.installation
    const status = resultState(item)
    const label = status === 'managed' ? '正常' : labels[status]!
    console.log(
      `${toolName(item.tool)} ${versionText(item, 'result')}${status === 'not-installed' ? '' : ` · ${state(label, status)}`}`,
    )
    const failed = ['blocked', 'failed', 'cancelled'].includes(item.status)
    if (failed) {
      const reason = shortMessage(item.message) || item.errorCode || '诊断未完成。'
      const code = item.errorCode && !reason.includes(item.errorCode) ? `（${item.errorCode}）` : ''
      console.log(`  ${state(reason + code, item.status)}`)
    }
    if (installation && ['external', 'conflict', 'broken'].includes(installation.status)) {
      const reason = shortMessage(installation.message)
      if (reason && (!failed || reason !== shortMessage(item.message)))
        console.log(`  ${state(reason, installation.status)}`)
      if (installation.packageVersion !== installation.commandVersion)
        console.log(
          `  npm 包：${installation.packageVersion ?? '无'} · 命令：${installation.commandVersion ?? '未知'}`,
        )
      for (const path of new Set(installation.paths)) console.log(`  ${redact(path)}`)
    }
    for (const warning of new Set(item.warnings.map(shortMessage).filter(Boolean)))
      console.log(state(`  提示：${warning}`, 'unknown'))
  }
}

export function printReport(report: Report, json = false): void {
  if (json) {
    console.log(
      JSON.stringify(report, (_key, value: unknown) =>
        typeof value === 'string' ? redact(value) : value,
      ),
    )
    return
  }
  if (report.operation !== 'doctor') {
    if (report.message) console.log(state(shortMessage(report.message), report.status))
    for (const item of report.results) {
      if (report.operation === 'versions' && item.versions?.length)
        for (const version of item.versions) console.log(`${toolName(item.tool)} ${version}`)
      else printTool(item, report.operation === 'check' ? 'check' : 'result')
    }
    return
  }
  printDoctor(report)
}

export function showPlans(plans: ToolResult[]): void {
  console.log('\n变更计划：')
  for (const item of plans) printTool(item, 'plan')
}

export async function confirmPlans(plans: ToolResult[]): Promise<boolean> {
  showPlans(plans)
  return answer(
    await confirm({
      message: '确认执行以上可执行项目？',
      active: '确认',
      inactive: '取消',
      initialValue: false,
    }),
  )
}

async function chooseVersion(manager: Manager, tool: ToolId, loading: Loading): Promise<string> {
  const request: Request = { operation: 'versions', tool }
  const versions = await loading.run(loadingMessage(request), () => manager.read(request))
  const item = versions.results[0]!
  if (!item.versions) throw new AppError(item.errorCode ?? 'NETWORK_ERROR', item.message)
  let offset = 0
  while (true) {
    const value = answer(
      await select({
        message: '选择历史稳定版本（↑↓ 选择，回车确认；不保证当前环境可安装）',
        showInstructions: false,
        options: [
          ...item.versions
            .slice(offset, offset + 20)
            .map((version) => ({ value: version, label: version })),
          ...(offset + 20 < item.versions.length ? [{ value: ':next', label: '下一页' }] : []),
          ...(offset > 0 ? [{ value: ':previous', label: '上一页' }] : []),
          { value: ':input', label: '输入精确版本（包括预发布版本）' },
        ],
      }),
    )
    if (value === ':next') {
      offset += 20
      continue
    }
    if (value === ':previous') {
      offset -= 20
      continue
    }
    if (value === ':input')
      return exactVersion(
        answer(
          await text({
            message: '精确版本号',
            validate: (input) => {
              try {
                exactVersion(input ?? '')
                return undefined
              } catch {
                return '请输入精确 SemVer 版本号。'
              }
            },
          }),
        ),
      )
    return value
  }
}

export async function menu(
  createManager: () => Promise<Manager>,
  loading = new Loading(),
): Promise<void> {
  const initialManager = await createManager()
  const local = await loading.run('正在检测本地工具…', () =>
    initialManager.read({ operation: 'list' }),
  )
  printReport(local)
  if (local.exitCode === 130) throw new AppError('CANCELLED', '用户中断。', 130)
  while (true) {
    const action = answer(
      await select({
        message: '选择操作（↑↓ 选择，回车确认，Esc 取消）',
        showInstructions: false,
        options: [
          { value: 'check', label: '检查全部工具更新' },
          { value: 'upgrade-all', label: '批量升级已安装工具' },
          { value: 'install', label: '安装稳定版' },
          { value: 'install-version', label: '安装/重装指定版本' },
          { value: 'upgrade', label: '升级单个工具' },
          { value: 'downgrade', label: '降级至历史版本' },
          { value: 'rollback', label: '回退到上次版本' },
          { value: 'uninstall', label: '卸载 npm 包（保留用户数据）' },
          { value: 'doctor', label: '环境诊断' },
          { value: 'exit', label: '退出' },
        ],
      }),
    )
    if (action === 'exit') return
    const manager = await createManager()
    let request: Request
    if (action === 'check' || action === 'doctor') request = { operation: action }
    else if (action === 'upgrade-all') request = { operation: 'upgrade', all: true }
    else {
      const tool = answer(
        await select({
          message: '选择工具（↑↓ 选择，回车确认）',
          showInstructions: false,
          options: Object.values(tools).map((item) => ({
            value: item.id,
            label: toolName(item.id),
          })),
        }),
      )
      request =
        action === 'install-version' || action === 'downgrade'
          ? {
              operation: action === 'downgrade' ? 'downgrade' : 'install',
              tool,
              version: await chooseVersion(manager, tool, loading),
            }
          : { operation: action, tool }
    }
    const output = await loading.run(loadingMessage(request), () =>
      request.operation === 'check' || request.operation === 'doctor'
        ? manager.read(request)
        : manager.mutate(request, { yes: false, interactive: true, confirm: confirmPlans }),
    )
    printReport(output)
    if (output.exitCode === 130) throw new AppError('CANCELLED', '用户取消或中断。', 130)
  }
}
