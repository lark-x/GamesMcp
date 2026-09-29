# 原神任务解析审计

- 上游：`F:\Project\GamesMcp\data\fixtures\anime-game-data-quests`
- Commit：`222bb0be1115e7a07c2878a2c80fbb6c2d5cd4b3`
- 主任务：1
- 可发布双语记录：2
- 完整/部分/仅元数据（中文）：1/0/0
- 解析失败：0
- Story Family：1；区域级其他独立任务：0；独立任务条目：0
- Talk 已解析任务：1；存在 Talk 问题的任务：0

## BEFORE / AFTER / DELTA

```json
{
  "before": null,
  "after": {
    "resolvedQuestCount": 1,
    "dialogueNodeCount": 2,
    "fallbackFamilyCount": 0,
    "standaloneQuestCount": 0,
    "aggregateCount": null,
    "controlCount": 0,
    "talkUnresolvedCount": 0,
    "danglingEdgeCount": 0,
    "publicNarrativeQuestCount": 1,
    "publicNarrativeResolvedCount": 1,
    "publicNarrativeDialogueNodes": 2,
    "allNarrativeQuestCount": 1,
    "allNarrativeResolvedCount": 1,
    "allNarrativeDialogueNodes": 2
  },
  "delta": {
    "resolvedQuestCount": null,
    "dialogueNodeCount": null,
    "fallbackFamilyCount": null,
    "standaloneQuestCount": null,
    "aggregateCount": null,
    "controlCount": null,
    "talkUnresolvedCount": null,
    "danglingEdgeCount": null,
    "publicNarrativeQuestCount": null,
    "publicNarrativeResolvedCount": null,
    "publicNarrativeDialogueNodes": null,
    "allNarrativeQuestCount": null,
    "allNarrativeResolvedCount": null,
    "allNarrativeDialogueNodes": null
  }
}
```

## 重点核对

| 主任务 | 标题 | 系列 | 章节 | 对白 | 内容角色 | Talk 状态 | 质量 |
| --- | --- | --- | --- | ---: | --- | --- | --- |

## 非完整任务



## Story Structure Audit

- 系列：1；单任务系列：1；仅 aggregate 系列：0
- 重复系列标题：0；重复章节标题：0
- 孤立 aggregate：0；跨地区系列：0

## Topology / Talk / Dialogue Audit

- Raw edges：0；Derived edges：0；requires：0；aggregate：0
- 拓扑 cycle：0；拓扑 dangling：0
- Talk expected/resolved/unresolved/ambiguous：0/0/0/0
- Dialogue nodes/edges/dangling：2/1/0
- rootless/cyclic graph：0/0；重复正文额外节点：0
- Talk 全目录 metadata scan：0；孤立对白资产：0；metadata scan 失败：0

本报告只读取上游文件并在内存中运行转换，不写入数据库；应在所有规则完成后再执行一次候选导入。
