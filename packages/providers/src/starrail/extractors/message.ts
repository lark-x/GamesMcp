import { resolve } from "node:path";
import { normalizeStarRailText, hasLikelyNarrativeText } from "../corpus/normalizer.js";
import type { ExtractorInput, ExtractorResult } from "./shared.js";
import {
  extractRecordDocuments,
  firstResolved,
  formatConversation,
  readSafeJsonFile,
} from "./shared.js";

export async function extractMessageDocuments(input: ExtractorInput): Promise<ExtractorResult> {
  const sectionItem = input.inventory.items.find(
    (i) => i.path === "ExcelOutput/MessageSectionConfig.json",
  );

  if (sectionItem) {
    const contactsItem = input.inventory.items.find(
      (i) => i.path === "ExcelOutput/MessageContactsConfig.json",
    );
    const groupItem = input.inventory.items.find(
      (i) => i.path === "ExcelOutput/MessageGroupConfig.json",
    );
    const itemConfig = input.inventory.items.find(
      (i) => i.path === "ExcelOutput/MessageItemConfig.json",
    );

    const contactMap = new Map<number, string>();
    if (contactsItem) {
      const contacts = await readSafeJsonFile<Array<Record<string, unknown>>>(
        resolve(input.dataDir, contactsItem.path),
      );
      if (Array.isArray(contacts)) {
        for (const c of contacts) {
          const id = Number(c.ID);
          const nameCandidate = c.Name;
          const name =
            nameCandidate && typeof nameCandidate === "object"
              ? input.resolver.resolve(
                  (nameCandidate as Record<string, unknown>).Hash as string | number,
                )
              : undefined;
          if (id && name) contactMap.set(id, name);
        }
      }
    }

    const sectionContactMap = new Map<number, { contactId: number; contactName: string }>();
    if (groupItem) {
      const groups = await readSafeJsonFile<Array<Record<string, unknown>>>(
        resolve(input.dataDir, groupItem.path),
      );
      if (Array.isArray(groups)) {
        for (const g of groups) {
          const contactId = Number(g.MessageContactsID);
          const contactName = contactMap.get(contactId) ?? `联系人 ${contactId}`;
          const sectionList = Array.isArray(g.MessageSectionIDList) ? g.MessageSectionIDList : [];
          for (const sId of sectionList) {
            sectionContactMap.set(Number(sId), { contactId, contactName });
          }
        }
      }
    }

    const sectionItemsMap = new Map<number, Array<Record<string, unknown>>>();
    if (itemConfig) {
      const items = await readSafeJsonFile<Array<Record<string, unknown>>>(
        resolve(input.dataDir, itemConfig.path),
      );
      if (Array.isArray(items)) {
        for (const it of items) {
          const sId = Number(it.SectionID);
          if (!Number.isInteger(sId)) continue;
          const list = sectionItemsMap.get(sId) ?? [];
          list.push(it);
          sectionItemsMap.set(sId, list);
        }
      }
    }

    const sections = await readSafeJsonFile<Array<Record<string, unknown>>>(
      resolve(input.dataDir, sectionItem.path),
    );
    if (Array.isArray(sections)) {
      const result: ExtractorResult = { documents: [], issues: [], unresolvedText: 0 };

      for (const section of sections) {
        const id = Number(section.ID);
        if (!Number.isInteger(id)) continue;

        const contactInfo = sectionContactMap.get(id);
        const contactName = contactInfo?.contactName ?? "未知联系人";
        const title = `${contactName}：短信会话`;

        const lines = [`# ${title}`, "", `MessageSectionID：${id}`];
        if (contactInfo?.contactId) {
          lines.push(`ContactID：${contactInfo.contactId}`);
        }
        lines.push("");

        const items = sectionItemsMap.get(id) ?? [];
        for (const it of items) {
          const textCandidate = it.MainText;
          const text =
            textCandidate && typeof textCandidate === "object"
              ? input.resolver.resolve(
                  (textCandidate as Record<string, unknown>).Hash as string | number,
                )
              : undefined;
          if (!text || !text.trim()) continue;

          const sender =
            it.Sender === "Player" ? "开拓者" : it.Sender === "System" ? "系统提示" : contactName;
          lines.push(`${sender}：${text}`);
        }

        const content = normalizeStarRailText(lines.join("\n"));
        if (!hasLikelyNarrativeText(content)) {
          result.issues.push({
            code: "empty_or_non_narrative_document",
            message: `Skipped empty/non-narrative message section`,
            sourcePath: sectionItem.path,
            sourceId: String(id),
          });
          continue;
        }

        const sourceFiles = [sectionItem.path];
        if (contactsItem) sourceFiles.push(contactsItem.path);
        if (groupItem) sourceFiles.push(groupItem.path);
        if (itemConfig) sourceFiles.push(itemConfig.path);

        result.documents.push({
          category: "sr_message",
          id,
          relativePath: `sr_message/${id}.txt`,
          title,
          content,
          sourceFiles,
          sourceIds: [`MessageSectionID:${id}`],
          metadata: {
            source: "turn-based-game-data",
            sourceCommit: input.sourceRef,
            sourcePath: sectionItem.path,
          },
          hierarchy: {
            parentId: contactInfo?.contactId
              ? `sr_character:${contactInfo.contactId}`
              : "sr_message",
            label: "Message",
            order: id,
          },
        });
      }

      if (result.documents.length > 0) {
        return result;
      }
    }
  }

  // Fallback for fixture
  return extractRecordDocuments({
    extractor: input,
    category: "sr_message",
    matchPath: (path) => /(?:Config\/Message\/|MessageConfig)/iu.test(path),
    naturalIdKeys: ["MessageSectionID", "MessageID", "SectionID"],
    titleKeys: ["ContactTextMapHash", "SenderTextMapHash", "TitleTextMapHash", "Contact", "Title"],
    bodyKeys: ["MainTextMapHash", "TextMapHash", "ContentTextMapHash", "MainText", "Content"],
    sourceIdPrefix: "MessageSectionID",
    relativePathFor: (id) => `sr_message/${id}.txt`,
    format: (record, context) => {
      const title =
        firstResolved(record, ["ContactTextMapHash", "Contact", "Title"], context) ?? "短信会话";
      const faction = firstResolved(record, ["FactionTextMapHash", "Faction"], context);
      return formatConversation({
        title: `${title}：短信会话`,
        subtitle: faction ? `阵营：${faction}` : undefined,
        record,
        context,
        containers: ["Messages", "Sections", "Dialogues", "Lines"],
      });
    },
    hierarchy: (id) => ({ parentId: "sr_message", label: "Message", order: id }),
  });
}
