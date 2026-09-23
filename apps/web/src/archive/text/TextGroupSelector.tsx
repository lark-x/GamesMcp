import { useState, useMemo, useRef, useEffect } from "react";
import type { TextCatalogGroup } from "@gip/contracts";

export interface TextGroupSelectorProps {
  label: string;
  groups: TextCatalogGroup[];
  activeGroupId: string | null;
  onSelectGroup: (groupId: string) => void;
}

export function TextGroupSelector({
  label,
  groups,
  activeGroupId,
  onSelectGroup,
}: TextGroupSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const activeGroup = useMemo(() => {
    return groups.find((g) => g.id === activeGroupId) ?? groups[0];
  }, [groups, activeGroupId]);

  const filteredGroups = useMemo(() => {
    if (!filterQuery.trim()) return groups;
    const q = filterQuery.trim().toLowerCase();
    return groups.filter(
      (g) =>
        g.name.toLowerCase().includes(q) || (g.subtitle && g.subtitle.toLowerCase().includes(q)),
    );
  }, [groups, filterQuery]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      if (groups.length > 20) {
        setTimeout(() => searchInputRef.current?.focus(), 50);
      }
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, groups.length]);

  if (!groups.length) return null;

  return (
    <div className="text-group-selector-container" ref={containerRef}>
      <div className="text-group-selector-header">
        <span className="text-group-selector-label">{label}</span>
        <span className="text-group-selector-count">共 {groups.length} 组</span>
      </div>

      <button
        type="button"
        className="text-group-trigger"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        <div className="text-group-trigger-left">
          <span className="text-group-trigger-name">{activeGroup?.name ?? "请选择"}</span>
          {activeGroup?.count !== undefined && (
            <span className="text-group-trigger-badge">{activeGroup.count}</span>
          )}
        </div>
        <span className="text-group-trigger-arrow">▼</span>
      </button>

      {isOpen && (
        <div className="text-group-dropdown">
          {groups.length > 15 && (
            <div className="text-group-dropdown-filter">
              <input
                ref={searchInputRef}
                type="text"
                className="text-group-dropdown-input"
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                placeholder={`过滤${label}...`}
              />
            </div>
          )}

          <div className="text-group-dropdown-list">
            {filteredGroups.length === 0 ? (
              <div className="text-catalog-empty" style={{ padding: "12px" }}>
                无匹配{label}
              </div>
            ) : (
              filteredGroups.map((group) => {
                const isSelected = group.id === activeGroup?.id;
                return (
                  <button
                    key={group.id}
                    type="button"
                    className={`text-group-dropdown-item ${isSelected ? "is-selected" : ""}`}
                    onClick={() => {
                      onSelectGroup(group.id);
                      setIsOpen(false);
                      setFilterQuery("");
                    }}
                  >
                    <span
                      style={{
                        fontWeight: isSelected ? 600 : 400,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {group.name}
                    </span>
                    <span
                      style={{ fontSize: "11px", color: "var(--archive-muted)", marginLeft: "8px" }}
                    >
                      {group.count}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
