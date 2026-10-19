# Agent CLI Manager

通过中文交互菜单或命令行，统一管理 **Claude Code、Codex CLI、Pi coding agent 和 Gemini CLI** 在当前 npm 全局环境中的版本。

## 快速上手

需要 Node.js `^22.18.0 || ^24.0.0` 和 npm；各工具目标版本的兼容性会另外检查。

```sh
npm install -g agent-cli-manager
agent-cli-manager
```

运行后按菜单提示查看、安装或更新工具。也可免全局安装临时使用：

```sh
npx agent-cli-manager@latest
```

更新管理器自身：`npm install -g agent-cli-manager@latest`。

## 命令

工具标识 `<tool>`：`claude`、`codex`、`pi`、`gemini`。`[tool]` 表示可选，省略时检查全部工具。

以下命令均以 `agent-cli-manager` 开头：

| 命令                                   | 说明                               |
| -------------------------------------- | ---------------------------------- |
| 无参数                                 | 打开交互菜单                       |
| `list`                                 | 查看本地版本，不查询更新           |
| `doctor [tool]`                        | 诊断 Node/npm、安装来源和 registry |
| `check [tool]`                         | 检查稳定版本更新                   |
| `versions <tool>`                      | 列出稳定历史版本                   |
| `install <tool> [--version <version>]` | 安装稳定版或指定精确版本           |
| `upgrade <tool>`                       | 升级指定的已安装工具               |
| `upgrade --all`                        | 升级全部可管理的已安装工具         |
| `downgrade <tool> --version <version>` | 降级到指定的较低版本               |
| `rollback <tool>`                      | 恢复上次成功替换前的版本           |
| `uninstall <tool>`                     | 卸载工具，保留配置、凭据和会话     |

## 常见用法

```sh
# 查看本地状态并检查更新
agent-cli-manager list
agent-cli-manager check

# 安装工具或升级全部已安装工具
agent-cli-manager install pi
agent-cli-manager upgrade --all

# 查询历史版本，再安装所需版本（以下版本号仅作示例）
agent-cli-manager versions codex
agent-cli-manager install codex --version 0.163.0

# 回退或排查安装问题
agent-cli-manager rollback claude
agent-cli-manager doctor claude

# 在脚本中跳过确认并获取 JSON 结果
agent-cli-manager upgrade --all --yes --json
```

常用选项：

| 选项                   | 说明                                              |
| ---------------------- | ------------------------------------------------- |
| `-h, --help`           | 查看帮助，例如 `agent-cli-manager install --help` |
| `-V, --version`        | 查看管理器版本                                    |
| `-y, --yes`            | 跳过变更确认，仍执行校验；非交互变更时必需        |
| `--json`               | 输出 JSON 并禁止交互；执行变更仍需 `--yes`        |
| `--include-prerelease` | 用于 `versions`，同时列出预发布版本               |

## 使用须知

- 仅管理当前 npm 全局环境，继承 npm 的 registry、代理和认证配置。其他安装来源或路径冲突会阻止相关变更。
- `upgrade` 用于更新所管理的工具，仅升级已安装版本，不降级或安装缺失工具。
- 回退需要当前环境的可信历史记录及可下载的目标版本，不提供多版本并存；旧版本可能无法读取新配置或会话。
- 已完成 Windows x64、Node 24 的真实链路验证；其他平台尚未声明已获支持。

版本规则、npm 来源、状态目录、JSON 字段及退出码见 [CLI 进阶参考](docs/cli-reference.md)。

许可证：MIT。
