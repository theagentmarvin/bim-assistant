// src/agent/tools.ts
//
// Three Spanish-named tool implementations. Each one is a typed async
// fn (args) => Promise<result> that the agent loop can call.
//
// The tools that touch the 3D viewer / PDF are passed in as callbacks
// (resaltarCallback, abrirPdfCallback) so this module stays decoupled
// from the React component tree.

import type { Filter, Mapping } from "../types";
import { retrieveSnippets, embed } from "./retriever";
import type { RetrievedHit } from "./retriever";
import bimElementsRaw from "../../data/bim_elements.json";
import mappingPresetsRaw from "../../data/mapping_presets.json";
import type {
  OperacionCalculo,
  QuantificationTable,
  TotalesSpec,
} from "../quantification/types";

/**
 * Count bim_elements.json entries by ifc_class. Defensive about the
 * envelope shape: documented as { elements: [...] } but older
 * extracts were sometimes a flat array.
 */
export function countByClass(ifcClass: string): number {
  const env = bimElementsRaw as
    | { elements?: Array<{ ifc_class?: string }> }
    | Array<{ ifc_class?: string }>;
  const list: Array<{ ifc_class?: string }> = Array.isArray(env)
    ? env
    : (env.elements ?? []);
  return list.filter((e) => e.ifc_class === ifcClass).length;
}

// ----- Tool result types -----

export interface ConsultarResult {
  respuesta: string;
  citas: Array<{
    fuente: string;
    id: string;
    snippet: string;
    score: number;
  }>;
  hits: RetrievedHit[];
  /** Optional structured table (populated when the agent asks for
   *  quantification + column list). Renders in the Cuantificación tab. */
  tabla?: QuantificationTable;
  /** Boss 2026-07-30 18:13 — warnings about the agent's request.
   *  Used to flag columns that have no data for the requested class
   *  (e.g., "largo" for IfcWindow — length_m is null in the extract).
   *  The agent uses these warnings to suggest alternatives to the
   *  user from the table's available_properties field. */
  warnings?: string[];
  /** Stage 1 Improvement 1 — agent-driven sidebar filtering.
   *  When the agent sets `filtrar_mapeos`, the tool returns the list
   *  of matching section_ids. The sidebar renders only those cards
   *  with an "Agente: filtrando N secciones" indicator. */
  tarjetas_visibles?: string[];
}

export interface ResaltarResult {
  matching: number;
  total: number;
  ids: number[];
  accion: "resaltado" | "limpiado" | "reset";
  criterio: string;
}

export interface AbrirPdfResult {
  pagina: number;
  titulo: string;
  snippet: string;
  fuente: string;
}

export type ToolResult =
  | { tool: "consultar_base_de_conocimiento"; ok: true; result: ConsultarResult }
  | { tool: "consultar_base_de_conocimiento"; ok: false; error: string }
  | { tool: "resaltar_elementos"; ok: true; result: ResaltarResult }
  | { tool: "resaltar_elementos"; ok: false; error: string }
  | { tool: "abrir_seccion_pdf"; ok: true; result: AbrirPdfResult }
  | { tool: "abrir_seccion_pdf"; ok: false; error: string };

// ----- Tool callback surface (wired in App.tsx) -----

export interface ResaltarCallback {
  (args: {
    clase_ifc?: string;
    seccion_id?: string;
    filtro?: Filter;
    reset?: boolean;
  }): ResaltarResult;
}

export interface AbrirPdfCallback {
  (args: {
    seccion_id?: string;
    consulta?: string;
    pagina?: number;
  }): AbrirPdfResult | Promise<AbrirPdfResult>;
}

export interface ToolContext {
  resaltar: ResaltarCallback;
  abrirPdf: AbrirPdfCallback;
}

// ----- Tool implementations -----

const TOP_K = 5;

/**
 * Optional structured-mode spec for `consultar_base_de_conocimiento`.
 * When set, the tool builds a `tabla` from bim_elements.json: filters
 * by class, projects to the requested columns (or group-by keys),
 * and returns the result wrapped as `QuantificationTable`.
 */
export interface TablaSpec {
  clase_ifc?: string;
  /** Project to these columns. Labels are resolved via COLUMN_LABEL_TO_KEY. */
  columnas?: string[];
  /** Group-by keys. Emits one row per unique key combination with a
   *  `Cantidad` count column. */
  agrupar_por?: string[];
  /** Spanish title for the table header. */
  titulo?: string;
  /**
   * Boss 2026-08-03 (calcular_cantidades) — when set, the table
   * aggregates the named columns (suma / promedio / min / max), adds a
   * TOTAL row per operation at the bottom of the Cuantificación tab
   * and exposes the aggregates via the table's `totales` field for
   * the agent's prose response. Each column must be one of the
   * labels in `columnas`. Resolution order is the same as for
   * `columnas` (Spanish aliases first, then class-specific Qto_
   * keys via availableColumns).
   *
   * 2026-08-05 (fix #B1.b) — promoted from a single object to an
   * array so a single tool call can emit totals for multiple
   * columns (e.g. sum Area + sum Largo + sum Alto). The LLM emits
   * the array; the tool loop produces one TOTAL row per element.
   */
  calcular?: Array<{
    operacion: OperacionCalculo;
    columna: string;
  }>;
  /**
   * Boss 2026-08-05 (R2: incremental refinement) — when set,
   * operates on the cached rows from the previous buildTabla call
   * instead of re-querying bim_elements.json. The refinement
   * inherits the class context from the cache, so the clase_ifc
   * field is ignored when refinar is present. See the report's
   * §Recommendation 2 for the full spec.
   */
  refinar?: RefinarSpec;
}

/**
 * Boss 2026-08-05 (R2) — refinement operations applied to the
 * cached raw rows from a previous buildTabla call. See
 * refinarTabla() and the report's §Recommendation 2 for the full
 * semantics (filter, sort, add/remove columns, restore the
 * unfiltered row set).
 */
