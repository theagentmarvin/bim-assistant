// src/components/QuantificationPanel.tsx
//
// Structured-table renderer for the Cuantificación tab. Receives the
// latest `tabla` from the agent (App.tsx owns it) and renders:
//   - header (titulo + meta + source)
//   - sortable, searchable table
//   - toolbar (Copy TSV / Copy CSV / Search)
//
// Empty state when no tabla has arrived yet.

import { useMemo, useState } from "react";
import { buildTSV, buildCSV, copyToClipboard, type Row as DataRow } from "../utils/copy";
import type { QuantificationTable } from "../quantification/types";
import styles from "./QuantificationPanel.module.css";

interface Props {
  data: QuantificationTable | null;
  /** Called when the user clicks a row. Receives every express_id
   *  that the row represents (one element for listing rows, many for
   *  grouping rows). The handler routes these to the viewer highlight. */
  onRowSelect?: (ids: number[]) => void;
}

type SortDir = "asc" | "desc" | null;

export default function QuantificationPanel({ data, onRowSelect }: Props) {
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [copyHint, setCopyHint] = useState<string | null>(null);

  const filteredRows = useMemo<DataRow[]>(() => {
    if (!data) return [];
    const needle = filter.trim().toLowerCase();
    let rows = data.filas;
    if (needle) {
      rows = rows.filter((r) =>
        data.columnas.some((c) => {
          const v = r[c];
          return v !== null && v !== undefined && String(v).toLowerCase().includes(needle);
        }),
      );
    }
    if (sortKey && sortDir) {
      const key = sortKey;
      const dir = sortDir === "asc" ? 1 : -1;
      rows = [...rows].sort((a, b) => compareCells(a[key], b[key]) * dir);
    }
    return rows;
  }, [data, filter, sortKey, sortDir]);

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
  const filteredCount = filteredRows.length;
  const generableAt = formatTime(data.generadaEn);

  const onCopy = async (format: "tsv" | "csv") => {
    const text = format === "tsv" ? buildTSV(data.columnas, filteredRows) : buildCSV(data.columnas, filteredRows);
    const ok = await copyToClipboard(text);
    setCopyHint(ok ? `${format.toUpperCase()} copiado` : `Error al copiar ${format.toUpperCase()}`);
    window.setTimeout(() => setCopyHint(null), 1800);
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
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              {data.columnas.map((c) => (
                <th
                  key={c}
                  scope="col"
                  aria-sort={ariaSortFor(c)}
                  className={styles.th}
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
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 && (
              <tr>
                <td className={styles.emptyCell} colSpan={data.columnas.length}>
                  Ninguna fila coincide con el filtro.
                </td>
              </tr>
            )}
            {filteredRows.map((row, i) => {
              // Glue: parallel array on the table (same length as filas).
              // See quantification/types.ts filas_express_ids for rationale.
              const ids = data.filas_express_ids?.[i] ?? [];
              const clickable = ids.length > 0 && !!onRowSelect;
              return (
                <tr
                  key={i}
                  className={`${styles.row}${clickable ? ` ${styles.rowClickable}` : ""}`}
                  onClick={clickable ? () => onRowSelect!(ids) : undefined}
                  onKeyDown={
                    clickable
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onRowSelect!(ids);
                          }
                        }
                      : undefined
                  }
                  tabIndex={clickable ? 0 : -1}
                  role={clickable ? "button" : undefined}
                  aria-label={
                    clickable
                      ? `Resaltar ${ids.length} elemento${ids.length === 1 ? "" : "s"} en el visor 3D`
                      : undefined
                  }
                >
                  {data.columnas.map((c) => (
                    <td key={c} className={styles.td}>
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
