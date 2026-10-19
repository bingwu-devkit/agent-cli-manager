# Agent CLI Manager

CLI 以 `agent-cli-manager` 为 npm 包名发布，提供同名命令。源码通过私有内部包 `@agent-cli-manager/core` 调用环境检测、版本管理和操作编排逻辑；core 实现随 CLI 一起打包，不单独发布。

统一管理 Claude Code、Codex CLI、Pi coding agent 和 Gemini CLI 在当前 npm 全局环境中的版本。需要 Node.js `^22.18.0 || ^24.0.0` 和 npm；各目标版本的兼容性另行检查。

```sh
agent-cli-manager
agent-cli-manager list
agent-cli-manager check --json
agent-cli-manager install pi
agent-cli-manager upgrade --all --yes --json
agent-cli-manager versions codex
agent-cli-manager rollback claude
```

工具标识：`claude`、`codex`、`pi`、`gemini`。支持 `install --version <精确版本>`、`downgrade --version <精确版本>`、`uninstall` 和 `doctor`。`--yes` 跳过确认，仍执行来源和环境校验；非交互变更必须提供该参数。

只管理当前 npm 全局目录，继承 npm registry、代理和认证。检测到其他安装来源或路径冲突时停止相关变更，不修改 PATH、不提权、不迁移旧 Pi 包。卸载保留配置、凭据和会话。回退依赖本地可信记录和可下载的历史版本，不提供多版本并存。

`--json` 输出 schemaVersion 1 的单一结果文档；退出码为 0（成功/无需变更）、1（失败）、2（参数/确认缺失）、3（前置受阻）、4（批量部分失败）、130（取消）。JSON 本身不授权变更。

首版优先验收 Windows PowerShell；macOS/Linux 在分别完成真实安装验收前不声明已获支持。许可证：MIT。
