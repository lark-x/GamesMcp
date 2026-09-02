export { TextResolver, cleanUpstreamText } from "./text-resolver.js";
export type { ResolvedText, FallbackLocaleText } from "./text-resolver.js";
export { hashInput } from "./context.js";
export type { AnimeContext } from "./context.js";
export type {
  AnimeTextExtractor,
  ExtractionResult,
  ExtractionWarning,
  ExtractionFailure,
  ExtractionCoverage,
} from "./extractor.js";
export { buildManifest } from "./manifest.js";
export type { ExtractorManifest } from "./manifest.js";
export { stableStringify, idValue, escapeLike } from "./helpers.js";
export { loadSourceJson } from "./source-files.js";
export type { SourceFile } from "./source-files.js";
export {
  CharacterStoryExtractor,
  characterStoryExtractor,
  buildCharacterStoryManifest,
  extractCharacterStories,
  segmentCharacterStoryBody,
  CHARACTER_STORY_EXTRACTOR_ID,
  CHARACTER_STORY_EXTRACTOR_VERSION,
  CHARACTER_STORY_INPUTS,
  CHARACTER_STORY_REQUIRED_INPUTS,
} from "./character-story/extractor.js";
export type {
  CharacterStoryRecord,
  CharacterStorySegment,
  CharacterStoryUnlockMetadata,
  CharacterStoryExtractionResult,
  TextResolution as CharacterStoryTextResolution,
} from "./character-story/extractor.js";
export {
  VoiceExtractor,
  voiceExtractor,
  buildVoiceManifest,
  extractVoices,
  parseRelatedEntityStableId,
  VOICE_EXTRACTOR_ID,
  VOICE_EXTRACTOR_VERSION,
  VOICE_INPUTS,
  VOICE_REQUIRED_INPUTS,
} from "./voice/extractor.js";
export type { VoiceRecord, VoiceExtractionResult, VoiceTextResolution } from "./voice/extractor.js";
export {
  buildDialogueManifest,
  dialogueExtractor,
  DialogueExtractor,
  extractDialogue,
  DIALOGUE_EXTRACTOR_ID,
  DIALOGUE_EXTRACTOR_VERSION,
  DIALOGUE_REQUIRED_INPUTS,
} from "./dialogue/extractor.js";
export type {
  DialogueExtractionResult,
  DialogueNodeType,
  DialogueRecord,
  DialogueTextResolution,
} from "./dialogue/extractor.js";
export {
  buildItemTextManifest,
  extractItemTexts,
  itemTextExtractor,
  ItemTextExtractor,
  segmentItemStoryText,
  ITEM_TEXT_EXTRACTOR_ID,
  ITEM_TEXT_EXTRACTOR_VERSION,
  ITEM_TEXT_INPUTS,
  ITEM_TEXT_REQUIRED_INPUTS,
  ITEM_TEXT_TYPES,
  ITEM_TYPE_MAPPING,
} from "./item-text/extractor.js";
export type {
  ItemTextExtractionResult,
  ItemTextItemType,
  ItemTextRecord,
  ItemTextResolution,
  ItemTextSegment,
  ItemType,
} from "./item-text/extractor.js";
export {
  MechanismExtractor,
  mechanismExtractor,
  buildMechanismManifest,
  extractMechanisms,
  mapMechanismCategory,
  MECHANISM_EXTRACTOR_ID,
  MECHANISM_EXTRACTOR_VERSION,
  MECHANISM_INPUTS,
  MECHANISM_SOURCE_PATHS,
  MECHANISM_AUXILIARY_INPUTS,
  MECHANISM_REQUIRED_INPUTS,
} from "./mechanism/extractor.js";
export type {
  MechanismRecord,
  MechanismCategory,
  MechanismExtractionResult,
  MechanismTextResolution,
} from "./mechanism/extractor.js";
