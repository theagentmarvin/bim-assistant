# bim-assistant — RAG-for-IFC interaction (revised plan)

**Project:** `~/projects/bim/bim-assistant/` · branch `main` · on top of `b9c453d`
**Brief:** Constrain the LLM's class picker + plumb the missing filter pipeline + flatter property metadata. Cleaner, smaller, empirically testable.
**Date:** 2026-07-30
**Author:** Architect (Marvin, DeepSeek V4 Pro)
**Critic review:** APPROVE-WITH-CHANGES (8/10) — incorporated below.

## What changed vs the original proposal

Architect's first draft proposed a separate RAG schema primer (~50 LOC). The critic caught that the filter plumbing **does not exist** in `App.tsx` — the LLM's `filtro` object is discarded at the agent callback. The proposal was right in spirit but wrong in detail.

**Revised approach (6 changes, ~62 LOC core + ~30 LOC tests):**

| # | Change | LOC | File(s) |
|---|---|---|---|
| 1 | Enum constraint on `clase_ifc` | ~5 | `src/agent/schema.ts` |
| 2 | Filter prop plumbing through App → ViewerPane → Viewer3D | ~40 | `src/App.tsx`, `src/components/ViewerPane.tsx`, `src/viewer/Viewer3D.tsx` |
| 3 | Flatten property key inventory into existing per-class chunks | ~10 | `src/agent/indexer.ts` (also `data/loaders.ts` if present) |
| 4 | Inline JSON example in `filtro` description | ~5 | `src/agent/schema.ts` |
| 5 | Bump `META_VERSION` so existing 0-chunk IndexedDB caches stay valid | ~1 | `src/agent/indexer.ts` |
| 6 | Bump `MAX_TURNS` 4 → 6 (RAG-before-filter eats 2 turns) | ~1 | `src/agent/loop.ts` |
| + | Populate `matching` count from bim_elements.json (currently 0) | ~5 | `src/agent/tools.ts` (~169) |
| + | Add RAG-before-filter rule to system prompt | ~3 | `src/agent/prompts.ts` |

## Decisions locked (Boss approved #14812)

- **No new tools.** The 3-tool surface (`consultar_base_de_conocimiento`, `resaltar_elementos`, `abrir_seccion_pdf`) stays.
- **No schema primer as a separate RAG chunk.** Inline JSON example in the tool description teaches the LLM the Filter shape; flat property keys in existing chunks cover the rest. If that turns out to be insufficient in v1.0 testing, the schema primer is a targeted v1.1 enhancement.
- **Defer to v1.1:** nested-property queries (`geometry_summary.height_m` is unreachable via `filterEvaluator.item[rule.p]`); spatial/hosted queries; NL-to-filter DSL; full IFC schema injection.
- **Filter shape is Navisworks-style** (no change to `filterEvaluator.ts`):

  ```ts
  Filter     = { c: "AND"|"OR"; g: FilterGroup[] }
  FilterGroup= { c: "AND"|"OR"; r: FilterRule[] }
  FilterRule = { p: string; op: string; v: string }
  ```

  Top-level property access only. Operators: `equals`, `not_equals`, `contains`, `>`, `<`, `>=`, `<=`, `is_empty`, `is_not_empty`.

## The 6 changes — concrete code sketches

### Change 1 — Enum on `clase_ifc` in `src/agent/schema.ts`

```ts
// At top of file, after existing imports:
import bimElementsRaw from "../../data/bim_elements.json";

type BimElementsEnvelope = { elements?: Array<{ ifc_class?: string }> } | Array<{ ifc_class?: string }>;
const _bimElements = (bimElementsRaw as BimElementsEnvelope);
const _list = Array.isArray(_bimElements) ? _bimElements : (_bimElements.elements ?? []);
export const IFC_CLASS_ENUM: readonly string[] = Array.from(
  new Set(_list.map((e) => e.ifc_class).filter((c): c is string => typeof c === "string" && c.length > 0)),
).sort();
```

Then in the `resaltar_elementos` tool schema (`schema.ts`):

