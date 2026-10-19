import { describe, expect, it } from 'vitest'
import { ProcessRunner } from '../src/process.js'

describe('real process boundaries', () => {
  it('passes metacharacters as data without a shell', async () => {
    const output = await new ProcessRunner().run(process.execPath, [
      '-e',
      'console.log(process.argv[1])',
      'value; & $(echo secret)',
    ])
    expect(output.code).toBe(0)
    expect(output.stdout.trim()).toBe('value; & $(echo secret)')
  })
  it('terminates a child on timeout', async () => {
    await expect(
      new ProcessRunner().run(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        timeout: 100,
      }),
    ).rejects.toMatchObject({ code: 'PROCESS_TIMEOUT' })
  })
  it('terminates a child on cancellation', async () => {
    const controller = new AbortController()
    const pending = new ProcessRunner().run(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)'],
      { signal: controller.signal },
    )
    setTimeout(() => controller.abort(), 100)
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED', exitCode: 130 })
  })
  it('reports a missing executable', async () => {
    await expect(
      new ProcessRunner().run('agent-manager-definitely-missing-command', []),
    ).rejects.toMatchObject({ code: 'EXECUTABLE_NOT_FOUND' })
  })
})
