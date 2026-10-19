export const toolIds = ['claude', 'codex', 'pi', 'gemini'] as const
export type ToolId = (typeof toolIds)[number]
export type Operation =
  | 'list'
  | 'doctor'
  | 'check'
  | 'versions'
  | 'install'
  | 'upgrade'
  | 'downgrade'
  | 'rollback'
  | 'uninstall'
type Status = 'success' | 'noop' | 'skipped' | 'blocked' | 'failed' | 'cancelled'
type InstallationStatus = 'not-installed' | 'managed' | 'external' | 'conflict' | 'broken'

export interface Tool {
  id: ToolId
  name: string
  package: string
  command: string
  stableTag: string
  legacyPackages: string[]
  installArgs: string[]
}

export interface Environment {
  id: string
  node: string
  nodeVersion: string
  npmFile: string
  npmArgs: string[]
  npmVersion: string
  prefix: string
  root: string
  platform: string
  arch: string
  path: string
}

export interface Installation {
  status: InstallationStatus
  packageVersion: string | null
  commandVersion: string | null
  commandPath: string | null
  paths: string[]
  manageable: boolean
  message: string
}

export interface Compatibility {
  node: 'compatible' | 'incompatible' | 'unknown'
  os: 'compatible' | 'incompatible' | 'unknown'
  cpu: 'compatible' | 'incompatible' | 'unknown'
}

export interface ToolResult {
  tool: ToolId
  status: Status
  currentVersion: string | null
  targetVersion: string | null
  changed: boolean
  errorCode: string | null
  message: string
  installation: Installation | null
  registry: string | null
  compatibility: Compatibility | null
  versions: string[] | null
  updateAvailable: boolean | null
  warnings: string[]
}

export interface Report {
  schemaVersion: 1
  operation: string
  status: Status | 'partial'
  results: ToolResult[]
  environment: Omit<Environment, 'path' | 'npmArgs'> | null
  errorCode: string | null
  message: string
  exitCode: number
}

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public exitCode = 1,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export function asError(error: unknown): AppError {
  return error instanceof AppError
    ? error
    : new AppError('INTERNAL_ERROR', error instanceof Error ? error.message : String(error))
}

export function systemErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : undefined
}

export function result(tool: ToolId, values: Partial<ToolResult> = {}): ToolResult {
  return {
    tool,
    status: 'success',
    currentVersion: null,
    targetVersion: null,
    changed: false,
    errorCode: null,
    message: '',
    installation: null,
    registry: null,
    compatibility: null,
    versions: null,
    updateAvailable: null,
    warnings: [],
    ...values,
  }
}

export function report(
  operation: string,
  results: ToolResult[],
  env: Environment | null = null,
  error?: AppError,
): Report {
  const statuses = new Set(results.map((item) => item.status))
  const errors = results.filter((item) => ['failed', 'blocked', 'cancelled'].includes(item.status))
  let status: Report['status'] = 'success'
  let exitCode = 0
  if (error) {
    status = error.exitCode === 130 ? 'cancelled' : error.exitCode === 3 ? 'blocked' : 'failed'
    exitCode = error.exitCode
  } else if (statuses.has('cancelled')) {
    status = 'cancelled'
    exitCode = 130
  } else if (errors.length > 0) {
    status =
      errors.length < results.length ? 'partial' : statuses.has('failed') ? 'failed' : 'blocked'
    exitCode = status === 'partial' ? 4 : status === 'blocked' ? 3 : 1
  } else if (
    results.length > 0 &&
    results.every((item) => item.status === 'noop' || item.status === 'skipped')
  ) {
    status = 'noop'
  }
  const environment = env
    ? {
        id: env.id,
        node: env.node,
        nodeVersion: env.nodeVersion,
        npmFile: env.npmFile,
        npmVersion: env.npmVersion,
        prefix: env.prefix,
        root: env.root,
        platform: env.platform,
        arch: env.arch,
      }
    : null
  return {
    schemaVersion: 1,
    operation,
    status,
    results,
    environment,
    errorCode: error?.code ?? null,
    message: error?.message ?? '',
    exitCode,
  }
}
