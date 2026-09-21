import type { StarRailDialogueNode, StarRailDialogueOption } from "./types.js";
import type { StarRailTextMapResolver } from "../source/textmap.js";

export interface DialogueExtractorOptions {
  resolver: StarRailTextMapResolver;
  talkSentenceMap?: Map<number, { speaker: string; text: string }>;
}

export class StarRailDialogueExtractor {
  private readonly resolver: StarRailTextMapResolver;
  private readonly talkSentenceMap: Map<number, { speaker: string; text: string }>;

  constructor(options: DialogueExtractorOptions) {
    this.resolver = options.resolver;
    this.talkSentenceMap = options.talkSentenceMap ?? new Map();
  }

  /**
   * Directly extract structured dialogue nodes from raw Story JSON parsed structure
   */
  public extractNodes(rawJson: unknown, sourceFile: string): StarRailDialogueNode[] {
    const nodes: StarRailDialogueNode[] = [];
    let orderCounter = 0;

    const resolveHash = (val: unknown): string | null => {
      if (!val) return null;
      if (typeof val === "number" || typeof val === "string") {
        return this.resolver.resolve(val);
      }
      if (typeof val === "object") {
        const rec = val as Record<string, unknown>;
        const hash = rec.Hash ?? rec.hash ?? rec.TextMapHash;
        if (hash !== undefined && hash !== null) {
          return this.resolver.resolve(hash as string | number);
        }
      }
      return null;
    };

    const processRecord = (record: Record<string, unknown>) => {
      // 1. Direct TalkSentenceID reference
      if (record.TalkSentenceID !== undefined && record.TalkSentenceID !== null) {
        const sentenceId = Number(record.TalkSentenceID);
        let speakerName = "";
        let body = "";

        if (this.talkSentenceMap.has(sentenceId)) {
          const found = this.talkSentenceMap.get(sentenceId)!;
          speakerName = found.speaker;
          body = found.text;
        } else {
          // If sentence details are embedded directly
          speakerName =
            resolveHash(record.TextmapTalkSentenceName) ??
            resolveHash(record.SpeakerName) ??
            (typeof record.Speaker === "string" ? record.Speaker : "");
          body =
            resolveHash(record.TalkSentenceText) ??
            resolveHash(record.Text) ??
            resolveHash(record.Content) ??
            "";
        }

        if (body.trim()) {
          orderCounter++;
          const nodeId = String(record.NodeID ?? record.ID ?? `talk_${sentenceId}_${orderCounter}`);
          const isOptionSentence =
            String(record.$type ?? "").includes("OptionTalkInfo") ||
            record.OptionIconType !== undefined ||
            record.IsOption === true;
          const nodeType: StarRailDialogueNode["nodeType"] = isOptionSentence
            ? "option"
            : speakerName
              ? "dialogue"
              : "narrator";

          // Parse options if attached to this node
          const options: StarRailDialogueOption[] = [];
          if (Array.isArray(record.Options)) {
            for (let i = 0; i < record.Options.length; i++) {
              const opt = record.Options[i];
              if (opt && typeof opt === "object") {
                const optRec = opt as Record<string, unknown>;
                const optText =
                  resolveHash(optRec.TextMapHash) ??
                  resolveHash(optRec.Text) ??
                  (typeof optRec.Text === "string" ? optRec.Text : "");
                if (optText.trim()) {
                  options.push({
                    id: String(optRec.OptionID ?? optRec.ID ?? `opt_${i}`),
                    text: optText.trim(),
                    nextNodeId: optRec.NextNodeID ? String(optRec.NextNodeID) : undefined,
                  });
                }
              }
            }
          }

          nodes.push({
            nodeId,
            nodeType,
            speakerId: record.SpeakerID !== undefined ? (record.SpeakerID as string | number) : undefined,
            speakerName: speakerName.trim() || undefined,
            body: body.trim(),
            order: orderCounter,
            options: options.length > 0 ? options : undefined,
            sourceFile,
          });
        }
      }

      // 2. Direct Options block without parent sentence
      if (
        record.Options &&
        Array.isArray(record.Options) &&
        (record.TalkSentenceID === undefined || record.TalkSentenceID === null)
      ) {
        const standaloneOptions: StarRailDialogueOption[] = [];
        for (let i = 0; i < record.Options.length; i++) {
          const opt = record.Options[i];
          if (opt && typeof opt === "object") {
            const optRec = opt as Record<string, unknown>;
            const optText =
              resolveHash(optRec.TextMapHash) ??
              resolveHash(optRec.Text) ??
              (typeof optRec.Text === "string" ? optRec.Text : "");
            if (optText.trim()) {
              standaloneOptions.push({
                id: String(optRec.OptionID ?? optRec.ID ?? `opt_${i}`),
                text: optText.trim(),
                nextNodeId: optRec.NextNodeID ? String(optRec.NextNodeID) : undefined,
              });
            }
          }
        }

        if (standaloneOptions.length > 0) {
          orderCounter++;
          nodes.push({
            nodeId: String(record.NodeID ?? record.ID ?? `opt_group_${orderCounter}`),
            nodeType: "option",
            body: "玩家分支选项",
            order: orderCounter,
            options: standaloneOptions,
            sourceFile,
          });
        }
      }
    };

    const walk = (val: unknown) => {
      if (!val || typeof val !== "object") return;
      if (Array.isArray(val)) {
        for (const item of val) walk(item);
        return;
      }
      const rec = val as Record<string, unknown>;
      processRecord(rec);
      for (const child of Object.values(rec)) {
        walk(child);
      }
    };

    walk(rawJson);
    return nodes;
  }
}
