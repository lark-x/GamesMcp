import type { StarRailCorpusDocument, StarRailCorpusMetadata } from "./types.js";

export function buildStarRailHierarchy(
  documents: StarRailCorpusDocument[],
): StarRailCorpusMetadata["hierarchy"] {
  const grouped: StarRailCorpusMetadata["hierarchy"] = {};
  for (const document of documents) {
    const group = (grouped[document.category] ??= { nodes: [] });
    group.nodes.push({
      key: `${document.category}:${document.id}`,
      title: document.title,
      children: null,
      file_id: document.id,
      toc_eligible: false,
    });
  }
  for (const category of Object.keys(grouped)) {
    grouped[category]?.nodes.sort((left, right) => left.file_id - right.file_id);
  }
  return Object.fromEntries(
    Object.entries(grouped).sort(([left], [right]) => left.localeCompare(right)),
  );
}
