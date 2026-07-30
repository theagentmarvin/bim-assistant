// src/components/QuantificationPanel.tsx
//
// Structured-table renderer for the Cuantificación tab. Receives the
// latest `tabla` from the agent (App.tsx owns it) and renders:
//   - header (titulo + meta + source)
//   - sortable, searchable table
//   - toolbar (Copy TSV / Copy CSV / Add column / Search)
//
// Boss #14882: row-click → onRowSelect → App.handleRowSelect →
// setAgentFilter → Viewer3D highlight on matching BIM elements.
// Boss #14917: rows carry ALL element properties (built by tools.ts),
// so users can dynamically add columns from `data.available_properties`
// without re-querying.

import { useEffect, useMemo, useRef, useState } from "react";
import { buildTSV, buildCSV, copyToClipboard, type Row as DataRow } from "../utils/copy";
import type { QuantificationTable } from "../quantification/types";
import styles from "./QuantificationPanel.module.css";

// Boss #14917 (follow-up): per-column resize handles. With
// table-layout: fixed, every column gets an explicit width and the
// "nombre" column stops eating the table. Widths persist in
// localStorage so the user's layout survives a reload.
const MIN_COL_WIDTH = 60;
const MAX_COL_WIDTH = 600;
const COL_WIDTHS_STORAGE_KEY = "bim-assistant:quantification:colwidths";

/**
 * Boss 2026-07-30 17:48 — content-based default column width. The
 * fixed 160px default crowded long window names and short numeric
 * dimensions the same way. This heuristic sizes the column to its
 * longest cell value so names get ~240-320px and numbers ~100px
 * on first render. Manual drags still override via colWidths.
 */
function getDynamicColumnWidth(
  col: string,
  rows: ReadonlyArray<DataRow>,
): number {
  let maxLength = col.length;
  for (const row of rows) {
    const v = row[col];
    if (v === null || v === undefined) continue;
    const s = String(v);
    if (s.length > maxLength) maxLength = s.length;
  }
  if (maxLength < 6) return 80;
  if (maxLength < 16) return 120;
  if (maxLength < 30) return 180;
  if (maxLength < 50) return 240;
  return 320;
}

interface Props {
  data: QuantificationTable | null;
  /** Called when the user clicks a row. Receives every express_id
   *  that the row represents (one element for listing rows, many for
   *  grouping rows). The handler routes these to the viewer highlight. */
  onRowSelect?: (ids: number[]) => void;
  /** Index of the currently-selected row in the original
   *  `data.filas_express_ids` array. Set by row click OR by a 3D
   *  element click (bidirectional sync with the model). The matching
   *  row gets the .rowSelected class and is scrolled into view.
   *  Compared via express_ids (not the index) so the highlight
   *  survives sort and filter changes. */
  selectedRowIndex?: number | null;
}

type SortDir = "asc" | "desc" | null;

interface RowMeta {
  row: DataRow;
  express_ids: number[];
}

