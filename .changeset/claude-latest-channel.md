---
'agent-cli-manager': patch
---

修复 Claude Code 使用 stable 标签导致无法检测最新发布版本的问题，将默认更新通道调整为 latest。检查更新、默认安装和升级均使用 latest 标签，继续拒绝 SemVer 预发布版本。
