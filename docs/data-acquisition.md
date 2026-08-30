# 数据采集与转换

当前首个采集器使用固定 Git Commit 的 `DimbreathBot/AnimeGameData` 数据，不需要安装或启动游戏。

## 上游最小文件

- `TextMap/TextMap_MediumCHS.json`
- `ExcelBinOutput/AvatarExcelConfigData.json`
- `ExcelBinOutput/FetterInfoExcelConfigData.json`
- `ExcelBinOutput/FetterStoryExcelConfigData.json`
- `ExcelBinOutput/BooksCodexExcelConfigData.json`
- `ExcelBinOutput/DocumentExcelConfigData.json`
- `ExcelBinOutput/LocalizationExcelConfigData.json`
- `ExcelBinOutput/MaterialExcelConfigData.json`
- `ExcelBinOutput/MaterialCodexExcelConfigData.json`
- `Readable/CHS/`

书籍必须通过 `Document.questIDList -> Localization -> Readable` 定位正文，不能根据
`Readable` 文件名猜测对应关系。角色故事通过 `FetterStory` 的 TextMap Hash 定位，物品描述通过
`MaterialCodex.materialId -> Material` 定位。

## 转换

上游仓库默认位于 `data/upstream/AnimeGameData`。转换器只读取此目录，不联网、不启动
游戏，也不会把上游原始资料复制到输出目录：

```bash
pnpm data:convert:anime
```

转换结果写入：

```text
data/imports/normalized/anime-game-data/<commit>/zh-CN/
├── manifest.json
└── records/
    ├── books.json
    ├── character-stories.json
    └── items.json
```

记录使用稳定的 canonical key，且不带来源前缀：

- 书籍：`book/<documentId>`
- 角色故事：`character/<avatarId>/story/<fetterId>`；其中角色实体为
  `character/<avatarId>`
- 物品图鉴：`item-codex/<codexId>`；其中物品实体为 `item/<materialId>`

书籍只接受确定的 `BooksCodex → Document → questID → Localization → Readable/CHS`
链路；角色故事只通过 `Avatar/FetterStory → TextMap_MediumCHS`，物品只通过
`MaterialCodex → Material → TextMap_MediumCHS`。转换器不按文件名或相似文本猜测映射。

每条记录的 `metadata` 保存字段级 `lineage`（相对上游文件、上游 ID、源文件哈希、字段值哈希及
Readable 路径）、`rawHash`/`normalizedHash`、实际执行的 `transforms`、commit/version、locale、
`converterVersion`、`rightsStatus` 和 `verificationRiskFlags`。转换会拒绝重复 canonical key、空标题/正文
和 Unicode replacement character（`U+FFFD`）。记录按 canonical key 排序并使用稳定 JSON/hash；只有
Manifest 的 `generatedAt` 是刻意可变的。

后台导入时只选择 `records/`，不要选择包含 `manifest.json` 的父目录。Manifest 保存
`discovered`、`converted`、`excluded`、逐条 `failures`、`accountedCoverage`、
`unexplainedMissing` 和所有已读取输入（包括确定链路命中的 Readable 文件）哈希。

提交前可只针对小型 fixture 运行转换器测试，不要以工作区中的大型原始目录替代 fixture：

```bash
pnpm exec vitest run scripts/anime-game-data-converter.test.ts
```

可以通过以下环境变量覆盖默认值：

- `ANIME_GAME_DATA_DIR`
- `ANIME_GAME_OUTPUT_DIR`
- `ANIME_GAME_VERSION`
- `ANIME_GAME_LANGUAGE`（首版只支持 `CHS`）

三个命令都会再次确认上游目录位于外置卷、输出目录位于配置的外置数据根；即使通过环境变量覆盖路径，也不能把原始数据或规范化结果写到系统盘。

如果没有 `ANIME_GAME_VERSION`，转换器会从上游 Git subject 推断游戏版本；无法读取 Git 时保留
`unknown`，不会伪造版本号。小型测试数据位于 `data/fixtures/anime-game-data`，真实上游目录
不应在测试中被读取。

上游仓库没有明确的数据许可证声明；生成物默认只作为私有内部数据使用，公开或商业再分发前应完成权利审查。

跨快照比较时只把相同 canonical key、游戏版本和语言的观察放入文本一致性判断。不同版本会单独记录为
`version_difference`，不会静默覆盖，也不会被误判为同版本冲突；同版本的真实差异必须在管理页面人工裁决。

人工裁决必须记录采用的来源观察，并遵循来源政策：同版本时游戏正式客户端原文优先于社区转储；官方公告只用于裁决版本或活动事实；
HoYoWiki 只能作为辅助渠道。系统不会因为来源名称相似而自动覆盖标准记录，裁决理由必须留在审计记录中；若采用观察与待发布批次的正文不同，必须重新导入采用观察对应的来源，否则发布门禁会拒绝。
