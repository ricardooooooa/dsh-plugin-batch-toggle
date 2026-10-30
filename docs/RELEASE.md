# v0.2.0 发布与社区收录

状态核对日期：2026-10-30。**[GitHub v0.2.0 Release](https://github.com/ricardooooooa/dsh-plugin-batch-toggle/releases/tag/v0.2.0) 已公开发布；尚未发布 npm 包，也未提交社区目录收录 PR。** 社区收录须由维护方审核，不属于 DeepSeek 官方认证。

## 已发布附件

[下载预编译安装包](https://github.com/ricardooooooa/dsh-plugin-batch-toggle/releases/download/v0.2.0/dsh-plugin-batch-toggle-0.2.0.tgz)：

```text
https://github.com/ricardooooooa/dsh-plugin-batch-toggle/releases/download/v0.2.0/dsh-plugin-batch-toggle-0.2.0.tgz
```

该发行包 SHA-256：

```text
9f72801fde15fcfb0900c040a1b6cabead3096c9b10f4e84295fb6c329fdacac
```

包内已包含前后端构建产物，用户可直接在 DSH 添加插件。运行验收基线为 DSH **0.2.1-rc.5**，声明范围 `>=0.2.1-rc.5 <0.2.2-0`，需要 Node.js 24+。已发布附件保持原样；后续源码或文档提交不代表替换了该二进制附件。

## 发行行为与验证

- 单一“一键更新”入口自动取消使用单项，顺序更新并恢复原启用意图；原先关闭的插件保持关闭。
- 明确失败后尽力回滚，完成收尾后继续其他项目；未完成项持久保存。旧版恢复记录可接续。
- 仅自动处理可管理的 npm 来源第三方 bundle，自身、市场、核心/官方、只读项及非 npm 来源跳过。
- 使用 DSH 官方 SDK，遵守兼容性、脚本审批和 `minimumReleaseAge` 等策略。查询 `latest` 不等于保证安装该版本。

本地验收通过类型检查、108 项自动测试、前后端构建和真实 rc.5 控制注册表集成场景。范围、结果和未覆盖情形见 [VALIDATION.md](./VALIDATION.md)。截图由 [screenshots.json](../screenshots.json) 声明，来自隔离测试 profile。不宣称完全撤销第三方副作用，也不宣称所有社区插件均已验证。

## 后续发布检查

1. 运行 `check` 与相应隔离集成场景，核对失败继续、原关闭状态、回滚、停止和重启恢复。
2. 运行 `release:pack`，检查预编译入口、包内文件及当次产物的 SHA-256。
3. 公开仓库保持真实实现、README、许可证、`dsh-plugin` topic 和与版本一致的元数据。
4. 新版本 Release 附预编译 `.tgz`、校验文件及实际验证范围；不上传本机配置、凭据、`.dev` 或恢复记录。
5. npm 发布是独立步骤。若发布，`repository` 必须指回本仓库，并在发布后核对注册表实际元数据。

## 社区目录与 Discover

[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 的收录规则见 [contributing.md](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)。本项目的 [条目草稿](./community-entry.yml) 使用已经发布的版本固定 `.tgz`。准确提交路径、仓库年龄门槛、验证依据及待用 PR 草稿见 [marketplace-submission.md](./marketplace-submission.md)。

本次准备目标是 **dshmarket 社区目录收录**。官方 Discover 的 format 1 索引还要求条目具有 npm 包名、版本和发布时间；当前仅提供 GitHub tarball、尚未发布 npm 的本项目不会进入该索引，即使配置社区索引也不能据此在 Discover 搜到本插件。将来若准备 Discover 分发，需要另行满足 npm 与索引生成条件，并验证实际可见性。README 中提到 Discover 仅指本插件安装后的共用页头入口，不代表 Discover 已收录本插件。
