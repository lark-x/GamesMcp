import { resolve } from "node:path";
import { normalizeStarRailText, hasLikelyNarrativeText } from "../corpus/normalizer.js";
import type { ExtractorInput, ExtractorResult } from "./shared.js";
import { extractRecordDocuments, firstResolved, readSafeJsonFile } from "./shared.js";

export async function extractCharacterStoryDocuments(
  input: ExtractorInput,
): Promise<ExtractorResult> {
  const atlasItem = input.inventory.items.find((i) => i.path === "ExcelOutput/StoryAtlas.json");
  if (atlasItem) {
    const avatarItem = input.inventory.items.find(
      (i) => i.path === "ExcelOutput/AvatarConfig.json",
    );
    const textmapItem = input.inventory.items.find(
      (i) => i.path === "ExcelOutput/StoryAtlasTextmap.json",
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

    const storyNameMap = new Map<number, string>();
    if (textmapItem) {
      const storyNames = await readSafeJsonFile<Array<Record<string, unknown>>>(
        resolve(input.dataDir, textmapItem.path),
      );
      if (Array.isArray(storyNames)) {
        for (const s of storyNames) {
          const storyId = Number(s.StoryID);
          const nameCandidate = s.StoryName ?? s.Name;
          const name =
            nameCandidate && typeof nameCandidate === "object"
              ? input.resolver.resolve(
                  (nameCandidate as Record<string, unknown>).Hash as string | number,
                )
              : undefined;
          if (storyId && name) storyNameMap.set(storyId, name);
        }
      }
    }

    const stories = await readSafeJsonFile<Array<Record<string, unknown>>>(
      resolve(input.dataDir, atlasItem.path),
    );
    if (Array.isArray(stories)) {
      const result: ExtractorResult = { documents: [], issues: [], unresolvedText: 0 };
      for (const s of stories) {
        const avatarId = Number(s.AvatarID);
        const storyId = Number(s.StoryID);
        if (!Number.isInteger(avatarId) || !Number.isInteger(storyId)) continue;
        const id = avatarId * 100 + storyId;

        const character = avatarMap.get(avatarId) ?? `角色 ${avatarId}`;
        const section = storyNameMap.get(storyId) ?? `角色故事 ${storyId}`;
        const title = `${character}：${section}`;

        const resolveHash = (val: unknown): string | null => {
          if (!val || typeof val !== "object") return null;
          const hash = (val as Record<string, unknown>).Hash;
          return hash ? input.resolver.resolve(hash as string | number) : null;
        };

        const storyText = resolveHash(s.Story);
        if (!storyText) {
          result.unresolvedText += 1;
          result.issues.push({
            code: "story_unresolved",
            message: `Could not resolve story text for Avatar ${avatarId} Story ${storyId}`,
            sourcePath: atlasItem.path,
            sourceId: `${avatarId}:${storyId}`,
          });
          continue;
        }

        const content = normalizeStarRailText(
          [`# ${character}`, `## ${section}`, "", storyText].join("\n"),
        );
        if (!hasLikelyNarrativeText(content)) {
          result.issues.push({
            code: "empty_or_non_narrative_document",
            message: `Skipped non-narrative character story`,
            sourcePath: atlasItem.path,
            sourceId: `${avatarId}:${storyId}`,
          });
          continue;
        }

        result.documents.push({
          category: "sr_character_story",
          id,
          relativePath: `sr_character_story/${id}.txt`,
          title,
          content,
          sourceFiles: [
            atlasItem.path,
            ...(avatarItem ? [avatarItem.path] : []),
            ...(textmapItem ? [textmapItem.path] : []),
          ],
          sourceIds: [`AvatarID:${avatarId}:StoryID:${storyId}`],
          metadata: {
            source: "turn-based-game-data",
            sourceCommit: input.sourceRef,
            sourcePath: atlasItem.path,
          },
          hierarchy: {
            parentId: `sr_character:${avatarId}`,
            label: "Character Story",
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
    category: "sr_character_story",
    matchPath: (path) => /avatar.*story|character.*story|fetter|profile/iu.test(path),
    naturalIdKeys: ["StoryID", "AvatarID", "CharacterID"],
    titleKeys: [
      "AvatarNameTextMapHash",
      "CharacterNameTextMapHash",
      "NameTextMapHash",
      "AvatarName",
      "Name",
    ],
    bodyKeys: [
      "StoryTextMapHash",
      "ContentTextMapHash",
      "DescTextMapHash",
      "Story",
      "Content",
      "Desc",
    ],
    sourceIdPrefix: "AvatarID",
    relativePathFor: (id) => `sr_character_story/${id}.txt`,
    format: (record, context) => {
      const character =
        firstResolved(record, ["AvatarNameTextMapHash", "AvatarName", "Name"], context) ?? "角色";
      const section = firstResolved(
        record,
        ["StoryTitleTextMapHash", "TitleTextMapHash", "Title"],
        context,
      );
      const story = firstResolved(
        record,
        ["StoryTextMapHash", "Story", "ContentTextMapHash", "Content"],
        context,
      );
      return [`# ${character}`, section ? `## ${section}` : undefined, "", story]
        .filter((line): line is string => typeof line === "string")
        .join("\n");
    },
    hierarchy: (id, record) => ({
      parentId: record.AvatarID ? `sr_character:${String(record.AvatarID)}` : "sr_character_story",
      label: "Character Story",
      order: id,
    }),
  });
}
