// src/utils/copy.ts
//
// Tabular clipboard formatters for the Cuantificación tab. Treated as
// pure functions so the panel can call them on every click and tests
// (when added) can verify the output without touching the DOM.

export type CellValue = string | number | boolean | null | undefined;
export type Row = Record<string, CellValue>;

/**
 * Escape a single CSV cell: wrap in double quotes if it contains a
 * comma, quote, newline, or carriage return; double-up internal
 * quotes. Matches RFC 4180.
 */
export function escapeCsvCell(value: CellValue): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "string" ? value : String(value);
  if (s === "") return "";
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Escape a single TSV cell: replace tabs/newlines with single spaces
 * so the TSV stays a single line per row when pasted into Excel.
 */
export function escapeTsvCell(value: CellValue): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "string" ? value : String(value);
  return s.replace(/[\t\r\n]+/g, " ");
}

/**
 * Build a TSV (tab-separated) string from headers + rows. Headers are
 * the first row. Pastes cleanly into Excel / Google Sheets.
 */
export function buildTSV(headers: string[], rows: Row[]): string {
  const lines: string[] = [];
  lines.push(headers.map(escapeTsvCell).join("\t"));
  for (const row of rows) {
    lines.push(headers.map((h) => escapeTsvCell(row[h])).join("\t"));
  }
  return lines.join("\n");
}

/**
 * Build a CSV (comma-separated) string from headers + rows. Strings
 * containing commas / quotes / newlines are RFC-4180 quoted. Pastes
 * cleanly into Excel / Numbers / text editors.
 */
export function buildCSV(headers: string[], rows: Row[]): string {
  const lines: string[] = [];
  lines.push(headers.map(escapeCsvCell).join(","));
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsvCell(row[h])).join(","));
  }
  return lines.join("\n");
}

/**
 * Best-effort clipboard write. Tries `navigator.clipboard.writeText`
 * first; falls back to a hidden textarea + execCommand for older
 * browsers / insecure contexts. Returns true on success.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to execCommand fallback
    }
  }
  if (typeof document === "undefined") return false;
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    ta.style.pointerEvents = "none";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
