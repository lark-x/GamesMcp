# StarRail P0 Corpus Source Mapping Specification

> Source Baseline: `DimbreathBot/TurnBasedGameData` @ `8cdb905dc2f8e6fffa9be4eb07af3e34435d6091`

This document defines the canonical source tables, primary keys, narrative text fields, and join strategies for all 8 P0 StarRail corpus categories.

---

## 1. Source Mapping Matrix

| Category             | Canonical Dataset(s)                                                                                                                                                 | Primary Keys                                       | Text Fields                                                                                   | Joins / Provenance                                                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `sr_mission`         | `ExcelOutput/MainMission.json`<br>`ExcelOutput/SubMission.json`<br>`Story/Mission/**`                                                                                | `MainMissionID`<br>`SubMissionID`                  | `Name.Hash`<br>`TargetText.Hash`<br>`DescrptionText.Hash`                                     | `MainMission` joined with child `SubMission`s. Supports fixture `Story/Mission/*.json`.                                             |
| `sr_story`           | `Story/Discussion/**`<br>`Story/SideStory.json`                                                                                                                      | `DiscussionID`<br>`StoryID`<br>`TalkSentenceID`    | `TextMapHash`<br>`TalkSentenceText.Hash`                                                      | Parses conversation branches, option texts, and discussion dialogues from narrative JSON trees.                                     |
| `sr_message`         | `ExcelOutput/MessageSectionConfig.json`<br>`ExcelOutput/MessageItemConfig.json`<br>`ExcelOutput/MessageContactsConfig.json`<br>`ExcelOutput/MessageGroupConfig.json` | `MessageSectionID`<br>`ID`                         | `Name.Hash`<br>`MainText.Hash`                                                                | `MessageGroupConfig` maps contact `MessageContactsID` to `MessageSectionIDList`. `MessageItemConfig` links messages by `SectionID`. |
| `sr_train_visitor`   | `ExcelOutput/TrainVisitorConfig.json`<br>`ExcelOutput/AvatarConfig.json`                                                                                             | `VisitorID`<br>`AvatarID`                          | `MessageCome.Hash`<br>`MessageLeave.Hash`<br>`MessageResident.Hash`<br>`AvatarName.Hash`      | `TrainVisitorConfig` joined with `AvatarConfig` on `AvatarID` to resolve character names and greeting/farewell dialogue.            |
| `sr_book`            | `ExcelOutput/LocalbookConfig.json`<br>`ExcelOutput/BookSeriesConfig.json`                                                                                            | `BookID`<br>`BookSeriesID`<br>`BookSeriesInsideID` | `BookInsideName.Hash`<br>`BookContent.Hash`<br>`BookSeries.Hash`<br>`BookSeriesComments.Hash` | `LocalbookConfig` represents individual book volumes; joins with `BookSeriesConfig` on `BookSeriesID`.                              |
| `sr_character_story` | `ExcelOutput/StoryAtlas.json`<br>`ExcelOutput/StoryAtlasTextmap.json`<br>`ExcelOutput/AvatarConfig.json`                                                             | `AvatarID`<br>`StoryID`                            | `Story.Hash`<br>`StoryName.Hash`<br>`AvatarName.Hash`                                         | `StoryAtlas` contains character story sections; joins `AvatarConfig` on `AvatarID` and `StoryAtlasTextmap` on `StoryID`.            |
| `sr_voiceline`       | `ExcelOutput/VoiceAtlas.json`<br>`ExcelOutput/AvatarConfig.json`                                                                                                     | `AvatarID`<br>`VoiceID`                            | `VoiceTitle.Hash`<br>`Voice_M.Hash`<br>`Voice_F.Hash`<br>`AvatarName.Hash`                    | `VoiceAtlas` contains character voiceline texts; joins `AvatarConfig` on `AvatarID`.                                                |
| `sr_item_lore`       | `ExcelOutput/ItemConfig.json`<br>`ExcelOutput/ItemConfigEquipment.json`<br>`ExcelOutput/ItemConfigRelic.json`                                                        | `ID` (ItemID / EquipmentID / RelicID)              | `ItemName.Hash`<br>`ItemDesc.Hash`<br>`ItemBGDesc.Hash`                                       | Filters strictly for items containing narrative background lore (`ItemBGDesc.Hash` or story content).                               |

---

## 2. TextMap Resolution & uint64 Preservation

`TurnBasedGameData` stores 64-bit integer hashes (e.g. `10926012491924913176`) as raw numeric JSON values. Because standard JavaScript `JSON.parse` uses 53-bit IEEE-754 numbers, large uint64 values undergo truncation without preservation.

- **Reader Boundary**: `readJsonRecords` quotes numbers with 15+ digits into strings before parsing (`:\s*(-?\d{15,})` -> `: "$1"`).
- **TextMap Lookup**: The stringified hash matches keys in `TextMap/TextMapCHS.json` losslessly.

---

## 3. Message Separation Architecture

To avoid conflating message references in mission flowcharts with genuine message content:

- Canonical message text is extracted from `MessageSectionConfig` + `MessageItemConfig` + `MessageContactsConfig`.
- `PlayMessage` or `MessageSectionID` references found in `Story/` or `Config/Level/Mission/` are treated solely as cross-references rather than duplicate message documents.

---

## 4. Stable Identity Invariants

1. All documents use native keys (`MissionID`, `MessageSectionID`, `BookID`, `AvatarID+StoryID`, etc.).
2. When composite IDs are needed, they use `category:composite_key`.
3. Array indices (`${item.path}:${index}`) are strictly forbidden as persistent stable IDs.