export interface RefinarSpec {
  /** Keep only rows where `columna` matches `valor`. Default
   *  operador is "igual" (exact match). */
  filtrar_por?: {
    columna: string;
    valor: string;
    operador?: "igual" | "no_igual" | "contiene" | "no_contiene" | "mayor_que" | "no_mayor_que" | "menor_que" | "no_menor_que";
  };
  /** Add columns from available_properties to the display. */
  agregar_columnas?: string[];
  /** Hide (don't delete) these columns from display. */
  quitar_columnas?: string[];
  /** Re-sort the cached rows by this column. */
  ordenar_por?: { columna: string; direccion: "asc" | "desc" };
  /** Restore the original unfiltered row set. Re-queries
   *  bim_elements.json with the cached clase_ifc. */
  quitar_filtro?: boolean;
}

/** Stage 1 Improvement 1 — agent-driven sidebar filtering.
 *  When the agent sets this, the tool filters mapping_presets.json
 *  in-memory and returns `tarjetas_visibles` in the result. */
export interface FiltrarMapeosSpec {
  /** Only sections mapped to this ifc_class. */
  ifc_class?: string;
  /** Only sections whose top result's pass matches. */
  pass?: string | string[];
  /** Only sections whose top result confidence ≥ this. */
  conf_min?: number;
  /** Only sections with this status ("mapped" | "review"). */
  status?: string;
  /** Fuzzy text search on section_title + rationale. */
  query?: string;
}

export interface ConsultarArgs {
  pregunta: string;
  fuente?: "modelo" | "especificacion" | "mapeos" | "auto";
  tabla?: TablaSpec;
  /** Stage 1 Improvement 1 — agent-driven sidebar filtering. */
  filtrar_mapeos?: FiltrarMapeosSpec;
}

/**
 * Map a Spanish / snake_case column label the agent supplies to the
 * actual top-level property key on the BIM element. Returns the
 * label's lower-cased form when the key is valid snakecase.
 */
const COLUMN_LABEL_TO_KEY: Record<string, string> = {
  nombre: "name", name: "name",
  clase: "ifc_class", "clase ifc": "ifc_class", clase_ifc: "ifc_class",
  material: "material_name", "material name": "material_name",
  exterior: "is_external", is_external: "is_external", es_externo: "is_external",
  "resistencia al fuego": "fire_rating", firerating: "fire_rating", fire_rating: "fire_rating",
  planta: "spatial_container", "spatial container": "spatial_container", spatial_container: "spatial_container",
  nivel: "spatial_container",
  piso: "spatial_container",
  "tipo predefinido": "predefined_type", predefined_type: "predefined_type",
  elemento_id: "element_id", element_id: "element_id",
  express_id: "express_id",
  // Dimensions — these now resolve directly to the flattened Qto_*
  // top-level keys (Boss 2026-07-30 task-psets-flattening). The
  // resolver looks for an available column ending with ".<bare>"
  // (e.g. "Qto_WallBaseQuantities.Width"). The English + dotted-path
  // aliases below still resolve to geometry_summary.* for callers
  // that want the legacy nested path.
  largo: "Length",
  ancho: "Width",
  alto: "Height",
  // English aliases (in case the agent uses English labels).
  length: "geometry_summary.length_m",
  width: "geometry_summary.width_m",
  height: "geometry_summary.height_m",
  // Direct dotted-path aliases (in case the agent passes the raw key).
  length_m: "geometry_summary.length_m",
  width_m: "geometry_summary.width_m",
  height_m: "geometry_summary.height_m",
  // Flattened Qto properties (Boss 2026-07-30 task-psets-flattening).
  // `volumen` carries an explicit regex (`Qto_.*GrossVolume`) and
  // resolves against the row's available scalar top-level keys
  // (returns the first class-specific match, e.g.
  // "Qto_WallBaseQuantities.GrossVolume"). The other entries are
  // bare names that the resolver treats as partial-match targets —
  // it looks for any available column ending with ".<bare>".
  volumen: "Qto_.*GrossVolume",
  altura: "Height",
  area: "NetSideArea",
  "area neta": "NetSideArea",
  "area bruta": "GrossSideArea",
  // Accented variants (Boss 2026-08-03 — calcular_cantidades test
  // surfaced this; the LLM frequently passes "Área" / "Área neta" with
  // the proper Spanish accent from the user's question. Without these
  // entries the column is filtered out and the table returns undefined).
  "área": "NetSideArea",
  "área neta": "NetSideArea",
  "área bruta": "GrossSideArea",
  "volumen bruto": "GrossVolume",
  "volumen neto": "NetVolume",
};

/**
 * Scalar top-level keys present in the given rows. Used to power
 * partial-match lookups in resolveColumnKey so labels like "volumen"
 * or "Height" resolve to class-specific flattened keys like
 * "Qto_WallBaseQuantities.GrossVolume" without hardcoding every
 * class-specific prefix. Added 2026-07-30 (task-psets-flattening).
 */
export function getScalarTopLevelKeys(
  rows: Array<Record<string, unknown>>,
): string[] {
  const keys = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      const v = r[k];
      if (
        v === null ||
        v === undefined ||
        typeof v === "string" ||
        typeof v === "number" ||
        typeof v === "boolean"
      ) {
        keys.add(k);
      }
    }
  }
  return [...keys].sort();
}

/**
 * Map a Spanish / snake_case column label the agent supplies to the
 * actual top-level property key on the BIM element.
 *
 * Resolution order (Boss 2026-07-30 task-psets-flattening):
 *   1. Exact match in COLUMN_LABEL_TO_KEY
 *      a. Regex marker (`.*`): find first available column matching.
 *      b. Bare name: prefer available column ending with ".<name>"
 *         (e.g. "Width" → "Qto_WallBaseQuantities.Width"), else
 *         return literal mapped value.
 *   2. Exact match against availableColumns (case-insensitive)
 *   3. Partial match: first column containing the label as a
 *      substring (case-insensitive)
 *   4. Snake_case fallback
 *
 * The `availableColumns` argument is optional. When omitted the
 * function falls back to map lookup + snake_case (legacy behavior).
 */
