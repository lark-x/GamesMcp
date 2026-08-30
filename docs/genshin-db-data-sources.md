# genshin-db 数据来源与使用边界

适配器锁定 `theBowja/genshin-db` 的 commit `8b15995fa220c88a4d0d7ffe1e21b041d0b32588`，来源 URL 为 <https://github.com/theBowja/genshin-db/tree/8b15995fa220c88a4d0d7ffe1e21b041d0b32588>。代码许可为 MIT；数据为社区整理（上游声明来自 Fandom Wiki 与 GenshinData），游戏内容权利记录为 `HoYoverse/third-party`。每次快照 manifest 记录 commit、locale、文件 SHA-256、记录 SHA-256、转换器版本和失败清单。

只转换角色、武器、圣遗物、材料、敌人的短事实字段（名称、类别、稀有度、元素/武器类型、掉落/材料关系）。不抓取图片、音频、长剧情或描述正文。固定 commit 不匹配时拒绝运行；未知行结构、缺少 id/name 明确失败。官方 HoYoWiki（<https://wiki.hoyolab.com/pc/genshin/home>）与官方公告仅供人工抽样核对，不批量抓取。HoYoLAB 法律 FAQ（<https://www.hoyolab.com/article/143107>）说明官方素材权利未转让，因此不得将 MIT 代码许可误作游戏内容许可。

预发布样本命令：`$env:GENSHIN_DB_SAMPLE=10; pnpm exec tsx scripts/convert-genshin-db.ts`。完整转换：清除该环境变量后执行同一命令。数据目录在 `.gitignore` 中，不提交上游 checkout 或快照。

## 导入前 dry-run

完整转换后运行 `pnpm data:validate:genshin-db`。该命令会通过项目现有 `local_json` adapter 和领域校验链路读取 `records.json`，确认 1699 条记录、五类数量 `122/249/63/919/346`、0 failures、无媒体引用或正文，并核对锁定 commit 与权利字段。输出目录中的 `manifest.json` 是审计清单；提交 API 时将 `records.json` 作为 `local_json` 来源路径，保留同目录 Manifest 供审核，不要把整个目录作为 `local_directory`（否则清单也会被当作输入文件）。

示例：

```powershell
Remove-Item Env:GENSHIN_DB_SAMPLE -ErrorAction SilentlyContinue
pnpm exec tsx scripts/convert-genshin-db.ts
pnpm data:validate:genshin-db
```

验证通过后，按正常来源创建/导入 API 提交暂存批次，完成审核后再发布 Dataset Revision；本适配器不执行发布操作。
