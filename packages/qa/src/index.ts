import type { RuntimeConfig } from "@gip/config";
import type { Citation, ClaimStatus, EvidenceAnswer } from "@gip/contracts";
import type { ClaimView, EntityDetail, KnowledgeRepository } from "@gip/domain";

export * from "./evaluation.js";

type QaDocument = NonNullable<Awaited<ReturnType<KnowledgeRepository["getDocument"]>>>;
type QaSegment = QaDocument["segments"][number];

type QaEvidence = Citation & {
  sourceNumber: number;
  claimStatuses: ClaimStatus[];
  claimIds: string[];
};

type ClaimContext = {
  id: string;
  statement: string;
  status: ClaimStatus;
  segmentIds: Set<string>;
};

type LlmResult = { answer: string; warnings: string[] };

export class QaError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 502,
  ) {
    super(message);
  }
}

export class EvidenceQaService {
  constructor(
    private readonly repository: KnowledgeRepository,
    private readonly config: RuntimeConfig,
  ) {}

  async answer(
    gameId: string,
    question: string,
    maxEvidence = 8,
    revisionId?: string,
  ): Promise<EvidenceAnswer> {
    const search = await this.repository.search(gameId, {
      query: question,
      types: ["entity", "document", "segment"],
      limit: Math.min(maxEvidence, 20),
      revisionId,
      debug: false,
    });
    const evidenceBySegment = new Map<string, QaEvidence>();
    const claimContexts = new Map<string, ClaimContext>();

    for (const result of search.segments.slice(0, maxEvidence)) {
      const document = await this.repository.getDocument(gameId, result.id, search.revisionId);
      const segment = document?.segments.find((item) => item.id === result.segmentId);
      if (!document || !segment) continue;
      this.addEvidence(evidenceBySegment, document, segment, segment.body);
    }

    if (typeof this.repository.getEntity === "function") {
      for (const entity of search.entities.slice(0, 5)) {
        const detail = await this.repository
          .getEntity(gameId, entity.id, search.revisionId)
          .catch(() => null);
        if (!detail) continue;
        await this.collectClaimEvidence(
          gameId,
          detail,
          search.revisionId,
          evidenceBySegment,
          claimContexts,
          maxEvidence,
        );
      }
    }

    const evidence = [...evidenceBySegment.values()].slice(0, maxEvidence);
    const relatedEntities = search.entities
      .slice(0, 5)
      .map((entity) => ({ id: entity.id, name: entity.name, type: entity.type }));
    const conflictWarnings = this.detectConflicts([...claimContexts.values()]);
    if (!evidence.length) {
      return {
        answer: "当前资料不足以确定。",
        confidence: "insufficient",
        citations: [],
        relatedEntities,
        datasetRevision: search.revision,
        warnings: ["没有找到可引用的已发布证据。", ...conflictWarnings],
      };
    }

    for (let index = 0; index < evidence.length; index += 1) {
      const item = evidence[index];
      if (item) item.sourceNumber = index + 1;
    }
    const citations = evidence.map((item) => this.asCitation(item));
    const fallback = this.fallbackAnswer(question, evidence, conflictWarnings);
    if (!this.config.llm.baseUrl || !this.config.llm.modelId) {
      return {
        answer: fallback,
        confidence: conflictWarnings.length ? "medium" : evidence.length >= 2 ? "medium" : "low",
        citations,
        relatedEntities,
        datasetRevision: search.revision,
        warnings: ["未配置 LLM，当前使用证据摘要模式。", ...conflictWarnings],
      };
    }

    const llm = await this.callLlm(
      question,
      evidence,
      [...claimContexts.values()],
      conflictWarnings,
    );
    return {
      answer: llm.answer || fallback,
      confidence: conflictWarnings.length ? "medium" : evidence.length >= 3 ? "high" : "medium",
      citations,
      relatedEntities,
      datasetRevision: search.revision,
      warnings: [...conflictWarnings, ...llm.warnings],
    };
  }

