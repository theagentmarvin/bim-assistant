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
  "tipo predefinido": "predefined_type", predefined_type: "predefined_type",
  elemento_id: "element_id", element_id: "element_id",
  express_id: "express_id",
};

function resolveColumnKey(label: string): string | null {
  const trimmed = label.trim();
  if (trimmed === "") return null;
  const lower = trimmed.toLowerCase();
  if (COLUMN_LABEL_TO_KEY[lower]) return COLUMN_LABEL_TO_KEY[lower];
  return /^[a-z][a-z0-9_]*$/.test(trimmed) ? trimmed : null;
}

function getBimElements(): Array<Record<string, unknown>> {
  const env = bimElementsRaw as
    | { elements?: Array<Record<string, unknown>> }
    | Array<Record<string, unknown>>;
  return Array.isArray(env) ? env : (env.elements ?? []);
}

function projectRow(
  row: Record<string, unknown>,
  columns: string[],
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const col of columns) {
    const key = resolveColumnKey(col);
    if (!key) {
      out[col] = "—";
      continue;
    }
    const v = row[key];
    if (v === null || v === undefined) out[col] = "—";
    else if (typeof v === "boolean") out[col] = v ? "sí" : "no";
    else if (typeof v === "number" || typeof v === "string") out[col] = v;
    else out[col] = JSON.stringify(v);
  }
  return out;
}

function defaultTitulo(spec: TablaSpec, count: number): string {
  if (spec.agrupar_por && spec.agrupar_por.length > 0) {
    return `Cantidad por ${spec.agrupar_por.join(" / ")} (${count})`;
  }
  if (spec.clase_ifc) return `Listado de ${spec.clase_ifc} (${count})`;
  return `Resultados (${count})`;
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
  let rows = getBimElements();
  if (spec.clase_ifc) {
    rows = rows.filter((r) => r.ifc_class === spec.clase_ifc);
  }
  if (spec.agrupar_por && spec.agrupar_por.length > 0) {
    // Bucket per group key + collect every express_id in the bucket
    // so a row click in the UI can highlight all matching elements.
    const buckets = new Map<string, { count: number; ids: number[] }>();
    for (const r of rows) {
      const key = spec.agrupar_por
        .map((g) => (r[g] === null || r[g] === undefined ? "—" : String(r[g])))
        .join(" · ");
      const bucket = buckets.get(key) ?? { count: 0, ids: [] };
      bucket.count += 1;
      if (typeof r.express_id === "number") bucket.ids.push(r.express_id);
      buckets.set(key, bucket);
    }
    const filas: Array<Record<string, string | number | boolean>> = [];
    const filas_express_ids: number[][] = [];
    for (const [key, bucket] of buckets) {
      const row: Record<string, string | number | boolean> = {};
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
      columnas: [...spec.agrupar_por, "Cantidad"],
      filas,
      filas_express_ids,
      fuente: "modelo",
      generadaEn: new Date().toISOString(),
    };
  }
  if (!spec.columnas || spec.columnas.length === 0) return undefined;
  const validColumns = spec.columnas.filter((c) => resolveColumnKey(c) !== null);
  if (validColumns.length === 0) return undefined;
  const filas = rows.map((r) => projectRow(r, validColumns));
  return {
    titulo: spec.titulo ?? defaultTitulo(spec, filas.length),
    columnas: validColumns,
    filas,
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
  return {
    respuesta:
      respuesta || "No se encontraron fragmentos relevantes para esta pregunta.",
    citas,
    hits: top,
    tabla,
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
