# 首版验收记录

验收日期：2026-10-19（Asia/Shanghai）。所有安装操作使用临时 Node/npm 运行目录、独立 npm 全局 prefix 和受控 PATH，未修改日常 CLI 安装。

## Windows 真实 npm 链路

- 系统：Windows NT 10.0.26300，x64，PowerShell。
- Node.js：24.16.0；npm：11.13.0；registry：`https://registry.npmjs.org/`。
- 执行：`node scripts/acceptance.mjs`；共 30 次命令调用，最终列表中四个工具均为未安装。
- 每种工具均通过首次安装、同版本重装、降级、升级、回退和卸载，执行后包版本与实际命令版本匹配。

| 工具            | 稳定目标            | 降级及回退目标 | 结果 |
| --------------- | ------------------- | -------------- | ---- |
| Claude Code     | 2.1.292（`stable`） | 2.1.291        | 通过 |
| Codex CLI       | 0.163.0             | 0.162.1        | 通过 |
| Pi coding agent | 1.3.0               | 1.2.0          | 通过 |
| Gemini CLI      | 0.64.0              | 0.63.0         | 通过 |

完整本机证据位于 `artifacts/acceptance-win32-x64.json`。该目录不纳入 Git；手动触发 GitHub Actions 的 Real npm acceptance 工作流时会上传对应证据。

## 包与自动化检查

- `pnpm check` 包含格式、lint、Knip、类型检查、Vitest 和构建。
- 受控测试覆盖来源冲突、Windows 包装文件归并、精确版本校验、稳定标签异常、兼容性、历史与锁、外部修改、失败后重检、批量部分失败、JSON、退出码、真实子进程取消及超时。
- 使用 `pnpm pack` 打包后，在另一临时 prefix 中通过 npm 安装 tarball；生成的 `agent-cli-manager.cmd` 正确输出版本、中文帮助和 JSON 版本结果。该项为本地打包安装验收。
- 在真实 PowerShell 终端检查主菜单、本地状态、全部更新查询和退出；当前 VS Code 扩展提供的 Codex 被正确识别为其他来源。
- CI 已配置 Windows、Linux、macOS × Node 22/24，但本地检查不代表远端矩阵已运行。

## 尚未声明的支持

macOS、Linux 以及其他架构尚无本次真实安装验收证据。Node 22 已纳入工程和 CI 声明，但本次真实包安装链路使用 Node 24。账号登录和模型调用不属于本次验收。
