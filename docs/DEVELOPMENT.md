# 开发准备阶段的依据与边界（历史记录）

> 历史记录：当前 v0.2.0 已改为 rc.5 的单一“一键更新”流程，现状参见 [README](../README.md) 和 [验证记录](VALIDATION.md)。
日期：2026-10-30。此文保留第一阶段的调查记录；插件已继续实现，当前设计和交付以 README 与 docs/superpowers/specs/2026-10-30-batch-plugin-design.md 为准。

## 已确认的需求

用户需要减少更新插件前逐个取消使用、更新后逐个恢复的操作。需要两个后续按钮：批量取消使用、恢复之前使用的插件。用户已明确选择恢复批停前列表，不统一启用所有已安装插件。

## 技术选择

沿用官方 Cordis / React 扩展 API，独立插件包，不修改安装目录和官方页面。后端消费现有 `pluginManager`，前端通过官方 remote 与 slots。准备阶段不引入新的远程服务或 Typert 代码生成链。

rc.3 的实际 Node 范围为 `^22.19.0 || >=24.0.0`；本项目主动选定 >=24.9.0，现有 Node24.15.0 满足。桌面 CLI 由随程序的 Electron Node24.21.0 执行。项目 pnpm 固定11.28.5；不依赖 PATH 上可能存在的11.25.0。

## rc.3 API

后端：`ctx.get('pluginManager')`，服务注入名 `pluginManager`。

| 方法 | 含义 |
| --- | --- |
| `listBundles()` | 枚举已安装的插件包和启用状态 |
| `listPlugins()` | 枚举 Cordis loader 的内部插件项 |
| `setBundleEnabled(name, enabled)` | 切换包层“使用/取消使用”，保留安装依赖 |
| `setPluginEnabled(entryId, enabled)` | 切换某个内部 loader 项 |

前端 `remote.pluginManager` 包装调用结果为 `{ ok, value }`，不同于后端直接返回值。前端源码注入名为 `slots`、`remote`、`remote.pluginManager`。后续可在 `plugins.add.actions` 等官方插槽接入按钮。

`ChangeResult.changed` 仅表示已落盘；必须检查 `application`：`applied`、`restart-required`、`overridden`、`failed`、`cancelled`。逐项顺序 await；不要在外层另套 `hmr.runExclusive()`。

rc.3 没有原子批处理 API，也没有 alpha.2 新增的 `updateBundle/listVersions`。本轮没有复现每个第三方插件的更新问题，不宣称所有插件拥有相同更新限制。

## 后续恢复逻辑必须解决的边界

- 持久保存批停前的启用集合和顺序，状态文件放在当前 profile 的专属存储，启动时校验归属和版本。
- 保留原来停用的插件；不重新启用批停期间已经卸载的插件。
- 尊重官方 `readOnlyReason`，排除本插件自身、管理/加载/通信组件与恢复入口的依赖。
- rc.3 保护17个管理核心模块；保护按 bundle 内容动态判断，不能只写死一份包名列表。
- 部分失败、取消、需要重启时逐项记录结果；重复点击和批停期间其他页面修改需要冲突处理。
- `setBundleEnabled(true)` 会把包追加到启用列表末尾，可能改变配置层优先级。顺序恢复的实现仍须在隔离环境设计和验证，不能承诺现有单项 API 能原子还原原序。
- 后续正式打包前，将元数据示例合并进 package.json，编写 `cordis.patch.yml` 挂载实际前后端入口，再进行真实安装与按钮验收；目前不具备这部分功能。

## 隔离策略

`DSH_HOME` 使 profile、状态和凭据目录位于 `.dev/dsh-home`；`DSH_AGENTS_HOME` 使技能目录位于 `.dev/agents-home`。启动器过滤继承环境中的模型提供方变量和 key/token/secret/credential/password 类变量，不打印变量值。工作目录为 `.dev/workspace`，没有 `.env`；overlay 将 `workspace-controller.config.documentsDirectory` 指向 `.dev/documents`。

初次创建 `plugin-lab` 才传 `--from-default-profile web`，以后不重复重建。只监听127.0.0.1，随机端口，禁止自动开浏览器。启动验证只检查 Web shell 可访问，不调用模型、不触发插件开关，不代表功能端到端测试。

rc.3 的本地访问链接先通过303交换浏览器会话cookie。Node fetch 没有浏览器cookie jar，因此验证脚本手动携带仅驻内存的cookie再检查首页；日志中的临时登录token已脱敏，报告不保存token或cookie。验证结束后终止该测试进程树并有界等待关闭。

## 官方来源（均锁定 rc.3）

- [版本与工具链](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.3/package.json)
- [插件管理源码与保护规则](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.3/packages/boot/plugin-manager/src/index.ts)
- [管理接口类型](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.3/packages/boot/plugin-manager/src/types.ts)
- [前端插件管理入口](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.3/packages/client/ui-plugin-manager/src/client/index.ts)
- [插槽契约](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.3/packages/client/ui-plugin-manager/src/client/slot-contract.ts)
- [ModuleLoader 构建协议](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.3/packages/client/tsdown.client.ts)
- [共享模块清单](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.3/packages/client/web/src/platform.ts)
- [打包发布规则](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.3/docs/user/develop/basic/publish.md)

这些规则已同时与本机 `C:/dsh/resources/app.asar` 中的 rc.3 包核对；用户真实 profile 和凭据不复制进项目。
