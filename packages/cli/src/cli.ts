#!/usr/bin/env node
import { Command, CommanderError } from 'commander'
import packageJson from '../package.json' with { type: 'json' }
import {
  detectEnvironment,
  Manager,
  type Request,
  exactVersion,
  AppError,
  asError,
  report,
  ProcessRunner,
  redact,
  parseTool,
} from '@agent-cli-manager/core'
import { confirmPlans, menu, printReport, showPlans } from './ui.js'

const json = process.argv.includes('--json')
const controller = new AbortController()
const interrupt = () => controller.abort()
process.on('SIGINT', interrupt)
process.on('SIGTERM', interrupt)
const runner = new ProcessRunner()
const program = new Command()
let operation = 'usage'
let controlOutput = ''

async function createManager(): Promise<Manager> {
  return new Manager(await detectEnvironment(runner), runner, controller.signal)
}

program
  .name('agent-cli-manager')
  .description('统一管理 Claude Code、Codex、Pi 和 Gemini CLI 的 npm 全局版本。')
  .enablePositionalOptions()
  .version(packageJson.version, '-V, --version', '显示管理器版本')
  .option('--json', '输出结构化 JSON，禁止交互')
  .option('-y, --yes', '跳过变更确认，仍执行全部前置校验')
  .helpOption('-h, --help', '显示帮助')
  .addHelpText(
    'after',
    '\n示例：\n  agent-cli-manager list\n  agent-cli-manager check --json\n  agent-cli-manager install pi --yes\n  agent-cli-manager install codex --version 0.163.0 --yes\n  agent-cli-manager upgrade --all --yes --json\n  agent-cli-manager rollback claude\n\n所有变更仅作用于当前 npm 全局环境。',
  )
  .exitOverride()
  .configureOutput({
    writeOut: (value) => {
      if (json) controlOutput += value
      else
        process.stdout.write(
          value
            .replace(/^Usage:/gm, '用法：')
            .replace(/^Options:/gm, '选项：')
            .replace(/^Commands:/gm, '命令：')
            .replace(/^Arguments:/gm, '参数：'),
        )
    },
    writeErr: (value) => {
      if (!json) process.stderr.write(redact(value))
    },
  })

program.hook('preAction', (_parent, command) => {
  operation = command.name()
})

function subcommand(name: string): Command {
  return program
    .command(name)
    .option('--json', '输出结构化 JSON，禁止交互')
    .option('-y, --yes', '跳过变更确认，仍执行全部前置校验')
    .helpOption('-h, --help', '显示帮助')
}

async function execute(request: Request, command: Command): Promise<void> {
  operation = request.operation
  if (request.version) exactVersion(request.version)
  const options = command.optsWithGlobals<{ yes?: boolean; json?: boolean }>()
  const manager = await createManager()
  const mutation = !['list', 'doctor', 'check', 'versions'].includes(request.operation)
  const output = mutation
    ? await manager.mutate(request, {
        yes: !!options.yes,
        interactive: !options.json && process.stdin.isTTY && process.stdout.isTTY,
        confirm: confirmPlans,
        preview: options.yes && !options.json ? showPlans : undefined,
      })
    : await manager.read(request)
  printReport(output, !!options.json)
  process.exitCode = output.exitCode
}

for (const [name, description] of [
  ['list', '查看本地状态，不查询更新'],
  ['doctor', '检查当前 Node/npm、安装来源和 registry'],
  ['check', '检查稳定更新'],
] as const) {
  const command = subcommand(name).description(description)
  if (name === 'list') command.action(async () => execute({ operation: name }, command))
  else
    command
      .argument('[tool]', 'claude、codex、pi 或 gemini')
      .action(async (tool?: string) =>
        execute({ operation: name, tool: tool ? parseTool(tool) : undefined }, command),
      )
}
const versions = subcommand('versions')
  .description('查询历史版本（默认只显示稳定版本）')
  .argument('<tool>', '工具标识')
  .option('--include-prerelease', '包含预发布版本')
versions.action(async (tool: string) =>
  execute(
    {
      operation: 'versions',
      tool: parseTool(tool),
      includePrerelease: !!versions.opts().includePrerelease,
    },
    versions,
  ),
)
for (const [name, description] of [
  ['install', '安装稳定版或精确版本'],
  ['downgrade', '降级到较低的精确版本'],
  ['rollback', '重新安装当前环境记录的上次版本'],
  ['uninstall', '仅卸载 npm 包，保留配置和会话'],
] as const) {
  const command = subcommand(name).description(description).argument('<tool>', '工具标识')
  if (name === 'install') command.option('--version <version>', '精确版本，同版本时修复性重装')
  if (name === 'downgrade')
    command.requiredOption('--version <version>', '低于当前版本的精确版本号')
  command.action(async (tool: string) =>
    execute(
      {
        operation: name,
        tool: parseTool(tool),
        version: command.opts<{ version?: string }>().version,
      },
      command,
    ),
  )
}
const upgrade = subcommand('upgrade')
  .description('升级已安装工具，不降级、不隐式安装')
  .argument('[tool]', '工具标识')
  .option('--all', '升级全部已安装工具')
upgrade.action(async (tool?: string) => {
  const all = !!upgrade.opts().all
  if ((!tool && !all) || (tool && all))
    throw new AppError(
      'INVALID_ARGUMENT',
      'upgrade 必须指定一个工具或 --all，两者不能同时使用。',
      2,
    )
  await execute({ operation: 'upgrade', tool: tool ? parseTool(tool) : undefined, all }, upgrade)
})
program.action(async () => {
  if (json || !process.stdin.isTTY || !process.stdout.isTTY) {
    if (!json) program.outputHelp()
    throw new AppError('INVALID_ARGUMENT', '非交互环境必须指定子命令；使用 --help 查看帮助。', 2)
  }
  await menu(createManager)
})

try {
  await program.parseAsync()
} catch (error) {
  if (
    error instanceof CommanderError &&
    ['commander.helpDisplayed', 'commander.version'].includes(error.code)
  ) {
    if (json)
      printReport(
        {
          ...report(error.code === 'commander.version' ? 'version' : 'help', []),
          message: controlOutput.trim(),
        },
        true,
      )
    process.exitCode = 0
  } else {
    const failure =
      error instanceof CommanderError
        ? new AppError('INVALID_ARGUMENT', '参数错误；请使用 --help 查看命令和必需参数。', 2)
        : asError(error)
    printReport(report(operation, [], null, failure), json)
    process.exitCode = failure.exitCode
  }
} finally {
  process.off('SIGINT', interrupt)
  process.off('SIGTERM', interrupt)
}
