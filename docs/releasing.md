# 发布说明

`agent-cli-manager` 已发布到 [npm](https://www.npmjs.com/package/agent-cli-manager)。2026-10-19 查询官方 registry 时，`latest` 为 `0.1.0`。

仅发布 `packages/cli`，其 npm 包名和命令名均为 `agent-cli-manager`。根工作区、core 和示例包均为私有包；core 实现构建时合并进 CLI 产物。

## 后续版本

1. 完成功能或修复后，执行 `pnpm changeset`，选择 `agent-cli-manager`，填写版本变更级别和变更说明。core 的行为变化也记录在 CLI 的 Changeset 中。
2. 执行 `pnpm check`，确认格式、lint、未使用代码检查、类型检查、测试和构建通过。涉及安装行为或平台支持的变化，还应按[验收记录](acceptance.md)补充真实验收证据。
3. 将变更合并到 `main`。Release 工作流通过 Changesets 创建或更新版本 PR，更新包版本与 changelog。
4. 审核并合并版本 PR。Release 工作流执行 `pnpm release`，再次运行检查并发布尚未发布的 CLI 版本。

仅修改仓库文档或 CI 配置时，通常不需要 Changeset；若希望更新 npm 包内的 README，则需要随新的 CLI 版本发布。

## 发布配置

工作流位于 [release.yml](../.github/workflows/release.yml)，使用 Node.js 24、仓库指定的 pnpm 和 npm Trusted Publishing。npm 包的 Trusted Publisher 应匹配 GitHub 仓库 `bingwu-devkit/agent-cli-manager` 及工作流文件 `release.yml`；工作流使用 `id-token: write` 获取发布身份，并启用 provenance。

Changesets 使用 `GITHUB_TOKEN` 维护版本 PR，仓库需要允许 GitHub Actions 创建 PR。仓库迁移或工作流文件重命名后，应同步检查 npm Trusted Publisher 配置。

## 发布后验证

查询官方 registry，核对最新版本及运行环境要求：

```powershell
npm view agent-cli-manager version dist-tags engines --json --registry=https://registry.npmjs.org
```

安装或更新后检查命令：

```powershell
npm install -g agent-cli-manager@latest
agent-cli-manager --version
agent-cli-manager --help
agent-cli-manager list
```

npm 发布成功与平台验收是不同的检查项；支持范围仍以[验收记录](acceptance.md)为准。
