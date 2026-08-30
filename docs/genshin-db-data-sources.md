# genshin-db 数据来源与使用边界

适配器锁定 `theBowja/genshin-db` 的 commit `8b15995fa220c88a4d0d7ffe1e21b041d0b32588`，来源 URL 为 <https://github.com/theBowja/genshin-db/tree/8b15995fa220c88a4d0d7ffe1e21b041d0b32588>。代码许可为 MIT；数据为社区整理（上游声明来自 Fandom Wiki 与 GenshinData），游戏内容权利记录为 `HoYoverse/third-party`。每次快照 manifest 记录 commit、locale、文件 SHA-256、记录 SHA-256、转换器版本和失败清单。

只转换角色、武器、圣遗物、材料、敌人的短事实字段（名称、类别、稀有度、元素/武器类型、掉落/材料关系）。不抓取图片、音频、长剧情或描述正文。固定 commit 不匹配时拒绝运行；未知行结构、缺少 id/name 明确失败。官方 HoYoWiki（<https://wiki.hoyolab.com/pc/genshin/home>）与官方公告仅供人工抽样核对，不批量抓取。HoYoLAB 法律 FAQ（<https://www.hoyolab.com/article/143107>）说明官方素材权利未转让，因此不得将 MIT 代码许可误作游戏内容许可。

预发布样本命令：`$env:GENSHIN_DB_SAMPLE=10; pnpm exec tsx scripts/convert-genshin-db.ts`。完整转换：清除该环境变量后执行同一命令。数据目录在 `.gitignore` 中，不提交上游 checkout 或快照。
