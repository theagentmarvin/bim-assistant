# Agent Improvement Recommendations — bim-assistant PoC

**Date:** 2026-08-05  
**Author:** Critic subagent (DeepSeek V4 Pro)  
**Read-only analysis.** No code edits, no commits, no test runs.

---

## TL;DR

**Elevator pitch:** The agent builds rich tables but has zero visibility into them after the first turn. Inject table context into subsequent turns so the agent can refine queries, suggest follow-ups, and extract multi-attribute aggregates — all without breaking the 3-tool surface.

**Three ranked recommendations:**
1. **Inject table-state context into every agent turn** — the agent sees what's in the current table and can refine/filter/expand it iteratively. Touches both axes hardest: richer extraction (the agent knows what properties are available on the existing rows) AND better table interaction (the agent can filter/sort without rebuilding).
2. **Add incremental table refinement to `buildTabla`** — the agent issues a `refinar` spec against the existing table (filter rows, add columns, change sort) instead of rebuilding from scratch. Touches axis A harder, axis B secondarily via drill-down.
3. **Contextual suggested-prompt chips** — the ChatPanel's "ejemplos" list adapts to the current model/table state, guiding the user toward high-value follow-ups. Touches axis A (interaction surface), axis B indirectly (prompts steer toward richer extraction).

**Extensibility:** A two-registry architecture: (a) `data/prompts-registry.json` for suggested prompts with trigger rules, and (b) `data/question-rules.json` for hook-based logic rules injected at 5 named pipeline points. Both are live-reloaded JSON, no code changes needed for new entries.

---

## Recommendation 1: Inject Table-State Context into Every Agent Turn

### Title
**Give the agent ambient awareness of the current table/viewer state so it can refine queries iteratively instead of rebuilding from scratch.**

### Pain today
When the user asks a follow-up question like _"y esas 7 ventanas, ¿cuáles son exteriores?"_, the agent has no idea there's already a table of 7 windows displayed. It treats the question as a brand-new query. The `JARVIS_SYSTEM_PROMPT` (prompts.ts:1-109) has no mechanism to communicate "the current table has rows X, Y, Z with columns A, B, C." The result: the agent calls `consultar_base_de_conocimiento` with a fresh `TablaSpec` from scratch, re-running the full `buildTabla` → `projectRowFull` pipeline (tools.ts:460-530) when the data already sits in `QuantificationTable.filas`. The worst offender is at `loop.ts:62-65` — every `runAgentLoop` invocation starts with `contents = [{ role: "user", parts: [{ text: userMessage }] }]` — a clean slate. No table context survives across turns.

Additionally, the prose-injection guardrail at `loop.ts:117-129` only fires when `consultar_base_de_conocimiento` returns `totales` in the SAME turn. If the user asks _"¿cuál fue el área total de esas ventanas?"_ in a follow-up turn, the total from the previous turn is lost — the agent re-queries (and may get a different result if the LLM constructs a different spec).

**Specific citation:** `loop.ts:116-129` (prose guard only for current-turn totals), `loop.ts:62-64` (contents array starts fresh each invocation).

### Proposed change
Before appending the user's message to `contents`, inject a compact **table-state preamble** as a `role: "user"` part. The preamble carries:
- Table title, row count, column names
- Available properties (so the agent knows what it _could_ add as columns)
- Whether a sort/filter is active
- Any cached `totales` from the previous turn
- Current viewer filter (selected IFC class / element count highlighted)

The format is a short Spanish text block (~200-400 chars) that the LLM can parse naturally in its system-prompt context. No new structured schema — just a plain text preamble that the prompt already knows how to interpret (the existing prompt at `prompts.ts:1-109` already gives rich column-building instructions; this preamble gives it the _current state_ it needs to follow them).

The preamble is built by `App.tsx` (which already owns `QuantificationTable | null` and `selectedIfcClass | null`) and injected into `runAgentLoop` via a new optional parameter: `tableContext?: string`. The loop prepends it to `contents[0]` before the user message.

### Chat UX sketch
**Before (today):**
```
Usuario: ¿cuáles son exteriores?
Salfa BIM Agent 01: 🔧 consultar_base_de_conocimiento
                    fuente=modelo · pregunta="ventanas exteriores IfcWindow"
                    → Nueva tabla: Listado de IfcWindow (7) — rebuild completa, misma tabla.
```
The agent rebuilds the table from scratch because it doesn't know one already exists.

**After (proposed):**
```
[Internal preamble injected:]
[Tabla actual: "Listado de IfcWindow (7)" · 7 filas · columnas: Nombre, Ancho, Alto · 
Propiedades disponibles: is_external, material_name, fire_rating, volumen, ...]

Usuario: ¿cuáles son exteriores?
Salfa BIM Agent 01: De las 7 ventanas en la tabla, 3 son exteriores.
                    🔧 consultar_base_de_conocimiento (refina tabla existente con filtro is_external=sí)
                    → Tabla refinada: 3 filas visibles de 7. Mismas columnas.
```
The agent knows the table exists and the available properties. It can either filter (if we ship R2) or build a refined query that adds `is_external` as a column.

