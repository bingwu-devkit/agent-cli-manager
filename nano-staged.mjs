import { extname, join } from 'node:path'

const lintExtensions = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx'])
const formatExtensions = new Set([...lintExtensions, '.json', '.jsonc', '.md', '.yaml', '.yml'])
const repositoryRoot = import.meta.dirname

function quote(value) {
  return `"${value}"`
}

function createCommands(filenames, { command, configName, extensions }) {
  const files = filenames.filter((file) => extensions.has(extname(file)))

  if (files.length === 0) return []

  const config = join(repositoryRoot, configName)
  const prefix = `${command} -c ${quote(config)}`
  const commands = []
  let current = prefix
  // Windows 的 .cmd 包装入口有命令行长度限制，为包装和转义预留空间。
  for (const file of files) {
    const argument = ` ${quote(file)}`
    if (current.length + argument.length > 2000 && current !== prefix) {
      commands.push(current)
      current = prefix
    }
    current += argument
  }
  commands.push(current)
  return commands
}

// Knip evaluates this config without a staged-file list.
export default ({ filenames = [] } = {}) => [
  ...createCommands(filenames, {
    command: 'oxlint --fix --no-error-on-unmatched-pattern',
    configName: 'oxlint.config.ts',
    extensions: lintExtensions,
  }),
  ...createCommands(filenames, {
    command: 'oxfmt --write --disable-nested-config --no-error-on-unmatched-pattern',
    configName: 'oxfmt.config.ts',
    extensions: formatExtensions,
  }),
]