  validateCitations(answer: string, citations: Citation[]): { valid: boolean; warnings: string[] } {
    const references = [...answer.matchAll(/\[S(\d+)\]/g)].map((match) => Number(match[1]));
    const warnings = references.length
      ? references
          .filter((reference) => reference < 1 || reference > citations.length)
          .map((reference) => `引用不存在: ${reference}`)
      : ["模型回答未提供可识别的来源引用"];
    return { valid: references.length > 0 && warnings.length === 0, warnings };
  }

  private async collectClaimEvidence(
    gameId: string,
    entity: EntityDetail,
    revisionId: string | undefined,
    evidenceBySegment: Map<string, QaEvidence>,
    claimContexts: Map<string, ClaimContext>,
    maxEvidence: number,
  ): Promise<void> {
    for (const summary of entity.documents.slice(0, maxEvidence)) {
      const document = await this.repository.getDocument(gameId, summary.id, revisionId);
      const segment = document?.segments[0];
      if (document && segment) this.addEvidence(evidenceBySegment, document, segment, segment.body);
      if (evidenceBySegment.size >= maxEvidence) break;
    }
    for (const claim of entity.claims) {
      const context = claimContexts.get(claim.id) ?? {
        id: claim.id,
        statement: claim.statement,
        status: claim.status,
        segmentIds: new Set<string>(),
      };
      claimContexts.set(claim.id, context);
      for (const item of claim.evidence) {
        const document = await this.repository.getDocument(gameId, item.documentId, revisionId);
        const segment = document?.segments.find((candidate) => candidate.id === item.segmentId);
        if (!document || !segment) continue;
        context.segmentIds.add(segment.id);
        const existing = evidenceBySegment.get(segment.id);
        if (existing) {
          if (!existing.claimStatuses.includes(claim.status))
            existing.claimStatuses.push(claim.status);
          if (!existing.claimIds.includes(claim.id)) existing.claimIds.push(claim.id);
          continue;
        }
        if (evidenceBySegment.size >= maxEvidence) continue;
        this.addEvidence(evidenceBySegment, document, segment, item.quote || segment.body, claim);
      }
    }
  }

  private addEvidence(
    evidenceBySegment: Map<string, QaEvidence>,
    document: QaDocument,
    segment: QaSegment,
    quote: string,
    claim?: ClaimView,
  ): void {
    const existing = evidenceBySegment.get(segment.id);
    if (existing) {
      if (claim && !existing.claimStatuses.includes(claim.status))
        existing.claimStatuses.push(claim.status);
      if (claim && !existing.claimIds.includes(claim.id)) existing.claimIds.push(claim.id);
      return;
    }
    evidenceBySegment.set(segment.id, {
      sourceNumber: evidenceBySegment.size + 1,
      documentId: document.id,
      sourceKey: document.sourceKey,
      sourceVersion: document.sourceVersion,
      documentTitle: document.title,
      segmentId: segment.id,
      quote: quote.slice(0, 1_200),
      sourceName: document.sourceName,
      gameVersion: document.gameVersion ?? null,
      datasetRevision: document.revision ?? "",
      claimStatuses: claim ? [claim.status] : [],
      claimIds: claim ? [claim.id] : [],
    });
  }

  private detectConflicts(claims: ClaimContext[]): string[] {
    const groups = new Map<string, ClaimContext[]>();
    for (const claim of claims) {
      const key = claim.statement
        .normalize("NFKC")
        .replace(/\s+/g, " ")
        .trim()
        .toLocaleLowerCase("zh-CN");
      groups.set(key, [...(groups.get(key) ?? []), claim]);
    }
    const warnings: string[] = [];
    for (const [statement, group] of groups) {
      const statuses = [...new Set(group.map((claim) => claim.status))];
      if (statuses.length > 1)
        warnings.push(`发现主张状态冲突：${statement}（${statuses.join("、")}）`);
    }
    return warnings;
  }

  private asCitation(item: QaEvidence): Citation {
    return {
      documentId: item.documentId,
      sourceKey: item.sourceKey,
      sourceVersion: item.sourceVersion,
      documentTitle: item.documentTitle,
      segmentId: item.segmentId,
      quote: item.quote,
      sourceName: item.sourceName,
      gameVersion: item.gameVersion,
      datasetRevision: item.datasetRevision,
    };
  }