### Table UX sketch
No visible UI change for the user. The agent's response carries more context — it references "de las 7 ventanas en la tabla" instead of starting from zero. The Cuantificación tab updates via the existing `setTabla` state path (already wired in `App.tsx`). If a refinement is possible (R2), the table updates in-place with a filter applied; if not, the agent builds a new table but with better column selection because it knows what properties are available.

### Implementation sketch
**Files to touch:**
- `src/agent/tools.ts` — add `buildTableContextPreamble(tabla: QuantificationTable, ...)`: string helper that generates the preamble text
- `src/agent/loop.ts` — add `tableContext?: string` to second parameter; prepend to contents when non-empty
- `src/App.tsx` — call `buildTableContextPreamble` with current state and pass to `runAgentLoop`

**New function sketch (~30 lines):**
```ts
// src/agent/tools.ts — new export
export function buildTableContextPreamble(
  tabla: QuantificationTable | null,
  selectedIfcClass: string | null,
  viewerMatchCount: number | null,
): string | null {
  if (!tabla && !selectedIfcClass) return null;
  const parts: string[] = [];
  if (tabla) {
    parts.push(`[Contexto de tabla activa — el usuario ya tiene ESTA tabla en pantalla]`);
    parts.push(`Título: "${tabla.titulo}" · ${tabla.filas.length} filas`);
    parts.push(`Columnas mostradas: ${tabla.columnas.join(", ")}`);
    if (tabla.available_properties?.length) {
      const preview = tabla.available_properties.slice(0, 12).join(", ");
      parts.push(`Propiedades disponibles (el usuario puede agregar): ${preview}${tabla.available_properties.length > 12 ? "…" : ""}`);
    }
    if (tabla.totales) {
      parts.push(`Cálculo activo: ${tabla.totales.operacion} de ${tabla.totales.columna} = ${tabla.totales.valor}${tabla.totales.unidad ? ` ${tabla.totales.unidad}` : ""}`);
    }
  }
  if (selectedIfcClass) {
    parts.push(`Clase IFC activa en el visor: ${selectedIfcClass}${viewerMatchCount != null ? ` (${viewerMatchCount} elementos visibles)` : ""}`);
  }
  if (parts.length === 0) return null;
  parts.push(`Usa este contexto para responder preguntas de seguimiento sin reconstruir la tabla desde cero. Si el usuario pide refinar, prioriza las propiedades disponibles listadas arriba.`);
  return parts.join("\n");
}
```

**Loop integration (~5 line change in `loop.ts`):**
```ts
export async function runAgentLoop(
  userMessage: string,
  ctx: ToolContext,
  callbacks: AgentCallbacks = {},
  signal?: AbortSignal,
  tableContext?: string,  // NEW
): Promise<string> {
  const parts: GeminiContent["parts"] = [];
  if (tableContext) {
    parts.push({ text: tableContext });
  }
  parts.push({ text: userMessage });
  const contents: GeminiContent[] = [{ role: "user", parts }];
  // ... rest unchanged
}
```

### Cost
- **LoC delta:** ~45 new, ~8 modified
- **Complexity tier:** S (small — a text preamble + one extra param)
- **Time to implement:** 45–60 minutes
- **No new types, no UI changes, no new tool schema.**

### Risk
- **What could break:** If the preamble is too long (>800 chars), it could push the user's message out of the LLM's attention window. Mitigation: cap at 400 chars, truncate `available_properties` preview at 12 entries.
- **Ties to existing:** `loop.ts:62-64` (contents init), `App.tsx:handleSend` (caller of `runAgentLoop`), `tools.ts:buildTabla` (source of `QuantificationTable` shape). All well-understood, minimal coupling.
- **Hallucination surface:** The preamble might mislead the LLM if it contains stale data (e.g., user manually cleared the table but the preamble still references the old one). Mitigation: `App.tsx` builds the preamble from the React state, which is always current — if `tabla` is null, no preamble is generated.

### PoC-fit check
✅ No locked constraint crossed. This is pure context injection — same 3-tool surface, Spanish-only, single IFC, no new UI. The agent gets smarter context but its capabilities don't change. Fully within PoC scope.

---

## Recommendation 2: Incremental Table Refinement via `refinar` Spec

### Title
**Add a `refinar` operation to `buildTabla` so the agent can filter rows, add columns, or change sort on the EXISTING table instead of rebuilding from scratch.**

### Pain today
Every follow-up table question triggers a complete rebuild. `buildTabla` (tools.ts:382-530) always starts from `getBimElements()` → filter by class → project rows. There's no concept of _"take the last table and apply a refinement."_ The result: 

