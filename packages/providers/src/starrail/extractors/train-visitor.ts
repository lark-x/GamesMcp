import { resolve } from "node:path";
import { normalizeStarRailText, hasLikelyNarrativeText } from "../corpus/normalizer.js";
import type { ExtractorInput, ExtractorResult } from "./shared.js";
import {
  extractRecordDocuments,
  firstResolved,
  formatConversation,
  readSafeJsonFile,
} from "./shared.js";

export async function extractTrainVisitorDocuments(
  input: ExtractorInput,
): Promise<ExtractorResult> {
  const visitorItem = input.inventory.items.find(
    (i) => i.path === "ExcelOutput/TrainVisitorConfig.json",
  );
  if (visitorItem) {
    const avatarItem = input.inventory.items.find(
      (i) => i.path === "ExcelOutput/AvatarConfig.json",
    );
    const avatarMap = new Map<number, string>();
    if (avatarItem) {
      const avatars = await readSafeJsonFile<Array<Record<string, unknown>>>(
        resolve(input.dataDir, avatarItem.path),
      );
      if (Array.isArray(avatars)) {
        for (const a of avatars) {
          const avatarId = Number(a.AvatarID);
          const nameCandidate = a.AvatarName ?? a.Name;
          const name =
            nameCandidate && typeof nameCandidate === "object"
              ? input.resolver.resolve(
                  (nameCandidate as Record<string, unknown>).Hash as string | number,
                )
              : undefined;
          if (avatarId && name) avatarMap.set(avatarId, name);
        }
      }
    }

    const visitors = await readSafeJsonFile<Array<Record<string, unknown>>>(
      resolve(input.dataDir, visitorItem.path),
    );
    if (Array.isArray(visitors)) {
      const result: ExtractorResult = { documents: [], issues: [], unresolvedText: 0 };
      for (const v of visitors) {
        const id = Number(v.VisitorID);
        if (!Number.isInteger(id)) continue;
        const avatarId = Number(v.AvatarID);
        const avatarName = avatarMap.get(avatarId) ?? `访客 ${id}`;
        const title = `${avatarName}：列车访客`;
        const lines = [`# ${title}`, "", `VisitorID：${id}`];
        if (avatarId) lines.push(`AvatarID：${avatarId}`);
        if (v.MissionID) lines.push(`MissionID：${v.MissionID}`);
        lines.push("");

        const resolveHash = (val: unknown): string | null => {
          if (!val || typeof val !== "object") return null;
          const hash = (val as Record<string, unknown>).Hash;
          return hash ? input.resolver.resolve(hash as string | number) : null;
        };

        const comeText = resolveHash(v.MessageCome);
        if (comeText) lines.push(`[来访留言] ${comeText}`);
        const leaveText = resolveHash(v.MessageLeave);
        if (leaveText) lines.push(`[离开留言] ${leaveText}`);
        const residentText = resolveHash(v.MessageResident);
        if (residentText) lines.push(`[常驻留言] ${residentText}`);

        const content = normalizeStarRailText(lines.join("\n"));
        if (!hasLikelyNarrativeText(content)) {
          result.issues.push({
            code: "empty_or_non_narrative_document",
            message: `Skipped non-narrative train visitor document`,
            sourcePath: visitorItem.path,
            sourceId: String(id),
          });
          continue;
        }

        result.documents.push({
          category: "sr_train_visitor",
          id,
          relativePath: `sr_train_visitor/${id}.txt`,
          title,
          content,
          sourceFiles: [visitorItem.path, ...(avatarItem ? [avatarItem.path] : [])],
          sourceIds: [`VisitorID:${id}`],
          metadata: {
            source: "turn-based-game-data",
            sourceCommit: input.sourceRef,
            sourcePath: visitorItem.path,
          },
          hierarchy: {
            parentId: avatarId ? `sr_character:${avatarId}` : "sr_train_visitor",
            label: "Train Visitor",
            order: id,
          },
        });
      }
      return result;
    }
  }

  // Fallback for fixture
  return extractRecordDocuments({
    extractor: input,
    category: "sr_train_visitor",
    matchPath: (path) => /train.*visitor|visitor.*train|TrainVisitor/iu.test(path),
    naturalIdKeys: ["VisitorID", "TrainVisitorID", "AvatarID"],
    titleKeys: ["TitleTextMapHash", "AvatarNameTextMapHash", "NameTextMapHash", "Title", "Name"],
    bodyKeys: ["TextMapHash", "ContentTextMapHash", "Text", "Content"],
    sourceIdPrefix: "VisitorID",
    relativePathFor: (id) => `sr_train_visitor/${id}.txt`,
    format: (record, context) =>
      formatConversation({
        title: firstResolved(record, ["TitleTextMapHash", "Title", "Name"], context) ?? "列车访客",
        record,
        context,
        containers: ["Talks", "Dialogues", "Dialogs", "Sentences", "Sections", "Lines"],
      }),
    hierarchy: (id) => ({ parentId: "sr_train_visitor", label: "Train Visitor", order: id }),
  });
}
