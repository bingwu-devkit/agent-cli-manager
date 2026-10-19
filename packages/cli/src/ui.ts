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
  compatible: '满足已声明约束',
  incompatible: '不兼容',
  unknown: '未知',
}

function answer<T>(value: T): Exclude<T, symbol> {
  if (typeof value === 'symbol') throw new AppError('CANCELLED', '用户取消。', 130)
  // eslint-disable-next-line typescript/no-unsafe-type-assertion -- The symbol branch above is excluded at runtime; TypeScript cannot narrow this generic conditional type.
  return value as Exclude<T, symbol>
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
  if (report.message) console.log(redact(report.message))
  if (report.environment)
    console.log(
      `Node ${report.environment.nodeVersion} · npm ${report.environment.npmVersion}\n全局位置：${report.environment.prefix}`,
    )
  for (const item of report.results) {
    console.log(
      `\n${tools[item.tool].name} [${labels[item.status]}] ${item.currentVersion ?? '未知/未安装'}${item.targetVersion ? ` → ${item.targetVersion}` : ''}`,
    )
    console.log(redact(item.message))
    if (item.errorCode) console.log(`错误码：${item.errorCode}`)
    if (item.installation) {
      console.log(
        `安装状态：${labels[item.installation.status]} · 可管理：${item.installation.manageable ? '是' : '否'} · npm 包：${item.installation.packageVersion ?? '无'} · 命令：${item.installation.commandVersion ?? '未知'}`,
      )
      for (const path of item.installation.paths) console.log(`  ${path}`)
    }
    if (item.registry) console.log(`registry：${item.registry}`)
    if (item.compatibility)
      console.log(
        `环境约束：Node=${labels[item.compatibility.node]} 系统=${labels[item.compatibility.os]} 架构=${labels[item.compatibility.cpu]}`,
      )
    if (item.versions) console.log(item.versions.join('\n'))
    for (const warning of item.warnings) console.log(`提示：${redact(warning)}`)
  }
}

export function showPlans(
  plans: ToolResult[],
  environment?: { prefix: string; root: string },
): void {
  console.log('\n变更计划：')
  if (environment) console.log(`全局位置：${environment.prefix}\n全局包目录：${environment.root}`)
  for (const item of plans) {
    console.log(
      redact(
        `${tools[item.tool].name}（${tools[item.tool].package}）：${item.currentVersion ?? '未安装'} → ${item.targetVersion ?? (item.status === 'success' ? '卸载' : '不执行')} [${labels[item.status]}]\n${item.message}\nregistry：${item.registry ?? '未查询'}`,
      ),
    )
    for (const warning of item.warnings) console.log(`提示：${redact(warning)}`)
  }
}

export async function confirmPlans(
  plans: ToolResult[],
  environment?: { prefix: string; root: string },
): Promise<boolean> {
  showPlans(plans, environment)
  return answer(
    await confirm({
      message: '确认执行以上可执行项目？',
      active: '确认',
      inactive: '取消',
      initialValue: false,
    }),
  )
}

async function chooseVersion(manager: Manager, tool: ToolId): Promise<string> {
  const versions = await manager.read({ operation: 'versions', tool })
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

export async function menu(createManager: () => Promise<Manager>): Promise<void> {
  while (true) {
    const manager = await createManager()
    const local = await manager.read({ operation: 'list' })
    printReport(local)
    if (local.exitCode === 130) throw new AppError('CANCELLED', '用户中断。', 130)
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
    let request: Request
    if (action === 'check' || action === 'doctor') request = { operation: action }
    else if (action === 'upgrade-all') request = { operation: 'upgrade', all: true }
    else {
      const tool = answer(
        await select({
          message: '选择工具（↑↓ 选择，回车确认）',
          showInstructions: false,
          options: Object.values(tools).map((item) => ({ value: item.id, label: item.name })),
        }),
      )
      request =
        action === 'install-version' || action === 'downgrade'
          ? {
              operation: action === 'downgrade' ? 'downgrade' : 'install',
              tool,
              version: await chooseVersion(manager, tool),
            }
          : { operation: action, tool }
    }
    const output =
      request.operation === 'check' || request.operation === 'doctor'
        ? await manager.read(request)
        : await manager.mutate(request, { yes: false, interactive: true, confirm: confirmPlans })
    printReport(output)
    if (output.exitCode === 130) throw new AppError('CANCELLED', '用户取消或中断。', 130)
  }
}
