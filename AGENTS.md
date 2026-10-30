# Project scope

- 当前阶段：用户已授权实现可安装、可发布的批量开关插件，并在插件管理和插件市场显示按钮。
- 本机运行基线为 DSH 0.2.1-rc.3；开发SDK保持rc.3，发布兼容范围>=0.2.1-rc.3 <0.2.2-0，rc.5接口源码一致但不可声称完成其运行测试。不要擅自升级桌面端。
- 用户已选择恢复策略：恢复批量停用前的插件列表，保留原来停用的插件。
- 测试必须通过 tooling/dev-dsh.mjs 的独立 DSH_HOME、DSH_AGENTS_HOME、工作目录和 documentsDirectory；不读真实凭证，不操作日常 desktop/web profile。
- 调用官方 pluginManager API；区分 bundle 开关与 loader entry 开关。尊重 readOnlyReason，排除管理组件和本插件，检查 ChangeResult.application。
- 浏览器产物使用 rc.3 的 ModuleLoader factory；仅外部化已验证的共享平台模块。React 使用宿主单例。
- `.dev`、`.tooling`、node_modules、真实配置、凭证、快照不提交。
- 验证命令：`./tooling/pnpm.ps1 run check` 和 `./tooling/pnpm.ps1 run dev:smoke`。
