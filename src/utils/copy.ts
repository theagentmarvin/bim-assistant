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
 * Trigger a CSV file download via an in-memory Blob + temporary
 * anchor click. Designed for the Cuantificación tab's "Exportar CSV"
 * button (Boss 2026-08-05 — copy was working but export wasn't).
 *
 * - Prepends a UTF-8 BOM so Excel respects Spanish accents
 *   (ñ, á, é, í, ó, ú) on first open. Without it, Excel interprets
 *   the file as CP-1252 and shows `Defensa` → `Defensa`.
 * - Uses `URL.createObjectURL` so the file content never has to be
 *   round-tripped through the data: URL protocol (which has length
 *   limits in some browsers).
 * - Cleans up the object URL on the next tick to avoid memory leaks.
 *
 * Returns true on success. Returns false (and logs) if Blob / URL
 * APIs are unavailable (e.g. SSR / Node-only test env).
 */
export function downloadCSV(
  filename: string,
  csv: string,
): boolean {
  if (typeof document === "undefined") return false;
  if (typeof URL === "undefined" || typeof Blob === "undefined") return false;
  try {
    const BOM = "\ufeff";
    // BOM as a separate BlobPart rather than concatenating into the
    // first string. Functionally equivalent, but lets the test
    // inspect the two parts independently — and mirrors how most
    // CSV-export libraries do it.
    const blob = new Blob([BOM, csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Defer revoke so the browser has time to start the download.
    // Sync revoke races Chromium's download pipeline on some versions.
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return true;
  } catch (err) {
    console.warn("[copy] downloadCSV failed:", err);
    return false;
  }
}

/**
 * Slugify a string for safe cross-platform filenames. Strips
 * diacritics, lowercases, and replaces non-alphanumeric runs with
 * a single hyphen. Collapses leading/trailing hyphens. Empty strings
 * fall back to "tabla".
 */
export function slugifyForFilename(input: string): string {
  const stripped = input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return stripped || "tabla";
}

/**
 * Format a Date as a YYYY-MM-DD-HHMM timestamp suffix for filenames.
 * Uses local time (matches the user's notion of "when I exported").
 */
export function timestampForFilename(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}`
  );
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
