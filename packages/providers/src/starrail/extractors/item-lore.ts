import type { ExtractorInput, ExtractorResult } from "./shared.js";
import { extractRecordDocuments, firstResolved } from "./shared.js";

export function extractItemLoreDocuments(input: ExtractorInput): Promise<ExtractorResult> {
  return extractRecordDocuments({
    extractor: input,
    category: "sr_item_lore",
    matchPath: (path) => /item|material|equipment|lightcone|relic/iu.test(path),
    naturalIdKeys: ["ItemID", "EquipmentID", "RelicID", "MaterialID"],
    titleKeys: [
      "ItemNameTextMapHash",
      "NameTextMapHash",
      "TitleTextMapHash",
      "ItemName",
      "Name",
      "Title",
    ],
    bodyKeys: [
      "ItemDescTextMapHash",
      "DescTextMapHash",
      "LoreTextMapHash",
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
        ["ItemDescTextMapHash", "DescTextMapHash", "LoreTextMapHash", "Desc", "Lore"],
        context,
      );
      return [`# ${title}`, "", lore]
        .filter((line): line is string => typeof line === "string")
        .join("\n");
    },
    hierarchy: (id) => ({ parentId: "sr_item_lore", label: "Item Lore", order: id }),
  });
}
