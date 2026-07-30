# Pset Flattening — Implementation Spec

**Date:** 2026-07-30
**Author:** Butler (research/eval)
**For:** Architect (implementation)
**Critic:** Validated by Architect critic subagent (DeepSeek V4 Pro) — approach confirmed optimal for PoC scale.

---

## Goal

Flatten all IFC property set (Pset) and quantity set (Qto) scalar values into top-level keys in `bim_elements.json` so they become accessible to the filter evaluator, quantification table, RAG chunker, and LLM-driven queries. Currently quantities (volume, area, height, width, length) are trapped inside nested `psets` objects and invisible to the agent.

## Current state

- `bim_elements.json`: 291 elements, 18 IFC classes, 12 top-level keys each
- `psets` key holds nested `{ "Pset_WallCommon": { "IsExternal": true, ... }, "Qto_WallBaseQuantities": { "GrossVolume": 0.407, ... } }`
- Only `is_external` and `fire_rating` were manually promoted to top-level by the existing extraction code
- Quantities and all other pset properties are only readable in `ModelPropertyPanel` (click an element)
- The filter evaluator (`filterEvaluator.ts.item[rule.p]`), table builder (`tools.ts.projectRowFull`), and RAG chunker (`indexer.ts.chunkModelo.Object.keys`) all operate on top-level keys only

## Target state

After extraction, a wall element gets flattened keys alongside existing ones:

```
element_id, express_id, ifc_class, ...  ← unchanged
is_external, fire_rating, ...           ← unchanged
Pset_WallCommon.IsExternal              ← flattened from psets (scalar, int/float/str/bool)
Pset_WallCommon.ThermalTransmittance    ← flattened
Pset_WallCommon.LoadBearing             ← flattened
Qto_WallBaseQuantities.Width            ← flattened (REAL measurement)
Qto_WallBaseQuantities.Height           ← flattened
Qto_WallBaseQuantities.Length           ← flattened
Qto_WallBaseQuantities.GrossVolume      ← flattened
Qto_WallBaseQuantities.NetVolume        ← flattened
Qto_WallBaseQuantities.NetSideArea      ← flattened
psets: { ... }                          ← kept unchanged (ModelPropertyPanel reads it)
```

All downstream systems — filter evaluator, table builder, RAG chunker — work without changes because they use `item[key]` with string keys and JavaScript resolves `"Pset_WallCommon.IsExternal"` as a literal key name containing dots.

## Files to change

| File | Change | Lines |
|---|---|---|
| `bim-specs-mapper/src/bim_extract/extract.py` | Add `flatten_psets()` + integrate into `process_element()` | ~35 |
| `bim-assistant/data/bim_elements.json` | Regenerated (one CLI command) | 0 |
| `bim-assistant/src/agent/tools.ts` | Extend `COLUMN_LABEL_TO_KEY` with ~15 qto aliases + update `resolveColumnKey` | ~20 |
| `bim-assistant/src/agent/indexer.ts` | Bump `META_VERSION` from `"2"` → `"3"` | 1 |

## Changes detail

### 1. extract.py — `flatten_psets()` function

Add to `bim-specs-mapper/src/bim_extract/extract.py`, before `process_element()`:

```python
import re

# Allowlist: only psets whose names contain standard characters.
# Non-standard IFC group names (e.g. material-list keys with
# colons and quotes) would produce dot-notation keys that break
# downstream parsers. Skip them — they're rare and their data
# is still available via the unflattened `psets` field.
_PSET_NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]*$")

def flatten_psets(psets: dict[str, Any]) -> dict[str, Any]:
    """Lift scalar leaf values from nested Pset/Qto dicts to flat
    dot-notation keys. Only scalars (int, float, str, bool) are
    lifted — nested dicts (per-material-layer Qto structures) are
    skipped. Groups whose names contain non-standard characters
    (colons, quotes, slashes) are skipped to avoid creating keys
    that would break downstream parsers."""
    flat: dict[str, Any] = {}
    for group_name, group in psets.items():
        if not isinstance(group, dict):
            continue
        if not _PSET_NAME_RE.match(group_name):
            continue
        for prop_name, value in group.items():
            if isinstance(value, dict):
                continue  # skip per-layer Qto sub-structures
            if isinstance(value, (int, float, str, bool)):
                flat[f"{group_name}.{prop_name}"] = value
    return flat
```

### 2. extract.py — integrate into `process_element()`

In `process_element()`, after the existing psets handling, merge flattened keys:

```python
def process_element(model, element) -> dict[str, Any]:
    psets = get_psets(element)
    # ... existing code: name, material, is_external, fire_rating, container ...
    
    cleaned_psets = _resolve_full_psets(psets)
    flat_psets = flatten_psets(cleaned_psets)
    
    result = {
        "element_id": ...,
        "express_id": ...,
        # ... existing 11 keys unchanged ...
        "psets": cleaned_psets,  # keep nested version for ModelPropertyPanel
    }
    result.update(flat_psets)  # merge flattened keys at top level
    return result
```

