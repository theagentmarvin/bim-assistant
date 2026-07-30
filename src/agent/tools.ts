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

export async function toolConsultarBaseDeConocimiento(
  args: { pregunta: string; fuente?: "modelo" | "especificacion" | "mapeos" | "auto" },
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
  // Sort by score desc and trim to TOP_K overall.
  allHits.sort((a, b) => b.score - a.score);
  const top = allHits.slice(0, TOP_K);
  const citas = top.map((h) => ({
    fuente: h.chunk.corpus,
    id: h.chunk.id,
    snippet: h.chunk.text.slice(0, 240),
    score: h.score,
  }));
  // The agent loop will turn the snippets into a synthesized answer
  // via Gemini (text-only turn). Here we just hand back the raw hits
  // so the LLM can cite them.
  const respuesta = top
    .map((h) => `[${h.chunk.corpus}/${h.chunk.id}]: ${h.chunk.text}`)
    .join("\n\n");
  return {
    respuesta:
      respuesta || "No se encontraron fragmentos relevantes para esta pregunta.",
    citas,
    hits: top,
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
      const a = args as { pregunta: string; fuente?: "modelo" | "especificacion" | "mapeos" | "auto" };
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
export { embed };
