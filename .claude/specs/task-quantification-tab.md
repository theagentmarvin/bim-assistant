# bim-assistant — PDF-as-tab + Cuantificación tab (requirement)

**Project:** `~/projects/bim/bim-assistant/` · branch `main` · on top of `fda82f3`
**Brief:** Replace the always-visible PDF column with a tabbed view (Spec PDF | Cuantificación). The Cuantificación tab renders structured, copyable tables when the agent returns quantification data.
**Date:** 2026-07-30
**Author:** Architect (Marvin, DeepSeek V4 Pro)
**Boss request:** #14860 (15:52 GMT-4) — *"el pdf sera una pestaña. la segunda pestaña sera una tabla de cuantificación [...] podamos presentar esta información en una ui facil de leer y copiar. investiga analyza genera el requerimiento para esta nueva tab"*

---

## Part 0 — Indexer audit (Boss's first concern)

**Question raised:** *"cada vez que inicia la app re indexamos todo quiero validar que esto sea local o si estamos llamando a fireworks"*

**Answer (verified by reading `src/agent/indexer.ts` + `src/data/storage.ts`):**

Fireworks is **NOT** called on every boot. The indexer is cached in IndexedDB. From `indexer.ts:202-208`:

```ts
const newHash = hashInputs(modeloChunks, mapeosChunks, specChunks);
const existingHash = opts.force ? null : await getMeta<string>(META_HASH_KEY);
if (existingHash === newHash) {
  onProgress({ phase: "done", chunks: total, embeddings: total });
  return;  // ← CACHE HIT — zero Fireworks calls
}
```

Cache hit conditions:
- Same hash → skip (the **normal** boot case)
- Cache miss → re-index (~45 chunks × 1 embed call = 45 Fireworks calls)

Cache miss is triggered by:
1. First boot (no cache exists yet) — happens once
2. `META_VERSION` bumped (chunk shape changed in code)
3. `data/bim_elements.json` or `data/mapping_presets.json` content changed
4. `/eett-c.pdf` text extraction changed (rare)
5. User clicks "Reindexar" button
6. IndexedDB was wiped (browser storage cleared)

**What IS local on every boot (no Fireworks):**
- `chunkModelo()` — pure local: reads `bim_elements.json` (Vite-imported), groups by class, builds chunks. CPU only.
- `chunkMapeos()` — same, pure local.
- `hashInputs()` — FNV-1a hash over chunk texts. Local CPU.
- `chunkEspecificacion()` — pdfjs runs **locally** in the browser to extract PDF text. No API call. (The pdfjs worker comes from a CDN, but the PDF content extraction is local.)
- IndexedDB read/write — local.

