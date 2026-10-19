import { styleText } from 'node:util'
import { tools, type ToolId } from '@agent-cli-manager/core'

type Color = 'orange' | 'cyan' | 'magenta' | 'blue' | 'green' | 'yellow' | 'red' | 'gray'

const toolColors: Record<ToolId, Color> = {
  claude: 'orange',
  codex: 'cyan',
  pi: 'magenta',
  gemini: 'blue',
}

const statusColors: Record<string, Color> = {
  success: 'green',
  noop: 'gray',
  skipped: 'gray',
  blocked: 'yellow',
  failed: 'red',
  cancelled: 'gray',
  'not-installed': 'gray',
  managed: 'green',
  external: 'yellow',
  conflict: 'yellow',
  broken: 'red',
  compatible: 'green',
  incompatible: 'red',
  unknown: 'yellow',
  partial: 'yellow',
}

function color(value: string, shade: Color): string {
  if (shade !== 'orange') return styleText(shade, value)
  const fallback = styleText('yellow', value)
  if (fallback === value) return value
  // Node 22 supports named colors; emit orange only when the terminal supports richer colors.
  const depth =
    process.stdout.getColorDepth?.() ??
    (process.env.FORCE_COLOR === '3' ? 24 : process.env.FORCE_COLOR === '2' ? 8 : 4)
  if (depth < 8) return fallback
  const code = depth >= 24 ? '38;2;217;119;87' : '38;5;173'
  return `\u001b[${code}m${value}\u001b[39m`
}

export function toolName(tool: ToolId): string {
  return color(tools[tool].name, toolColors[tool])
}

export function state(value: string, status: string): string {
  return color(value, statusColors[status] ?? 'gray')
}
