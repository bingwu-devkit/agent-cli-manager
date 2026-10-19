import { AppError, type Tool, type ToolId, toolIds } from './model.js'

export const tools: Record<ToolId, Tool> = {
  claude: {
    id: 'claude',
    name: 'Claude Code',
    package: '@anthropic-ai/claude-code',
    command: 'claude',
    stableTag: 'latest',
    legacyPackages: [],
    installArgs: [],
  },
  codex: {
    id: 'codex',
    name: 'Codex CLI',
    package: '@openai/codex',
    command: 'codex',
    stableTag: 'latest',
    legacyPackages: [],
    installArgs: [],
  },
  pi: {
    id: 'pi',
    name: 'Pi coding agent',
    package: '@earendil-works/pi-coding-agent',
    command: 'pi',
    stableTag: 'latest',
    legacyPackages: ['@mariozechner/pi-coding-agent'],
    installArgs: ['--ignore-scripts'],
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini CLI',
    package: '@google/gemini-cli',
    command: 'gemini',
    stableTag: 'latest',
    legacyPackages: [],
    installArgs: [],
  },
}

export function parseTool(value: string): ToolId {
  const id = toolIds.find((item) => item === value)
  if (!id)
    throw new AppError('INVALID_ARGUMENT', `未知工具 ${value}；可选：${toolIds.join('、')}。`, 2)
  return id
}
