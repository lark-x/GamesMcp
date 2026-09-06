import React from "react";
import type { TextCatalogEntry as EntryModel, TextCatalogResponse } from "@gip/contracts";
import type { TextKindConfig } from "./text-kind-registry.js";
import { TextGroupSelector } from "./TextGroupSelector.js";
import { TextCatalogEntry } from "./TextCatalogEntry.js";

export interface TextCatalogProps {
  kindConfig: TextKindConfig;
  catalog: TextCatalogResponse | null;
  loading: boolean;
  activeGroupId: string | null;
  activeEntryId: string | null;
  searchQuery: string;
  onSelectGroup: (groupId: string) => void;
  onSelectEntry: (entry: EntryModel) => void;
  onSearchChange: (q: string) => void;
  onPageChange: (offset: number) => void;
}

export function TextCatalog({
  kindConfig,
  catalog,
  loading,
  activeGroupId,
  activeEntryId,
  searchQuery,
  onSelectGroup,
  onSelectEntry,
  onSearchChange,
  onPageChange,
}: TextCatalogProps) {
  const groups = catalog?.groups ?? [];
  const entries = catalog?.entries ?? [];
  const total = catalog?.total ?? 0;
  const offset = catalog?.offset ?? 0;
  const limit = catalog?.limit ?? 50;

  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(Math.ceil(total / limit), 1);

  return (
    <div className="text-catalog-pane">
      {/* Search Input */}
      {kindConfig.supportsSearch && (
        <div className="text-catalog-search">
          <div className="text-catalog-search-wrapper">
            <input
              type="text"
              className="text-catalog-search-input"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={`搜索${kindConfig.itemNoun}...`}
            />
            {searchQuery && (
              <button
                type="button"
                className="text-catalog-search-clear"
                onClick={() => onSearchChange("")}
              >
                ✕
              </button>
            )}
          </div>
        </div>
      )}

      {/* Group Selector (if multiple groups exist) */}
      {groups.length > 1 && (
        <TextGroupSelector
          label={kindConfig.groupLabel}
          groups={groups}
          activeGroupId={activeGroupId}
          onSelectGroup={onSelectGroup}
        />
      )}

      {/* Entry List */}
      <div className="text-catalog-entries-scroll">
        {loading && !entries.length ? (
          <div className="text-catalog-loading">加载中...</div>
        ) : entries.length === 0 ? (
          <div className="text-catalog-empty">
            {searchQuery ? "无搜索结果" : kindConfig.emptyTitle}
          </div>
        ) : (
          entries.map((entry) => (
            <TextCatalogEntry
              key={entry.documentId}
              entry={entry}
              isActive={entry.documentId === activeEntryId || entry.stableId === activeEntryId}
              onSelect={onSelectEntry}
            />
          ))
        )}
      </div>

      {/* Pagination Footer */}
      {totalPages > 1 && (
        <div className="text-catalog-pagination">
          <button
            type="button"
            className="text-catalog-page-btn"
            disabled={offset === 0 || loading}
            onClick={() => onPageChange(Math.max(offset - limit, 0))}
          >
            上一页
          </button>
          <span>
            {currentPage} / {totalPages}
          </span>
          <button
            type="button"
            className="text-catalog-page-btn"
            disabled={catalog?.nextOffset === null || loading}
            onClick={() => {
              if (catalog?.nextOffset !== null && catalog?.nextOffset !== undefined) {
                onPageChange(catalog.nextOffset);
              }
            }}
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}
