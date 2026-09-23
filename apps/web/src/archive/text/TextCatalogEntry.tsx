import React from "react";
import type { TextCatalogEntry as EntryModel } from "@gip/contracts";

export interface TextCatalogEntryProps {
  entry: EntryModel;
  isActive: boolean;
  onSelect: (entry: EntryModel) => void;
}

export function TextCatalogEntry({ entry, isActive, onSelect }: TextCatalogEntryProps) {
  const cleanSnippet = entry.preview
    ? entry.preview
        .replace(/^#+\s+[^\n]+/gm, "")
        .replace(/<[^>]+>/g, "")
        .replace(/[*_~`]/g, "")
        .replace(/\s+/g, " ")
        .trim()
    : "";
  const displayText = cleanSnippet || entry.subtitle || entry.groupName || "";

  return (
    <button
      type="button"
      className={`text-catalog-entry ${isActive ? "is-active" : ""}`}
      onClick={() => onSelect(entry)}
      aria-current={isActive ? "true" : undefined}
    >
      <span className="text-catalog-entry-title">{entry.title}</span>
      <div className="text-catalog-entry-meta">
        <span className="text-catalog-entry-snippet">{displayText}</span>
        {entry.gameVersion && (
          <span className="text-catalog-entry-version">v{entry.gameVersion}</span>
        )}
      </div>
    </button>
  );
}
