# v0.2 发布与社区收录

v0.2 的公开描述以单颗“一键更新”入口为准，不再宣传两个手动批量开关按钮。公开发布和社区收录状态以实际 Release、npm 与维护方记录为准；此文不声明已发布或已收录。

## 发行行为

- 官方插件管理页和市场页提供一键更新；需要时自动取消使用单项，顺序更新并恢复原启用意图。
- 有旧版批停记录时，自动接续恢复；原先主动关闭的插件保持关闭。
- 明确失败的项目在安全收尾后记录并继续。失败时尽力回滚旧版本，未完成责任持久保留。
- 仅自动处理可管理的 npm 来源第三方 bundle；自身、市场、核心/官方、只读项和非 npm 来源跳过。
- 使用 DSH 官方 SDK，保留其兼容性、审批与 `minimumReleaseAge` 发布等待策略。查询 `latest` 不等于保证安装该版本。

运行与开发基线为 DSH 0.2.1-rc.5，声明范围 `>=0.2.1-rc.5 <0.2.2-0`。不宣传绝对无损回滚或所有第三方插件均已验证。

## 发布检查

1. 运行类型检查、测试与构建，以及 rc.5 隔离更新集成场景。检查失败项、关闭状态、回滚、停止和重启恢复。
2. 运行 `release:pack`，核对预编译入口、文件清单与该次生成的 SHA-256。最终哈希只从实际打包产物取得。
3. 将源码与元数据推送到 [本项目仓库](https://github.com/ricardooooooa/dsh-plugin-batch-toggle)，为仓库保留 `dsh-plugin` topic。
4. 发布 v0.2.0 Release 时附 `dsh-plugin-batch-toggle-0.2.0.tgz`、校验文件及实际验证范围。不要上传本机配置、凭据、`.dev`、恢复记录或未脱敏日志。
5. npm 发布可选且需相应账户权限。包的 `repository` 必须指回本仓库，才能与社区条目自动关联。

预期 v0.2.0 发行附件地址如下，仅在该 Release 与附件发布后有效：

```text
https://github.com/ricardooooooa/dsh-plugin-batch-toggle/releases/download/v0.2.0/dsh-plugin-batch-toggle-0.2.0.tgz
```

`screenshots.json` 声明固定路径下的界面截图。发布前核对截图展示 rc.5 的单按钮流程，并与实际页面一致。

## dshmarket 社区目录

目录来自 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)，按照其 [contributing.md](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md) 提交 `data/plugins/<owner>__<repo>.yml` 单文件 PR。提交时重新核对维护方的规则和 CI，不手改生成 README，不添加自定义 npm 字段。

本项目条目草稿在 `docs/community-entry.yml`，预期安装包指向 v0.2.0；确认附件已发布后再提交。不要将仅准备好的条目描述为已收录。

英文介绍：One-click sequential updates for npm-installed DSH plugins, with enabled-state preservation, rollback and persistent recovery.

中文介绍：在插件管理和市场提供一键更新，顺序更新 npm 来源插件，保留启用状态，失败后尽力回滚并接续后续项目。

社区收录由维护方决定，不属于 DeepSeek 官方审核。

## 官方 Discover

Discover 读取用户配置的索引。社区目录收录不会让所有 DSH 安装自动出现该条目；用户配置相应 [社区索引](https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json) 后才能在 Discover 搜索。不要宣传为“DeepSeek 官方认证”。
