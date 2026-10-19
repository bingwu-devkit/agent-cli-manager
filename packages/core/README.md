# Agent CLI Manager Core

`@agent-cli-manager/core` 是不发布到 npm 的私有内部包，保存 Agent CLI Manager 的工具目录、环境与来源检测、npm 执行、版本查询、操作编排、回退记录和跨进程锁逻辑。

`packages/cli`（发布名 `agent-cli-manager`）通过包入口导入这些逻辑，负责命令解析、中文菜单、确认和输出。CLI 构建时将 core 实现合并进产物，安装用户无需获取 core 包。core 本身不注册命令或启动交互界面，不提供公共 JavaScript API。

需要 Node.js `^22.18.0 || ^24.0.0` 和 npm。许可证：MIT。
