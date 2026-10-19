# Changesets

自动发布默认启用，按[发布说明](../README.md#发布)配置 npm 和 GitHub 权限。
仅发布 `packages/cli` 下的 `agent-cli-manager` 包。根包、core 和示例均为私有包，不发布。
core 的实现会合并到 CLI 产物，因此 core 的用户可见变更也应为 `agent-cli-manager` 添加 Changeset。

运行 `pnpm changeset` 描述面向用户的变更。合并到 `main` 会维护版本 PR；
合并版本 PR 后会发布 npm 包并创建对应的 GitHub Release。
