// src/data/prompts.ts
//
// Boss 2026-08-05 (R3: contextual suggested-prompt chips) — Loads
// the user-prompts registry and generates a dynamic list of
// suggested prompts adapted to the current model/table state.
//
// Stays inside the locked PoC scope: Spanish-only, no new tool,
// UI-only change. The registry is a JSON file Boss can edit
// without touching TypeScript — Vite HMR picks up the change on
// save.

import promptsRaw from "../../data/user-prompts.json";
import type { QuantificationTable } from "../quantification/types";

export interface PromptCondition {
  /** Show only when the IFC model has finished loading. */
  model_loaded?: boolean;
  /** Show only when a quantification table is visible. */
  table_active?: boolean;
  /** Inverse of table_active — show only when no table is on screen. */
  no_table?: boolean;
  /** Show only when the agent has highlighted elements in the viewer. */
  viewer_highlight_active?: boolean;
  /** Show only when the table includes this column label. */
  has_column?: string;
  /** Show only when this property is in available_properties. */
  has_available_property?: string;
  /** Show only when this specific IFC class is highlighted. */
  selected_class?: string;
}

export interface PromptEntry {
  id: string;
  text: string;
  category: string;
  /** Higher = more important. Dynamic prompts use 50; clearing 10. */
  priority: number;
  conditions?: PromptCondition;
}

interface PromptRegistry {
  prompts: PromptEntry[];
}

/**
 * Load the user-prompts registry at module-init time. Vite bundles
 * the JSON statically so this is a one-shot read. HMR re-evaluates
 * the file on save.
 */
export function loadPromptRegistry(): PromptEntry[] {
  const env = promptsRaw as PromptRegistry | PromptEntry[];
  return Array.isArray(env) ? env : (env.prompts ?? []);
}

/**
 * Match a single entry's conditions against the current state.
 * Returns true if the entry should be shown. Undefined condition
 * keys are skipped (treated as "match anything").
 */
function matchesConditions(
  cond: PromptCondition | undefined,
  ctx: PromptContext,
): boolean {
  if (!cond) return true;
  if (cond.model_loaded !== undefined && cond.model_loaded !== ctx.modelLoaded) {
    return false;
  }
  if (cond.table_active !== undefined) {
    const tableActive = ctx.tabla !== null;
    if (cond.table_active !== tableActive) return false;
  }
  if (cond.no_table !== undefined) {
    const tableActive = ctx.tabla !== null;
    if (cond.no_table === tableActive) return false;
  }
  if (cond.viewer_highlight_active !== undefined) {
    // Registry field is a boolean toggle. The runtime proxy for
    // "viewer has highlights" is viewerMatchCount !== null — when
    // the agent has highlighted elements, the viewer exposes the
    // count; when nothing is highlighted, it's null.
    const viewerHighlighted = ctx.viewerMatchCount !== null;
    if (cond.viewer_highlight_active !== viewerHighlighted) return false;
  }
  if (cond.has_column !== undefined) {
    if (!ctx.tabla || !ctx.tabla.columnas.includes(cond.has_column)) return false;
  }
  if (cond.has_available_property !== undefined) {
    if (
      !ctx.tabla?.available_properties?.includes(cond.has_available_property)
    ) {
      return false;
    }
  }
  if (cond.selected_class !== undefined) {
    if (ctx.selectedIfcClass !== cond.selected_class) return false;
  }
  return true;
}

interface PromptContext {
  tabla: QuantificationTable | null;
  selectedIfcClass: string | null;
  viewerMatchCount: number | null;
  modelLoaded: boolean;
}

/**
 * Pure helper: detect the labels of any numeric columns in the
 * given table. Used to generate dynamic aggregation prompts
 * ("¿Cuál es el más ancho?", "Calcula el total de volumen", etc.).
 */
function numericColumnLabels(tabla: QuantificationTable): string[] {
  const labels: string[] = [];
  for (const col of tabla.columnas) {
    const sample = tabla.filas.find((r) => typeof r[col] === "number");
    if (sample !== undefined) labels.push(col);
  }
  return labels;
}

/**
 * Pure helper: convert a Spanish column label to its singular
 * noun form for prompts. Tiny heuristic — strips common plural
 * markers and lowercases. Falls back to the original label.
 */
function singularize(label: string): string {
  const lower = label.toLowerCase();
  if (lower.endsWith("es")) return label.slice(0, -2);
  if (lower.endsWith("s")) return label.slice(0, -1);
  return label;
}

/**
 * Compute the contextual suggested-prompt list. Combines:
 *   1. Static registry entries whose conditions match the current
 *      state, sorted by priority desc.
 *   2. Dynamic prompts generated from the table state (numeric
 *      columns → max/avg/sum, boolean properties → filter).
 *   3. A "Limpia la tabla actual" prompt when a table is active
 *      (priority 10 — always below the content prompts but above
 *      the help fallback).
 * Final list is capped at 6 entries to keep the suggestion list
 * scannable on mobile.
 */
export function getContextualPrompts(
  registry: PromptEntry[],
  tabla: QuantificationTable | null,
  selectedIfcClass: string | null,
  viewerMatchCount: number | null,
  modelLoaded = true,
  maxItems = 6,
): string[] {
  const ctx: PromptContext = {
    tabla,
    selectedIfcClass,
    viewerMatchCount,
    modelLoaded,
  };
  const items: Array<{ text: string; priority: number }> = [];

  // 1. Static entries whose conditions match.
  for (const entry of registry) {
    if (!matchesConditions(entry.conditions, ctx)) continue;
    items.push({ text: entry.text, priority: entry.priority });
  }

  // 2. Dynamic prompts from table state.
  if (tabla) {
    const numericCols = numericColumnLabels(tabla);
    for (const col of numericCols.slice(0, 2)) {
      const singular = singularize(col);
      items.push({ text: `¿Cuál es el más alto de ${singular}?`, priority: 50 });
      items.push({ text: `Calcula el promedio de ${singular}`, priority: 50 });
      items.push({ text: `Suma total de ${singular}`, priority: 50 });
    }
    if (tabla.available_properties?.includes("is_external")) {
      // Don't duplicate — if "refinar-exteriores" is already in the
      // list from the registry, drop one copy.
      const hasFilter = items.some((it) =>
        it.text.toLowerCase().includes("filtra solo los exteriores"),
      );
      if (!hasFilter) {
        items.push({ text: "Filtra solo los exteriores", priority: 55 });
      }
    }
    if (tabla.available_properties?.includes("material_name")) {
      const hasAdd = items.some((it) =>
        it.text.toLowerCase().includes("agrega la columna de material"),
      );
      if (!hasAdd) {
        items.push({ text: "Agrega la columna de material", priority: 48 });
      }
    }
    // Always offer table-clear at low priority.
    const hasClear = items.some((it) =>
      it.text.toLowerCase().includes("limpia la tabla"),
    );
    if (!hasClear) {
      items.push({ text: "Limpia la tabla actual", priority: 10 });
    }
  }

  // Sort by priority desc and dedup by text.
  items.sort((a, b) => b.priority - a.priority);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    if (seen.has(it.text)) continue;
    seen.add(it.text);
    out.push(it.text);
    if (out.length >= maxItems) break;
  }
  return out;
}