export function resolveColumnKey(
  label: string,
  availableColumns?: string[],
): string | null {
  const trimmed = label.trim();
  if (trimmed === "") return null;
  const lower = trimmed.toLowerCase();
  const mapped = COLUMN_LABEL_TO_KEY[lower];
  if (mapped !== undefined) {
    // Regex marker: resolve against availableColumns.
    if (mapped.includes(".*")) {
      if (!availableColumns || availableColumns.length === 0) return null;
      try {
        const re = new RegExp(mapped, "i");
        const match = availableColumns.find((c) => re.test(c));
        if (match) return match;
      } catch {
        /* fall through */
      }
      return null;
    }
    // Bare-name: prefer a column that ends with ".<mapped>" (the
    // class-specific flattened Qto key). Falls back to literal
    // (e.g. geometry_summary.length_m via the English aliases).
    if (availableColumns && availableColumns.length > 0) {
      const endsWith = availableColumns.find((c) => c.endsWith("." + mapped));
      if (endsWith) return endsWith;
    }
    return mapped;
  }
  if (availableColumns && availableColumns.length > 0) {
    const exact = availableColumns.find((c) => c.toLowerCase() === lower);
    if (exact) return exact;
    const partial = availableColumns.find((c) => c.toLowerCase().includes(lower));
    if (partial) return partial;
  }
  return /^[a-z][a-z0-9_]*$/.test(trimmed) ? trimmed : null;
}

/**
 * Get a possibly-nested property from a BIM element row. Resolves
 * dotted paths like "geometry_summary.length_m" by walking the
 * object tree. Returns undefined for any missing segment.
 *
 * First tries the path as a LITERAL key — flat top-level keys
 * like "Qto_WallBaseQuantities.GrossVolume" legitimately contain
 * dots as part of their name (Boss 2026-07-30 task-psets-flattening)
 * and are NOT a navigation path.
 *
 * Added 2026-07-30: the prior projection only did top-level
 * lookups, so any resolution to a nested key (e.g. "largo" →
 * "geometry_summary.length_m") silently returned undefined.
 */
export function getPropertyByPath(row: Record<string, unknown>, path: string): unknown {
  if (Object.prototype.hasOwnProperty.call(row, path)) {
    return row[path];
  }
  const parts = path.split(".");
  let current: unknown = row;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function getBimElements(): Array<Record<string, unknown>> {
  const env = bimElementsRaw as
    | { elements?: Array<Record<string, unknown>> }
    | Array<Record<string, unknown>>;
  return Array.isArray(env) ? env : (env.elements ?? []);
}

/**
 * Project every top-level property of a BIM element into a flat row.
 * Used by `buildTabla` so the UI can add columns at runtime
 * (Boss #14917) without re-querying — the data is already there.
 *
 * Two-pass projection:
 *  1. The agent's chosen columns go into the row under their
 *     Spanish label keys (so the panel can do `row["Nombre"]`
 *     without re-resolving the label→property map on every render).
 *  2. Every OTHER top-level property is added under its raw key
 *     so the "Agregar columna" dropdown has the full inventory to
 *     offer. Skips ifc_class (metadata, not a column users want).
 *
 * The trailing `:NNN` (express_id) is stripped from any `name`
 * value — Boss #14917 wants the table display clean.
 */
function projectRowFull(
  row: Record<string, unknown>,
  columns: string[],
  availableColumns?: string[],
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  // Pass 1 — agent's columns, keyed by label. Uses getPropertyByPath
  // so columns whose resolved key is dotted (e.g. "largo" →
  // "geometry_summary.length_m") actually find their value.
  // `availableColumns` is passed through to resolveColumnKey so
  // partial-match / regex lookups (Boss 2026-07-30
  // task-psets-flattening) can resolve "volumen" → the class's
  // specific Qto_GrossVolume key.
  for (const col of columns) {
    const key = resolveColumnKey(col, availableColumns);
    if (!key) {
      out[col] = "—";
      continue;
    }
    const v = getPropertyByPath(row, key);
    let value: string | number | boolean;
    if (v === null || v === undefined) value = "—";
    else if (typeof v === "boolean") value = v ? "sí" : "no";
    else if (typeof v === "number" || typeof v === "string") value = v;
    else value = JSON.stringify(v);
    if (key === "name" && typeof value === "string") {
      value = value.replace(/:[\d]+$/, "");
    }
    out[col] = value;
  }
  // Pass 2 — every other top-level property under its raw key.
  for (const [k, v] of Object.entries(row)) {
    if (k === "ifc_class") continue;
    if (out[k] !== undefined) continue; // already projected by label pass
    // Flatten geometry_summary into top-level keys so the "Agregar
    // columna" dropdown in QuantificationPanel can offer length_m,
    // width_m, height_m, volume_m3 as direct column choices. Prior
    // to this, the dropdown listed `geometry_summary` as a single
    // JSON-stringified entry — selecting it dumped the whole nested
    // object into one cell. The flattened keys are what the
    // "Agregar columna" inventory consumes via computeAvailableProperties.
    if (k === "geometry_summary" && v && typeof v === "object") {
      for (const [gk, gv] of Object.entries(v as Record<string, unknown>)) {
        if (out[gk] !== undefined) continue;
        let gvalue: string | number | boolean;
        if (gv === null || gv === undefined) gvalue = "—";
        else if (typeof gv === "boolean") gvalue = gv ? "sí" : "no";
        else if (typeof gv === "number" || typeof gv === "string") gvalue = gv;
        else gvalue = JSON.stringify(gv);
        out[gk] = gvalue;
      }
      continue;
    }
    let value: string | number | boolean;
    if (v === null || v === undefined) value = "—";
    else if (typeof v === "boolean") value = v ? "sí" : "no";
    else if (typeof v === "number" || typeof v === "string") value = v;
    else value = JSON.stringify(v);
    if (k === "name" && typeof value === "string") {
      value = value.replace(/:[\d]+$/, "");
    }
    out[k] = value;
  }
  return out;
}

/**
 * Build the available_properties list: every scalar key present in
 * the data minus the ones the agent already chose. Used to power
 * the "Agregar columna" dropdown in QuantificationPanel.
 */
function computeAvailableProperties(
  rows: Array<Record<string, string | number | boolean>>,
  displayedColumns: string[],
): string[] {
  const keys = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      // Boss 2026-08-03 (calcular_cantidades) — internal row marker,
      // not a real column. Skip it so the "Agregar columna" dropdown
      // doesn't offer `_tipo` as an option.
      if (k === "_tipo") continue;
      if (!displayedColumns.includes(k)) keys.add(k);
    }
  }
  return [...keys].sort();
}

