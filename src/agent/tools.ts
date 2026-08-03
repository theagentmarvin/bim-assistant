// src/agent/tools.ts
//
// Three Spanish-named tool implementations. Each one is a typed async
// fn (args) => Promise<result> that the agent loop can call.
//
// The tools that touch the 3D viewer / PDF are passed in as callbacks
// (resaltarCallback, abrirPdfCallback) so this module stays decoupled
// from the React component tree.

import type { Filter } from "../types";
import { retrieveSnippets, embed } from "./retriever";
import type { RetrievedHit } from "./retriever";
import bimElementsRaw from "../../data/bim_elements.json";
import type { QuantificationTable } from "../quantification/types";

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
}

export interface ConsultarArgs {
  pregunta: string;
  fuente?: "modelo" | "especificacion" | "mapeos" | "auto";
  tabla?: TablaSpec;
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
      if (!displayedColumns.includes(k)) keys.add(k);
    }
  }
  return [...keys].sort();
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
export function buildTabla(
  fuente: "modelo" | "especificacion" | "mapeos",
  spec: TablaSpec,
): QuantificationTable | undefined {
  if (fuente !== "modelo") return undefined;
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
  return {
    titulo: spec.titulo ?? defaultTitulo(spec, filas.length),
    columnas: validColumns,
    filas,
    filas_express_ids,
    available_properties: computeAvailableProperties(filas, validColumns),
    fuente: "modelo",
    generadaEn: new Date().toISOString(),
  };
}

export async function toolConsultarBaseDeConocimiento(
  args: ConsultarArgs,
  _ctx: ToolContext,
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
  return {
    respuesta:
      respuesta || "No se encontraron fragmentos relevantes para esta pregunta.",
    citas,
    hits: top,
    tabla,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
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
