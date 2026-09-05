# GamesMcp Archive Data Baseline Report

> 生成时间: 2026-09-04T14:54:49.055Z
> 基线 Commit: 8a105e63eddf78c8f35b6f2bc969a99d0d590bda
> 审计脚本: scripts/archive-data-audit.ts

---

## 1. 原神 (Genshin Impact) 真实数据基线

### 剧情 (Quests / Story)
| 指标 | 统计数值 | 说明 |
|---|---|---|
| **任务总数 (total)** | **4372** | MainQuest 原始条目 |
| **公开可用任务 (public)** | **3636** | 排除测试/内部后 |
| **可读标题数 (withReadableTitle)** | **4246** | TextMap 解析有效标题 |
| **原始关联地区 (withRegion)** | **800** | 通过 Chapter.cityId 关联（**当前未接入 Story 模型**） |
| **未关联地区任务 (unresolvedRegions)** | **3572** | 当前前端普遍显示“未知地区” |
| **结构化对白覆盖 (withDialogueNodes)** | **1225** | 具备对白结构 |
| **正文段落可用数 (withDocumentBody)** | **4246** | 具备文本正文 |

### 材料 (Materials)
| 指标 | 统计数值 | 说明 |
|---|---|---|
| **原始材料总数 (totalRaw)** | **10404** | MaterialExcelConfigData |
| **公开有效材料 (public)** | **10318** | 排除占位/无名/内部 |
| **内部/测试垃圾 (internalLike)** | **86** | 需由 isPublicMaterial 过滤 |
| **描述覆盖数 (withDescription)** | **9997** | 具备有效中文描述 |
| **来源覆盖数 (withSources)** | **0** | **当前 Converter 硬编码为 0 (sources: [])** |
| **用途覆盖数 (withUsedBy)** | **0** | **当前 Converter 硬编码为 0 (usedBy: [])** |
| **粗暴分类为 other 占比** | **4624 (44.4%)** | 字符串包含导致近半材料沦为 other |

#### 原始粗暴分类分布：
```json
{
  "other": 4624,
  "character_development": 747,
  "quest_item": 2784,
  "cooking": 752,
  "weapon_development": 29,
  "furnishing": 1468
}
```

---

## 2. 崩坏：星穹铁道 (Honkai: Star Rail) 真实数据基线

### 任务与剧情 (Missions)
| 指标 | 统计数值 | 说明 |
|---|---|---|
| **任务总数 (total)** | **1** | 当前有效 Mission 样本 |
| **含世界 ID (withWorldId)** | **1** | World 关联 |
| **含章节 ID (withChapterId)** | **0** | Chapter 关联 |
| **真实叙事对白 (withNarrativeText)** | **1** | 具备真实 Talks 对白节点 |
| **仅阶段目标 (objectiveOnly)** | **0** | 仅有阶段任务目标，无剧情对白 |

### 材料 (Materials)
| 指标 | 统计数值 | 说明 |
|---|---|---|
| **材料总数 (total)** | **1** | ItemConfig 样本 |
| **公开有效材料 (public)** | **1** | 具备有效名称 |
| **描述覆盖数 (withDescription)** | **1** | 具备有效道具描述 |
| **来源覆盖数 (withSources)** | **0** | 当前未接入星铁材料来源 |
| **用途覆盖数 (withUsedBy)** | **0** | 当前未接入星铁材料用途 |

---

## 3. Phase 0 审计结论与核心瓶颈

1. **原神剧情 Region 链路断裂**：原始数据中 ChapterExcelConfigData.cityId 明确存在，但转换层与 Read Model 未打通，导致“未知地区”。
2. **原神材料来源与用途全部为零**：sources: [] 与 usedBy: [] 天然为空，导致 UI 展现空白。
3. **原神材料分类粗糙**：旧粗暴算法导致高达 44.4% 的材料被归类为 other。
4. **星铁与原神数据系统割裂**：星铁 Mission Talks 与 Archive Story Read Model 完全未连通。