/**
 * Boss 2026-08-03 (calcular_cantidades) — infer the unit string from
 * a resolved Qto_ property key. Volume keys → m³, Area keys → m²,
 * Length/Width/Height keys → m. Returns undefined for keys that
 * don't match a known Qto_ segment (e.g. a user-defined property).
 */
function getUnitForProperty(key: string): string | undefined {
  if (/\.Volume$/.test(key) || key.endsWith("Volume")) return "m³";
  if (/\.Area$/.test(key) || key.endsWith("Area")) return "m²";
  if (
    /(\.Length|\.Width|\.Height)$/.test(key) ||
    key.endsWith("Length") ||
    key.endsWith("Width") ||
    key.endsWith("Height")
  ) {
    return "m";
  }
  return undefined;
}

/**
 * Boss 2026-08-03 (calcular_cantidades) — fold a numeric series into
 * a single aggregate value. Returns 0 for an empty input rather than
 * NaN/Infinity so the rendered TOTAL row never displays "NaN".
 */
function aggregateValues(
  values: number[],
  operacion: OperacionCalculo,
): number {
  if (values.length === 0) return 0;
  switch (operacion) {
    case "suma":
      return values.reduce((a, b) => a + b, 0);
    case "promedio":
      return values.reduce((a, b) => a + b, 0) / values.length;
    case "min":
      return Math.min(...values);
    case "max":
      return Math.max(...values);
  }
}

/**
 * Boss 2026-08-03 (calcular_cantidades) — coerce a projected cell
 * value (string | number | boolean) into a finite number for the
 * aggregate. Returns null for booleans, missing values, strings that
 * don't parse as a finite number, and `NaN`/`Infinity` so the
 * aggregate ignores junk without throwing.
 */
