export function ArchiveLoading({ label = "资料加载中" }: { label?: string }) {
  return (
    <div className="archive-loading" role="status" aria-busy="true">
      <span className="archive-loading-bar" style={{ width: "38%" }} />
      <span className="archive-loading-bar" style={{ width: "82%" }} />
      <span className="archive-loading-bar" style={{ width: "64%" }} />
      <span className="archive-loading-bar" style={{ width: "74%" }} />
      <span className="archive-loading-label">{label}…</span>
    </div>
  );
}

export function ArchiveEmpty({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="archive-state-block" role="status">
      <span aria-hidden="true">◇</span>
      <strong>{title}</strong>
      {detail ? <p>{detail}</p> : null}
    </div>
  );
}

export function ArchiveError({
  message,
  detail,
  onRetry,
}: {
  message: string;
  detail?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="archive-state-block archive-error-block" role="alert">
      <span aria-hidden="true">!</span>
      <strong>{message}</strong>
      {detail ? <p>{detail}</p> : null}
      {onRetry ? (
        <button type="button" onClick={onRetry}>
          重新加载
        </button>
      ) : null}
    </div>
  );
}
