import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const entry = fileURLToPath(new URL('../dist/cli.mjs', import.meta.url))
function cli(args: string[], env?: NodeJS.ProcessEnv) {
  const child = spawnSync(process.execPath, [entry, ...args], {
    encoding: 'utf8',
    shell: false,
    env: env ?? process.env,
    timeout: 15_000,
  })
  if (child.error) throw child.error
  return { code: child.status, stdout: child.stdout, stderr: child.stderr }
}

describe('CLI package command contract', () => {
  it.each([
    [[], 2, 'INVALID_ARGUMENT'],
    [['upgrade'], 2, 'INVALID_ARGUMENT'],
    [['upgrade', 'pi', '--all'], 2, 'INVALID_ARGUMENT'],
    [['install', 'unknown'], 2, 'INVALID_ARGUMENT'],
    [['downgrade', 'pi'], 2, 'INVALID_ARGUMENT'],
    [['install', 'pi', '--version', 'invalid', '--yes'], 2, 'INVALID_VERSION'],
    [['downgrade', 'pi', '--version', '^1.0.0', '--yes'], 2, 'INVALID_VERSION'],
    [['--not-an-option'], 2, 'INVALID_ARGUMENT'],
  ] as const)('returns a single JSON document for arguments %j', (args, code, errorCode) => {
    const output = cli([...args, '--json'])
    expect(output.code).toBe(code)
    expect(JSON.parse(output.stdout)).toMatchObject({ schemaVersion: 1, errorCode, exitCode: code })
    expect(output.stderr).toBe('')
  })
  it('handles missing npm without invoking a shell or blocking', () => {
    const output = cli(['list', '--json'], { ...process.env, PATH: '' })
    expect(output.code).toBe(3)
    expect(JSON.parse(output.stdout)).toMatchObject({ errorCode: 'NPM_NOT_FOUND', exitCode: 3 })
  })
  it('provides text and JSON help/version without npm', () => {
    const env = { ...process.env, PATH: '' }
    expect(cli(['--version'], env).stdout.trim()).toBe('0.1.0')
    expect(cli(['--help'], env).stdout).toContain('统一管理')
    expect(JSON.parse(cli(['--version', '--json'], env).stdout)).toMatchObject({
      operation: 'version',
      message: '0.1.0',
      exitCode: 0,
    })
    expect(JSON.parse(cli(['--help', '--json'], env).stdout)).toMatchObject({
      operation: 'help',
      exitCode: 0,
    })
  })
})
