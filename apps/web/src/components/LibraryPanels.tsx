import type { FormEvent } from "react";
import type { ArchiveHomeResponse, Citation, EvidenceAnswer, SearchResult } from "@gip/contracts";
import type { DocumentDetail, EntityDetail } from "@gip/domain";
import { Button } from "antd";
import type { ArchiveCategory } from "../shared.js";
import {
  AnswerView,
  ArchiveHome,
  DocumentView,
  EntityView,
  LoadingCards,
  SearchResultFeed,
  copyCitationText,
} from "./PublicViews.js";

export function ArchiveFeed({
  search,
  home,
  searching,
  overviewLoading,
  onEntity,
  onDocument,
  onCategory,
}: {
  search: SearchResult | null;
  home: ArchiveHomeResponse | null;
  searching: boolean;
  overviewLoading: boolean;
  onEntity: (id: string, revisionId?: string) => void;
  onDocument: (id: string, revisionId?: string, segmentId?: string) => void;
  onCategory: (category: ArchiveCategory) => void;
}) {
  return (
    <section className="archive-feed" aria-busy={searching || overviewLoading}>
      {searching || (!search && overviewLoading) ? (
        <LoadingCards />
      ) : search ? (
        <SearchResultFeed search={search} onEntity={onEntity} onDocument={onDocument} />
      ) : (
        <ArchiveHome
          home={home}
          onEntity={onEntity}
          onDocument={onDocument}
          onCategory={onCategory}
        />
      )}
    </section>
  );
}

export function DetailPanel({
  detailLoading,
  entity,
  document,
  activeSegmentId,
  onEntity,
  onDocument,
  onCitation,
}: {
  detailLoading: boolean;
  entity: EntityDetail | null;
  document: DocumentDetail | null;
  activeSegmentId?: string;
  onEntity: (id: string, revisionId?: string) => void;
  onDocument: (id: string, revisionId?: string, segmentId?: string) => void;
  onCitation: (citation: Citation) => void;
}) {
  return (
    <section className="panel detail-panel archive-detail" aria-busy={detailLoading}>
      {detailLoading ? (
        <div className="detail-loading" role="status">
          <span className="loading-orb" aria-hidden="true" />
          <strong>正在读取完整资料</strong>
          <small>正在加载正文、出处和关联内容…</small>
        </div>
      ) : entity ? (
        <EntityView
          entity={entity}
          onEntity={onEntity}
          onDocument={onDocument}
          onCitation={onCitation}
        />
      ) : document ? (
        <DocumentView
          document={document}
          activeSegmentId={activeSegmentId}
          onEntity={onEntity}
          onCopy={copyCitationText}
        />
      ) : (
        <div className="empty-detail">
          <span className="detail-mark">✦</span>
          <h2>在这里阅读完整资料</h2>
          <p>从左侧结果选择实体、文档或原文片段，即可查看正文、出处、版本和关联内容。</p>
        </div>
      )}
    </section>
  );
}

export function QaPanel({
  question,
  asking,
  disabled,
  answer,
  onQuestionChange,
  onAsk,
  onCitation,
  onEntity,
}: {
  question: string;
  asking: boolean;
  disabled: boolean;
  answer: EvidenceAnswer | null;
  onQuestionChange: (value: string) => void;
  onAsk: (event: FormEvent) => void;
  onCitation: (citation: Citation) => void;
  onEntity: (id: string, revisionId?: string) => void;
}) {
  return (
    <section className="panel qa-panel archive-qa">
      <div className="panel-title">
        <div>
          <span className="eyebrow">EVIDENCE QA</span>
          <h2>基于资料提问</h2>
        </div>
        <span className="muted">答案附带可定位的原文引用</span>
      </div>
      <form className="qa-form" onSubmit={onAsk}>
        <textarea
          aria-label="问答问题"
          value={question}
          onChange={(event) => onQuestionChange(event.target.value)}
          placeholder="例如：某角色与某阵营有什么关系？"
          rows={2}
        />
        <Button type="primary" htmlType="submit" loading={asking} disabled={disabled}>
          基于证据回答
        </Button>
      </form>
      {answer && <AnswerView answer={answer} onCitation={onCitation} onEntity={onEntity} />}
    </section>
  );
}

export function AdminEntry({ onOpen }: { onOpen: () => void }) {
  return (
    <section className="admin-toggle library-admin-entry">
      <span>需要维护资料？管理功能位于独立工作台。</span>
      <button className="secondary-button" onClick={onOpen}>
        打开审核工作台
      </button>
    </section>
  );
}
