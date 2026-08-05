/* MappedSidebar.tsx — ported from bim-specs-mapper (2026-08-05 Stage 1).
 *
 * Narrow sidebar (160px) docked alongside the PDF viewer. Shows a
 * compact list of spec sections with pass badges + inline detail
 * panel when a section is selected.
 *
 * Stage 1 changes from the spec-mapper original:
 *   - Correction workflow stripped (Accept/Reject/Correct removed).
 *     This is a read-only view for the bim-assistant PoC.
 *   - agentFilterIds prop added for agent-driven sidebar filtering
 *     (Improvement 1). When set, only matching sections appear.
 *   - Removed appendCorrection dependency — no corrections.ts import.
 *   - Removed FilterEditorModal import — no correction editing.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Filter, Mapping, MappingResult, Pass } from "../types";
import { topResult } from "../types";
import styles from "./MappedSidebar.module.css";

type TabId = "mapped" | "unmapped";

interface Props {
  mappings: Mapping[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  activeTab: TabId;
  /** Stage 1 Improvement 1: agent-driven filtering. When non-null,
   *  only sections whose section_id is in this list are shown.
   *  null → show all sections (default). */
  agentFilterIds?: string[] | null;
}

// ============================================================
// Helpers
// ============================================================

function confidenceColor(conf: number): string {
  if (conf >= 0.85) return "var(--ff-tag-arq-text)";
  if (conf >= 0.6) return "var(--ff-tag-section-text)";
  return "var(--ff-pdf-icon)";
}

function passClass(pass: Pass): string {
  switch (pass) {
    case "canonical": case "high": return styles.passGreen ?? "";
    case "medium": return styles.passYellow ?? "";
    case "review": return styles.passRed ?? "";
    case "offline": return styles.passGray ?? "";
    default: return styles.passRed ?? "";
  }
}

function passLabel(pass: Pass): string { return pass.toUpperCase(); }

function renderFilterText(f: Filter): string {
  if (f.g.length === 0) return "()";
  return f.g
    .map((g) => (g.r.length === 0 ? "()" : `(${g.r.map((r) => `${r.p} ${r.op} ${r.v}`).join(` ${g.c} `)})`))
    .join(` ${f.c} `);
}

// ============================================================
// DetailPanel — bottom panel inside sidebar (read-only)
// ============================================================

