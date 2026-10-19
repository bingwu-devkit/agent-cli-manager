import { clearLine, cursorTo } from 'node:readline'
import { type Progress, type Request } from '@agent-cli-manager/core'
import { state, toolName } from './colors.js'

interface Output extends NodeJS.WritableStream {
  isTTY?: boolean
}

interface Options {
  json?: boolean
  signal?: AbortSignal
  output?: Output
}

const actions: Record<Request['operation'], string> = {
  list: '检测本地状态',
  doctor: '诊断环境',
  check: '检查更新',
  versions: '查询历史版本',
  install: '安装',
  upgrade: '升级',
  downgrade: '降级',
  rollback: '回退',
  uninstall: '卸载',
}
const phases: Record<Exclude<Progress['phase'], 'idle'>, string> = {
  detect: '检测本地状态',
  query: '查询',
  lock: '等待全局环境锁',
  plan: '准备变更计划',
  execute: '执行变更',
  verify: '验证安装状态',
  recover: '复查安装状态',
  save: '保存操作记录',
}
const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export function loadingMessage(request: Request): string {
  return `正在${actions[request.operation]}${request.tool ? ` ${toolName(request.tool)}` : ''}…`
}

export class Loading {
  private output: Output
  private timer: ReturnType<typeof setInterval> | undefined
  private started = 0
  private frame = 0
  private message = ''
  private running = false

  constructor(private options: Options = {}) {
    this.output = options.output ?? process.stdout
  }

  progress = (progress: Progress): void => {
    if (!this.running) return
    if (progress.phase === 'idle') {
      this.clear()
      return
    }
    const action =
      progress.phase === 'execute' || progress.phase === 'query'
        ? actions[progress.operation]
        : phases[progress.phase]
    this.show(`正在${action}${progress.tool ? ` ${toolName(progress.tool)}` : ''}…`)
  }

  async run<T>(message: string, task: () => Promise<T>): Promise<T> {
    this.running = true
    const abort = () => this.clear()
    this.options.signal?.addEventListener('abort', abort, { once: true })
    try {
      this.show(message)
      return await task()
    } finally {
      this.running = false
      this.options.signal?.removeEventListener('abort', abort)
      this.clear()
    }
  }

  private show(message: string): void {
    if (this.options.json || !this.output.isTTY || this.options.signal?.aborted) return
    this.message = message
    if (!this.timer) {
      this.started = Date.now()
      this.frame = 0
      this.output.write('\u001b[?25l')
      this.timer = setInterval(() => this.render(), 80)
      this.timer.unref()
    }
    this.render()
  }

  private render(): void {
    const elapsed = Math.floor((Date.now() - this.started) / 1000)
    cursorTo(this.output, 0)
    clearLine(this.output, 0)
    this.output.write(
      `${state(frames[this.frame++ % frames.length]!, 'unknown')} ${this.message} ${state(`${elapsed}s`, 'noop')}`,
    )
  }

  private clear(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = undefined
    cursorTo(this.output, 0)
    clearLine(this.output, 0)
    this.output.write('\u001b[?25h')
  }
}
