export function ArchivePagination({
  current,
  limit,
  total,
  hasMore,
  disabled,
  onPrev,
  onNext,
}: {
  current: number; // 1-indexed page
  limit: number;
  total?: number;
  hasMore?: boolean;
  disabled?: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  const canGoPrev = current > 1 && !disabled;
  const canGoNext = (total != null ? current * limit < total : (hasMore ?? false)) && !disabled;

  return (
    <nav className="archive-pagination" aria-label="分页导航">
      <button
        type="button"
        className="archive-pagination-btn"
        disabled={!canGoPrev}
        onClick={onPrev}
        aria-label="上一页"
      >
        ← 上一页
      </button>
      <span className="archive-pagination-info" role="status">
        第 {current} 页
        {total != null ? ` / 共 ${Math.ceil(total / limit) || 1} 页 (${total} 条)` : ""}
      </span>
      <button
        type="button"
        className="archive-pagination-btn"
        disabled={!canGoNext}
        onClick={onNext}
        aria-label="下一页"
      >
        下一页 →
      </button>
    </nav>
  );
}
