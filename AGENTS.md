# Project scope

- 当前阶段：用户已授权实现可安装、可发布的批量开关插件，并在插件管理和插件市场显示按钮。
- 用户已确认公开创建 GitHub 仓库并发布v0.1.0；仓库为ricardooooooa/dsh-plugin-batch-toggle。npm发布和向其他仓库提交PR不在本次确认范围内。
- 用户已要求适配实际rc.5并更新桌面插件：本轮以AppData中的rc.5为运行与SDK基线，C:/dsh是旧rc.3，不可用其冒充rc.5验收。
- 用户最新明确主界面只要一个“一键更新”按钮，自动取消使用、顺序更新和恢复原启用意图，单项失败记录并继续；不再放两个手动开关按钮。
- 用户已选择恢复策略：恢复批量停用前的插件列表，保留原来停用的插件。
- 测试必须通过 tooling/dev-dsh.mjs 的独立 DSH_HOME、DSH_AGENTS_HOME、工作目录和 documentsDirectory；不读真实凭证，不操作日常 desktop/web profile。
- 调用官方 pluginManager API；区分 bundle 开关与 loader entry 开关。尊重 readOnlyReason，排除管理组件和本插件，检查 ChangeResult.application。
- 浏览器产物使用已核对 rc.5 的 ModuleLoader factory；仅外部化已验证的共享平台模块。React 使用宿主单例。
- `.dev`、`.tooling`、node_modules、真实配置、凭证、快照不提交。
- 验证命令：`./tooling/pnpm.ps1 run check` 和 `./tooling/pnpm.ps1 run dev:smoke`。
