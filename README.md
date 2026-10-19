# Agent CLI Manager

使用统一的中文菜单和命令，管理 Claude Code、Codex CLI、Pi coding agent 和 Gemini CLI 在当前 npm 全局环境中的版本。

需要 Node.js `^22.18.0 || ^24.0.0` 和可用的 npm。目标工具的 Node、系统和架构要求另外按目标版本检查；例如当前 Pi 要求 Node.js 22.19+，管理器可以运行不代表目标包一定兼容。

## 本地使用

项目尚未发布至 npm。使用 pnpm 11.15.1 开发和运行：

```powershell
pnpm install
pnpm build
node packages/cli/dist/cli.mjs
node packages/cli/dist/cli.mjs list
node packages/cli/dist/cli.mjs check --json
```

构建后的 CLI 以 `agent-cli-manager` 为 npm 包名发布，并提供同名命令。下文示例使用该命令名；本地可替换为 `node packages/cli/dist/cli.mjs`。

根包 `agent-cli-manager` 是私有开发工作区。`packages/core`（`@agent-cli-manager/core`）是私有内部包，提供环境检测、版本管理和操作编排逻辑；`packages/cli`（`agent-cli-manager`）调用 core，提供参数解析、菜单和结果输出。仅发布 CLI，构建时将 core 逻辑合并进 CLI 产物；用户安装时无需下载 core 包。

## 命令

| 命令                                   | 行为                                         |
| -------------------------------------- | -------------------------------------------- |
| 无参数                                 | 在交互终端进入菜单；非交互调用返回 2         |
| `list`                                 | 检测本地版本、路径及来源，不查询更新         |
| `doctor [tool]`                        | 展示 Node/npm、全局位置、来源及有效 registry |
| `check [tool]`                         | 查询指定工具或全部工具的稳定目标             |
| `versions <tool>`                      | 按新到旧展示稳定历史版本                     |
| `install <tool> [--version <version>]` | 安装稳定版或精确版本                         |
| `upgrade <tool>`                       | 升级已安装工具，不降级、不安装缺失工具       |
| `upgrade --all`                        | 串行升级可管理的已安装工具                   |
| `downgrade <tool> --version <version>` | 安装低于当前版本的精确版本                   |
| `rollback <tool>`                      | 重新下载安装上次成功替换前的版本             |
| `uninstall <tool>`                     | 仅卸载当前 npm 包，保留配置、凭据和会话      |

工具标识为 `claude`、`codex`、`pi`、`gemini`。`versions --include-prerelease` 显式包含预发布版本；`install --version` 也可以指定精确的预发布版本，不接受标签、范围、URL 或任意包名。

```powershell
agent-cli-manager install pi
agent-cli-manager install codex --version 0.163.0 --yes
agent-cli-manager upgrade --all --yes --json
agent-cli-manager rollback claude
```

`install pi` 在版本相同时不变更；`install pi --version <当前版本>` 执行修复性重装。`--yes` 跳过确认，仍然执行来源、版本及兼容性校验。非交互变更必须提供 `--yes`。

## npm 来源与安装边界

| 标识     | 官方 npm 包                       | 默认稳定标签 |
| -------- | --------------------------------- | ------------ |
| `claude` | `@anthropic-ai/claude-code`       | `stable`     |
| `codex`  | `@openai/codex`                   | `latest`     |
| `pi`     | `@earendil-works/pi-coding-agent` | `latest`     |
| `gemini` | `@google/gemini-cli`              | `latest`     |

