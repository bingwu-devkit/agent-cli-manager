import { stripVTControlCharacters } from 'node:util'
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { AppError, Manager, report, type ToolResult } from '@agent-cli-manager/core'
import { menu, printReport, showPlans } from '../src/ui.js'

const prompts = vi.hoisted(() => ({
  confirm: vi.fn<typeof import('@clack/prompts').confirm>(),
  select: vi.fn<typeof import('@clack/prompts').select>(),
  text: vi.fn<typeof import('@clack/prompts').text>(),
  updateSettings: vi.fn<typeof import('@clack/prompts').updateSettings>(),
}))
vi.mock('@clack/prompts', () => prompts)

const environment = {
  id: 'test-environment',
  node: process.execPath,
  nodeVersion: '24.16.0',
  npmFile: process.execPath,
  npmArgs: [],
  npmVersion: '11.13.0',
  prefix: 'fixture-prefix',
  root: 'fixture-root',
  platform: 'win32',
  arch: 'x64',
  path: 'fixture-prefix',
}

function item(values: Partial<ToolResult> = {}): ToolResult {
  return {
    tool: 'codex',
    status: 'success',
    currentVersion: '0.163.0',
    targetVersion: null,
    changed: false,
    errorCode: null,
    message: '当前 npm 环境安装，版本和命令来源已匹配。',
    installation: {
      status: 'managed',
      packageVersion: '0.163.0',
      commandVersion: '0.163.0',
      commandPath: 'fixture-prefix/codex.cmd',
      paths: ['fixture-prefix/codex.cmd'],
      manageable: true,
      message: '当前 npm 环境安装，版本和命令来源已匹配。',
    },
    registry: 'https://registry.npmjs.org/',
    compatibility: { node: 'compatible', os: 'unknown', cpu: 'unknown' },
    versions: null,
    updateAvailable: null,
    warnings: ['部分环境约束未声明，兼容性未知。'],
    ...values,
  }
}

function installation(values: Partial<NonNullable<ToolResult['installation']>>) {
  return { ...item().installation!, ...values }
}

let output: MockInstance<typeof console.log>
beforeEach(() => {
  vi.stubEnv('FORCE_COLOR', '0')
  vi.stubEnv('NO_COLOR', undefined)
  vi.stubEnv('NODE_DISABLE_COLORS', undefined)
  output = vi.spyOn(console, 'log').mockImplementation(() => undefined)
})
function lines() {
  return output.mock.calls.map(([line]) => line)
}