function readNumericCell(v: string | number | boolean | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = parseFloat(v);
    if (!Number.isNaN(n) && Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Boss 2026-08-05 (fix #B1.b) — compute one TOTAL row per operation
 * in the spec, push them onto `filas` in place, and return the
 * aggregate TotalesSpec array. Extracted from buildTabla +
 * refinarTabla after the schema was promoted from a single object
 * to an array (a single tool call can now emit totals for multiple
 * columns).
 *
 * Skips a TOTAL row when the column has zero numeric values in the
 * data rows (which would otherwise produce TOTAL = 0.000 with no
 * semantic meaning). Also skips rows already marked `_tipo: "total"`
 * so re-running on a refined cache never sums its own output.
 *
 * Returns an empty array when `specCalcular` is undefined or empty.
 */
function computeCalcularTotales(
  specCalcular: TablaSpec["calcular"],
  filas: Array<Record<string, string | number | boolean>>,
  validColumns: string[],
  availableColumns: string[],
): TotalesSpec[] {
  const totales: TotalesSpec[] = [];
  if (!specCalcular || specCalcular.length === 0) return totales;
  for (const op of specCalcular) {
    const targetCol = op.columna;
    const resolvedKey =
      resolveColumnKey(targetCol, availableColumns) ?? undefined;
    const values: number[] = [];
    for (const row of filas) {
      if (row._tipo === "total") continue;
      const v = readNumericCell(row[targetCol]);
      if (v !== null) values.push(v);
    }
    if (values.length === 0) continue;
    const valor = aggregateValues(values, op.operacion);
    const unidad = resolvedKey ? getUnitForProperty(resolvedKey) : undefined;
    const formatted = unidad
      ? `${valor.toFixed(3)} ${unidad}`
      : valor.toFixed(3);
    const totalRow: Record<string, string | number | boolean> = {
      _tipo: "total",
    };
    for (const col of validColumns) {
      totalRow[col] = col === targetCol ? formatted : "—";
    }
    filas.push(totalRow);
    totales.push({
      operacion: op.operacion,
      columna: targetCol,
      valor,
      unidad,
    });
  }
  return totales;
}

function defaultTitulo(spec: TablaSpec, count: number): string {
  if (spec.agrupar_por && spec.agrupar_por.length > 0) {
    return `Cantidad por ${spec.agrupar_por.join(" / ")} (${count})`;
  }
  if (spec.clase_ifc) return `Listado de ${spec.clase_ifc} (${count})`;
  return `Resultados (${count})`;
}

/**
 * Boss 2026-07-30 18:13 — detect columns that resolved to "—" for
 * every row. These are properties that either don't exist for the
 * class (e.g., length_m for IfcWindow) or are null in the data.
 * Returns the column names so the agent can suggest alternatives
 * from the table's available_properties field.
 */
function detectEmptyColumns(
  filas: Array<Record<string, string | number | boolean>>,
  columnas: string[],
): string[] {
  if (filas.length === 0) return [];
  const empty: string[] = [];
  for (const col of columnas) {
    if (filas.every((row) => row[col] === "—")) {
      empty.push(col);
    }
  }
  return empty;
}

/**
 * Build a structured `tabla` from bim_elements.json. Only sourced
 * from `modelo` corpus — spec/PDF rows don't carry structured
 * properties in this PoC.
 */
/**
 * Boss 2026-08-05 (R2: incremental refinement) — module-level
 * cache of the last successful listing-path buildTabla() call's
 * source rows + column metadata. Consumed by refinarTabla() to
 * skip the bim_elements re-query on the next call. Mutated on
 * every cacheable build; cleared via clearTablaRefinementCache()
 * from App.tsx on table-reset paths.
 *
 * TOTAL rows from calcular_cantidades are NOT a concern — the
 * cache stores raw BIM elements (not projected filas); the TOTAL
 * row only exists in the projected filas and is reconstructed on
 * every refinement. Re-issuing `calcular` on a refined spec
 * re-computes the aggregate (per the report's "Aggregate edge
 * case" mitigation).
 */
let lastTablaCache: {
  rows: Array<Record<string, unknown>>;
  express_ids: number[][];
  columnas: string[];
  available_properties: string[];
  clase_ifc?: string;
} | null = null;

/**
 * Boss 2026-08-05 (R2) — clear the module-level refinement cache.
 * Called by App.tsx on every `setLatestTable(null)` path (× button
 * via handleClearTable, full session reset via handleReset, and
 * any other table-invalidation point). Pure — does not emit events.
 */
export function clearTablaRefinementCache(): void {
  lastTablaCache = null;
}

/**
 * Boss 2026-08-05 (R2) — apply refinement operations to the cached
 * raw rows. Operates on the cache instead of re-querying
 * bim_elements. Bypasses buildTabla's `clase_ifc` guard. Pure —
 * does not mutate the cache; buildTabla re-assigns lastTablaCache
 * after the refinement completes.
 *
 * Pipeline order (matches the report's spec):
 *   1. filtrar_por   — narrow rows
 *   2. columnas      — adjust display (agregar/quitar)
 *   3. ordenar_por   — sort by column
 *   4. quitar_filtro — restore full row set (re-query if needed)
 *   5. compute calculate totals (if spec.calcular is present)
 *   6. project fresh filas and return the new table
 */
function refinarTabla(
  cache: NonNullable<typeof lastTablaCache>,
  refinar: RefinarSpec,
  spec: TablaSpec,
): QuantificationTable | undefined {
  let { rows, express_ids, columnas } = cache;
  // Boss 2026-08-05 (R2.5 bug fix) — raw BIM rows carry flat keys
  // like "Qto_WallBaseQuantities.GrossVolume" / "name", not the
  // Spanish labels the LLM sends ("Volumen", "Nombre"). Resolve
  // the label once so the filter + sort blocks read the right cell.
  const cachedScalarKeys = getScalarTopLevelKeys(rows);

  // 1. Apply row filter.
  if (refinar.filtrar_por) {
    const { columna, valor, operador } = refinar.filtrar_por;
    // Translate the LLM's Spanish label to the raw row's actual
    // key (e.g. "Volumen" → "Qto_.*GrossVolume"). Falls back to the
    // literal label if the column doesn't resolve (graceful —
    // mirrors projectRowFull's "—" em-dash behavior).
    const filterLookup = resolveColumnKey(columna, cachedScalarKeys) ?? columna;
    const indices: number[] = [];
    for (let i = 0; i < rows.length; i++) {
      const cellRaw = getPropertyByPath(rows[i], filterLookup);
      // Mirror projectRowFull's name-strip behavior — drops the trailing
      // ":digits" express-id fragment some BIM tools emit so the filter
      // compares against the same projected name the user sees.
      let cellStr = String(cellRaw ?? "");
      if (filterLookup === "name") cellStr = cellStr.replace(/:[\d]+$/, "");
      const v = cellStr.toLowerCase();
      const target = valor.toLowerCase();
      // Boss 2026-08-05 (R2.5 follow-up) — negation operators
      // (`no_igual`, `no_contiene`, `no_mayor_que`, `no_menor_que`)
      // invert the base match. Numeric operators skip non-numeric
      // cells cleanly so `Number('foo') > Number('bar') → false
      // → !false → true` doesn't silently include junk rows.
      const safeOperador = operador ?? "igual";
      const isNegation = safeOperador.startsWith("no_");
      const baseOp = isNegation ? safeOperador.slice(3) : safeOperador;
      let match = false;
      if (baseOp === "contiene") match = v.includes(target);
      else if (baseOp === "igual") match = v === target;
      else if (baseOp === "mayor_que") {
        const nv = Number(v);
        const nt = Number(target);
        match = Number.isFinite(nv) && Number.isFinite(nt) && nv > nt;
      } else if (baseOp === "menor_que") {
        const nv = Number(v);
        const nt = Number(target);
        match = Number.isFinite(nv) && Number.isFinite(nt) && nv < nt;
      }
      if (isNegation) match = !match;
      if (match) indices.push(i);
    }
    rows = indices.map((i) => rows[i]);
    express_ids = indices.map((i) => express_ids[i] ?? []);
  }

  // 2. Add/remove columns from display.
  if (refinar.agregar_columnas) {
    columnas = [
      ...columnas,
      ...refinar.agregar_columnas.filter((c) => !columnas.includes(c)),
    ];
  }
  if (refinar.quitar_columnas) {
    const quitar = refinar.quitar_columnas;
    columnas = columnas.filter((c) => !quitar.includes(c));
  }

  // 3. Sort by column. Compare helper is local to tools.ts (per the
  //    report's "Sort race" risk — keep the dependency here so we
  //    don't import from QuantificationPanel).
  if (refinar.ordenar_por) {
    const { columna, direccion } = refinar.ordenar_por;
    const dir = direccion === "desc" ? -1 : 1;
    // Same label translation as the filter block — without it the
    // sort comparator reads the wrong property.
    const sortLookup = resolveColumnKey(columna, cachedScalarKeys) ?? columna;
    const indexed = rows.map((r, i) => ({
      row: r,
      ids: express_ids[i] ?? [],
    }));
    indexed.sort(
      (a, b) => compareRefinementCell(a.row[sortLookup], b.row[sortLookup]) * dir,
    );
    rows = indexed.map((x) => x.row);
    express_ids = indexed.map((x) => x.ids);
  }

  // 4. Restore full row set (re-query bim_elements with cached class).
  if (refinar.quitar_filtro) {
    const all = cache.clase_ifc
      ? getBimElements().filter((r) => r.ifc_class === cache.clase_ifc)
      : getBimElements();
    rows = all;
    express_ids = all.map((r) =>
      typeof r.express_id === "number" ? [r.express_id] : [],
    );
  }

  // Re-project fresh filas from the refined raw rows.
  const availableColumns = getScalarTopLevelKeys(rows);
  const validColumns = columnas.filter(
    (c) => resolveColumnKey(c, availableColumns) !== null,
  );
  if (validColumns.length === 0) return undefined;
  const filas = rows.map((r) =>
    projectRowFull(r, validColumns, availableColumns),
  );

  // 5. Re-run `calcular` on the refined rows if the new spec asks.
  // Boss 2026-08-05 (fix #B1.b) — `calcular` is now an array, so a
  // single refinement can re-emit totals for multiple columns
  // (e.g. sum Area + sum Largo + sum Alto after a material filter).
  // Helper pushes one TOTAL row per operation.
  const totales = computeCalcularTotales(
    spec.calcular,
    filas,
    validColumns,
    availableColumns,
  );
  for (let i = 0; i < totales.length; i++) express_ids.push([]);

  return {
    titulo: spec.titulo ?? `Refinado (${filas.length})`,
    columnas: validColumns,
    filas,
    filas_express_ids: express_ids,
    available_properties: computeAvailableProperties(filas, validColumns),
    fuente: "modelo",
    generadaEn: new Date().toISOString(),
    totales,
  };
}

/**
 * Boss 2026-08-05 (R2) — compare helper for refinement sort.
 * Inlined per the report's "Sort race" risk (keep the dependency
 * local to tools.ts so the refinement module doesn't depend on
 * the panel). Returns -1 / 0 / 1 for ascending; numbers compared
 * numerically, strings case-insensitively, nulls sorted last.
 */
function compareRefinementCell(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === undefined || a === null) return 1;
  if (b === undefined || b === null) return -1;
  if (typeof a === "number" && typeof b === "number") {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  const sa = String(a).toLowerCase();
  const sb = String(b).toLowerCase();
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/**
 * Build a structured `tabla` from bim_elements.json. Only sourced
 * from `modelo` corpus — spec/PDF rows don't carry structured
 * properties in this PoC.
 */
export function buildTabla(
  fuente: "modelo" | "especificacion" | "mapeos",
  spec: TablaSpec,
): QuantificationTable | undefined {
  if (fuente !== "modelo") return undefined;
  // Boss 2026-08-05 (R2: incremental refinement) — refinement path.
  // Operates on the cached raw rows from the previous listing-path
  // buildTabla call instead of re-querying bim_elements.json.
  // Bypasses the Boss #14905 safeguard (the refinement inherits the
  // class context from the cache). On cache miss we fall through to
  // the safeguard below so the chat response becomes prose only.
  if (spec.refinar && lastTablaCache) {
    const refined = refinarTabla(lastTablaCache, spec.refinar, spec);
    if (refined) return refined;
  }
  // Boss #14905 safeguard: refuse to build a table with neither a
  // class filter nor a grouping. Without one of these, the table
  // would dump every BIM element in the model — usually a sign the
  // agent got confused about what the user asked for. Force the
  // agent to be specific; the chat response stays as prose only.
  if (!spec.clase_ifc && (!spec.agrupar_por || spec.agrupar_por.length === 0)) {
    return undefined;
  }
  let rows = getBimElements();
  if (spec.clase_ifc) {
    rows = rows.filter((r) => r.ifc_class === spec.clase_ifc);
  }
  // Scalar top-level keys present in the filtered rows — passed to
  // resolveColumnKey so labels like "volumen" or "Height" can be
  // resolved against the actual flattened Qto keys (e.g.
  // "Qto_WallBaseQuantities.GrossVolume") without hardcoding every
  // class-specific prefix. Added 2026-07-30 task-psets-flattening.
  const availableColumns = getScalarTopLevelKeys(rows);
  if (spec.agrupar_por && spec.agrupar_por.length > 0) {
    // Bucket per group key + collect every express_id in the bucket
    // so a row click in the UI can highlight all matching elements.
    const buckets = new Map<string, { count: number; ids: number[]; sample: Record<string, unknown> }>();
    for (const r of rows) {
      const key = spec.agrupar_por
        .map((g) => (r[g] === null || r[g] === undefined ? "—" : String(r[g])))
        .join(" · ");
      const bucket = buckets.get(key) ?? { count: 0, ids: [], sample: r };
      bucket.count += 1;
      if (typeof r.express_id === "number") bucket.ids.push(r.express_id);
      buckets.set(key, bucket);
    }
    const filas: Array<Record<string, string | number | boolean>> = [];
    const filas_express_ids: number[][] = [];
    const groupingKeys = [...spec.agrupar_por, "Cantidad"];
    for (const [key, bucket] of buckets) {
      // Boss #14917: project ALL properties from the sample element
      // so the UI can add columns at runtime. Group key columns and
      // Cantidad overwrite the projected values below.
      const row = projectRowFull(bucket.sample, groupingKeys);
      const parts = key.split(" · ");
      spec.agrupar_por.forEach((g, i) => {
        row[g] = parts[i] ?? "—";
      });
      row["Cantidad"] = bucket.count;
      filas.push(row);
      filas_express_ids.push(bucket.ids);
    }
    filas.sort((a, b) => Number(b["Cantidad"]) - Number(a["Cantidad"]));
    // Boss 2026-08-07 (R2 fix) — populate the refinement cache in the
    // grouping path too, so a follow-up `refinar` can narrow the rows
    // behind the grouped table instead of falling through to a full
    // rebuild (which, with no clase_ifc/agrupar_por in the LLM's
    // refinement spec, hits the #14905 safeguard and clears the table).
    // We store the RAW per-element rows + per-element express_ids, NOT
    // the aggregated filas — a refinement then dis-aggregates the
    // grouped view into a flat filtered listing. The `columnas`
    // defaults to the grouping keys + Cantidad, so an un-grouped
    // refinement yields a sensible listing.
    lastTablaCache = {
      rows,
      express_ids: filas_express_ids,
      columnas: groupingKeys,
      available_properties: computeAvailableProperties(filas, groupingKeys),
      clase_ifc: spec.clase_ifc,
    };
    return {
      titulo: spec.titulo ?? defaultTitulo(spec, filas.length),
      columnas: groupingKeys,
      filas,
      filas_express_ids,
      available_properties: computeAvailableProperties(filas, groupingKeys),
      fuente: "modelo",
      generadaEn: new Date().toISOString(),
    };
  }
  if (!spec.columnas || spec.columnas.length === 0) return undefined;
  const validColumns = spec.columnas.filter((c) => resolveColumnKey(c, availableColumns) !== null);
  if (validColumns.length === 0) return undefined;
  // Boss #14917: project ALL top-level properties into each row so
  // the UI can add columns at runtime. The `columnas` array drives
  // display order only; `available_properties` lets the user pick extras.
  const filas_express_ids: number[][] = rows.map((r) =>
    typeof r.express_id === "number" ? [r.express_id] : [],
  );
  const filas = rows.map((r) => projectRowFull(r, validColumns, availableColumns));
  // Boss 2026-08-03 (calcular_cantidades) — compute the aggregates if
  // the spec asks for them. One TOTAL row per operation goes at the
  // end of `filas` with `_tipo: "total"`; the panel renders them last
  // with distinct styling and bypasses filter/sort. The same values
  // are exposed via `totales` so the agent can phrase the prose response.
  //
  // 2026-08-05 (fix #B1.b) — `calcular` is now an array, so a single
  // buildTabla call can emit totals for multiple columns. The helper
  // produces one TOTAL row per operation and pushes the matching
  // empty express_ids entries below.
  const totales: TotalesSpec[] = computeCalcularTotales(
    spec.calcular,
    filas,
    validColumns,
    availableColumns,
  );
  for (let i = 0; i < totales.length; i++) filas_express_ids.push([]);
  // Boss 2026-08-05 (R2) — populate the refinement cache so the next
  // call with `refinar` can operate on this row set without
  // re-querying bim_elements.json. The cache stores raw elements
  // (not projected filas), so the TOTAL row never enters the cache
  // and refinements always re-project cleanly. Since 2026-08-07 the
  // grouping path above ALSO populates the cache (grouped → listing
  // transition); this listing path remains the ungrouped source.
  const cachedAvailableProperties = computeAvailableProperties(
    filas,
    validColumns,
  );
  lastTablaCache = {
    rows,
    express_ids: filas_express_ids,
    columnas: validColumns,
    available_properties: cachedAvailableProperties,
    clase_ifc: spec.clase_ifc,
  };

  return {
    titulo: spec.titulo ?? defaultTitulo(spec, filas.length),
    columnas: validColumns,
    filas,
    filas_express_ids,
    available_properties: cachedAvailableProperties,
    fuente: "modelo",
    generadaEn: new Date().toISOString(),
    totales,
  };
}

/**
 * Stage 1 Improvement 1 — filter mapping_presets.json in-memory
 * and return matching section_ids for the sidebar.
 */
function filtraMapeos(spec: FiltrarMapeosSpec | undefined): string[] | undefined {
  if (!spec) return undefined;
  const data = mappingPresetsRaw as unknown as { mappings?: Mapping[] };
  const mappings = data.mappings ?? [];
  let filtered = mappings;

  if (spec.ifc_class) {
    const cls = spec.ifc_class;
    filtered = filtered.filter((m) =>
      m.results.some((r) => r.ifc_class === cls),
    );
  }
  if (spec.pass !== undefined) {
    const passes = Array.isArray(spec.pass) ? spec.pass : [spec.pass];
    filtered = filtered.filter((m) => {
      const top = m.results[0];
      return top && passes.includes(top.pass);
    });
  }
  if (spec.conf_min !== undefined) {
    const min = spec.conf_min;
    filtered = filtered.filter((m) => {
      const top = m.results[0];
      return top && top.conf >= min;
    });
  }
  if (spec.status) {
    filtered = filtered.filter((m) => m.status === spec.status);
  }
  if (spec.query) {
    const q = spec.query.toLowerCase();
    filtered = filtered.filter((m) => {
      const title = (m.section_title ?? "").toLowerCase();
      if (title.includes(q)) return true;
      return m.results.some((r) =>
        (r.rationale ?? "").toLowerCase().includes(q),
      );
    });
  }
  return filtered.length > 0 ? filtered.map((m) => m.section_id) : [];
}

export async function toolConsultarBaseDeConocimiento(
  args: ConsultarArgs,
  ctx: ToolContext,
  signal?: AbortSignal,
): Promise<ConsultarResult> {
  const fuente = args.fuente ?? "auto";
  const corpora: Array<"modelo" | "especificacion" | "mapeos"> =
    fuente === "auto"
      ? ["modelo", "mapeos", "especificacion"]
      : [fuente];
  const allHits: RetrievedHit[] = [];
  for (const c of corpora) {
    const { hits } = await retrieveSnippets(args.pregunta, TOP_K, c, signal);
    allHits.push(...hits);
  }
  allHits.sort((a, b) => b.score - a.score);
  const top = allHits.slice(0, TOP_K);
  const citas = top.map((h) => ({
    fuente: h.chunk.corpus,
    id: h.chunk.id,
    snippet: h.chunk.text.slice(0, 240),
    score: h.score,
  }));
  const respuesta = top
    .map((h) => `[${h.chunk.corpus}/${h.chunk.id}]: ${h.chunk.text}`)
    .join("\n\n");
  // Structured-mode: when the agent supplies a `tabla` spec, build it
  // from bim_elements.json (locked to the `modelo` corpus).
  const resolvedFuente: "modelo" | "especificacion" | "mapeos" =
    fuente === "auto" ? "modelo" : fuente;
  const tabla = args.tabla ? buildTabla(resolvedFuente, args.tabla) : undefined;
  // Boss 2026-07-30 18:13 — detect columns that have no data for the
  // requested class (e.g., "largo" for IfcWindow — length_m is null
  // in the extract). The agent uses these warnings to suggest
  // alternatives from available_properties.
  //
  // Declared before the viewer-mirror block below: Boss 2026-08-07
  // adds empty-table warnings here too, after the build.
  const warnings: string[] = [];
  if (tabla) {
    const emptyCols = detectEmptyColumns(tabla.filas, tabla.columnas);
    for (const col of emptyCols) {
      warnings.push(
        `La columna "${col}" no tiene datos para la clase solicitada. ` +
        `Sugiere al usuario columnas alternativas del campo available_properties.`,
      );
    }
  }
  // Boss 2026-08-05 (R2.5 follow-up) — auto-mirror table → viewer.
  // Every fresh and refined table mirrors to the 3D viewer so the
  // JARVIS experience keeps table and model in sync, removing the
  // old decoupled-bundle failure mode where the LLM had to remember
  // a separate `resaltar_elementos` call.
  //
  // Boss 2026-08-07 (honest-reporting hard requirement) — an empty
  // result is NOT the same as "user asked for a reset". Empty table
  // (0 filas) or empty id set must NEVER reset the viewer; the prior
  // highlight is preserved and a warning is emitted so the LLM
  // reports the empty result honestly and suggests alternatives.
  if (tabla?.filas_express_ids) {
    const allIds = tabla.filas_express_ids
      .flat()
      .filter((n): n is number => typeof n === "number" && Number.isFinite(n));
    if (allIds.length > 0) {
      const mirrorFilter: Filter = {
        c: "OR",
        g: allIds.map((id) => ({
          c: "AND",
          r: [{ p: "express_id", op: "equals", v: String(id) }],
        })),
      };
      try {
        ctx.resaltar({ filtro: mirrorFilter });
      } catch (mirrorErr) {
        // Best-effort — never fail the table call on a viewer-side
        // issue.
        // eslint-disable-next-line no-console
        console.warn("table→viewer mirror failed", mirrorErr);
      }
    } else {
      // Boss 2026-08-07 — do NOT reset the viewer on an empty table.
      // Preserve the prior highlight. The user didn't ask for a
      // reset; the auto-mirror must not erase model state just
      // because a filter matched zero rows. A warning below tells
      // the LLM to report the empty result honestly.
      if (tabla.filas.length === 0) {
        warnings.push(
          "La tabla está vacía — el filtro no encontró elementos coincidentes. " +
            "El visor 3D mantiene el resaltado anterior. Informa al usuario " +
            "explícitamente y sugiere valores alternativos de las propiedades " +
            "disponibles. NUNCA afirmes que la operación fue exitosa.",
        );
      }
    }
  } else if (tabla && tabla.filas.length === 0) {
    // Boss 2026-08-07 — a table with 0 filas but no id projection
    // still warrants an honest-empty warning on the prose path.
    warnings.push(
      "La tabla se generó sin filas — el filtro aplicado no encontró " +
        "elementos coincidentes. Informa al usuario explícitamente y " +
        "sugiere valores alternativos. NUNCA afirmes que la operación fue exitosa.",
    );
  }
  // Stage 1 Improvement 1 — agent-driven sidebar filtering.
  // Filter mapping_presets.json in-memory and return matching
  // section_ids. The App.tsx extracts `tarjetas_visibles` from
  // the result and passes it to MappedSidebar.agentFilterIds.
  const tarjetas_visibles = filtraMapeos(args.filtrar_mapeos);

  return {
    respuesta:
      respuesta || "No se encontraron fragmentos relevantes para esta pregunta.",
    citas,
    hits: top,
    tabla,
    warnings: warnings.length > 0 ? warnings : undefined,
    tarjetas_visibles,
  };
}

/**
 * Boss 2026-08-05 (R1: table-state context) — Build a short Spanish
 * preamble describing the currently active table and viewer state
 * so the agent can answer follow-up questions without rebuilding
 * from scratch. Returns null when there's no table AND no selected
 * class, so the caller can safely skip injection.
 *
 * Length cap: kept well under 800 chars. available_properties is
 * truncated to 12 entries so the user's message is never pushed
 * out of the LLM's attention window.
 */
export function buildTableContextPreamble(
    tabla: QuantificationTable | null,
    selectedIfcClass: string | null,
    viewerMatchCount: number | null,
  ): string | null {
    const parts: string[] = [];
    if (tabla) {
      parts.push(
        "[Contexto de tabla activa — el usuario ya tiene ESTA tabla en pantalla]",
      );
      parts.push(`Título: "${tabla.titulo}" · ${tabla.filas.length} filas`);
      parts.push(
        `Columnas mostradas: ${tabla.columnas.join(", ") || "(ninguna)"}`,
      );
      if (tabla.available_properties?.length) {
        const preview = tabla.available_properties.slice(0, 12);
        const suffix = tabla.available_properties.length > 12 ? "…" : "";
        parts.push(
          `Propiedades disponibles (puedes agregarlas como columna): ${preview.join(", ")}${suffix}`,
        );
      }
      if (tabla.totales && tabla.totales.length > 0) {
        // Boss 2026-08-05 (fix #B1.b) — `totales` is now an array.
        // Emit one "Cálculo activo" line per aggregate so the LLM
        // sees the full state on the next turn.
        const opLabel: Record<string, string> = {
          suma: "Suma",
          promedio: "Promedio",
          min: "Mínimo",
          max: "Máximo",
        };
        for (const t of tabla.totales) {
          const formatted = t.unidad
            ? `${t.valor.toFixed(3)} ${t.unidad}`
            : t.valor.toFixed(3);
          const label = opLabel[t.operacion] ?? t.operacion;
          parts.push(
            `Cálculo activo: ${label} de '${t.columna}' = ${formatted}`,
          );
        }
      }
    }
    if (selectedIfcClass) {
      const count =
        viewerMatchCount != null
          ? ` (${viewerMatchCount} elementos visibles)`
          : "";
      parts.push(
        `Clase IFC activa en el visor: ${selectedIfcClass}${count}`,
      );
    }
    if (parts.length === 0) return null;
    parts.push(
      "Usa este contexto para responder preguntas de seguimiento sin reconstruir la tabla desde cero. Si el usuario pide refinar, prioriza las propiedades disponibles listadas arriba.",
    );
    return parts.join("\n");
  }

export function toolResaltarElementos(
  args: {
    clase_ifc?: string;
    seccion_id?: string;
    filtro?: Filter;
    reset?: boolean;
  },
  ctx: ToolContext,
): ResaltarResult {
  return ctx.resaltar(args);
}

export async function toolAbrirSeccionPdf(
  args: { seccion_id?: string; consulta?: string; pagina?: number },
  ctx: ToolContext,
): Promise<AbrirPdfResult> {
  return ctx.abrirPdf(args);
}

/** Dispatch helper used by the agent loop. */
export async function runTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
  signal?: AbortSignal,
): Promise<ToolResult> {
  try {
    if (name === "consultar_base_de_conocimiento") {
      const a = args as unknown as ConsultarArgs;
      const result = await toolConsultarBaseDeConocimiento(a, ctx, signal);
      return { tool: name, ok: true, result };
    }
    if (name === "resaltar_elementos") {
      const a = args as Parameters<ResaltarCallback>[0];
      const result = toolResaltarElementos(a, ctx);
      return { tool: name, ok: true, result };
    }
    if (name === "abrir_seccion_pdf") {
      const a = args as Parameters<AbrirPdfCallback>[0];
      const result = await toolAbrirSeccionPdf(a, ctx);
      return { tool: name, ok: true, result };
    }
    throw new Error(`Herramienta desconocida: ${name}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      tool: name as ToolResult["tool"],
      ok: false,
      error: message,
    } as ToolResult;
  }
}

// Suppress unused-var lint for embed (re-exported for callers that
// want to embed ad-hoc text without re-running the retriever).
export { embed};
