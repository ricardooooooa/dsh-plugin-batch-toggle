# 开发准备验收记录（第一阶段）

> 历史记录：当前 v0.2.0 已改为 rc.5 的单一“一键更新”流程，现状参见 [README](../README.md) 和 [验证记录](VALIDATION.md)。
日期：2026-10-30。

| 检查 | 实测结果 |
| --- | --- |
| 本机桌面版本与 SDK 一致 | DSH 0.2.1-rc.3 |
| 项目工具链 | Node24.15.0 / pnpm11.28.5 / TypeScript6.0.3 / esbuild0.28.2 |
| 官方管理接口类型 | TypeScript 检查通过 |
| 后端构建配置 | ESM 探针编译通过 |
| 前端构建配置 | ModuleLoader 包装及注册探针通过 |
| 隔离 profile | plugin-lab，独立 DSH_HOME 与 DSH_AGENTS_HOME |
| 隔离网页启动 | 登录交换303，首页HTTP200 |
| 测试进程清理 | 等待测试进程关闭后退出，退出码0 |
| 恢复策略 | 用户选择：恢复批停前列表，保持原先停用状态 |

可重跑命令：`./tooling/pnpm.ps1 run check`、`./tooling/pnpm.ps1 run dev:smoke`。

机器生成的最新检查详情位于 `.dev/environment-report.json` 与 `.dev/runtime-report.json`，不纳入版本管理。

本次交付为开发准备：已安装开发依赖并提供配置、构建探针、独立启动入口、API 与边界说明。没有批量开关按钮、快照或恢复实现；没有挂载到日常 DSH，也没有发布插件。正式插件入口、挂载补丁与功能验收在后续开发阶段完成。