```ts
{
  name: "resaltar_elementos",
  parameters: {
    type: "object",
    properties: {
      clase_ifc: {
        type: "string",
        enum: [...IFC_CLASS_ENUM], // ← new
        description: "Clase IFC presente en el modelo. Solo las clases de IFC_CLASS_ENUM son válidas.",
      },
      seccion_id: { ...existing... },
      filtro: { ...see Change 4... },
      reset: { ...existing... },
    },
  },
}
```

**Expected IFC_CLASS_ENUM for this model (15 classes)** — verified via `python3 -c "..."` on `data/bim_elements.json`:

```
IfcBuildingElementProxy, IfcColumn, IfcCovering, IfcDoor, IfcFlowTerminal,
IfcFurniture, IfcMember, IfcOpeningElement, IfcPipeFitting, IfcPipeSegment,
IfcRailing, IfcSlab, IfcValve, IfcWall, IfcWindow
```

If the enum is empty, that means `bim_elements.json` is missing the `elements` envelope — read the file structure and adjust. Currently it IS the envelope `{source_ifc, schema, summary, elements}` — handle both shapes defensively (the sketch above does).

### Change 2 — Filter prop plumbing

**The missing landing pad.** Currently `App.tsx:115-130` only extracts `._ifcClass` from `args.filtro`. We need to actually carry the full Filter down to `Viewer3D`.

`src/App.tsx` — add new state alongside the existing `agentIfcClass` / `agentMappingId`:

```ts
const [agentFilter, setAgentFilter] = useState<Filter | null>(null);
```

In the `resaltar` callback, replace the `filtro object — best-effort` branch (the one that only reads `._ifcClass`) with:

```ts
if (args.filtro) {
  setAgentMappingId(null);
  setAgentIfcClass(null);
  setAgentFilter(args.filtro as Filter);
  return {
    matching: 0, // populated by tools.ts change below
    total: 0,
    ids: [],
    accion: "resaltado",
    criterio: "filtro del agente",
  };
}
```

Add `Filter` to the imports from `../types`. Pass `agentFilter` to `<ViewerPane>` as a new prop, and on `reset` / `seccion_id` / `clase_ifc` paths, set `agentFilter` to `null` so the filter clears.

`src/components/ViewerPane.tsx` — add the new prop:

```ts
interface Props {
  // ...existing...
  agentFilter?: Filter | null;
}
```

Spread it into `<Viewer3D agentFilter={agentFilter} mapping={mapping} ...>`.

`src/viewer/Viewer3D.tsx` — add the prop. The viewer already takes `mapping` (which is a `Mapping` from `mapping_presets.json`) and uses it to derive a filter. Add a sibling prop:

```ts
interface Props {
  // ...existing...
  agentFilter?: Filter | null;
}
```

Inside the viewer, compute the effective filter as: `agentFilter ?? mappingToFilter(mapping) ?? null`. The existing mapping-based filter path stays — `agentFilter` only takes precedence when present.

**Important:** the existing iso loop over `selectedR` + `classR` in `Viewer3D.tsx` should still drive `hl.highlight(matchingSetR.current, ...)`. The change is in WHICH ids end up in `matchingSetR`. Read the current highlight isolation block (around lines 350-400) and wire `agentFilter` into the id-collection logic the same way `mapping` already is.

**Don't refactor unrelated code.** Keep the mapping path untouched. Only add the agentFilter branch.

### Change 3 — Flatten property metadata into existing per-class chunks

`src/agent/indexer.ts` — at the chunk builder, when grouping `bim_elements.json` by `ifc_class`, also compute a flat property key inventory per class and append it to the chunk text:

```ts
// existing chunk loop:
for (const [cls, items] of groupedElements) {
  const allKeys = new Set<string>();
  for (const it of items) {
    for (const k of Object.keys(it)) {
      if (k !== "ifc_class") allKeys.add(k);
    }
  }
  const sample = items.slice(0, 2).map((it) => ({
    name: it.name,
    sample_props: Object.fromEntries(
      [...allKeys].slice(0, 8).map((k) => [k, it[k]]),
    ),
  }));
  const text = [
    `Clase IFC: ${cls} (${items.length} elementos)`,
    `Propiedades filtrables (top-level): ${[...allKeys].sort().join(", ")}`,
    `Muestra: ${JSON.stringify(sample, null, 0).slice(0, 600)}`,
  ].join("\n");
  chunks.push({ id: `modelo:${cls}`, corpus: "modelo", text, metadata: { ifc_class: cls, count: items.length } });
}
```