Pi 的[当前官方说明](https://github.com/earendil-works/pi/tree/main/packages/coding-agent)要求 npm 安装使用 `--ignore-scripts`；该参数不会统一应用到其他工具。旧包 `@mariozechner/pi-coding-agent` 仅识别并提示手动处理，不自动迁移。

查询和安装使用同一 npm 的全局配置，继承有效 scoped registry、代理及认证。管理器不修改 `.npmrc`，不切换镜像、不安装 Node/npm、不提权，也不处理其他包管理渠道。

来源检测限于 PATH 和当前 npm 全局目录。Windows 中指向同一个包入口的包装文件归并为一份安装；其他来源、路径冲突、损坏或版本不一致会阻止该工具变更。无法安全验证的命令版本显示未知；shell 会话中的临时 alias/function 不属于 PATH 文件检测范围。

所有目标先解析成精确版本，再展示、执行和验证。缺少环境元数据时显示“未知”，不会声称兼容性已验证。安装失败或中断会重新检测；管理器不会假定失败意味着没有修改，也不会自动回滚。

## 回退与历史

历史只保存版本和必要环境信息，不保留多份 CLI。状态目录为：

- Windows：`%LOCALAPPDATA%\agent-cli-manager`
- macOS：`~/Library/Application Support/agent-cli-manager`
- Linux：`$XDG_STATE_HOME/agent-cli-manager`，默认 `~/.local/state/agent-cli-manager`

需要隔离记录时可设置 `AGENT_CLI_MANAGER_STATE_DIR`；验收脚本使用独立目录。并行运行的管理器应使用相同的状态目录，以共享全局环境锁。

环境标识包含 Node/npm 路径和 npm 全局目录；不同环境不共享回退目标。同一个全局目录通过跨进程锁串行变更。状态使用 JSON 原子替换，操作日志使用 NDJSON；不记录凭据或 npm 认证配置。

只有成功执行并验证后的版本替换才更新回退目标。首次安装不生成回退记录，同版本重装保留原目标，失败不会覆盖可信记录。A → B → C 后回退至 B，下一次可回退至 C。卸载后必须显式安装，不能使用 rollback 隐式恢复。

回退需要目标仍可下载且环境兼容。旧版本可能无法读取新配置或会话；原 CLI 的自带更新也可能再次改变版本。管理器不修改其更新设置。历史损坏时仍可查看实时状态，但回退不可用。

## JSON 与退出码

`--json` 禁止交互，标准输出只有一个最终 JSON 文档，包含：

```json
{
  "schemaVersion": 1,
  "operation": "check",
  "status": "success",
  "results": [],
  "environment": null,
  "errorCode": null,
  "message": "",
  "exitCode": 0
}
```

每项包含 `tool`、`status`、`currentVersion`（操作前的实际命令版本）、`targetVersion`、`changed`、`errorCode`、`message`、`installation`（操作后的实时状态）、`registry`、`compatibility`、`versions`、`updateAvailable` 和 `warnings`；不适用值为 `null`。

逐项状态为 `success`、`noop`、`skipped`、`blocked`、`failed`、`cancelled`；整体还可能为 `partial`。机器应使用字段和稳定错误码判断结果，无需解析中文消息。

| 退出码 | 含义                                 |
| ------ | ------------------------------------ |
| 0      | 成功或无需变更，发现更新也返回 0     |
| 1      | 执行或验证失败                       |
| 2      | 参数错误、缺少输入或非交互确认授权   |
| 3      | 来源冲突、环境不兼容等前置条件不满足 |
| 4      | 批量部分成功、部分失败或受阻         |
| 130    | 用户取消或中断                       |

## 开发与验收

```powershell
pnpm check
pnpm --filter @agent-cli-manager/example-basic start
pnpm acceptance
```

`pnpm check` 运行格式、lint、未使用代码检查、类型检查、测试和构建。自动测试使用受控 npm/文件系统验证错误与状态流转；CI 配置覆盖 Windows、Linux、macOS 的 Node 22/24。

`pnpm acceptance` 是显式执行的真实联网安装验收：复制 Node/npm 到临时运行目录，使用独立全局 prefix、状态目录和受控 PATH，对四个官方包逐个执行安装、重装、降级、升级、回退和卸载。记录输出到 `artifacts/acceptance-<platform>-<arch>.json`；临时环境保留用于排查，不改变日常工具安装。macOS/Linux 的受控 PATH 若仍发现系统目录中的其他来源，会按正常规则受阻。

真实验收也可以手动触发 GitHub Actions 的 **Real npm acceptance** 工作流。平台支持以实际验收证据为准，CI 配置本身不代表对应平台已验收。已完成 Windows x64、Node 24 的真实链路，详见[验收记录](docs/acceptance.md)；其他平台尚不声明已获支持。

## 发布

发布工作流默认启用：推送到 `main` 时，Changesets 自动维护版本 PR，或发布待发布的 `agent-cli-manager` CLI 包。通过 `pnpm changeset` 记录变更，合并版本 PR 后发布对应版本。根包、core 和示例均为私有包，不发布。

core 的行为变更也应为 `agent-cli-manager` 添加 Changeset，因为 core 实现随 CLI 一起交付。发布前须复查 npm 包名、工具映射和平台证据，并为 CLI 配置仓库信息及 npm Trusted Publisher。本项目使用 MIT 许可证。
