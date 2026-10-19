# CLI 进阶参考

[返回快速上手](../README.md)

## 版本与交互规则

- 无参数时在交互终端进入菜单；非交互调用必须指定子命令，否则返回退出码 2。
- `versions <tool>` 默认按新到旧列出稳定版本；添加 `--include-prerelease` 可包含预发布版本。
- `install <tool>` 安装稳定版本，版本相同时不变更；显式指定 `--version <当前版本>` 则执行修复性重装。
- `install --version` 接受精确版本（含预发布版本），不接受标签、范围、URL 或任意包名。
- `upgrade <tool>` 只升级已安装工具，不降级、不安装缺失工具；`upgrade --all` 串行处理可管理的已安装工具。
- `--yes` 跳过确认，仍执行来源、版本及兼容性校验；非交互变更必须提供该参数。
- `--json` 禁止交互，本身不授权变更；脚本中执行变更时需同时提供 `--yes`。

## 诊断

`doctor [tool]` 展示 Node/npm、全局位置、安装来源及有效 registry。检测到异常时显示原因、相关路径及包与命令版号差异；完整数据可通过 `doctor --json` 查看。

“正常”表示本地安装与命令匹配；registry 展示的是配置地址。

## npm 来源与安装边界

| 标识     | 官方 npm 包                       | 默认稳定标签 |
| -------- | --------------------------------- | ------------ |
| `claude` | `@anthropic-ai/claude-code`       | `latest`     |
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

需要隔离记录时可设置 `AGENT_CLI_MANAGER_STATE_DIR`。并行运行的管理器应使用相同的状态目录，以共享全局环境锁。

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