Don't add a new chunk type. Don't change the embedding model or the top-level chunking loop. This is the only edit to `indexer.ts`'s chunk builder.

### Change 4 — Inline JSON example in `filtro` description

`src/agent/schema.ts` — replace the `filtro` property description (line ~70-76) with:

```ts
filtro: {
  type: "object",
  description: "Filtro Navisworks-style. Acceso solo a propiedades top-level (ej: 'is_external', 'predefined_type', 'name'). NO anidados (geometry_summary.x no funciona). Ejemplo real para 'muros exteriores': { c: 'AND', g: [{ c: 'AND', r: [{ p: 'ifc_class', op: 'equals', v: 'IfcWall' }, { p: 'is_external', op: 'equals', v: 'true' }] }] }. Operadores: equals, not_equals, contains, >, <, >=, <=, is_empty, is_not_empty.",
  properties: {
    c: { type: "string", enum: ["AND", "OR"] },
    g: { type: "array", items: { /* nested FilterGroup */ } },
  },
},
```

The schema is intentionally loose (the description carries the contract). The actual evaluation happens in `filterEvaluator.ts` (do NOT modify). The LLM gets the working example from the description.

### Change 5 — META_VERSION bump

`src/agent/indexer.ts` — at the top of the file (around line 26-28):

```ts
const META_VERSION = "2"; // was "1"; bump when chunk shape changes (e.g. flat property keys added)
```

This forces a re-index on first load with the new code. Old IndexedDB caches (`version: "1"`) won't match the new hash and will be rebuilt.

### Change 6 — MAX_TURNS bump

`src/agent/loop.ts` — `const MAX_TURNS = 6;` (was 4). Add a comment explaining why: RAG-before-filter can consume 2 turns, so 4 was tight.

### Bonus — populate `matching` count from bim_elements.json

`src/agent/tools.ts` (~line 169) — for the `resaltar` tool's return value, when called with `clase_ifc` only, count from the bim_elements.json:

```ts
import bimElementsRaw from "../../data/bim_elements.json";

function countByClass(ifcClass: string): number {
  const env = bimElementsRaw as { elements?: Array<{ ifc_class?: string }> } | Array<{ ifc_class?: string }>;
  const list = Array.isArray(env) ? env : (env.elements ?? []);
  return list.filter((e) => e.ifc_class === ifcClass).length;
}
```

Then in the `resaltar` tool's `clase_ifc` / `filtro` paths, populate `matching` and `total` from this count when the id list isn't available synchronously. **Remove the `matching: 0, total: 0, ids: []` placeholders that the current code returns.**

For the `filtro` path, the actual count comes from filterEvaluator when the viewer applies it. Webdev can either:
- (a) Keep the tool return as best-effort `0` and rely on the viewer's own count (look at how bim-specs-mapper's existing pipeline surfaces this), OR
- (b) Run filterEvaluator synchronously in the tool with the loaded element data, returning real counts.

**(a) is simpler and matches the existing pattern.** Use (a) unless (b) is clearly cheap. The viewer's existing filter application already returns the matching count — replumb through the existing callback the same way `mapping` does.

### Bonus — system prompt RAG-before-filter rule

`src/agent/prompts.ts` — add to the system prompt (Spanish):

```
- Antes de construir un `filtro` para `resaltar_elementos`, llama a `consultar_base_de_conocimiento` con la clase IFC relevante para confirmar qué propiedades top-level existen. Los nombres exactos importan (no se permiten propiedades anidadas).
```

## What you MUST NOT change

