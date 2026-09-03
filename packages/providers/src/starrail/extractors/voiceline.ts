import { resolve } from "node:path";
import { normalizeStarRailText, hasLikelyNarrativeText } from "../corpus/normalizer.js";
import type { ExtractorInput, ExtractorResult } from "./shared.js";
import { extractRecordDocuments, firstResolved, readSafeJsonFile } from "./shared.js";

export async function extractVoiceLineDocuments(input: ExtractorInput): Promise<ExtractorResult> {
  const atlasItem = input.inventory.items.find((i) => i.path === "ExcelOutput/VoiceAtlas.json");
  if (atlasItem) {
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

    const voices = await readSafeJsonFile<Array<Record<string, unknown>>>(
      resolve(input.dataDir, atlasItem.path),
    );
    if (Array.isArray(voices)) {
      const result: ExtractorResult = { documents: [], issues: [], unresolvedText: 0 };
      for (const v of voices) {
        const voiceId = Number(v.VoiceID);
        const avatarId = Number(v.AvatarID);
        if (!Number.isInteger(voiceId) || !Number.isInteger(avatarId)) continue;
        const id = avatarId * 1000 + voiceId;

        const character = avatarMap.get(avatarId) ?? `角色 ${avatarId}`;
        const resolveHash = (val: unknown): string | null => {
          if (!val || typeof val !== "object") return null;
          const hash = (val as Record<string, unknown>).Hash;
          return hash ? input.resolver.resolve(hash as string | number) : null;
        };

        const voiceTitle = resolveHash(v.VoiceTitle) ?? `语音 ${voiceId}`;
        const title = `${character}：${voiceTitle}`;

        const voiceM = resolveHash(v.Voice_M);
        const voiceF = resolveHash(v.Voice_F);
        const lines = [`# ${character}：角色语音`, `## ${voiceTitle}`, ""];
        if (voiceM && voiceF && voiceM !== voiceF) {
          lines.push(`[男主] ${voiceM}`, "", `[女主] ${voiceF}`);
        } else {
          const text = voiceM ?? voiceF;
          if (text) lines.push(text);
        }

        const content = normalizeStarRailText(lines.join("\n"));
        if (!hasLikelyNarrativeText(content)) {
          result.issues.push({
            code: "empty_or_non_narrative_document",
            message: `Skipped non-narrative voice line`,
            sourcePath: atlasItem.path,
            sourceId: `${avatarId}:${voiceId}`,
          });
          continue;
        }

        result.documents.push({
          category: "sr_voiceline",
          id,
          relativePath: `sr_voiceline/${id}.txt`,
          title,
          content,
          sourceFiles: [atlasItem.path, ...(avatarItem ? [avatarItem.path] : [])],
          sourceIds: [`AvatarID:${avatarId}:VoiceID:${voiceId}`],
          metadata: {
            source: "turn-based-game-data",
            sourceCommit: input.sourceRef,
            sourcePath: atlasItem.path,
          },
          hierarchy: {
            parentId: avatarId ? `sr_character:${avatarId}` : "sr_voiceline",
            label: "Voice Line",
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
    category: "sr_voiceline",
    matchPath: (path) =>
      /avatar.*voice|AvatarVoiceConfig/iu.test(path) ||
      (/voice/iu.test(path) && !/VoiceConfig/iu.test(path)),
    naturalIdKeys: ["VoiceID", "AvatarID", "CharacterID"],
    titleKeys: ["AvatarNameTextMapHash", "CharacterNameTextMapHash", "AvatarName", "Name"],
    bodyKeys: ["VoiceTextMapHash", "TextMapHash", "ContentTextMapHash", "Voice", "Text", "Content"],
    sourceIdPrefix: "VoiceID",
    relativePathFor: (id) => `sr_voiceline/${id}.txt`,
    format: (record, context) => {
      const character =
        firstResolved(record, ["AvatarNameTextMapHash", "AvatarName", "Name"], context) ??
        "角色语音";
      const title = firstResolved(
        record,
        ["VoiceTitleTextMapHash", "TitleTextMapHash", "Title"],
        context,
      );
      const voice = firstResolved(
        record,
        ["VoiceTextMapHash", "TextMapHash", "Voice", "Text"],
        context,
      );
      return [`# ${character}：角色语音`, title ? `## ${title}` : undefined, "", voice]
        .filter((line): line is string => typeof line === "string")
        .join("\n");
    },
    hierarchy: (id, record) => ({
      parentId: record.AvatarID ? `sr_character:${String(record.AvatarID)}` : "sr_voiceline",
      label: "Voice Line",
      order: id,
    }),
  });
}