function DetailPanel({ mapping }: { mapping: Mapping }) {
  const [showRationale, setShowRationale] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [activeI, setActiveI] = useState(0);

  useEffect(() => {
    setShowRationale(false);
    setShowFilter(false);
    setActiveI(0);
  }, [mapping.section_id]);

  return (
    <div className={styles.detailPanel}>
      {/* Section header */}
      <div className={styles.detailHeader}>
        <span className={styles.detailSectionId}>{mapping.section_id}</span>
        <span className={styles.detailStatus}>{mapping.status}</span>
      </div>

      <div className={styles.detailBody}>
        {mapping.results.map((r: MappingResult, i: number) => {
          return (
            <article key={`${r.ifc_class}-${i}`} className={styles.resultCard}>
              {/* IfcClass + pass badge */}
              <div className={styles.resultHead}>
                <code className={styles.ifcClass}>{r.ifc_class}</code>
                <span className={`${styles.passBadge} ${passClass(r.pass)}`}>{passLabel(r.pass)}</span>
              </div>

              {/* Confidence */}
              <div className={styles.confBar}>
                <div className={styles.confTrack}>
                  <div className={styles.confFill} style={{ width: `${r.conf * 100}%`, background: confidenceColor(r.conf) }} />
                </div>
                <span className={styles.confLabel}>{(r.conf * 100).toFixed(0)}%</span>
              </div>

              {/* Tags */}
              {(r.analysis_class || r.canonical_concept) && (
                <div className={styles.conceptMeta}>
                  {r.analysis_class && <span>{r.analysis_class}</span>}
                  {r.quantity_type && <span>{r.quantity_type}</span>}
                  {r.target_mode && <span>{r.target_mode}</span>}
                  {r.canonical_concept && <code>{r.canonical_concept}</code>}
                </div>
              )}

              {/* Rationale — collapsed by default */}
              <button type="button" className={styles.toggleRow}
                onClick={() => { setShowRationale((v) => !v); setActiveI(i); }}>
                <span className={styles.toggleLabel}>Why this match?</span>
                <span className={showRationale && activeI === i ? styles.toggleArrowOpen : styles.toggleArrow}>▸</span>
              </button>
              {showRationale && activeI === i && (
                <p className={styles.rationale}>{r.rationale}</p>
              )}

              {/* Filter — collapsed by default */}
              <button type="button" className={styles.toggleRow}
                onClick={() => { setShowFilter((v) => !v); setActiveI(i); }}>
                <span className={styles.toggleLabel}>Filter expression</span>
                <span className={showFilter && activeI === i ? styles.toggleArrowOpen : styles.toggleArrow}>▸</span>
              </button>
              {showFilter && activeI === i && (
                <div className={styles.filterBox}>
                  <div className={styles.filterSummary}>{renderFilterText(r.filter)}</div>
                  {r.match_stats && (
                    <div className={styles.matchStats}>
                      {r.match_stats.matched_elements} / {(r.match_stats.match_share * 100).toFixed(0)}% · {r.match_stats.specificity_status}
                    </div>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// MappedSidebar
// ============================================================

export default function MappedSidebar({ mappings, selectedId, onSelect, activeTab, agentFilterIds }: Props) {

  // Stage 1 Improvement 1: agent-driven filtering.
  const visibleMappings = useMemo(() => {
    if (!agentFilterIds || agentFilterIds.length === 0) return mappings;
    const set = new Set(agentFilterIds);
    return mappings.filter((m) => set.has(m.section_id));
  }, [mappings, agentFilterIds]);

  const unmapped = useMemo(() => {
    const source = visibleMappings;
    return source.filter((m) => {
      const top = topResult(m);
      return m.status === "review" || m.status === "unmapped" || top?.pass === "review";
    });
  }, [visibleMappings]);

  const selected = useMemo(
    () => mappings.find((m) => m.section_id === selectedId) ?? null,
    [mappings, selectedId],
  );

  const handleSectionClick = useCallback((id: string) => {
    onSelect(id);
  }, [onSelect]);

  // ----- Resizable detail panel height -----
  const [detailH, setDetailH] = useState(240);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);
  const onDragDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startH: detailH };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [detailH]);
  const onDragMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dy = dragRef.current.startY - e.clientY;
    setDetailH(Math.max(0, Math.min(500, dragRef.current.startH + dy)));
  }, []);
  const onDragUp = useCallback(() => { dragRef.current = null; }, []);

  const showDetail = selected && activeTab === "mapped";
  const isFiltered = agentFilterIds && agentFilterIds.length > 0 &&
    agentFilterIds.length < mappings.length;

  return (
    <div className={styles.sidebar}>
      {/* ----- Agent filter indicator ----- */}
      {isFiltered && (
        <div className={styles.agentFilterBar}>
          Agente: filtrando {visibleMappings.length} de {mappings.length} secciones
        </div>
      )}

      {/* ----- List ----- */}
      <div className={styles.listArea}>
        {activeTab === "mapped" && (
          <ul className={styles.list}>
            {visibleMappings.map((m) => {
              const top = topResult(m);
              const isSelected = m.section_id === selectedId;
              const pass: Pass = top?.pass ?? "review";
              return (
                <li key={m.section_id}>
                  <button type="button"
                    className={`${styles.item} ${isSelected ? styles.itemSelected : ""} ${styles[`itemPass${pass === 'canonical' || pass === 'high' ? 'Green' : pass === 'medium' ? 'Yellow' : pass === 'review' ? 'Red' : 'Gray'}`]}`}
                    onClick={() => handleSectionClick(m.section_id)}>
                    <div className={styles.itemTop}>
                      <span className={styles.sectionId}>{m.section_id}</span>
                      <span className={`${styles.passMini} ${passClass(pass)}`}>{passLabel(pass)}</span>
                    </div>
                    <div className={styles.sectionTitle}>{m.section_title}</div>
                    <div className={styles.itemBottom}>
                      <span className={styles.ifcClass}>{top?.ifc_class ?? "—"}</span>
                      {top && <span className={styles.conf}>{(top.conf * 100).toFixed(0)}%</span>}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {activeTab === "unmapped" && (
          <>
            {unmapped.length === 0 ? (
              <div className={styles.empty}>
                <div className={styles.emptyTitle}>No unmapped sections</div>
                <div className={styles.emptySub}>All {visibleMappings.length} sections have a mapping.</div>
              </div>
            ) : (
              <ul className={styles.list}>
                {unmapped.map((m) => {
                  const top = topResult(m);
                  const isSelected = m.section_id === selectedId;
                  return (
                    <li key={m.section_id}>
                      <button type="button" className={`${styles.item} ${isSelected ? styles.itemSelected : ""}`} onClick={() => handleSectionClick(m.section_id)}>
                        <div className={styles.itemTop}>
                          <span className={styles.sectionId}>{m.section_id}</span>
                          <span className={styles.unmappedBadge}>{m.status}</span>
                        </div>
                        <div className={styles.sectionTitle}>{m.section_title}</div>
                        <div className={styles.itemBottom}>
                          {top ? `${top.ifc_class} · ${(top.conf * 100).toFixed(0)}%` : "no BIM candidate"}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>

      {/* ----- Resize handle + bottom detail panel ----- */}
      {showDetail && (
        <>
          <div className={styles.resizeHandle}
            onPointerDown={onDragDown} onPointerMove={onDragMove}
            onPointerUp={onDragUp} onPointerCancel={onDragUp}
            role="separator" aria-label="Resize detail panel" />
          <div className={styles.detailWrap} style={detailH > 0 ? { height: detailH } : { display: "none" }}>
            <DetailPanel mapping={selected} />
          </div>
        </>
      )}
    </div>
  );
}