- ❌ `src/viewer/filterEvaluator.ts` — already supports the operators we need; enum + top-level access is the contract.
- ❌ `src/agent/retriever.ts` — the cosine search is fine; flat metadata gets embedded via the chunk text.
- ❌ `src/data/llm.ts` — already pinned to `gemini-flash-latest` and `dimensions: 1024`.
- ❌ `src/data/storage.ts` — IndexedDB schema is fine; `META_VERSION` bump handles the cache invalidation.
- ❌ `src/components/PdfViewer.tsx`, `src/components/ChatPanel.tsx`, `src/components/AgentStatus.tsx` — untouched.
- ❌ `package.json`, `vite.config.ts`, `tsconfig.json` — no dep changes.
- ❌ Tool surface — still 3 tools, no new ones.

## What you'll need to verify (smoke tests)

After wiring, run these in the browser at http://127.0.0.1:5173/ (Boss is testing live):

1. **"muéstrame las ventanas"** → Tool call: `resaltar_elementos(clase_ifc="IfcWindow")`. Viewer should isolate 7 windows in orange. No RAG call needed.
2. **"muros exteriores"** → Tool call: `consultar_base_de_conocimiento` (gets IfcWall schema), then `resaltar_elementos(filtro={c:"AND", g:[{c:"AND", r:[{p:"ifc_class", op:"equals", v:"IfcWall"}, {p:"is_external", op:"equals", v:"true"}]}]})`. Viewer isolates ~68 walls in orange.
3. **"cuántas ventanas hay?"** → `consultar_base_de_conocimiento` returns "IfcWindow: 7 elementos" + citation. No viewer change.
4. **"muros arriba de 3m"** → LLM tries to construct `filtro` with `p: "geometry_summary.height_m"`. Should FAIL (nested property). The critic already noted this is out of scope — expected broken path. Document in the response.

If the LLM hallucinates filter properties that don't exist, the filter evaluates to `false` for all elements and the viewer shows nothing. That's a graceful empty path — better than throwing.

## Definition of Done

- [ ] `npm run typecheck` clean
- [ ] `npm run dev` boots without console errors
- [ ] IndexedDB re-indexes cleanly on first load (META_VERSION bump works)
- [ ] Sample queries 1, 2, 3, 4 from "What you'll need to verify" pass with the expected behavior
- [ ] No new tools, no new deps, no refactor of untouched files
- [ ] Net diff to non-test files: ~62 LOC core (±20)
- [ ] Working tree clean of leftover files

## Sub-agent execution contract

- **Working directory:** `~/projects/bim/bim-assistant/`
- **Read first:** `PROJECT-TRACKER.md` (for state), this spec, then `.last-task.md` (the critic's review — your predecessor's output).
- **Commit policy:** **leave all work uncommitted.** Do NOT run `git add` / `git commit` / `git push`. The Architect reviews the diff, runs final gates, and commits.
- **Time budget:** ~25-40 min. The plumbing is mechanical (3 files), the indexer change is 10 LOC, the rest is small.
- **Two-layer completion signal.** As your LAST action, overwrite `.last-task.md` with:

```
Completed: <ISO 8601 timestamp>
Status: <one line, e.g. "RAG-for-IFC wiring complete, ready for Architect review">
Task: RAG-for-IFC interaction step 1 (enum + plumbing + flat props)
Files touched:
- <list every file, including unchanged props>
Gates:
- npm run typecheck clean — YES/NO
- npm run dev boots clean — YES/NO
- IndexedDB re-index path works — YES/NO
- 4 sample queries behave as expected — YES/NO (pass each one)
- Diff size ~62 LOC core — YES/NO (actual: +/-)
- No new tools/deps — YES/NO
```

Then `sessions_send` to `agent:architect:telegram:architect:direct:8450148189` with subject `webdev: RAG-for-IFC landed` and a 1-paragraph summary. Skip silently if the tool isn't available.

## Out-of-scope reminders (do NOT build)

- ❌ No new tool (consultar_base_de_conocimiento / resaltar_elementos / abrir_seccion_pdf is the locked triplet)
- ❌ No separate schema primer RAG chunk
- ❌ No nested-property / spatial / hosted-element queries (graceful empty path)
- ❌ No bilingual UI (Spanish only)
- ❌ No new npm deps
- ❌ No Firebase / deployment
- ❌ No commit / push
- ❌ No refactor of unrelated code

## End of spec
