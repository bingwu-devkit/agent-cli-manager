import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// 只读消费示例：从 workspace 包定位构建后的 CLI，不更改全局安装。
const packageFile = import.meta.resolve('agent-cli-manager/package.json')
const entry = fileURLToPath(new URL('./dist/cli.mjs', packageFile))
const result = spawnSync(process.execPath, [entry, '--version'], { encoding: 'utf8', shell: false })
if (result.error) throw result.error
process.stdout.write(result.stdout)
process.stderr.write(result.stderr)
process.exitCode = result.status ?? 1
