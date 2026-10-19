import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { AppError } from './model.js'

export interface ProcessResult {
  code: number
  stdout: string
  stderr: string
}
export interface RunOptions {
  signal?: AbortSignal | undefined
  timeout?: number
  env?: NodeJS.ProcessEnv
  cwd?: string
}
export interface Runner {
  run(file: string, args: string[], options?: RunOptions): Promise<ProcessResult>
}

export function redact(value: string): string {
  return value
    .replace(/(https?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, '$1[REDACTED]@')
    .replace(/([?&](?:token|auth|key|password|secret|signature)[^=\s]*=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(
      /((?:_authToken|_auth|password|authorization|npm_token|access_token)\s*[=:]\s*)(?:Bearer\s+)?[^\s,;]+/gi,
      '$1[REDACTED]',
    )
    .replace(/\bnpm_[A-Za-z0-9]{20,}\b/g, '[REDACTED]')
}

export class ProcessRunner implements Runner {
  run(file: string, args: string[], options: RunOptions = {}): Promise<ProcessResult> {
    if (options.signal?.aborted)
      return Promise.reject(new AppError('CANCELLED', '操作已中断。', 130))
    return new Promise((resolve, reject) => {
      const child = spawn(file, args, {
        shell: false,
        detached: process.platform !== 'win32',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        ...(options.env ? { env: options.env } : {}),
        ...(options.cwd ? { cwd: options.cwd } : {}),
      })
      let stdout = ''
      let stderr = ''
      let stopReason: AppError | undefined
      let forceTimer: ReturnType<typeof setTimeout> | undefined
      const stop = (reason: AppError) => {
        if (stopReason) return
        stopReason = reason
        if (process.platform === 'win32' && child.pid) {
          const killer = spawn(
            join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'),
            ['/pid', String(child.pid), '/T', '/F'],
            { shell: false, windowsHide: true, stdio: 'ignore' },
          )
          killer.on('error', () => child.kill())
          killer.on('close', (code) => {
            if (code !== 0) child.kill()
          })
        } else if (child.pid) {
          const pid = child.pid
          try {
            process.kill(-pid, 'SIGTERM')
          } catch {
            child.kill('SIGTERM')
          }
          forceTimer = setTimeout(() => {
            try {
              process.kill(-pid, 'SIGKILL')
            } catch {
              /* Already stopped. */
            }
          }, 2000)
          forceTimer.unref()
        }
      }
      const cancel = () => stop(new AppError('CANCELLED', '操作已中断，已重新检测安装状态。', 130))
      options.signal?.addEventListener('abort', cancel, { once: true })
      const timer = setTimeout(
        () => stop(new AppError('PROCESS_TIMEOUT', '命令执行超时；请检查网络或工具状态。')),
        options.timeout ?? 60_000,
      )
      const collect = (current: string, data: Buffer) => {
        if (current.length + data.length > 8 * 1024 * 1024) {
          stop(new AppError('OUTPUT_TOO_LARGE', '命令输出超过安全上限。'))
          return current
        }
        return current + data.toString('utf8')
      }
      child.stdout.on('data', (data: Buffer) => {
        stdout = collect(stdout, data)
      })
      child.stderr.on('data', (data: Buffer) => {
        stderr = collect(stderr, data)
      })
      const cleanup = () => {
        clearTimeout(timer)
        clearTimeout(forceTimer)
        options.signal?.removeEventListener('abort', cancel)
      }
      child.on('error', (error) => {
        cleanup()
        reject(
          new AppError(
            (error as NodeJS.ErrnoException).code === 'ENOENT'
              ? 'EXECUTABLE_NOT_FOUND'
              : 'PROCESS_ERROR',
            redact(error.message),
          ),
        )
      })
      child.on('close', (code) => {
        cleanup()
        if (stopReason) reject(stopReason)
        else resolve({ code: code ?? 1, stdout, stderr })
      })
    })
  }
}

export function npmError(output: string): AppError {
  const message = redact(output).slice(0, 4000)
  if (/EACCES|EPERM|permission denied/i.test(output))
    return new AppError(
      'PERMISSION_DENIED',
      `npm 权限不足，请检查全局目录权限，不会自动提权。\n${message}`,
    )
  if (/E401|E403|ENEEDAUTH/i.test(output))
    return new AppError(
      'AUTH_ERROR',
      `当前 registry 认证失败，请检查 npm 登录及访问权限。\n${message}`,
    )
  if (/E404|ETARGET|No matching version/i.test(output))
    return new AppError('VERSION_NOT_FOUND', `包或版本不存在，请使用 versions 查询。\n${message}`)
  if (/ENOTFOUND|ECONN|ETIMEDOUT|EAI_AGAIN|FETCH_ERROR|CERT_|UNABLE_TO_VERIFY/i.test(output))
    return new AppError(
      'NETWORK_ERROR',
      `无法访问当前 registry，请检查网络、代理和证书。\n${message}`,
    )
  if (/EBADENGINE|EBADPLATFORM/i.test(output))
    return new AppError('ENV_UNSUPPORTED', `目标包不支持当前环境。\n${message}`, 3)
  return new AppError('NPM_FAILED', `npm 执行失败，安装状态可能已经改变。\n${message}`)
}
