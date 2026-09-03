import { useState } from "react";
import { apiFetch } from "../../api.js";
import { ArchiveGlobalNav } from "../ArchiveGlobalNav.js";
import { ArchiveLayout } from "../ArchiveLayout.js";
import { ArchiveError, ArchiveLoading } from "../ArchiveStates.js";

interface EvidenceItem {
  text: string;
  documentId?: string;
  source?: string;
  score?: number;
}

interface EvidenceAnswer {
  answer: string;
  confidence: number;
  evidences: EvidenceItem[];
}

export function AskPage({
  gameId,
  selectedRevision,
  initialQuestion = "",
}: {
  gameId: string;
  selectedRevision?: string;
  initialQuestion?: string;
}) {
  const [question, setQuestion] = useState(initialQuestion);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [answer, setAnswer] = useState<EvidenceAnswer | null>(null);

  async function handleAsk(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;

    setLoading(true);
    setError("");
    setAnswer(null);

    try {
      const res = await apiFetch<EvidenceAnswer>(`/api/games/${encodeURIComponent(gameId)}/qa`, {
        method: "POST",
        body: JSON.stringify({
          question: question.trim(),
          maxEvidence: 5,
          revisionId: selectedRevision || undefined,
        }),
      });
      setAnswer(res);
    } catch (err: unknown) {
      setError((err as Error).message || "问答推理失败，请检查服务可用性");
    } finally {
      setLoading(false);
    }
  }

  return (
    <ArchiveLayout
      globalNav={<ArchiveGlobalNav activeSection="ask" />}
      main={
        <div className="archive-ask-container" role="main">
          <div className="archive-ask-header">
            <h1 className="archive-ask-title">证据链智能问答</h1>
            <p className="archive-ask-subtitle">
              针对剧情设定、角色渊源与世界观设定提问。系统严格基于入库文档检索，附带直接证据段落与置信度。
            </p>

            <form className="archive-ask-form" onSubmit={handleAsk}>
              <textarea
                className="archive-ask-textarea"
                rows={3}
                placeholder="在此输入您的问题（例如：风魔龙特瓦林为什么会袭击蒙德城？）..."
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                aria-label="提问内容"
              />
              <div className="archive-ask-form-actions">
                <span className="archive-ask-hint">
                  提示：支持按特定版本 ({selectedRevision ?? "已发布版本"}) 检索事实。
                </span>
                <button
                  type="submit"
                  className="archive-ask-submit-btn"
                  disabled={loading || !question.trim()}
                >
                  {loading ? "正在检索证据并推理..." : "生成解答"}
                </button>
              </div>
            </form>
          </div>

          <div className="archive-ask-result-pane">
            {loading && <ArchiveLoading label="正在检索文献证据链并组织解答..." />}
            {error && <ArchiveError message={error} onRetry={handleAsk} />}
            {!loading && !error && !answer && (
              <div className="archive-ask-empty-prompt">
                <p>提交问题后，知识库将为您检索出处证据并提供可核验解答。</p>
              </div>
            )}
            {!loading && !error && answer && (
              <article className="archive-ask-card">
                <header className="archive-ask-card-header">
                  <h2>解答结论</h2>
                  <span
                    className="confidence-pill"
                    title={`置信度 ${(answer.confidence * 100).toFixed(0)}%`}
                  >
                    置信度: {(answer.confidence * 100).toFixed(0)}%
                  </span>
                </header>

                <div className="archive-ask-body">
                  <p className="archive-answer-text">{answer.answer}</p>
                </div>

                {answer.evidences && answer.evidences.length > 0 && (
                  <section className="archive-ask-evidences">
                    <h3>依据与引用文献 ({answer.evidences.length})</h3>
                    <div className="evidence-list">
                      {answer.evidences.map((ev, idx) => (
                        <div key={idx} className="evidence-item">
                          <div className="evidence-item-head">
                            <span className="evidence-num">证据 #{idx + 1}</span>
                            {ev.source && <span className="evidence-source">{ev.source}</span>}
                            {typeof ev.score === "number" && (
                              <span className="evidence-score">匹配度: {ev.score.toFixed(2)}</span>
                            )}
                          </div>
                          <blockquote className="evidence-quote">{ev.text}</blockquote>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </article>
            )}
          </div>
        </div>
      }
    />
  );
}
