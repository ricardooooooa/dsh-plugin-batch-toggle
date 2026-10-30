# 发布与社区收录

本地发行包不是“已上架”。源码、预编译安装包和验收完成后，才进入公开发布与收录阶段。

## 发行内容

`package.json` 包含 DSH bundle 声明、client entry、兼容范围及 dsh-plugin 关键词；`cordis.patch.yml` 挂载 Host row；DSH 自动发现同包 client half。发行包包含预编译代码、中英文 README 和 MIT 许可。`release:pack` 生成 tgz、SHA-256 和文件清单。

## 公开发布前

1. 确定并创建公开 GitHub 仓库，上传源码；添加 `dsh-plugin` topic。
2. 将真实地址补入 package.json 的 `repository`、`homepage`、`bugs`，再构建和打包。当前没有填入尚不存在的仓库地址。
3. 创建 `v0.1.0` Release，附 tgz、SHA-256、真实运行截图及验证范围。不要上传 `.dev`、本机配置、凭据或恢复记录。
4. npm 发布可选；先检查名称和发布权限。npm repository 必须精确指回收录的真实仓库才能自动关联。

## dshmarket 社区目录

目前使用 [awesome-dsh-plugin 社区目录](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)。按照[当前 contributing.md](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)提交单文件 PR：`data/plugins/<owner>__<repo>.yml`。

要求实际可运行代码、有效 dsh.bundle、仓库 topic，以及仓库创建至少一天。category 建议 market；英文介绍必填。不要手改生成 README 或手写 npm 字段，提交时以维护方最新规则和CI为准。

建议英文介绍：One-click pause and restore for enabled DSH plugins, with persistent recovery and protected core/market controls.

中文介绍：在插件管理和插件市场显示一键停用、一键启用按钮，更新前暂停第三方插件，更新后恢复原先的启用列表。

已提供 `docs/community-entry.template.yml`，发布后替换 OWNER / REPOSITORY 再提交。模板使用钉住 v0.1.0 的 tarball 地址；仓库安装不依赖开发者预先提交 lib 产物，市场优先提供 Release 的预编译包。不能用占位仓库提交。社区目录收录由维护方决定，不属于 DeepSeek 官方审核。

`screenshots.json` 按社区规则声明三张真实隔离环境截图；图片位于 docs/screenshots，发布仓库时一起上传即可。

## 官方 Discover

Discover 读取用户配置的索引。社区收录不等于所有安装默认自动出现；对应社区索引为 [dsh-plugin-catalog](https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json)。不要宣传为“DeepSeek 官方认证”。