describe('concise CLI output', () => {
  it('prints one line per tool without environment, paths or metadata', () => {
    printReport(
      report(
        'list',
        [
          item({ tool: 'claude', installation: installation({ commandVersion: '2.1.301' }) }),
          item(),
          item({ tool: 'pi', installation: installation({ commandVersion: '1.3.0' }) }),
          item({ tool: 'gemini', installation: installation({ commandVersion: '0.64.0' }) }),
        ],
        environment,
      ),
    )
    expect(lines()).toEqual([
      'Claude Code 2.1.301',
      'Codex CLI 0.163.0',
      'Pi coding agent 1.3.0',
      'Gemini CLI 0.64.0',
    ])
  })

  it.each([
    ['0.164.0', true, 'Codex CLI 0.163.0 → 0.164.0'],
    ['0.163.0', false, 'Codex CLI 0.163.0'],
    ['0.162.1', false, 'Codex CLI 0.163.0'],
  ] as const)(
    'shows an update arrow only for a higher target %s',
    (target, available, expected) => {
      printReport(report('check', [item({ targetVersion: target, updateAvailable: available })]))
      expect(lines()).toEqual([expected])
    },
  )

  it('shows only the installed version when upgrade needs no change', () => {
    printReport(
      report('upgrade', [
        item({
          tool: 'claude',
          status: 'noop',
          currentVersion: '2.1.301',
          targetVersion: '2.1.292',
          installation: installation({ commandVersion: '2.1.301' }),
        }),
      ]),
    )
    expect(lines()).toEqual(['Claude Code 2.1.301'])
  })

  it.each(['install', 'upgrade', 'downgrade', 'rollback'])(
    'shows the actual version after %s rather than the before version',
    (operation) => {
      printReport(
        report(operation, [
          item({
            currentVersion: '0.162.1',
            targetVersion: '0.163.0',
            changed: true,
          }),
        ]),
      )
      expect(lines()).toEqual(['Codex CLI 0.163.0'])
    },
  )

  it.each(['list', 'check', 'uninstall'])(
    'shows absent tools as uninstalled in %s',
    (operation) => {
      printReport(
        report(operation, [
          item({
            targetVersion: '0.164.0',
            installation: installation({
              status: 'not-installed',
              packageVersion: null,
              commandVersion: null,
            }),
          }),
        ]),
      )
      expect(lines()).toEqual(['Codex CLI 未安装'])
    },
  )

  it.each(['external', 'conflict', 'broken'] as const)(
    'keeps a one-line reason for a successful probe with %s installation',
    (status) => {
      printReport(
        report('list', [
          item({ installation: installation({ status, message: '需要手动处理。\n详细路径。' }) }),
        ]),
      )
      expect(lines()).toEqual([
        `Codex CLI 0.163.0 · ${status === 'external' ? '其他来源' : status === 'conflict' ? '存在冲突' : '安装损坏'}：需要手动处理。`,
      ])
    },
  )

  it('does not substitute a package, previous or target version for an unknown actual version', () => {
    printReport(
      report('upgrade', [
        item({
          status: 'failed',
          targetVersion: '0.164.0',
          message: '版本验证失败。',
          installation: installation({ commandVersion: null }),
        }),
      ]),
    )
    expect(lines()).toEqual(['Codex CLI 版本未知 · 失败：版本验证失败。'])
  })

  it('keeps the actual state and first error line after a failed change', () => {
    printReport(
      report('upgrade', [
        item({
          status: 'failed',
          currentVersion: '0.162.1',
          targetVersion: '0.163.0',
          changed: true,
          errorCode: 'PERMISSION_DENIED',
          message: '权限不足。\r\nnpm 原始错误\n重新检测详情。',
        }),
      ]),
    )
    expect(lines()).toEqual(['Codex CLI 0.163.0 · 失败：权限不足。'])
  })

  it('keeps top-level errors concise and redacted', () => {
    printReport(
      report(
        'list',
        [],
        null,
        new AppError('NETWORK_ERROR', '无法访问 https://user:secret@registry.example/\n详情。'),
      ),
    )
    expect(lines()).toEqual(['无法访问 https://[REDACTED]@registry.example/'])
  })

  it('keeps historical version queries useful without metadata', () => {
    printReport(report('versions', [item({ versions: ['0.163.0', '0.162.1'] })]))
    expect(lines()).toEqual(['Codex CLI 0.163.0', 'Codex CLI 0.162.1'])
  })

  it('shows concise plans and omits targets for items that will not change', () => {
    showPlans([
      item({ targetVersion: '0.164.0' }),
      item({ tool: 'claude', status: 'noop', targetVersion: '0.162.1' }),
      item({ tool: 'gemini' }),
    ])
    expect(lines()).toEqual([
      '\n变更计划：',
      'Codex CLI 0.163.0 → 0.164.0',
      'Claude Code 0.163.0',
      'Gemini CLI 0.163.0 → 未安装',
    ])
  })

  it('summarizes shared diagnostic information while preserving full structured JSON', () => {
    const diagnostic = report(
      'doctor',
      [item({ warnings: [] }), item({ tool: 'pi', warnings: [] })],
      environment,
    )
    printReport(diagnostic)
    expect(lines()).toEqual([
      'Node 24.16.0 · npm 11.13.0',
      '全局位置：fixture-prefix',
      'registry：https://registry.npmjs.org/',
      '',
      'Codex CLI 0.163.0 · 正常',
      'Pi coding agent 0.163.0 · 正常',
    ])
    output.mockClear()
    printReport(diagnostic, true)
    expect(output).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(lines()[0]))).toEqual(diagnostic)
  })

  it('attributes different registries to their tools without assigning a failed query to a group', () => {
    printReport(
      report(
        'doctor',
        [
          item({ tool: 'claude', warnings: [] }),
          item({ registry: 'https://user:secret@mirror.example/', warnings: [] }),
          item({ tool: 'pi', warnings: ['历史记录无法读取。'] }),
          item({
            tool: 'gemini',
            status: 'failed',
            errorCode: 'REGISTRY_INVALID',
            message: '当前 npm registry 地址无效。\n原始详情。',
            registry: null,
            warnings: [],
          }),
        ],
        environment,
      ),
    )
    expect(lines()).toContain(
      'registry：https://registry.npmjs.org/（Claude Code、Pi coding agent）',
    )
    expect(lines()).toContain('registry：https://[REDACTED]@mirror.example/（Codex CLI）')
    expect(lines()).toContain('Gemini CLI 0.163.0 · 失败')
    expect(lines()).toContain('  当前 npm registry 地址无效。（REGISTRY_INVALID）')
    expect(lines()).toContain('  提示：历史记录无法读取。')
    expect(lines().join('\n')).not.toContain('secret')
    expect(lines().join('\n')).not.toContain('fixture-prefix/codex.cmd')
  })

  it('retains conflicting versions and paths without reporting a successful probe as healthy', () => {
    printReport(
      report(
        'doctor',
        [
          item({
            installation: installation({
              status: 'conflict',
              packageVersion: '0.164.0',
              message: 'npm 包版本与实际 CLI 版本不一致。',
              paths: ['fixture-prefix/codex.cmd', 'other-prefix/codex.exe'],
            }),
            warnings: [],
          }),
        ],
        environment,
      ),
    )
    expect(lines()).toContain('Codex CLI 0.163.0 · 存在冲突')
    expect(lines()).toContain('  npm 包版本与实际 CLI 版本不一致。')
    expect(lines()).toContain('  npm 包：0.164.0 · 命令：0.163.0')
    expect(lines()).toContain('  fixture-prefix/codex.cmd')
    expect(lines()).toContain('  other-prefix/codex.exe')
    expect(lines().join('\n')).not.toContain('正常')
  })

  it('adds terminal colors without changing text, report data or forced-color JSON', () => {
    vi.stubEnv('FORCE_COLOR', '3')
    const structured = report('check', [
      item({ tool: 'claude', installation: installation({ commandVersion: '2.1.301' }) }),
      item({ targetVersion: '0.164.0', updateAvailable: true }),
      item({ tool: 'pi', status: 'failed', message: '权限不足。' }),
      item({
        tool: 'gemini',
        installation: installation({ status: 'not-installed', commandVersion: null }),
      }),
    ])
    const original = JSON.stringify(structured)
    printReport(structured)
    expect(lines().every((line) => String(line).includes('\u001b['))).toBe(true)
    expect(lines().map((line) => stripVTControlCharacters(String(line)))).toEqual([
      'Claude Code 2.1.301',
      'Codex CLI 0.163.0 → 0.164.0',
      'Pi coding agent 0.163.0 · 失败：权限不足。',
      'Gemini CLI 未安装',
    ])
    output.mockClear()
    printReport(structured, true)
    expect(lines()).toEqual([original])
    expect(JSON.stringify(structured)).toBe(original)
  })

  it('prints the initial list once and returns to the menu with only each operation result', async () => {
    const manager = new Manager(environment, {
      run: async () => {
        throw new Error('Unexpected process invocation')
      },
    })
    const read = vi
      .spyOn(manager, 'read')
      .mockResolvedValueOnce(report('list', [item()]))
      .mockResolvedValueOnce(
        report('check', [item({ targetVersion: '0.164.0', updateAvailable: true })]),
      )
    vi.spyOn(manager, 'mutate').mockResolvedValueOnce(
      report('upgrade', [
        item({ installation: installation({ commandVersion: '0.164.0' }), changed: true }),
      ]),
    )
    prompts.select
      .mockResolvedValueOnce('check')
      .mockResolvedValueOnce('upgrade-all')
      .mockResolvedValueOnce('exit')

    await menu(async () => manager)

    expect(read.mock.calls).toEqual([[{ operation: 'list' }], [{ operation: 'check' }]])
    expect(lines()).toEqual([
      'Codex CLI 0.163.0',
      'Codex CLI 0.163.0 → 0.164.0',
      'Codex CLI 0.164.0',
    ])
  })
})