export default function QuantificationPanel({ data, onRowSelect, selectedRowIndex }: Props) {
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [copyHint, setCopyHint] = useState<string | null>(null);
  // Boss #14917: columns the user has added on top of the agent's
  // selection. Persisted across filter/sort (recomputed with rows).
  const [extraColumns, setExtraColumns] = useState<string[]>([]);
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  // Boss #14917 (follow-up): per-column widths. Keyed by column name.
  // Missing or invalid keys fall back to DEFAULT_COL_WIDTH.
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const dragStateRef = useRef<{ col: string; startX: number; startWidth: number } | null>(null);

  // Load persisted widths from localStorage. Failures (corrupted
  // JSON, storage disabled) are silently swallowed — the user keeps
  // working with defaults.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(COL_WIDTHS_STORAGE_KEY);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return;
      const cleaned: Record<string, number> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === "number" && v >= MIN_COL_WIDTH && v <= MAX_COL_WIDTH) {
          cleaned[k] = v;
        }
      }
      setColWidths(cleaned);
    } catch {
      // ignore
    }
  }, []);

  // Persist on change. Skip the initial empty state so we don't
  // overwrite a stored value with `{}` on the first render.
  useEffect(() => {
    if (Object.keys(colWidths).length === 0) return;
    try {
      window.localStorage.setItem(COL_WIDTHS_STORAGE_KEY, JSON.stringify(colWidths));
    } catch {
      // ignore
    }
  }, [colWidths]);

  const getColumnWidth = (col: string): number => {
    const w = colWidths[col];
    if (typeof w === "number" && w >= MIN_COL_WIDTH && w <= MAX_COL_WIDTH) return w;
    return getDynamicColumnWidth(col, rowsWithMeta.map(m => m.row));
  };

  const startResize = (col: string, e: React.MouseEvent) => {
    // Prevent the click from also bubbling up to the sort button.
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = getColumnWidth(col);
    dragStateRef.current = { col, startX, startWidth };

    const onMove = (ev: MouseEvent) => {
      const state = dragStateRef.current;
      if (!state) return;
      const delta = ev.clientX - state.startX;
      const newWidth = Math.max(
        MIN_COL_WIDTH,
        Math.min(MAX_COL_WIDTH, state.startWidth + delta),
      );
      setColWidths((prev) => ({ ...prev, [state.col]: newWidth }));
    };

    const onUp = () => {
      dragStateRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  // All columns currently displayed: agent's choice + user extras.
  // The agent's columns stay fixed (you can't remove them — that
  // would lose information). User-added columns can be removed via ×.
  const allColumns: string[] = useMemo(() => {
    if (!data) return [];
    return [...data.columnas, ...extraColumns];
  }, [data, extraColumns]);

  // Properties the user can still add (everything except what's already
  // shown). available_properties already excludes the agent's columns,
  // so we just need to also exclude the user's own extras.
  const addableProperties: string[] = useMemo(() => {
    if (!data?.available_properties) return [];
    const taken = new Set([...data.columnas, ...extraColumns]);
    return data.available_properties.filter((p) => !taken.has(p));
  }, [data, extraColumns]);

  // Boss #14917: track original indices through filter+sort so row
  // clicks always reference the correct express_ids, regardless of
  // the displayed ordering.
  const rowsWithMeta = useMemo<RowMeta[]>(() => {
    if (!data) return [];
    let indices = data.filas.map((_, i) => i);
    const needle = filter.trim().toLowerCase();
    if (needle) {
      indices = indices.filter((i) =>
        allColumns.some((c) => {
          const v = data.filas[i][c];
          return v !== null && v !== undefined && String(v).toLowerCase().includes(needle);
        }),
      );
    }
    if (sortKey && sortDir) {
      const key = sortKey;
      const dir = sortDir === "asc" ? 1 : -1;
      indices = [...indices].sort(
        (a, b) => compareCells(data.filas[a][key], data.filas[b][key]) * dir,
      );
    }
    return indices.map((i) => ({
      row: data.filas[i],
      express_ids: data.filas_express_ids?.[i] ?? [],
    }));
  }, [data, filter, sortKey, sortDir, allColumns]);

  // Auto-fit: apply content-based default to every column that doesn't
  // have a stored override. Reads colWidths via a ref (not the dep
  // array) so manual drags don't trigger this effect — we'd otherwise
  // overwrite the user's manual width on every render. Lives here
  // (after rowsWithMeta) because the closure references allColumns
  // and rowsWithMeta which are declared with useMemo above.
  const colWidthsRef = useRef(colWidths);
  colWidthsRef.current = colWidths;
  useEffect(() => {
    if (!data) return;
    const newWidths: Record<string, number> = {};
    for (const col of allColumns) {
      if (colWidthsRef.current[col] !== undefined) continue;
      newWidths[col] = getDynamicColumnWidth(col, rowsWithMeta.map((m) => m.row));
    }
    if (Object.keys(newWidths).length > 0) {
      setColWidths((prev) => ({ ...prev, ...newWidths }));
    }
  }, [data, allColumns, rowsWithMeta]);

  // Boss 2026-07-30 17:48 — resolve the selected row's express_ids
  // from the original index. The highlight comparison below uses the
  // ids (not the index) so the selection survives sort and filter.
  const selectedRowIds = useMemo<number[] | null>(() => {
    if (selectedRowIndex === null || selectedRowIndex === undefined || !data) return null;
    return data.filas_express_ids?.[selectedRowIndex] ?? null;
  }, [selectedRowIndex, data]);

  // Boss 2026-07-30 17:48 — scroll the selected row into view when
  // selectedRowIndex changes (typically via 3D element click). The
  // row is found via its data-row-ids attribute (the express_ids).
  const tableWrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selectedRowIds === null || selectedRowIds.length === 0) return;
    const rowEl = tableWrapRef.current?.querySelector(
      `[data-row-ids="${selectedRowIds.join(",")}"]`,
    );
    if (rowEl) {
      rowEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [selectedRowIds]);

  if (!data) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyTitle}>Cuantificación</div>
        <p className={styles.emptyText}>
          Aún no hay datos. Pregúntame algo como{" "}
          <em>&quot;lista los tipos de ventana&quot;</em> o{" "}
          <em>&quot;dame una tabla por clase&quot;</em>.
        </p>
      </div>
    );
  }

  const onHeaderClick = (col: string) => {
    if (sortKey !== col) {
      setSortKey(col);
      setSortDir("asc");
    } else if (sortDir === "asc") {
      setSortDir("desc");
    } else {
      setSortKey(null);
      setSortDir(null);
    }
  };

  const ariaSortFor = (col: string): "ascending" | "descending" | "none" =>
    sortKey === col && sortDir ? (sortDir === "asc" ? "ascending" : "descending") : "none";

  const totalRows = data.filas.length;
  const filteredCount = rowsWithMeta.length;
  const generableAt = formatTime(data.generadaEn);

  const onCopy = async (format: "tsv" | "csv") => {
    const headers = allColumns;
    const rows = rowsWithMeta.map((m) => {
      const out: DataRow = {};
      for (const c of headers) out[c] = m.row[c];
      return out;
    });
    const text = format === "tsv" ? buildTSV(headers, rows) : buildCSV(headers, rows);
    const ok = await copyToClipboard(text);
    setCopyHint(ok ? `${format.toUpperCase()} copiado` : `Error al copiar ${format.toUpperCase()}`);
    window.setTimeout(() => setCopyHint(null), 1800);
  };

  const addColumn = (prop: string) => {
    if (!extraColumns.includes(prop)) {
      setExtraColumns([...extraColumns, prop]);
    }
    setShowColumnMenu(false);
  };

  const removeExtraColumn = (prop: string) => {
    setExtraColumns(extraColumns.filter((p) => p !== prop));
    if (sortKey === prop) {
      setSortKey(null);
      setSortDir(null);
    }
  };

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <div className={styles.title} title={data.titulo}>{data.titulo}</div>
        <div className={styles.meta}>
          Generado {generableAt} · fuente: {labelFuente(data.fuente)} · {totalRows}{" "}
          fila{totalRows === 1 ? "" : "s"}
          {filteredCount !== totalRows && ` · ${filteredCount} visibles`}
        </div>
      </header>
      <div className={styles.tableWrap} ref={tableWrapRef}>
        <table className={styles.table}>
          <thead>
            <tr>
              {allColumns.map((c) => {
                const isExtra = extraColumns.includes(c);
                return (
                  <th
                    key={c}
                    scope="col"
                    aria-sort={ariaSortFor(c)}
                    className={styles.th}
                    data-extra={isExtra ? "true" : undefined}
                    style={{ width: getColumnWidth(c) }}
                  >
                    <button
                      type="button"
                      className={styles.sortBtn}
                      onClick={() => onHeaderClick(c)}
                      aria-label={`Ordenar por ${c}`}
                    >
                      <span>{c}</span>
                      <span className={styles.sortIcon} aria-hidden="true">
                        {sortKey === c ? (sortDir === "asc" ? "▲" : "▼") : "▾"}
                      </span>
                    </button>
                    {isExtra && (
                      <button
                        type="button"
                        className={styles.removeColBtn}
                        onClick={(e) => {
                          e.stopPropagation();
                          removeExtraColumn(c);
                        }}
                        aria-label={`Quitar columna ${c}`}
                        title="Quitar columna"
                      >
                        ×
                      </button>
                    )}
                    <div
                      className={styles.resizeHandle}
                      onMouseDown={(e) => startResize(c, e)}
                      role="separator"
                      aria-label={`Redimensionar columna ${c}`}
                      aria-orientation="vertical"
                      title="Arrastrar para ajustar ancho"
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rowsWithMeta.length === 0 && (
              <tr>
                <td className={styles.emptyCell} colSpan={allColumns.length}>
                  Ninguna fila coincide con el filtro.
                </td>
              </tr>
            )}
            {rowsWithMeta.map(({ row, express_ids }, i) => {
              const clickable = express_ids.length > 0 && !!onRowSelect;
              const isSelected = selectedRowIds !== null &&
                express_ids.length === selectedRowIds.length &&
                express_ids.every((id) => selectedRowIds.includes(id));
              const rowClass = [
                styles.row,
                clickable ? styles.rowClickable : "",
                isSelected ? styles.rowSelected : "",
              ].filter(Boolean).join(" ");
              return (
                <tr
                  key={i}
                  data-row-ids={express_ids.join(",")}
                  className={rowClass}
                  onClick={clickable ? () => onRowSelect!(express_ids) : undefined}
                  onKeyDown={
                    clickable
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onRowSelect!(express_ids);
                          }
                        }
                      : undefined
                  }
                  tabIndex={clickable ? 0 : -1}
                  role={clickable ? "button" : undefined}
                  aria-selected={isSelected || undefined}
                  aria-label={
                    clickable
                      ? `Resaltar ${express_ids.length} elemento${express_ids.length === 1 ? "" : "s"} en el visor 3D`
                      : undefined
                  }
                >
                  {allColumns.map((c) => (
                    <td key={c} className={styles.td} data-col={c} style={{ width: getColumnWidth(c) }}>
                      {formatCell(row[c])}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <footer className={styles.toolbar}>
        <button
          type="button"
          className={styles.toolbarBtn}
          onClick={() => onCopy("tsv")}
          aria-label="Copiar tabla como TSV"
          title="Copiar como TSV (tab-separado, pegar en Excel)"
        >
          Copiar TSV
        </button>
        <button
          type="button"
          className={styles.toolbarBtn}
          onClick={() => onCopy("csv")}
          aria-label="Copiar tabla como CSV"
          title="Copiar como CSV (RFC-4180)"
        >
          Copiar CSV
        </button>
        <div className={styles.addColumnWrap}>
          <button
            type="button"
            className={styles.toolbarBtn}
            onClick={() => setShowColumnMenu((s) => !s)}
            disabled={addableProperties.length === 0}
            aria-haspopup="menu"
            aria-expanded={showColumnMenu}
            title={
              addableProperties.length === 0
                ? "No hay más propiedades para agregar"
                : "Agregar columna desde las propiedades disponibles del modelo"
            }
          >
            + Agregar columna
          </button>
          {showColumnMenu && addableProperties.length > 0 && (
            <div role="menu" className={styles.columnMenu}>
              {addableProperties.map((prop) => (
                <button
                  key={prop}
                  type="button"
                  role="menuitem"
                  className={styles.columnMenuItem}
                  onClick={() => addColumn(prop)}
                >
                  {prop}
                </button>
              ))}
            </div>
          )}
        </div>
        <input
          type="search"
          className={styles.search}
          placeholder="Buscar…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filtrar filas"
        />
        {copyHint && <span className={styles.copyHint} aria-live="polite">{copyHint}</span>}
      </footer>
    </div>
  );
}

// ----- helpers -----

function compareCells(a: unknown, b: unknown): number {
  const aNil = a === null || a === undefined || a === "";
  const bNil = b === null || b === undefined || b === "";
  if (aNil && bNil) return 0;
  if (aNil) return -1;
  if (bNil) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  const aN = typeof a === "string" && a.trim() !== "" && !Number.isNaN(Number(a)) ? Number(a) : null;
  const bN = typeof b === "string" && b.trim() !== "" && !Number.isNaN(Number(b)) ? Number(b) : null;
  if (aN !== null && bN !== null) return aN - bN;
  return String(a).localeCompare(String(b), "es");
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "sí" : "no";
  return String(v);
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function labelFuente(f: string): string {
  if (f === "modelo") return "modelo BIM";
  if (f === "especificacion") return "especificación PDF";
  if (f === "mapeos") return "mapeos";
  return f;
}