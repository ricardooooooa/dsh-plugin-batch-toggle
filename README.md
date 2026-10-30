# DSH Plugin Batch Toggle · 插件一键更新

[![CI](https://github.com/ricardooooooa/dsh-plugin-batch-toggle/actions/workflows/ci.yml/badge.svg)](https://github.com/ricardooooooa/dsh-plugin-batch-toggle/actions/workflows/ci.yml)

在 DeepSeek Harness 的插件管理和 dshmarket 中，用一颗 **一键更新** 按钮顺序更新 npm 来源插件，自动取消使用并恢复原启用状态。原先关闭的插件更新后仍保持关闭。

[English](./README.en.md) · [更新记录](./CHANGELOG.md) · [问题反馈](https://github.com/ricardooooooa/dsh-plugin-batch-toggle/issues)

## 安装 v0.2.0

运行验收基线为 **DSH 0.2.1-rc.5**，兼容声明为 `>=0.2.1-rc.5 <0.2.2-0`，需要 Node.js 24+。

1. 在 DSH 中打开 **插件 → 添加插件**。
2. 粘贴下面的 [v0.2.0 预编译安装包链接](https://github.com/ricardooooooa/dsh-plugin-batch-toggle/releases/download/v0.2.0/dsh-plugin-batch-toggle-0.2.0.tgz)，或先下载后填写文件的绝对路径。
3. 安装并启用本插件；若 DSH 提示需要重启，按提示重启。

```text
https://github.com/ricardooooooa/dsh-plugin-batch-toggle/releases/download/v0.2.0/dsh-plugin-batch-toggle-0.2.0.tgz
```

预编译包无需 TypeScript 或其他构建工具。[GitHub Release](https://github.com/ricardooooooa/dsh-plugin-batch-toggle/releases/tag/v0.2.0) 已发布；**截至 2026-10-30，未发布到 npm，未提交社区目录收录 PR**。请使用上面的发行附件安装。

目前准备的是 dshmarket 社区目录收录。此 tarball-only 发行版不会进入要求 npm 元数据的官方 Discover 索引；下文的 Discover 入口是指安装后的界面按钮。

升级本插件请使用 DSH 的添加/更新插件入口，它不会在一键更新中更新自己。若使用桌面 profile 的命令行安装，应先完全退出桌面端，并使用同一 rc.5 安装附带的 CLI。

## 使用

点击插件管理或 dshmarket 页头的 **一键更新**。每个符合条件的包依次执行：检查版本 → 必要时取消使用 → 移除旧包 → 安装更新 → 恢复原启用意图并核对结果。

- 界面显示当前项、阶段、进度、失败数量和逐项结果。单项明确失败并完成收尾后，继续处理后面的项目。
- 运行时同一按钮变为 **停止更新**；停止请求等待当前项安全收尾或回滚，不会立即终止安装进程。
- **批量更新** 标签提供完整结果与恢复状态；“添加插件”菜单也有入口。详情页只显示自身的操作按钮，不重复显示页头按钮。
- 若有 v0.1 遗留恢复记录，先按记录接续恢复；再次运行也会优先处理上一轮未完成项。

支持官方 Installed、Discover、dshmarket 标签的共用页头，以及 dshmarket 独立设置/侧栏面板。

## 更新范围与限制

自动更新仅适用于**可管理、以自身包名从 npm 注册表安装的第三方 bundle**。本插件、市场载体、官方/核心组件、只读和不可管理项会跳过。Git、本地 file/link、tarball/URL 与 npm 别名来源也会跳过，原因可在详情查看。

查询到的 `latest` 是参考版本。实际安装通过 DSH 官方插件管理 SDK，遵守其注册表配置、兼容性检查、脚本审批和 `minimumReleaseAge` 等策略；刚发布的最新版本可能尚不可安装。结果分别显示更新前、查询最新和实际安装版本。

安装或校验失败会尽力重装原版本并恢复原启用意图。结果和未完成项保存在当前 profile 的 `.dsh-plugin-batch-toggle/`，重启后可接续处理。**回滚并非完全撤销**：第三方脚本、数据变更与运行状态不保证能够还原；回滚失败的项目会保留恢复责任。卸载本插件前应先处理未完成项。

其他已知限制：

- DSH 要求重启时显示提示，本插件不自动重启。
- 官方启用 API 会把恢复的 bundle 追加到列表末尾，不能保证与保留包交错的完整配置优先顺序原样复原。
- 不强制开启包内原先关闭的 Cordis 插件项。
- 页头入口依赖 DOM 标记兼容层；宿主页面结构变化时，可使用原生“批量更新”标签或菜单。

接口使用 DSH 现有 Owner 认证和同源校验，不额外监听端口，不需要模型密钥。本插件不上传会话；查询和安装会访问配置的 npm 注册表。

## 界面预览

以下截图均来自 **rc.5 独立测试 profile**。更新结果中的 `dsh-update-fixture-*` 是控制注册表中的测试包，不代表已验证所有社区插件。

**插件管理：** Installed、Discover 和市场共用页头的一键更新入口。

![rc.5 插件管理中的一键更新入口](./docs/screenshots/plugin-manager.png)

**dshmarket：** 市场标签中保留相同入口，与市场自己的更新按钮分开显示。

![rc.5 dshmarket 中的一键更新入口](./docs/screenshots/plugin-market.png)

**结果详情：** 测试包 B 更新失败后回滚，后续测试包继续更新；详情页没有重复页头按钮。

![独立测试包的更新结果与回滚详情](./docs/screenshots/batch-recovery.png)

## 开发与验证

```powershell
./tooling/bootstrap.ps1
./tooling/pnpm.ps1 run check
./tooling/pnpm.ps1 run release:pack
./tooling/pnpm.ps1 run test:integration:updates
```

2026-10-30 的本地验收通过类型检查、108 项自动测试、前后端构建，以及真实 rc.5 的控制注册表集成场景：A/C/D 更新成功，B 失败后回滚且后续继续，原先关闭的 D 保持关闭且未执行。测试使用隔离 profile，不执行日常插件集合的一键更新。完整范围与边界见 [验证记录](./docs/VALIDATION.md)。

[发布说明](./docs/RELEASE.md) · [社区收录准备与 PR 草稿](./docs/marketplace-submission.md) · [当前设计](./docs/superpowers/specs/2026-10-30-rc5-one-click-update.md) · [MIT License](./LICENSE)