- If the user asks _"filtra solo los muros exteriores"_, the agent has to guess the `clase_ifc` again (it was `IfcWall` from context, but the agent may forget or hallucinate `IfcWallStandardCase`).
- If the user asks _"agrega la columna de material"_, the agent rebuilds the entire table — same class filter, same rows, just adding one column to `columnas`. This is wasteful (re-runs `projectRowFull` on 68 rows, re-runs the cosine search for RAG snippets that aren't needed).
- The `QuantificationPanel` already has client-side filter (`filter` state at line ~90, sort at line ~88, extra columns at line ~100), but the agent has no API to trigger these operations — they're manual-only.

The worst offender is `tools.ts:472-476` — the `if (!spec.clase_ifc && (!spec.agrupar_por || spec.agrupar_por.length === 0))` guard refuses to build a table without a class filter, but if the user has a table of 68 muros open and says _"filtra solo los exteriores"_, the agent passes no `clase_ifc` (it's an implicit refinement), triggering this guard and returning `undefined`.

### Proposed change
Extend `TablaSpec` with an optional `refinar` field that carries incremental operations on the **previous table's cached rows**. The refinement operations are:

```ts
interface RefinarSpec {
  /** Row filter — keeps only rows where `columna` matches `valor`.
   *  Applied to the cached rows, not re-queried from bim_elements.json. */
  filtrar_por?: { columna: string; valor: string; operador?: "igual" | "contiene" | "mayor_que" | "menor_que" };
  /** Add columns from available_properties to the display. */
  agregar_columnas?: string[];
  /** Remove columns from display (hide, not delete). */
  quitar_columnas?: string[];
  /** Change the primary sort. */
  ordenar_por?: { columna: string; direccion: "asc" | "desc" };
  /** Remove the current filter (show all rows again). */
  quitar_filtro?: boolean;
}
```

When `refinar` is present on the `TablaSpec`, `buildTabla` skips the `getBimElements()` step and instead operates on the **cached rows from the previous table call**. The LLM doesn't need to re-specify `clase_ifc` or `columnas` — those are inherited. The refinement is a delta, not a replacement.

The cache lives in a new module-level variable (`let lastTablaCache: { rows, express_ids, columnas, available_properties } | null = null`) in `tools.ts`. It's set on every successful `buildTabla` call and consumed by refinement calls.

**Guard for the "filtra solo los exteriores" case:** When `refinar` is present, bypass the `clase_ifc` guard at `tools.ts:472-476` — the refinement inherits the class context from the cache.

### Chat UX sketch
```
Usuario: lista los muros con su material
Salfa BIM Agent 01: 🔧 consultar_base_de_conocimiento (tabla: IfcWall, columnas: Nombre, Material)
                    → Tabla: 68 muros, columnas Nombre, Material

Usuario: filtra solo los exteriores
Salfa BIM Agent 01: 🔧 consultar_base_de_conocimiento (tabla: refinar → filtrar_por is_external=sí)
                    → Tabla refinada: 12 muros exteriores de 68. Mismas columnas.

Usuario: agrégales el volumen
Salfa BIM Agent 01: 🔧 consultar_base_de_conocimiento (tabla: refinar → agregar_columnas: Volumen)
                    → Tabla: 12 muros exteriores, columnas Nombre, Material, Volumen.
```

The agent fits the refinements into the same `consultar_base_de_conocimiento` tool — no new tool needed. The `TablaSpec` type expands; the LLM uses the existing schema to choose between a full table build and a refinement.

### Table UX sketch
When a refinement is applied, the table updates in-place via the existing `setTabla` React state path (`App.tsx` → `QuantificationPanel`). The rows animate naturally (React re-render). If the refinement applies a filter, the table's `filas` array shrinks, the meta line updates ("12 visibles de 68"), and the existing `filter` input in `QuantificationPanel.tsx` is NOT touched — the refinement filter is a separate, agent-driven layer. The toolbar shows a subtle badge: "Filtro activo: is_external = sí" with an × to clear it.

### Implementation sketch
**Files to touch:**
- `src/quantification/types.ts` — add `RefinarSpec` interface and optional `refinar?: RefinarSpec` on `QuantificationTable`
- `src/agent/tools.ts` — add `refinarTabla()` function, modify `buildTabla` to detect `refinar` and delegate
- `src/components/QuantificationPanel.tsx` — render the active-refinement badge in the toolbar
- `src/agent/schema.ts` — update the `TablaSpec` JSON schema (already uses inline schema, `TOOL_SCHEMAS` object)

**Core refinement function (~40 lines):**
```ts
// src/agent/tools.ts — new function
let lastTablaCache: {
  rows: Array<Record<string, unknown>>;
  express_ids: number[][];
  columnas: string[];
  available_properties: string[];
  clase_ifc?: string;
} | null = null;

function refinarTabla(
  cache: typeof lastTablaCache,
  refinar: RefinarSpec,
  spec: TablaSpec,
): QuantificationTable | undefined {
  if (!cache) return undefined;
  let { rows, express_ids, columnas, available_properties } = cache;
  
  // 1. Apply row filter
  if (refinar.filtrar_por) {
    const { columna, valor, operador } = refinar.filtrar_por;
    const key = resolveColumnKey(columna) ?? columna;
    const indices: number[] = [];
    for (let i = 0; i < rows.length; i++) {
      const v = String(rows[i][key] ?? "").toLowerCase();
      const target = valor.toLowerCase();
      const match = operador === "contiene" ? v.includes(target)
        : operador === "mayor_que" ? Number(v) > Number(target)
        : operador === "menor_que" ? Number(v) < Number(target)
        : v === target; // default: igual
      if (match) indices.push(i);
    }
    rows = indices.map(i => rows[i]);
    express_ids = indices.map(i => express_ids[i] ?? []);
  }
  
  // 2. Add/remove columns
  if (refinar.agregar_columnas) {
    columnas = [...columnas, ...refinar.agregar_columnas.filter(c => !columnas.includes(c))];
  }
  if (refinar.quitar_columnas) {
    columnas = columnas.filter(c => !refinar.quitar_columnas!.includes(c));
  }
  
  // 3. Sort
  if (refinar.ordenar_por) {
    const { columna, direccion } = refinar.ordenar_por;
    const dir = direccion === "desc" ? -1 : 1;
    // sort rows + express_ids together
    const indexed = rows.map((r, i) => ({ row: r, ids: express_ids[i] ?? [], i }));
    indexed.sort((a, b) => compareCells(a.row[columna], b.row[columna]) * dir);
    rows = indexed.map(x => x.row);
    express_ids = indexed.map(x => x.ids);
  }
  
  // 4. Remove filter
  if (refinar.quitar_filtro) {
    // Restore from cache — but the cache was already filtered, so we
    // re-extract from bim_elements with the cached clase_ifc. This is
    // the only path that needs a re-query.
    const allRows = cache.clase_ifc
      ? getBimElements().filter(r => r.ifc_class === cache.clase_ifc)
      : getBimElements();
    rows = allRows;
    express_ids = allRows.map(r => typeof r.express_id === "number" ? [r.express_id] : []);
  }
  
  const filas = rows.map(r => projectRowFull(r, columnas));
  return {
    titulo: spec.titulo ?? `Refinado (${filas.length})`,
    columnas,
    filas,
    filas_express_ids: express_ids,
    available_properties: computeAvailableProperties(filas, columnas),
    fuente: "modelo",
    generadaEn: new Date().toISOString(),
  };
}
```

**Integration in `buildTabla` (~6 line change):**
```ts
export function buildTabla(fuente, spec): QuantificationTable | undefined {
  if (fuente !== "modelo") return undefined;
  
  // NEW: refinement path
  if (spec.refinar && lastTablaCache) {
    const result = refinarTabla(lastTablaCache, spec.refinar, spec);
    if (result) {
      lastTablaCache = { rows: /* extracted from result */, ... };
      return result;
    }
  }
  
  // existing full-build path (unchanged)
  if (!spec.clase_ifc && (!spec.agrupar_por || spec.agrupar_por.length === 0)) {
    return undefined;
  }
  // ... rest unchanged, set lastTablaCache at the end
}
```

### Cost
- **LoC delta:** ~70 new (refinement function + cache), ~20 modified (buildTabla + schema)
- **Complexity tier:** M (medium — new code path in a 550-line function, cache invalidation edge cases)
- **Time to implement:** 2–3 hours
- **No new UI (badge is one line), no new tool schema field (refinar is a nested optional in existing TablaSpec).**

### Risk
- **What could break:** Cache staleness. If the user changes the model state between calls (e.g., resets the table via the × button), the cache may reference rows that no longer exist in the UI. Mitigation: clear `lastTablaCache` in the `onClear` callback path (`App.tsx` → `handleClearTable`), and on every `resetTrigger` bump.
- **Sort race:** `compareCells` is imported from `QuantificationPanel.tsx` — move it to a shared utils file or inline in `tools.ts`.
- **Aggregate edge case:** If the user refines a table that had a `totales` row (calcular_cantidades), the refinement operation needs to strip the TOTAL row before filtering (or the filter/sort could break). Mitigation: always strip `_tipo: "total"` rows from the cache before applying refinements; re-run `calcular` on the refined rows if the spec still carries it.
- **Ties to existing:** `tools.ts:382-530` (buildTabla), `QuantificationPanel.tsx:onClear` (× button), `App.tsx:handleClearTable`. Moderate coupling — the cache clearing path needs coordination.

### PoC-fit check
✅ No locked constraint crossed. The `refinar` field is a new optional property on an existing tool argument — not a new tool. Operations are all programmatic (filter, sort, column-add) — no LLM arithmetic. Spanish-only. Single IFC. No auth/deploy/cost/clash/spatial.

---

## Recommendation 3: Contextual Suggested-Prompt Chips

### Title
**Replace the static `ejemplos` list in ChatPanel with a dynamic registry that adapts to the current model/table state.**

### Pain today
The suggested prompts in `ChatPanel.tsx:100-106` are four hardcoded strings:
```tsx
<li>¿Cuántos muros hay en el modelo?</li>
<li>muéstrame los muros exteriores</li>
<li>abre la sección sobre siding</li>
<li>¿qué dice la especificación sobre el siding?</li>
```
These are static, never change based on what's currently loaded, and don't exploit the rich data the agent already extracted. When a table of 7 windows with columns Nombre, Ancho, Alto is displayed, the suggested prompts should surface: _"¿Cuál es la ventana más alta?"_, _"¿Cuál es el área total?"_, _"Muestra solo las exteriores"_ — but they don't. The user has to guess what follow-ups are useful.

Additionally, there's no way for the Boss to add new prompts without editing `ChatPanel.tsx` and rebuilding. A simple prompt-registry JSON file would let the Boss tune the chat experience iteratively.

### Proposed change
Three layers:

**Layer 1 — Static registry file:** `data/user-prompts.json` (or `data/prompts-registry.json` — same file used by the extensibility framework). Each entry has:
```json
{
  "id": "cuantificar-ventanas",
  "text": "Cuantifica las ventanas con su ancho y alto",
  "category": "cuantificacion",
  "priority": 10,
  "conditions": { "model_loaded": true }
}
```

**Layer 2 — Dynamic prompt generation:** When a table is populated, infer context-specific prompts from the column inventory and row data. For example, if the table has column `Ancho` with numeric values, generate:
- _"¿Cuál es el más ancho?"_ (max)
- _"¿Cuál es el promedio de ancho?"_ (avg)
- _"Ordena por ancho de mayor a menor"_ (sort)

If the table has `is_external` as an available property, generate:
- _"Filtra solo los exteriores"_
- _"Filtra solo los interiores"_

**Layer 3 — Runtime consumption:** `ChatPanel` receives a new prop `contextualPrompts: string[]` from `App.tsx`. `App.tsx` computes the prompt list by merging the static registry (filtered by conditions) with the dynamic-generation output. The prompt list is limited to 6 items max.

### Chat UX sketch
**Before (today):** Static list of 4 prompts, same every session.

**After (proposed):**
```
[Table active: Listado de IfcWindow (7) · Nombre, Ancho, Alto]

Sugerencias:
  ▸ ¿Cuál es la ventana más alta?
  ▸ Calcula el área total de las ventanas
  ▸ Filtra solo las ventanas exteriores
  ▸ ¿Qué dice la especificación sobre ventanas?
  ▸ ¿Cuántas ventanas hay de cada tipo?
  ▸ Limpiar tabla
```

When no table is active, fall back to the static registry entries.

### Table UX sketch
The suggested-prompt list in ChatPanel replaces the static `<ul className={styles.examples}>` block with a dynamic list. When the user clicks a suggestion, it populates the input field (same as the existing examples behavior — they're displayed, not automatic). The list updates reactively whenever the table or viewer state changes.

### Implementation sketch
**Files to touch:**
- `data/user-prompts.json` — new static registry file (~30 prompts to start)
- `src/components/ChatPanel.tsx` — add `contextualPrompts` prop, render dynamic list
- `src/App.tsx` — compute prompt list from table state + registry
- `src/data/prompts.ts` — new module: `loadPromptRegistry()`, `getContextualPrompts(tabla, viewerState)`

**Registry loader (~25 lines):**
```ts
// src/data/prompts.ts
import promptsRaw from "../../data/user-prompts.json";

interface PromptEntry {
  id: string;
  text: string;
  category: string;
  priority: number;
  conditions?: {
    model_loaded?: boolean;
    table_active?: boolean;
    viewer_highlight_active?: boolean;
    has_column?: string;
    has_available_property?: string;
  };
}

export function loadPromptRegistry(): PromptEntry[] {
  return (promptsRaw as { prompts: PromptEntry[] }).prompts ?? [];
}

export function getContextualPrompts(
  registry: PromptEntry[],
  tabla: QuantificationTable | null,
  viewerMatchCount: number | null,
): string[] {
  const prompts: { text: string; priority: number }[] = [];
  
  // Static prompts matching conditions
  for (const entry of registry) {
    const c = entry.conditions ?? {};
    if (c.table_active !== undefined && c.table_active !== (tabla !== null)) continue;
    if (c.has_column && (!tabla || !tabla.columnas.includes(c.has_column))) continue;
    if (c.has_available_property && (!tabla?.available_properties?.includes(c.has_available_property))) continue;
    prompts.push({ text: entry.text, priority: entry.priority });
  }
  
  // Dynamic prompts from table context
  if (tabla) {
    const numericCols = tabla.columnas.filter(col => {
      const sample = tabla.filas.find(r => typeof r[col] === "number");
      return sample !== undefined;
    });
    for (const col of numericCols.slice(0, 2)) {
      prompts.push({ text: `¿Cuál es el promedio de ${col.toLowerCase()}?`, priority: 50 });
      prompts.push({ text: `Calcula el total de ${col.toLowerCase()}`, priority: 50 });
    }
    if (tabla.available_properties?.includes("is_external")) {
      prompts.push({ text: "Filtra solo los exteriores", priority: 55 });
    }
    // Always offer a "clear table" prompt
    prompts.push({ text: "Limpia la tabla actual", priority: 40 });
  }
  
  prompts.sort((a, b) => b.priority - a.priority);
  return prompts.slice(0, 6).map(p => p.text);
}
```

### Cost
- **LoC delta:** ~80 new (registry loader + dynamic generator), ~15 modified (ChatPanel prop + App.tsx wiring)
- **Complexity tier:** S (small — new file + prop drilling, no new agent logic)
- **Time to implement:** 60–90 minutes
- **New JSON file, new prop, new data module. No new tool schema.**

### Risk
- **What could break:** Too many dynamic prompts could overwhelm the suggested-prompt list (limited to 6). Contextual prompts could suggest operations the agent can't yet perform (mitigation: only suggest operations that map to existing tool capabilities).
- **Registry file missing at build:** Vite bundles it as a static import. If the file is missing, fall back to the 4 hardcoded defaults (line `ChatPanel.tsx:100-106` — keep those as a fallback).
- **Ties to existing:** `ChatPanel.tsx:98-106` (static examples block), `App.tsx:handleSend` (no change needed — prompts feed into the same input). Low coupling.

### PoC-fit check
✅ No locked constraint crossed. UI-only change to the suggested-prompt list. Spanish-only. No new tool. No auth/deploy.

---

## Extensibility Framework

### Goal
Boss wants to add (a) new user prompts and (b) new question-logic rules without code changes. Both should live in JSON files, be reloadable at runtime (or on page reload via Vite HMR), and not require touching TypeScript.

---

### User Prompt Registry

**Location:** `data/user-prompts.json`  
**Format:** JSON with a top-level `prompts` array  
**Schema:** Each entry: `{ id, text, category, priority, conditions? }`

**Conditions grammar:**
- `model_loaded: boolean` — only show when the IFC model has finished loading
- `table_active: boolean` — only show when a quantification table is visible
- `viewer_highlight_active: boolean` — only show when elements are highlighted
- `has_column: string` — only show when the table includes this column label
- `has_available_property: string` — only show when this property is in `available_properties`
- `no_table: boolean` — only show when NO table is active (inverse of table_active)
- `selected_class: string` — only show when a specific IFC class is highlighted (e.g., "IfcWindow")

**Runtime consumption:** `src/data/prompts.ts` loads the registry at import time (Vite bundles it). `App.tsx` calls `getContextualPrompts(registry, tabla, viewerState)` on every table/viewer state change. The result feeds into `ChatPanel.contextualPrompts` prop.

**Adding a new prompt:** Boss adds one JSON object to `data/user-prompts.json`. Vite HMR picks it up on save. No rebuild, no TypeScript changes.

**Concrete JSON example with 2 entries:**
```json
{
  "prompts": [
    {
      "id": "cuantificar-ventanas-dimensiones",
      "text": "Cuantifica las ventanas con su ancho, alto y material",
      "category": "cuantificacion",
      "priority": 15,
      "conditions": { "model_loaded": true }
    },
    {
      "id": "seguimiento-exteriores",
      "text": "Filtra solo los exteriores",
      "category": "refinamiento",
      "priority": 55,
      "conditions": {
        "table_active": true,
        "has_available_property": "is_external"
      }
    }
  ]
}
```

---

### Question-Logic Registry

**Location:** `data/question-rules.json`  
**Format:** JSON with a top-level `rules` array  
**Schema:** Each rule: `{ id, hook, priority, description, rule: { ...hook-specific shape } }`

**Five hook types:**

#### Hook 1: `pre-prompt-augmentation`
**Slot:** Before the user message reaches the LLM (after table context injection, before `geminiComplete`).
**Signature:** `(userMessage: string, context: { tabla?, selectedIfcClass?, viewerMatchCount? }) => string | null` — returns text to inject as a `role: "user"` prefix, or null to skip.
**Example:** Auto-detect when the user asks for "cuantificación" but doesn't specify columns — inject a reminder to use the default column set.
```json
{
  "id": "force-cuantificacion-table",
  "hook": "pre-prompt-augmentation",
  "priority": 100,
  "description": "When user asks for cuantificación, remind the LLM to always return a table with at least 'nombre'.",
  "rule": {
    "trigger_pattern": "cuantific[a-záéíóú]+|cuantifica",
    "augmentation_text": "[Regla]: Esta pregunta contiene una solicitud de cuantificación. Debes devolver SIEMPRE una tabla. Si no sabes qué columnas usar, devuelve al menos 'nombre'. Nunca respondas solo con prosa.",
    "cooldown_turns": 1
  }
}
```

#### Hook 2: `post-tool-call-validator`
**Slot:** After a tool result is computed, before it's serialized to the LLM. Runs on every tool call.
**Signature:** `(toolName: string, result: ToolResult) => ToolResult` — returns the (possibly modified) result.
**Example:** When `resaltar_elementos` returns 0 matching elements, append a warning so the LLM tells the user instead of silently proceeding.
```json
{
  "id": "warn-empty-highlight",
  "hook": "post-tool-call-validator",
  "priority": 50,
  "description": "If resaltar_elementos finds 0 elements, surface a warning in the result.",
  "rule": {
    "tool_name": "resaltar_elementos",
    "condition": { "result.matching": 0 },
    "inject_warning": "No se encontraron elementos que coincidan con el criterio. Sugiere al usuario revisar la clase IFC o el nombre del elemento."
  }
}
```

#### Hook 3: `hallucination-guard`
**Slot:** After the LLM's final text response, before it's displayed to the user. Runs once per agent turn.
**Signature:** `(finalText: string, toolResults: ToolResult[]) => { text: string; warnings: string[] }` — returns the (possibly flagged/modified) text.
**Example:** If the LLM's response contains a number that doesn't match any tool result's aggregate value, flag it with a warning.
```json
{
  "id": "cross-check-totales",
  "hook": "hallucination-guard",
  "priority": 90,
  "description": "If the LLM reports a numeric total that differs from the tool's aggregate, append a warning.",
  "rule": {
    "check": "numeric_mismatch",
    "tolerance_percent": 1.0,
    "warning_text": "⚠ El valor numérico en la respuesta difiere del cálculo programático del tool. El tool es la fuente de verdad."
  }
}
```

#### Hook 4: `intent-classifier`
**Slot:** Before the LLM sees the user message. Classifies the intent and can short-circuit (return a canned response for trivial queries).
**Signature:** `(userMessage: string) => { intent: string; confidence: number; canned_response?: string } | null`
**Example:** Detect "hola", "gracias", "qué puedes hacer" — return canned responses without calling the LLM, saving API quota.
```json
{
  "id": "greeting-short-circuit",
  "hook": "intent-classifier",
  "priority": 10,
  "description": "Short-circuit greetings and thanks with canned responses to save API quota.",
  "rule": {
    "patterns": [
      { "regex": "^(hola|buenos días|buenas tardes)\\b", "response": "¡Hola! Soy Salfa BIM Agent 01. Pregúntame sobre el modelo o las especificaciones." },
      { "regex": "^(gracias|muchas gracias|thanks)\\b", "response": "¡De nada! Estoy aquí para ayudarte con el modelo BIM." },
      { "regex": "^(qué puedes hacer|ayuda|help|cómo funcionas)\\b", "response": "Puedo consultar el modelo BIM, resaltar elementos en el visor 3D, abrir secciones del PDF de especificaciones, y generar tablas de cuantificación." }
    ]
  }
}
```

#### Hook 5: `formatting-template`
**Slot:** After the LLM's final text response. Applies a formatting template (wraps citations, adds footer).
**Signature:** `(finalText: string, context: { turnNumber: number; toolResults: ToolResult[] }) => string`
**Example:** Append a model-stats footer to every response.
```json
{
  "id": "append-model-stats-footer",
  "hook": "formatting-template",
  "priority": 5,
  "description": "Append a small model stats footer to every agent response.",
  "rule": {
    "footer_template": "\n\n---\n*Modelo: SZA_BDE3_ARQ_C1 · 291 elementos · IFC 2×3*",
    "max_length": 100
  }
}
```

**Runtime integration points in `loop.ts`:**
```ts
// Hook 4: intent-classifier (BEFORE geminiComplete)
const intentResult = runHook("intent-classifier", userMessage);
if (intentResult?.canned_response) return intentResult.canned_response;

// Hook 1: pre-prompt-augmentation
const augmentations = runHooks("pre-prompt-augmentation", userMessage, ctx);
contents[0].parts = [...augmentations, { text: userMessage }];

// Hook 2: post-tool-call-validator (AFTER each runTool)
const validatedResult = runHooks("post-tool-call-validator", fc.name, result);
// use validatedResult instead of raw result

// Hook 3: hallucination-guard (AFTER finalText)
const guarded = runHooks("hallucination-guard", finalText, toolResults);

// Hook 5: formatting-template (BEFORE returning)
finalText = runHooks("formatting-template", finalText, { turnNumber, toolResults });
```

### Compatibility with Existing System

**`JARVIS_SYSTEM_PROMPT` interaction:**
- The system prompt at `prompts.ts:1-109` remains the source of truth for agent behavior. Hook outputs are injected as user-role messages (hints, context, rules), NOT as system-prompt overrides. This keeps the injection surface narrow and prevents conflicting instructions.
- If a rule conflicts with the system prompt (e.g., a hook says "responde en inglés" but the system prompt mandates Spanish), the system prompt wins — hooks inject hints, not mandates. The hook executor runs with `priority`, and the system prompt instruction is `priority: ∞`.

**Tool-call guardrails (`d944ea2`):**
- The `calcular_cantidades` guardrail at `loop.ts:26-50` (prose-injection) is NOT replaced by hooks — it remains the canonical enforcement because it's a hard guarantee (the exact value is injected). Hooks can ADD warnings or cross-checks, but cannot REMOVE the existing guardrail.
- The `formatTotalesForProse` call at `loop.ts:117-129` runs BEFORE any `post-tool-call-validator` hooks, guaranteeing the exact value is always present in the LLM context. Hooks run after and can only append, not replace.

**Migration sketch:**
1. Ship the `data/question-rules.json` file with 3-5 starter rules (the examples above).
2. Ship a `src/agent/rules-engine.ts` module (~80 lines) with `loadRules()`, `runHooks()`, and the 5 hook dispatchers.
3. Modify `loop.ts` to call the hooks at the integration points listed above. The loop function signature doesn't change — hooks are an internal concern.
4. Boss adds a new rule by editing `data/question-rules.json`. Vite HMR reloads it on save. No TypeScript changes, no rebuild.
5. The existing `JARVIS_SYSTEM_PROMPT` stays unchanged. Hooks are additive — a null hook returns the input unchanged.

---

## Recommended Roadmap

**Week 1 (ship Monday, feedback Tuesday–Wednesday):**
1. **Recommendation 1: Table-state context injection** — smallest change (45 LoC, S-tier), highest impact (unlocks iterative agent reasoning across turns), no new API surface. Ship first because R2 (refinement) needs R1's context awareness to work well — the agent needs to know the table exists before it can refine it.

**Week 1 (ship Wednesday, feedback Thursday–Friday):**
2. **Recommendation 3: Contextual prompt chips** — ships the `data/user-prompts.json` registry, which also delivers the extensibility framework's first artifact. Low code risk (UI-only), but depends on R1 being live so the prompt generator has table context to work with. Boss gets immediate value: as he adds prompts to the registry, the chat surface adapts without touching TypeScript.

**Week 2 (ship Monday, buffer week for polish):**
3. **Recommendation 2: Incremental table refinement** — the heaviest change (M-tier, ~90 LoC) with the most edge cases (cache staleness, aggregate stripping, sort+filter composition). Ship last because: (a) R1 already gives the agent context to build BETTER from-scratch tables (partial mitigation of the pain), and (b) R3 already surfaces contextual follow-ups (partial mitigation of the "what do I ask next" pain). The refinement engine is the icing — valuable, but R1+R3 together deliver 70% of the value at 40% of the cost.

**What blocks what:**
- R3 depends on R1 (needs table context to generate contextual prompts).
- R2 depends on R1 (refinement engine needs the context preamble to know what exists to refine).
- Nothing depends on R2 or R3 — they're additive on top of R1.
- The extensibility framework (question-rules engine) can ship independently alongside any of the 3 recommendations — it's a parallel pipeline. Ship it with R3 since both touch `data/` JSON files.

**Stay within PoC scope, ship the smallest thing with the most value first.**

---

## Self-Critique

- **Depth:** 4/5 — grounded in specific file:line citations throughout; could go deeper on the `buildTabla` edge cases (multi-class aggregation) but that's v1.1 material.
- **Source Quality:** N/A (codebase analysis, not external research).
- **Citation Density:** High — every claim references specific file paths and line ranges from the actual source.
- **Perspective Balance:** 4/5 — considered both the Boss's immediate needs (prompt registry, quick wins) and the engineering cost (cache invalidation, hook complexity).
- **Contextual Richness:** 4/5 — traced pain points through the full stack (prompt → loop → tools → panel → viewer), showing how a table built in `tools.ts:382` becomes invisible to the next turn at `loop.ts:62`.

---

*Report generated by critic subagent. No files modified, no commits made, no tests run. Recommendations are read-only and bounded by the locked PoC constraints listed in `AGENTS.md` §1.*