**What Boss should see:** After the first boot (~5-10s), subsequent boots are <500ms (just IndexedDB reads). Boss observed a slow first boot (because `META_VERSION` was bumped from 1→2 by the webdev-marvin's flat-property-key change) and assumed it was Fireworks on every boot. It wasn't.

### Recommended dev-mode optimization (optional)

If Boss still wants to eliminate Fireworks calls entirely from dev boot (so he can iterate UI without thinking about API budget), the cleanest solution is:

**`scripts/precompute-embeddings.mjs`** — Node script run once (or as a `prebuild` hook) that:
1. Reads `data/bim_elements.json` + `data/mapping_presets.json`
2. Computes the same chunks as `chunkModelo()` + `chunkMapeos()`
3. Calls Fireworks embed API for each chunk
4. Writes `data/precomputed-embeddings.json` (~190 KB: 38 chunks × 1024 floats × 4 bytes + JSON overhead)

**`src/agent/indexer.ts`** — On boot, if `precomputed-embeddings.json` is importable (Vite), load it directly into IndexedDB instead of calling `embed()`. PDF chunks still call Fireworks at runtime (because PDF text depends on the user's environment — but only 7 chunks, not 45).

**Effect:**
- 38 of 45 chunks get pre-computed embeddings → bundle ships with them
- 7 PDF chunks call Fireworks on first boot only (until cache hit)
- After first boot: **zero Fireworks calls** even across full reloads, until data changes
- META_VERSION bumps no longer invalidate (because precomputed embeddings are versioned in their own JSON file)

**Cost:** ~190 KB added to bundle. Negligible.

**Defer:** this is an optimization, not a blocker. Boss should first verify the current behavior with `AgentStatus` cycling vs. not cycling on each boot.

---

## Part 1 — PDF-as-tab requirement

### Goal

Replace the always-visible PDF column with a **tabbed view** in the same column slot:
- **Tab 1: Spec PDF** (current behavior — moved into a tab)
- **Tab 2: Cuantificación** (new — renders structured tables)

Tabs can be **toggled**:
- **Manually** — user clicks the tab strip
- **Automatically** — when the agent returns a quantification result, the tab switches to Cuantificación

### Where the tabs live

The current 4-column layout (chat | pdf | viewer | properties) becomes:

```
[Chat rail]  [Tab strip: Spec PDF | Cuantificación]
             [Active tab content: PDF viewer OR table]

              [3D viewer]   [Properties]
```

The PDF column becomes a 2-row flex: tab strip on top (~32px), content below (flex 1). Tab strip has 2 buttons with active highlight. Tab strip CSS uses existing `tokens.css` patterns (border, padding, font-size 11-12px).

### Tab-switching logic

| Trigger | Active tab |
|---|---|
| App boot, no quantification history | Spec PDF (default) |
| Agent returns `tabla` in tool result | Cuantificación (auto-switch) |
| User clicks "Spec PDF" tab | Spec PDF |
| User clicks "Cuantificación" tab | Cuantificación |
| App boot with previous quantification in state | Cuantificación (sticky) |

The tab state lives in `App.tsx` as `rightPaneTab: "pdf" | "cuantificacion"`. Persists for the session (cleared on Reset).

### Spec PDF tab — unchanged

Keep the existing `PdfViewer.tsx` exactly as-is. Just wrap it in the tab container.

---

## Part 2 — Cuantificación tab requirement

### Goal

When the user asks for **counts, quantities, lists, tables** (e.g., "lista los tipos de ventana", "cuántas puertas exteriores hay", "dame una tabla por clase"), the agent returns **structured data** that the UI renders as a copyable table.

### Trigger detection (LLM-side)

Augment the `consultar_base_de_conocimiento` tool to optionally return structured data. The agent decides whether to populate `tabla` based on the query. No new tool — same surface, extended output type.

### Tool result shape (extended)

```ts
// Current:
interface ConsultarResult {
  respuesta: string;        // Spanish prose answer
  citas: Array<{            // Citations
    fuente: "modelo" | "especificacion" | "mapeos";
    id: string;
    snippet: string;
  }>;
}

// Extended:
interface ConsultarResult {
  respuesta: string;
  citas: Array<{ ... }>;
  tabla?: {                  // ← NEW — populated when query asks for structured data
    titulo: string;          // "Cantidad de elementos por clase IFC"
    columnas: string[];      // ["Clase IFC", "Total", "Exteriores"]
    filas: Array<Record<string, string | number | boolean>>;
    // Each row is keyed by column name. Values are scalars (string / number / boolean).
    fuente: "modelo" | "especificacion" | "mapeos";
    generadaEn: string;      // ISO timestamp
  };
}
```

### Agent decision logic (system prompt update)

Add to `Salfa BIM Agent 01_SYSTEM_PROMPT`:

```
- Cuando el usuario pida valores, cantidades, listas o tablas (ej: "lista los tipos de ventana", "dame una tabla por clase", "cuántos elementos de cada material"), incluye un campo `tabla` en la respuesta de `consultar_base_de_conocimiento`. La tabla debe ser pequeña (típicamente <20 filas) y bien rotulada.
- Para listados de >50 elementos, devuelve solo un resumen (top 20 por alguna métrica) en la tabla, no la lista completa.
- Las columnas deben ser strings cortas (≤24 chars). Los valores deben ser legibles, no IDs crudos (ej: muestra `name`, no `express_id`).
```

### Property-driven columns (Boss #14865 requirement)

**The columns of the table must reflect the properties of interest that the user mentioned in their prompt** — not a fixed schema, not "all available properties", and not just the class. The agent infers what the user wants to see and selects the matching properties.

Worked examples the LLM must get right:

| User prompt (Spanish) | Detected intent | Expected `columnas` | Expected `filas` |
|---|---|---|---|
| "lista los muros con su material" | Walls + material_name | `["Nombre", "Material"]` | One row per wall: `name`, `material_name` |
| "muros exteriores y su resistencia al fuego" | Walls + exterior + fire_rating | `["Nombre", "Exterior", "Resistencia al fuego"]` | One row per external wall: `name`, `is_external`, `fire_rating` |
| "dame los muros por planta" | Walls + spatial_container | `["Nombre", "Planta"]` | One row per wall: `name`, `spatial_container` |
| "dame una tabla por clase" | Per-class summary | `["Clase IFC", "Total", "Exteriores"]` | One row per class with counts |
| "cuántos muros hay" | Just count | (no table — prose: "Hay 68 muros") | empty |
| "lista los tipos de ventana" | Windows + grouping | `["Tipo de ventana", "Cantidad"]` | One row per window type with count |
| "qué material usan los muros" | Walls + material | `["Material", "Cantidad"]` | One row per unique material with count |

**Critical rules for the LLM:**

1. **Don't dump every property.** If the user said "material", only show the material column. Don't add fire_rating, spatial_container, etc. unless asked.
2. **Don't use raw IDs.** Show `name`, not `express_id`. Show material name, not material id.
3. **Detect properties by name match** in the prompt. Spanish phrases like "con su [X]", "y su [X]", "por [X]", "agrupado por [X]" map to specific fields. The RAG chunks now include the property key inventory per class (from the indexer change in `14333c7`), so the LLM can verify a property exists before including it as a column.
4. **Group-by requests** produce summary tables. "por planta" → one row per unique planta. "por material" → one row per unique material. Use COUNT aggregation.
5. **List requests** produce row-per-element tables. "lista los muros con X" → one row per muro.
6. **If the prompt mentions properties that don't exist on the entity**, gracefully omit that column and note it in `respuesta`. Never invent columns.
7. **Column titles in Spanish**, matching the prompt's vocabulary ("Material" if user said "material", not "Material Name"). Title Case preferred, ≤24 chars.

**Tool implementation hint:** the tool `consultar_base_de_conocimiento` should accept an optional `columnas?: string[]` parameter from the agent. When present, the tool:
1. Reads bim_elements.json (already Vite-imported, ~291 records)
2. Filters by entity (class from the RAG hit)
3. Selects only the requested columns (verifies they exist on the entity)
4. Returns structured rows
5. Wraps as `tabla: { titulo, columnas, filas, fuente, generadaEn }`

If the agent doesn't specify `columnas`, the tool returns prose only (no `tabla`).

### When the agent produces a table

Examples that should trigger `tabla`:

| User query | Expected `tabla` |
|---|---|
| "¿Cuántos muros hay en el modelo?" | Class=IfcWall, Total=68, Exteriores=68 |
| "lista los tipos de ventana" | Tipo=Ventana Mixta PVC, Cantidad=4 + ... |
| "dame una tabla por clase" | Class \| Total \| Exteriores \| Materiales únicos |
| "muros exteriores por material" | Material \| Count |
| "cuántos elementos hay en cada planta" | Plant \| Total (if spatial_container has floor info) |

Examples that should NOT trigger `tabla` (pure prose):

| User query | Why no table |
|---|---|
| "¿De qué material son los muros?" | Prose answer is clearer than a single-row table |
| "Háblame de las ventanas del modelo" | Open-ended prose |
| "muéstrame los muros exteriores" | Should call `resaltar_elementos` instead of `consultar_base_de_conocimiento` |

### Quantification panel UI

```
┌─ Pestaña: Cuantificación ──────────────────────────┐
│ Cantidad de elementos por clase IFC               │ ← titulo
│ Generado 14:35 · fuente: modelo BIM · 18 filas    │ ← meta
├───────────────────────────────────────────────────┤
│ Clase IFC ▲ │ Total ▼ │ Ext │ Materiales únicos   │ ← column headers (sortable)
├─────────────┼─────────┼─────┼───────────────────────┤
│ IfcWall     │ 68      │ 68  │ 2 (SIP, Tabiquería)   │
│ IfcDoor     │ 38      │ 38  │ 1 (Madera)            │
│ IfcWindow   │ 7       │ 7   │ 2 (PVC mixta, PVC ...)│
│ ...         │ ...     │ ... │ ...                   │
├───────────────────────────────────────────────────┤
│ [Copiar TSV]  [Copiar CSV]  [Buscar...]            │ ← toolbar
└───────────────────────────────────────────────────┘
```

### UI requirements

- **Sortable columns** — click header to sort asc/desc; small ▲/▼ indicator
- **Search/filter** — single text input that filters rows by any column (case-insensitive substring)
- **Copy as TSV** — tab-separated, pastable into Excel/Sheets directly. Includes headers. One click, copies to clipboard.
- **Copy as CSV** — comma-separated, with proper quoting for strings containing commas/quotes
- **Row count + meta** — shows N rows, source corpus, generation timestamp
- **Empty state** — "Aún no hay datos. Haz una pregunta como 'lista los tipos de ventana' o 'dame una tabla por clase'." when no `tabla` has been produced yet
- **Sticky** — once a table is produced, it stays in the tab until a new one arrives or the user clicks "Limpiar"
- **Responsive** — table fills the column width with horizontal scroll for wide content
- **Spanish UI strings** — all labels in Spanish, matching the PoC's Spanish-only constraint

### Accessibility

- Table is a real `<table>` with `<thead>` and `<tbody>`, not a CSS grid
- Sortable headers use `aria-sort="ascending|descending"`
- Toolbar buttons have `aria-label` in Spanish
- Keyboard nav: Tab through cells, Enter on header to sort

---

## Part 3 — Implementation plan

### Phase 1: Tab strip + quantification panel shell (~40 LOC)

- Create `src/components/RightPaneTabs.tsx` — tab strip + content slot
- Create `src/components/QuantificationPanel.tsx` — empty state + table renderer skeleton
- Wire in `App.tsx`: replace `.pdfSlot` with `<RightPaneTabs tab={rightPaneTab} onTabChange={...}>`
- Tab state: `useState<"pdf" | "cuantificacion">("pdf")`
- Spec PDF tab wraps existing `<PdfViewer>`

### Phase 2: Tool result extension (~25 LOC)

- Extend `ConsultarResult` in `src/agent/tools.ts` to include optional `tabla`
- Update `ConsultarResult` consumer in `App.tsx` (`handleSend` callback) to extract `tabla` if present
- Push `tabla` into new App.tsx state: `latestTable: TableData | null`
- Auto-switch tab: when `latestTable` arrives, set `rightPaneTab = "cuantificacion"`

### Phase 3: Quantification panel data wiring (~30 LOC)

- `QuantificationPanel.tsx` receives `data: TableData | null`
- Render empty state when null
- Render table when data present (column headers + rows)
- Toolbar: copy TSV + copy CSV buttons
- Search/filter input → filter rows in-place (no API call)

### Phase 4: Agent behavior tuning (~10 LOC + iteration)

- Update `Salfa BIM Agent 01_SYSTEM_PROMPT` in `src/agent/prompts.ts` with the table-trigger rules
- Smoke test: try each trigger example, verify agent returns `tabla` appropriately
- Tighten the prompt as needed based on real outputs

### Phase 5: Verification (~20 LOC tests)

- Unit test: `buildTSV(headers, rows)` produces correct tab-separated output
- Unit test: `buildCSV(headers, rows)` produces correct quoted CSV
- Manual smoke: 5 sample queries from the trigger table

### Total estimate

~125 LOC core + ~30 LOC tests. ~155 net.

---

## Part 4 — Data flow

```
User query "lista los tipos de ventana"
   │
   ▼
ChatPanel → App.handleSend(text)
   │
   ▼
runAgentLoop(text, toolContext, callbacks)
   │
   ▼
Gemini returns tool_call: consultar_base_de_conocimiento(pregunta="...", fuente="modelo")
   │
   ▼
Tool executes cosine search, builds response:
  { respuesta, citas, tabla?: { titulo, columnas, filas } }
   │     ▲
   │     └── agent fills tabla when query is quantification-flavored
   ▼
App.tsx onToolCallEnd callback extracts tabla → setLatestTable(tabla)
   │                                              │
   ▼                                              ▼
ChatPanel renders respuesta + citas           setRightPaneTab("cuantificacion")
                                                │
                                                ▼
                                          QuantificationPanel renders table
```

The tool result flows both to the chat (prose + citations) AND to the tab (structured table). The chat panel can also show a small "Ver tabla" link to switch to the tab.

---

## Part 5 — What is explicitly out of scope

- ❌ Editable tables (read-only for PoC)
- ❌ CSV file export (download). Clipboard copy only.
- ❌ Charts/graphs. Tabular only.
- ❌ Cross-table comparison ("compare ventana count across two models")
- ❌ Persistence across browser sessions (table clears on reload)
- ❌ Multi-table tabs (single quantification view at a time)
- ❌ Custom user-defined columns (agent decides columns per query)
- ❌ Bilingual UI (Spanish only, per locked spec)
- ❌ Schema primer RAG enhancement (deferred to v1.1, separate concern)
- ❌ Pre-compute embeddings optimization (separate concern, optional)

---

## Part 6 — Definition of Done

- [ ] `npm run typecheck` clean
- [ ] `npm run build` clean
- [ ] PDF is no longer a fixed column — it's the "Spec PDF" tab
- [ ] "Cuantificación" tab exists, defaults to empty state
- [ ] Auto-switch: when agent returns `tabla`, tab flips to Cuantificación
- [ ] Manual switch: clicking either tab header works
- [ ] Sample queries each produce the expected `tabla`:
  - "¿Cuántos muros hay en el modelo?" → Class | Total | Exteriores
  - "lista los tipos de ventana" → Tipo | Cantidad
  - "dame una tabla por clase" → Class | Total | Exteriores | Materiales únicos
- [ ] Copy TSV button → clipboard has tab-separated text with headers
- [ ] Copy CSV button → clipboard has properly quoted CSV
- [ ] Search input filters rows in-place
- [ ] Sortable columns work (click header)
- [ ] Tab persists across multiple queries in the same session
- [ ] "Limpiar" button clears both chat AND table
- [ ] Net diff: ~125 LOC core + ~30 LOC tests
- [ ] No new npm dependencies
- [ ] Working tree committed (Architect reviews + commits)

---

## Part 7 — Files touched (expected)

| File | Change | LOC |
|---|---|---|
| `src/components/RightPaneTabs.tsx` | NEW — tab strip component | ~25 |
| `src/components/RightPaneTabs.module.css` | NEW | ~15 |
| `src/components/QuantificationPanel.tsx` | NEW — table renderer | ~60 |
| `src/components/QuantificationPanel.module.css` | NEW | ~30 |
| `src/components/PdfViewer.tsx` | UNCHANGED (kept as-is) | 0 |
| `src/App.tsx` | Replace `.pdfSlot` with `<RightPaneTabs>`; new state; auto-switch | ~20 |
| `src/App.module.css` | Adjust `.pdfSlot` to host the tab strip | ~5 |
| `src/agent/tools.ts` | Extend `ConsultarResult` with `tabla?` | ~10 |
| `src/agent/loop.ts` | Pass `tabla` through tool callbacks | ~5 |
| `src/agent/prompts.ts` | Add table-trigger rules to system prompt | ~5 |
| `src/utils/copy.ts` | NEW — TSV/CSV formatters | ~20 |
| `src/utils/copy.test.ts` | NEW — unit tests | ~30 |
| `src/components/__snapshots__/...` | NEW — if visual regression test added | optional |

Untouched per spec: `filterEvaluator.ts`, `retriever.ts`, `llm.ts`, `storage.ts`, `indexer.ts`, `package.json`, `tsconfig.json`, `vite.config.ts`.

---

## Part 8 — Open questions for Boss

1. **Auto-switch default?** Confirm: should `tabla` arrival auto-switch to Cuantificación tab, or stay on whatever tab the user is on? (My recommendation: auto-switch on first arrival, sticky after.)
2. **Table source corpus label?** Each table will show its source ("modelo BIM" / "especificación PDF" / "mapeos"). Want it visible, or hide it?
3. **Empty-state copy in Spanish?** Specific phrasing preference? (My draft: "Aún no hay datos. Pregúntame algo como 'lista los tipos de ventana' o 'dame una tabla por clase'.")
4. **Tab strip position?** Top of the column (my recommendation) or left side as vertical tabs?
5. **Apply the indexing optimization?** (Pre-compute embeddings at build time to zero out Fireworks calls in dev.) — separate ticket, but flag if yes.

---

## Part 9 — Sub-agent execution contract (when Boss approves)

- Working directory: `~/projects/bim/bim-assistant/`
- Read first: `PROJECT-TRACKER.md`, this spec, then `.last-task.md` (the most recent critic review + webdev-marvin's gate report)
- Commit policy: leave work **uncommitted**. Architect reviews + commits.
- Two-layer completion signal:
  - File: overwrite `.last-task.md` with the gates template
  - Push: best-effort `sessions_send` to Architect's stable key (skip if tool unavailable)
- Model override: `minimax-portal/MiniMax-M3` (webdev-marvin default)
- Time budget: ~40-70 min (UI + tool changes + iteration on agent prompt)

## End of requirement doc