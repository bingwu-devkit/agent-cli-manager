import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Loading } from '../src/loading.js'

function terminal(isTTY = true) {
  const output = Object.assign(new PassThrough(), { isTTY })
  let text = ''
  output.on('data', (chunk: Buffer) => {
    text += chunk.toString('utf8')
  })
  return { output, text: () => text }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv('FORCE_COLOR', '0')
  vi.stubEnv('NO_COLOR', undefined)
  vi.stubEnv('NODE_DISABLE_COLORS', undefined)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('loading lifecycle', () => {
  it('animates elapsed time and current tool, then clears without an extra result line', async () => {
    const target = terminal()
    const loading = new Loading({ output: target.output })
    const work = Promise.withResolvers<string>()
    const signalListeners = process.listenerCount('SIGINT')
    const raw = process.stdin.isRaw
    const result = loading.run('正在检测 Node/npm 环境…', () => work.promise)
    expect(target.text()).toContain('正在检测 Node/npm 环境… 0s')
    await vi.advanceTimersByTimeAsync(1200)
    expect(target.text()).toContain('正在检测 Node/npm 环境… 1s')
    loading.progress({ operation: 'check', phase: 'query', tool: 'codex' })
    expect(target.text()).toContain('正在检查更新 Codex CLI… 1s')
    loading.progress({ operation: 'check', phase: 'query', tool: 'pi' })
    expect(target.text()).toContain('正在检查更新 Pi coding agent… 1s')
    expect(process.listenerCount('SIGINT')).toBe(signalListeners)
    expect(process.stdin.isRaw).toBe(raw)
    work.resolve('done')
    await expect(result).resolves.toBe('done')
    expect(vi.getTimerCount()).toBe(0)
    expect(target.text().endsWith('\u001b[?25h')).toBe(true)
    expect(target.text()).not.toContain('\n')
  })

  it('pauses before confirmation and resumes only when work starts again', async () => {
    const target = terminal()
    const loading = new Loading({ output: target.output })
    const work = Promise.withResolvers<void>()
    const result = loading.run('正在准备变更计划…', () => work.promise)
    loading.progress({ operation: 'upgrade', phase: 'idle' })
    expect(vi.getTimerCount()).toBe(0)
    const paused = target.text()
    await vi.advanceTimersByTimeAsync(5000)
    expect(target.text()).toBe(paused)
    loading.progress({ operation: 'upgrade', phase: 'execute', tool: 'claude' })
    expect(target.text()).toContain('正在升级 Claude Code… 0s')
    expect(vi.getTimerCount()).toBe(1)
    work.resolve()
    await result
    expect(vi.getTimerCount()).toBe(0)
  })

  it('restores the cursor and stops timers before propagating failures', async () => {
    const target = terminal()
    const loading = new Loading({ output: target.output })
    const failure = new Error('fixture failure')
    await expect(
      loading.run('正在检查更新…', async () => {
        throw failure
      }),
    ).rejects.toBe(failure)
    expect(vi.getTimerCount()).toBe(0)
    expect(target.text().endsWith('\u001b[?25h')).toBe(true)
  })

  it('clears immediately on abort without taking over cancellation or restarting during recovery', async () => {
    const target = terminal()
    const controller = new AbortController()
    const loading = new Loading({ output: target.output, signal: controller.signal })
    const work = Promise.withResolvers<void>()
    const result = loading.run('正在升级…', () => work.promise)
    controller.abort()
    const cancelled = target.text()
    expect(cancelled.endsWith('\u001b[?25h')).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    loading.progress({ operation: 'upgrade', phase: 'recover', tool: 'pi' })
    await vi.advanceTimersByTimeAsync(1000)
    expect(target.text()).toBe(cancelled)
    work.resolve()
    await result
    expect(target.text()).toBe(cancelled)
  })

  it.each([
    { json: true, isTTY: true },
    { json: false, isTTY: false },
  ])('never writes loading for %j even with forced colors', async ({ json, isTTY }) => {
    vi.stubEnv('FORCE_COLOR', '3')
    const target = terminal(isTTY)
    const loading = new Loading({ json, output: target.output })
    await loading.run('正在检测…', async () => {
      loading.progress({ operation: 'check', phase: 'query', tool: 'claude' })
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(target.text()).toBe('')
    expect(vi.getTimerCount()).toBe(0)
  })
})