  private fallbackAnswer(
    question: string,
    evidence: QaEvidence[],
    conflictWarnings: string[],
  ): string {
    const lines = evidence
      .slice(0, 3)
      .map((item) => `- ${item.quote.replace(/\s+/g, " ").slice(0, 420)} [S${item.sourceNumber}]`);
    const conflict = conflictWarnings.length ? `\n\n状态提示：${conflictWarnings.join("；")}` : "";
    return `基于当前已发布资料，对“${question}”可确认的相关内容如下：\n${lines.join("\n")}${conflict}\n\n以上内容仅代表资料中的直接证据；未被引用支持的部分不能视为确定事实。`;
  }

  private async callLlm(
    question: string,
    evidence: QaEvidence[],
    claims: ClaimContext[],
    conflictWarnings: string[],
  ): Promise<LlmResult> {
    const rawContext = evidence
      .map(
        (item) =>
          `[S${item.sourceNumber}] ${item.documentTitle} (${item.sourceName}, ${item.gameVersion ?? "游戏版本未知"}, source version ${item.sourceVersion ?? "未知"})\n${item.quote}`,
      )
      .join("\n\n");
    const rawClaimContext = claims
      .map((claim, index) => {
        const sourceNumbers = evidence
          .filter((item) => claim.segmentIds.has(item.segmentId))
          .map((item) => `S${item.sourceNumber}`)
          .join(", ");
        return `[C${index + 1}] status=${claim.status} evidence=${sourceNumbers || "none"} ${claim.statement}`;
      })
      .join("\n");
    const contextBudget = Math.max(1_000, this.config.llm.maxContextChars);
    const context = rawContext.slice(0, contextBudget);
    const claimContext = rawClaimContext.slice(0, Math.max(0, contextBudget - context.length));
    const contextWarning =
      rawContext.length > context.length || rawClaimContext.length > claimContext.length
        ? ["LLM 上下文已按配置长度截断。"]
        : [];
    const body = JSON.stringify({
      model: this.config.llm.modelId,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "你是证据优先的游戏叙事问答助手。只能依据给出的资料回答；事实性句子必须使用 [S1] 形式引用；主张状态必须原样区分 confirmed、implied、interpretation、theory、outdated、rejected；状态冲突时并列说明；资料不足时明确说无法确定；不要虚构文档、片段或引用。",
        },
        {
          role: "user",
          content: `问题：${question}\n\n资料：\n${context}\n\n主张状态：\n${claimContext || "无"}\n\n已有冲突提示：${conflictWarnings.join("；") || "无"}`,
        },
      ],
    });
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.config.llm.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.llm.timeoutMs);
      try {
        const response = await fetch(
          `${this.config.llm.baseUrl!.replace(/\/$/, "")}/chat/completions`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...(this.config.llm.apiKey
                ? { authorization: `Bearer ${this.config.llm.apiKey}` }
                : {}),
            },
            body,
            signal: controller.signal,
          },
        );
        if (!response.ok)
          throw new QaError("llm_http_error", `LLM request failed with status ${response.status}`);
        const json: unknown = await response.json();
        const content = (json as { choices?: Array<{ message?: { content?: unknown } }> })
          .choices?.[0]?.message?.content;
        if (typeof content !== "string" || !content.trim())
          throw new QaError("llm_empty_response", "LLM returned an empty response");
        const validation = this.validateCitations(
          content,
          evidence.map((item) => this.asCitation(item)),
        );
        const references = [...content.matchAll(/\[S(\d+)\]/g)];
        if (!validation.valid || !references.length)
          return {
            answer: this.fallbackAnswer(question, evidence, conflictWarnings),
            warnings: [
              ...(validation.warnings.length
                ? validation.warnings
                : ["模型回答未提供可识别的引用标记"]),
              "已保留结构化证据摘要。",
              ...contextWarning,
            ],
          };
        return { answer: content.trim(), warnings: contextWarning };
      } catch (error) {
        lastError = error;
      } finally {
        clearTimeout(timer);
      }
    }
    throw new QaError(
      "llm_unavailable",
      lastError instanceof Error ? lastError.message : "LLM is unavailable",
    );
  }
}
