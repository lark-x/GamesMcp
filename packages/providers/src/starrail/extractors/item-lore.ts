import { resolve } from "node:path";
import { normalizeStarRailText, hasLikelyNarrativeText } from "../corpus/normalizer.js";
import type { ExtractorInput, ExtractorResult } from "./shared.js";
import { extractRecordDocuments, firstResolved, readSafeJsonFile } from "./shared.js";

const ITEM_TABLES = [
  { path: "ExcelOutput/ItemConfig.json", type: "Item", label: "道具背景" },
  { path: "ExcelOutput/ItemConfigEquipment.json", type: "Equipment", label: "光锥背景" },
  { path: "ExcelOutput/ItemConfigRelic.json", type: "Relic", label: "遗器背景" },
];

export async function extractItemLoreDocuments(input: ExtractorInput): Promise<ExtractorResult> {
  const presentTables = ITEM_TABLES.filter((t) =>
    input.inventory.items.some((i) => i.path === t.path),
  );

  if (
    presentTables.length > 0 &&
    input.inventory.items.some((i) => i.path === "ExcelOutput/ItemConfig.json")
  ) {
    const result: ExtractorResult = { documents: [], issues: [], unresolvedText: 0 };

    for (const table of presentTables) {
      const records = await readSafeJsonFile<Array<Record<string, unknown>>>(
        resolve(input.dataDir, table.path),
      );
      if (!Array.isArray(records)) continue;

      for (const record of records) {
        const id = Number(record.ID ?? record.ItemID ?? record.EquipmentID ?? record.RelicID);
        if (!Number.isInteger(id)) continue;

        const resolveHash = (val: unknown): string | null => {
          if (!val) return null;
          if (typeof val === "number" || typeof val === "string")
            return input.resolver.resolve(val);
          if (typeof val === "object") {
            const hash =
              (val as Record<string, unknown>).Hash ?? (val as Record<string, unknown>).hash;
            return hash ? input.resolver.resolve(hash as string | number) : null;
          }
          return null;
        };

        const name = resolveHash(record.ItemName) ?? resolveHash(record.Name) ?? `物品 ${id}`;
        const bgDesc = resolveHash(record.ItemBGDesc) ?? resolveHash(record.Lore);
        const desc = resolveHash(record.ItemDesc) ?? resolveHash(record.Desc);

        if (!bgDesc && !desc) {
          continue; // Skip virtual / non-narrative items without background description
        }

        const lines = [`# ${name}`, `类别：${table.label}`, ""];
        if (bgDesc) {
          lines.push("## 背景故事", bgDesc, "");
        }
        if (desc && desc !== bgDesc) {
          lines.push("## 物品描述", desc);
        }

        const content = normalizeStarRailText(lines.join("\n"));
        if (!hasLikelyNarrativeText(content)) {
          result.issues.push({
            code: "empty_or_non_narrative_document",
            message: `Skipped non-narrative item lore`,
            sourcePath: table.path,
            sourceId: String(id),
          });
          continue;
        }

        result.documents.push({
          category: "sr_item_lore",
          id,
          relativePath: `sr_item_lore/${id}.txt`,
          title: `${name}（${table.label}）`,
          content,
          sourceFiles: [table.path],
          sourceIds: [`ItemID:${id}`],
          metadata: {
            source: "turn-based-game-data",
            sourceCommit: input.sourceRef,
            sourcePath: table.path,
          },
          hierarchy: {
            parentId: "sr_item_lore",
            label: "Item Lore",
            order: id,
          },
        });
      }
    }

    if (result.documents.length > 0) {
      return result;
    }
  }

  // Fallback for fixture
  return extractRecordDocuments({
    extractor: input,
    category: "sr_item_lore",
    matchPath: (path) => /(?:ExcelOutput\/ItemConfig\.json|item)/iu.test(path),
    naturalIdKeys: ["ItemID", "ID", "EquipmentID", "RelicID", "MaterialID"],
    titleKeys: [
      "ItemNameTextMapHash",
      "NameTextMapHash",
      "TitleTextMapHash",
      "ItemName",
      "Name",
      "Title",
    ],
    bodyKeys: [
      "LoreTextMapHash",
      "ItemDescTextMapHash",
      "DescTextMapHash",
      "Desc",
      "Lore",
      "Content",
    ],
    sourceIdPrefix: "ItemID",
    relativePathFor: (id) => `sr_item_lore/${id}.txt`,
    format: (record, context) => {
      const title =
        firstResolved(
          record,
          ["ItemNameTextMapHash", "NameTextMapHash", "ItemName", "Name"],
          context,
        ) ?? "物品";
      const lore = firstResolved(
        record,
        ["LoreTextMapHash", "ItemDescTextMapHash", "DescTextMapHash", "Desc", "Lore"],
        context,
      );
      return [`# ${title}`, "", lore]
        .filter((line): line is string => typeof line === "string")
        .join("\n");
    },
    hierarchy: (id) => ({ parentId: "sr_item_lore", label: "Item Lore", order: id }),
  });
}