The `**` unpack into `result` avoids shadowing existing top-level keys (dot-notation keys can't collide — existing keys have no dots).

### 3. Regenerate bim_elements.json

```bash
cd ~/projects/bim/bim-specs-mapper
python3 src/bim_extract/extract.py \
  --ifc ~/Documents/Test\ Files/SZA_BDE3_ARQ_C1.ifc \
  --out ~/projects/bim/bim-assistant/data/bim_elements.json
python3 src/bim_extract/infer_properties.py \
  --ifc ~/Documents/Test\ Files/SZA_BDE3_ARQ_C1.ifc \
  --in  ~/projects/bim/bim-assistant/data/bim_elements.json \
  --out ~/projects/bim/bim-assistant/data/bim_elements.json
```

Then copy to bim-assistant: `cp` from the mapper output.

### 4. tools.ts — extend COLUMN_LABEL_TO_KEY

Add ~15 Spanish → dot-notation mappings for common qto properties:

```typescript
const COLUMN_LABEL_TO_KEY: Record<string, string> = {
  // ... existing entries unchanged ...
  
  // Flattened Qto properties
  volumen: "Qto_.*GrossVolume",  // partial match — see resolveColumnKey update
  altura: "Height",
  ancho: "Width",
  largo: "Length",
  area: "NetSideArea",
  "area neta": "NetSideArea",
  "area bruta": "GrossSideArea",
  "volumen bruto": "GrossVolume",
  "volumen neto": "NetVolume",
};
```

Update `resolveColumnKey()` to handle partial matches: if a label doesn't match exactly, iterate all columns looking for one that includes the label as a substring (case-insensitive). This lets `"volumen"` match `"Qto_WallBaseQuantities.GrossVolume"` without hardcoding every class-specific prefix.

Pseudo-implementation in `resolveColumnKey()`:

```typescript
function resolveColumnKey(label: string, availableColumns?: string[]): string | null {
  // 1. Exact match in COLUMN_LABEL_TO_KEY
  // 2. Exact match against availableColumns
  // 3. Partial match: find column that includes label (case-insensitive)
  // 4. Return null
}
```

### 5. indexer.ts — bump META_VERSION

```typescript
const META_VERSION = "3"; // bump 2→3: flattened psets added, invalidate IndexedDB
```

This forces a re-index on next app boot. The content hash will also change (new keys in chunk text), so the idempotent check catches it — the version bump is belt-and-suspenders.

## What does NOT change

Zero changes to: `filterEvaluator.ts`, `chunkModelo` indexer logic, `buildTabla` grouping, `Viewer3D.tsx`, `loop.ts`, `App.tsx`, `ChatPanel`, `QuantificationPanel`, `storage.ts`, `types.ts`, `retriever.ts`.

The `chunkModelo()` function already calls `Object.keys(it)` to discover scalar keys per class. New flattened keys appear automatically in the `scalarKeys` list and get embedded into the LLM's per-class knowledge.

## Gates

| Gate | Command | Expected |
|---|---|---|
| Extract runs clean | `python3 extract.py --ifc ...` | No errors, outputs coverage report |
| JSON valid | `python3 -c "import json; json.load(open('bim_elements.json'))"` | Exit 0 |
| Flattened keys present | Check a wall element has `Qto_WallBaseQuantities.GrossVolume` at top level | Present, numeric |
| No weird-character keys | `jq '.elements[].psets | keys[]' bim_elements.json | sort -u` | All keys match `^[A-Za-z][A-Za-z0-9_]*$` |
| TypeScript compiles | `cd bim-assistant && npm run typecheck` | Exit 0 |
| Dev server boots | `npm run dev` | Indexer shows "Listo · N fragmentos indexados" |
| Qto filter works | Ask "muéstrame muros con Qto_WallBaseQuantities.GrossVolume > 0.3" | Agent calls `resaltar_elementos` with correct filter, viewer isolates matching walls |
| Qto table works | Ask "dame una tabla de muros con volumen y altura" | Quantification tab shows columns with real numbers |

## Edge cases handled

1. **Per-layer Qto sub-structures:** Skipped — they contain `{id, type, Discrimination, properties: {Width: ...}}` dicts, not scalars. Top-level qto scalars (Width: 0.096) are kept.

2. **Non-standard pset group names:** Material-list psets with colons (`:`) and quotes (`"`) in group names are filtered by the `_PSET_NAME_RE` regex. Affects ~5 doors (non-standard IfcMaterialList groups). Their properties remain in the nested `psets` field for ModelPropertyPanel.

3. **Name collisions:** Impossible. Existing top-level keys have no dots. Flattened keys all contain dots. They cannot collide.

4. **Embedding chunk bloat:** Each class chunk's `scalarKeys` list grows by ~7-15 entries (~15 bytes each = ~200 bytes per chunk). 18 chunks × 200 bytes = 3.6KB total. Negligible.

5. **bim_elements.json size:** Each element gains ~20-35 flattened properties × ~80 bytes = ~2KB per element. 291 elements × ~2KB = ~600KB. File grows from ~12K lines to ~18K lines. Manageable.

6. **IndexedDB schema:** No change. `META_VERSION` bump triggers hash mismatch → full re-index. Existing chunks/embeddings are replaced, not migrated.

## What NOT to do

- ❌ Don't modify `filterEvaluator.ts` to traverse nested `psets` at runtime. Flattening at extraction time is zero-cost for the hot path.
- ❌ Don't prefix flattened keys with `flat.` or `pset.` — it adds ceremony without preventing any real collision risk. Existing keys have no dots.
- ❌ Don't attempt to flatten per-layer Qto sub-structures. They're deeply nested with non-scalar values. The top-level qto scalars already contain the aggregate measurements.
- ❌ Don't remove the nested `psets` field. ModelPropertyPanel reads it for the per-element detail view.
- ❌ Don't change the RAG chunking strategy. The existing per-class chunk with scalar key inventory is sufficient — no need to embed individual element psets.
