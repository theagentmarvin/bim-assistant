// Viewer3D.tsx — v6
// Isolation: OBC.Hider (Free Field pattern — set(true,matching) + set(false,nonMatching))
// Click-to-select: OBCF.Highlighter. Properties: onElementData callback.

import React, { useEffect, useRef, useState } from "react";
import * as OBC from "@thatopen/components";
import * as OBCF from "@thatopen/components-front";
import * as FRAGS from "@thatopen/fragments";
import * as THREE from "three";

import type { Mapping } from "../types";
import styles from "./Viewer3D.module.css";
import { getFragmentWorkerUrl } from "./blobWorker";
import { WEBIFC_WASM_BASE } from "./webIfc";
import { evaluateFilter, type FragmentItem } from "./filterEvaluator";
import { bimElementCount, evaluationItemFor } from "../data/elements";

const MODEL_ID = "sza-bde3-arq-c1";
const IFC_URL = "/SZA_BDE3_ARQ_C1.ifc";

// SELECT_MAT for the Highlighter 'select' style.
//
// Use preserveOriginalMaterial: true + _explicitProps so that
// only color/opacity/transparent are overridden on top of the element's
// own material. This matches the TOE Highlighter's intended design (see
// default config in components-front/dist/index.js ~23311) and crucially
// makes the highlight robust against any later setOpacity / resetOpacity
// call that strips opacity/transparent — without _explicitProps the
// materials manager's loop short-circuits and the color override is
// silently dropped. (See commit history — this is exactly the regression
// we hit when the obsolete ghost-re-apply block was still firing inside
// the onHighlight handler.)
const SELECT_MAT: FRAGS.MaterialDefinition = {
  color: new THREE.Color(0xff6a00),
  opacity: 0.6,
  transparent: true,
  renderedFaces: FRAGS.RenderedFaces.TWO,
  preserveOriginalMaterial: true,
  _explicitProps: ["color", "opacity", "transparent"],
};

type ItemsMap = Record<number, FragmentItem>;
type FragmentsModelLike = {
  getLocalIds: () => Promise<number[]>;
  getItemsData: (ids: number[], config?: unknown) => Promise<Array<Record<string, unknown>>>;
  getGuidsByLocalIds?: (ids: number[]) => Promise<Array<string | null>>;
};

export interface ElementClickData { ifcClass: string; name: string; expressID: number; modelId: string; }
export interface ElementProperties { modelId: string; expressId: number; guid?: string; ifcClass: string; name: string; properties: Record<string, string>; }

interface Props {
  selectedIfcClass: string | null;
  mapping: Mapping | null;
  onElementClick?: (data: ElementClickData) => void;
  onElementData?: (data: ElementProperties) => void;
  /** Bump to soft-reset the viewer: clears the 'select' highlight in the
   *  Highlighter without disposing the model. Boss directive 2026-07-27
   *  09:40 — reset view should not reload the IFC. */
  resetTrigger?: number;
}

class EB extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(e: Error) { return { error: e }; }
  render() {
    if (this.state.error) return <div className={styles.viewer}><div className={styles.errorOverlay}><div className={styles.errorLabel}>3D viewer failed</div><pre className={styles.errorText}>{String(this.state.error)}</pre></div></div>;
    return this.props.children;
  }
}

export default function Viewer3D(p: Props) { return <EB><V {...p} /></EB>; }

function V({ selectedIfcClass, mapping, onElementClick, onElementData, resetTrigger }: Props) {
  const cr = useRef<HTMLDivElement | null>(null);
  const compR = useRef<OBC.Components | null>(null);
  const fragsR = useRef<OBC.FragmentsManager | null>(null);
  const worldR = useRef<OBC.World | null>(null);
  const hlR = useRef<OBCF.Highlighter | null>(null);
  const hiderR = useRef<OBC.Hider | null>(null);
  const disR = useRef(false);
  const loadedR = useRef(false);
  const itemsR = useRef<ItemsMap | null>(null);
  // Set of localIds that should be pickable right now — i.e. the "pink"
  // (non-ghosted) elements under the current isolation. Updated by the
  // isolation effect, read by the highlighter click handler so ghosted
  // (non-matching) elements are ignored on click. Null when isolation
  // is not active (treat as "all pickable").
  const matchingSetR = useRef<Set<number> | null>(null);

  const [status, setStatus] = useState("Initializing…");
  const [loaded, setLoaded] = useState(false);

  const clickR = useRef(onElementClick); clickR.current = onElementClick;
  const dataR = useRef(onElementData); dataR.current = onElementData;

  useEffect(() => {
    if (!cr.current) return;
    disR.current = false; loadedR.current = false; itemsR.current = null;
    const c = new OBC.Components(); compR.current = c;
    const w = c.get(OBC.Worlds).create<OBC.SimpleScene, OBC.OrthoPerspectiveCamera, OBC.SimpleRenderer>();
    w.scene = new OBC.SimpleScene(c); w.scene.setup();
    w.scene.three.background = new THREE.Color(0xf2f3f4);
    if (w.renderer) w.renderer.three.setClearColor(0xf2f3f4, 1);
    w.renderer = new OBC.SimpleRenderer(c, cr.current);
    w.camera = new OBC.OrthoPerspectiveCamera(c);
    w.camera.controls!.setLookAt(15, 15, 15, 0, 0, 0);
    worldR.current = w; c.init();
    const frags = c.get(OBC.FragmentsManager); fragsR.current = frags;
    const stale = () => compR.current !== c;
    // Holder for the custom pointerdown listener cleanup; written by
    // the async init IIFE once the canvas + Highlighter are ready.
    let pointerDownCleanup: (() => void) | null = null;

    (async () => {
      if (stale() || disR.current) return;
      try { frags.init(await getFragmentWorkerUrl()); } catch { if (!stale()) setStatus("Worker failed"); return; }
      if (stale() || disR.current) return;

      frags.core.models.materials.list.onItemSet.add(({ value: m }) => {
        if (stale() || disR.current) return;
        if (!("isLodMaterial" in m && m.isLodMaterial)) { m.polygonOffset = true; m.polygonOffsetUnits = 1; m.polygonOffsetFactor = Math.random(); }
      });
      frags.list.onItemSet.add(({ value: model }) => {
        if (stale() || disR.current) return;
        try { model.useCamera(w.camera.three); } catch { return; }
        w.scene.three.add(model.object); void frags.core.update(true);
      });

      // Pre-warm raycaster + register Hider (Free Field pattern: lazy init)
      c.get(OBC.Raycasters).get(w);
      hiderR.current = c.get(OBC.Hider);

      if (w.renderer) {
        const hl = c.get(OBCF.Highlighter);
        hl.setup({ world: w, selectMaterialDefinition: SELECT_MAT, autoHighlightOnClick: false });
        hl.multiple = "none"; hlR.current = hl;
        hl.events.select.onHighlight.add(async (mids: Record<string, Set<number>>) => {
          if (stale() || disR.current) return;
          const [mid, ids] = Object.entries(mids)[0] ?? []; const id = ids?.values().next().value;
          if (mid == null || id == null) return;
          // Filter ghosted (non-matching) elements when isolation is active.
          // matchingSetR.current is null when isolation isn't active → no filter.
          const matchingForClick = matchingSetR.current;
          if (matchingForClick && !matchingForClick.has(id)) return;
          const model = frags.list.get(mid); if (!model) return;
          const items = itemsR.current;
          if (!items) return; const item = items[id]; if (!item) return;
          clickR.current?.({ ifcClass: item.ifc_class ?? "?", name: item.name ?? "?", expressID: id, modelId: mid });
          try {
            // attributesDefault: true ensures GlobalId/globalId/element_id
            // are in the result (walls get it from basic attrs, windows get it
            // from relations — both paths must be present).
            const d = await (model as unknown as { getItemsData?: Function }).getItemsData?.([id], { attributesDefault: true, relations: { IsDefinedBy: true } });
            // getItemsData returns an array of items in the order requested.
            // We're requesting a single id, so the item is at index 0.
            // (d[id] would be undefined since id is a localId, not an array index.)
            const itemData = (d && (Array.isArray(d) ? d[0] : d[id])) ?? null;
            if (itemData) {
              // Pull GUID from the live item data (more reliable than item.guid
              // which was populated from getGuidsByLocalIds — that array can be
              // sparse for some element types).
              const idAny = itemData as Record<string, unknown>;
              const liveGuid = (typeof idAny.GlobalId === "string" ? idAny.GlobalId : null)
                ?? (typeof idAny.globalId === "string" ? idAny.globalId : null)
                ?? (typeof idAny.element_id === "string" ? idAny.element_id : null);
              const p: Record<string, string> = {};
              for (const [k, v] of Object.entries(itemData)) { if (v != null) p[k] = String(v); }
              dataR.current?.({ modelId: mid, expressId: id, guid: (liveGuid ?? item.guid) as string | undefined, ifcClass: item.ifc_class ?? "?", name: item.name ?? "", properties: p });
            }
          } catch { /* */ }
          // No ghost re-apply here: isolation is handled by OBC.Hider
          // (visibility, not material), so re-running setOpacity/resetOpacity
          // after a highlight tick is destructive — resetOpacity strips
          // opacity/transparent from the SELECT_MAT and leaves the color
          // override stranded (no _explicitProps → loop short-circuits in
          // the materials manager → click highlight vanishes). The Hider is
          // persistent across renders and survives highlightByID /
          // updateColors() / frags.core.update(true) on its own.
        });
        // Per Boss directive 2026-07-26 20:10:39: onClear is intentionally
        // a no-op. Selection state is managed by:
        //   - the pointerdown handler's empty branch below (true deselect —
        //     emits setSelectedElement(null) explicitly when castRay
        //     returns null AND when the matchingSetR filter rejects the
        //     hit), AND
        //   - the onHighlight handler above (valid pick — populates the
        //     panel via clickR.current + dataR.current).
        // Auto-emitting empty on every onClear was the source of the
        // "selection glitches / deselects on click" symptom: when
        // highlightByID() runs with removePrevious:true (e.g., re-clicking
        // the same element to re-highlight), onClear fires synchronously
        // between the clear-previous and apply-new passes, briefly nulling
        // out selectedElement. The panel flicker that the user saw is now
        // eliminated.

        // Custom click handler — replaces autoHighlightOnClick.
        //
        // Why we disabled autoHighlightOnClick (see hl.setup() above):
        //  * It synchronously applies SELECT_MAT on every click, including
        //    ghosted (non-matching) elements. From the user's perspective
        //    the ghost "picks" because it flashes orange.
        //  * The material change triggers an internal frags.core.update(true)
        //    which can rebuild the scene and reset the camera view.
        //  * Every new click also fires onClear → setSelectedElement(null),
        //    wiping the property panel even when the new click is a ghost
        //    that we want to ignore.
        //
        // This handler owns the click loop instead. It runs the raycaster,
        // iterates hits (already sorted by distance), and applies the
        // matchingSet filter: ghosts are silently skipped; pass-through
        // takes the first hit whose localId is in the matching set.
        // Valid picks call hl.highlightByID(...) which still routes through
        // the existing events.select.onHighlight handler — that flow (click
        // event emission + properties fetch + RAF ghost re-apply) is
        // unchanged and reused as-is.
        const onPointerDown = async (ev: PointerEvent) => {
          if (ev.button !== 0) return;                                  // left-click only
          if (disR.current || !loadedR.current) return;
          if (!cr.current) return;
          const items = itemsR.current; if (!items) return;
          const hl = hlR.current;      if (!hl) return;
          const w = worldR.current;     if (!w) return;
          const c = compR.current;      if (!c) return;

          const rect = cr.current.getBoundingClientRect();
          const mouse = new THREE.Vector2(
            ((ev.clientX - rect.left) / rect.width)  *  2 - 1,
            -((ev.clientY - rect.top) / rect.height) *  2 + 1,
          );

          // Use OBC's GPU-based picker — the canonical pipeline that
          // autoHighlightOnClick used. It correctly decodes itemId → localId
          // via the FastModelPicker's GPU id-render pass (castRay impl at
          // components/dist/index.mjs:14081; the result is constructed at
          // 14112-14123 with { localId, point, normal, distance, fragments,
          // object }). The previous Three.js raycaster +
          // extractLocalIdFromIntersection path was brittle: the "id"
          // BufferAttribute stores 4-byte big-endian itemIds in a Uint8Array
          // (fragments/dist/index.mjs:21708 + 32129) and Three.js
          // BufferAttribute.getX() reads only byte 0 (always 0 for typical
          // itemIds), so every hit returned localId=0 and the items[id]
          // lookup was permanently broken.
          // OBC's castRay builds a result object with { localId, point, normal,
          // distance, fragments, object } at components/dist/index.mjs:14112-14123,
          // but the TypeScript signature only exposes THREE.Intersection. Cast
          // to acknowledge the extra fields (verified at the source line above).
          const hit = (await c.get(OBC.Raycasters).get(w).castRay({ position: mouse })) as
            | (THREE.Intersection & {
                localId?: number | null;
                fragments?: FRAGS.FragmentsModel;
              })
            | null;
          if (!hit || hit.localId === undefined || hit.localId === null) {
            // Empty space click — emit setSelectedElement(null) directly.
            // The onClear event handler above is intentionally a no-op
            // (see the rationale there), so this branch is the only path
            // that nulls out the panel for a true deselect. (Per Boss
            // directive 2026-07-26 20:10:39 — fix the
            // "selection glitches on click" symptom by stopping the
            // panel from being emptied during legitimate onHighlight
            // re-applications on the same element.)
            void hl.clear("select").catch(() => {});
            clickR.current?.({ ifcClass: "", name: "", expressID: 0, modelId: "" });
            dataR.current?.(null as unknown as ElementProperties);
            return;
          }

          const localId = hit.localId;
          if (!items[localId]) return;  // hit an element not in our items map

          // Filter ghosted (non-matching) elements when isolation is active.
          const matching = matchingSetR.current;
          if (matching && !matching.has(localId)) {
            // Ghost click — pass through silently. castRay returns the
            // frontmost hit; if that's a ghost, we skip. Full pass-through
            // to a backing pink element would require iterating Three.js
            // hits in priority order, which OBC's castRay doesn't expose
            // — but frontmost-hit is the typical UX for "click what you see".
            return;
          }

          // Valid pick — manually invoke the Highlighter's pick flow so the
          // existing onHighlight handler runs (matchingSetR guard is now
          // redundant but harmless — we already filtered here).
          void hl.highlightByID(
            "select",
            { [MODEL_ID]: new Set([localId]) },
            true,                         // removePrevious: clear prior selection first
          ).catch(() => {});
        };
        if (cr.current) {
          cr.current.addEventListener("pointerdown", onPointerDown);
          pointerDownCleanup = () => {
            if (cr.current) cr.current.removeEventListener("pointerdown", onPointerDown);
          };
        }
      }

      if (stale() || disR.current) return;
      setStatus("Fetching IFC…");
      let ib: Uint8Array;
      try { const r = await fetch(IFC_URL); if (stale() || disR.current) return; if (!r.ok) throw new Error(`${r.status}`); ib = new Uint8Array(await r.arrayBuffer()); } catch { if (!stale()) setStatus("IFC fetch failed"); return; }
      if (stale() || disR.current) return;
      setStatus("Converting IFC…");
      let fb: Uint8Array;
      try { const imp = new FRAGS.IfcImporter(); imp.wasm = { absolute: true, path: WEBIFC_WASM_BASE }; fb = await imp.process({ bytes: ib, raw: true }); } catch { if (!stale()) setStatus("Conversion failed"); return; }
      if (stale() || disR.current) return;
      setStatus("Loading fragments…");
      try {
        const buf = fb.buffer.slice(fb.byteOffset, fb.byteOffset + fb.byteLength) as ArrayBuffer;
        await frags.core.load(buf, { modelId: MODEL_ID, raw: true });
        if (stale() || disR.current) return;
        await frameModel(frags, w);
        if (stale() || disR.current) return;
        const model = frags.list.get(MODEL_ID);
        itemsR.current = model ? await buildItemsMap(model as unknown as FragmentsModelLike) : null;
        loadedR.current = true; setLoaded(true);
        setStatus("1 model loaded");
      } catch { if (!stale()) setStatus("Load failed"); }
    })().catch(e => { if (!stale()) console.error("[V3D]", e); });

    return () => {
      disR.current = true; loadedR.current = false; itemsR.current = null;
      pointerDownCleanup?.();
      const h = hlR.current; if (h) { void h.dispose().catch(() => {}); } hlR.current = null;
      hiderR.current = null;
      try { c.dispose(); } catch { /* */ }
      compR.current = null; fragsR.current = null; worldR.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Isolation via OBC.Hider (Free Field pattern).
  // Runs on section change. Uses refs (not state) to check if model is loaded.
  useEffect(() => {
    if (!loadedR.current) return;
    const frags = fragsR.current; if (!frags) return;
    const items = itemsR.current; if (!items) return;
    const hider = hiderR.current; if (!hider) { console.warn("[V3D] isolation: no hider"); return; }

    const allIds = Object.keys(items).map(Number);
    const all = new Set(allIds);

    // Get filter expressions from mapping
    const filters = mapping?.results?.map(r => r.filter).filter(f => !!f && (f.g?.length ?? 0) > 0) ?? [];
    const hasFilter = filters.length > 0;
    let linked = 0;

    let matching: Set<number>;
    if (hasFilter || selectedIfcClass) {
      matching = new Set<number>();
      for (const [idStr, item] of Object.entries(items)) {
        const id = Number(idStr);
        const evaluationItem = evaluationItemFor(id, item) as FragmentItem;
        if (evaluationItem.express_id || evaluationItem.element_id) linked += 1;
        const m = hasFilter
          ? filters.some(f => evaluateFilter(f, evaluationItem))
          : evaluationItem.ifc_class === selectedIfcClass;
        if (m) matching.add(id);
      }
    } else {
      matching = new Set(all);
    }
    // Publish to the click handler so ghosted (non-matching) elements can't be picked.
    matchingSetR.current = matching;

    console.log("[V3D] isolation:", {
      matching: matching.size,
      total: all.size,
      linked,
      bimElements: bimElementCount(),
      filters: filters.length,
      selectedIfcClass,
    });

    // Ghost non-matching elements (instead of hiding).
    // Use setOpacity to keep original colors — only add transparency.
    // Per Boss directive 2026-07-26 19:52: switch isolation mechanism
    // from setOpacity (ghost — fragile, wiped by highlightByID /
    // updateColors) to OBC.Hider (hide — visibility state is persistent
    // across renders and survives updateColors()'s resetHighlight(ALL)
    // and frags.core.update(true)).
    //
    // Trade-off vs setOpacity: hidden elements aren't visible at all
    // (no silhouette context), but clicks pass through to whatever is
    // actually showing, and the hide state isn't blown away on each
    // highlight tick. Boss decided the fragility wasn't worth the
    // silhouette — hide it is.
    //
    // The setOpacity / resetOpacity primitives are preserved in code as
    // a commented toggle — flip the comments to re-enable visual
    // ghosting if silhouette comes back as a requirement.

    if ((hasFilter || selectedIfcClass) && matching.size < all.size) {
      const nonMatchingIds = allIds.filter(id => !matching.has(id));
      const matchingIds = [...matching];
      const visibleMap = { [MODEL_ID]: new Set(matchingIds) };
      const hiddenMap  = { [MODEL_ID]: new Set(nonMatchingIds) };
      Promise.all([
        hider.set(true,  visibleMap),
        hider.set(false, hiddenMap),
      ]).then(() => {
        if (disR.current) return;
        setStatus(`1 model · ${matching.size} matching / ${all.size} total`);
      }).catch((e) => console.warn("[V3D] hide failed:", e));
      // (GHOST METHODS — preserved as commented toggle.)
      // const model = frags.list.get(MODEL_ID);
      // if (model) {
      //   Promise.all([
      //     model.setOpacity(nonMatchingIds, 0.1),
      //     model.resetOpacity(matchingIds),
      //   ]).then(() => { ... }).catch(...);
      // }
    } else {
      // No isolation active — show everything, clear any prior hides.
      hider.set(true, { [MODEL_ID]: new Set(allIds) }).then(() => {
        if (disR.current) return;
        setStatus("1 model loaded");
      }).catch((e) => console.warn("[V3D] reset hide failed:", e));
      // (GHOST RESET) frags.list.get(MODEL_ID)?.resetOpacity(allIds).then(...);
    }
  }, [selectedIfcClass, mapping, loaded]);

  // Soft reset: bump resetTrigger to clear the 'select' highlight in the
  // Highlighter WITHOUT remounting Viewer3D or reloading the IFC.
  // Boss directive 2026-07-27 09:40 — reset view should remove filters
  // and deselect the spec section, not dispose+reload the model.
  // (The companion state in App.tsx clears selectedId + selectedElement
  // in the same tick, so the isolation effect (above) runs with mapping=null
  // and shows the whole model.)
  useEffect(() => {
    if (resetTrigger === undefined || resetTrigger === 0) return;
    if (!loadedR.current) return;
    const hl = hlR.current;
    if (!hl) return;
    void hl.clear("select").catch(() => {});
  }, [resetTrigger]);

  return (
    <div className={styles.viewer}>
      <div ref={cr} className={styles.canvas} />
      <div className={styles.statusOverlay}>
        <span className={styles.statusLabel}>viewer:</span>
        <span className={styles.statusValue}>{status}</span>
      </div>
      {selectedIfcClass && (
        <div className={styles.classBadge}><span className={styles.classBadgeLabel}>highlight:</span>{selectedIfcClass}</div>
      )}
    </div>
  );
}

async function buildItemsMap(model: FragmentsModelLike): Promise<ItemsMap> {
  const localIds = await model.getLocalIds();
  const [rawItems, guids] = await Promise.all([
    model.getItemsData(localIds, { attributesDefault: true }),
    model.getGuidsByLocalIds ? model.getGuidsByLocalIds(localIds) : Promise.resolve([]),
  ]);

  const map: ItemsMap = {};
  for (let i = 0; i < localIds.length; i += 1) {
    const localId = localIds[i];
    const raw = rawItems[i] ?? {};
    const item: FragmentItem = { express_id: localId, guid: guids[i] ?? undefined };

    for (const [key, value] of Object.entries(raw)) {
      if (Array.isArray(value)) continue;
      if (value && typeof value === "object") {
        const candidate = value as Record<string, unknown>;
        if (typeof candidate.getValue === "function") {
          item[key] = (candidate.getValue as (k: string) => unknown)(key);
        } else if ("value" in candidate) {
          item[key] = candidate.value;
        }
      } else {
        item[key] = value;
      }
    }

    const ifcClass = item.ifc_class ?? item.category ?? item.Category ?? item.type ?? item.Type;
    if (ifcClass !== undefined) item.ifc_class = String(ifcClass);
    const name = item.name ?? item.Name ?? item.NominalValue ?? item.LongName;
    if (name !== undefined) item.name = String(name);
    const guid = guids[i] ?? item.GlobalId ?? item.globalId ?? item.element_id;
    if (guid !== undefined) item.guid = String(guid);
    map[localId] = item;
  }

  console.log("[V3D] item map:", { localIds: localIds.length, guids: guids.length });
  return map;
}

async function frameModel(frags: OBC.FragmentsManager, world: OBC.World): Promise<void> {
  try {
    const boxes = await frags.getBBoxes({}); const box = boxes[0]; if (!box) return;
    const c = new THREE.Vector3(); box.getCenter(c);
    const s = new THREE.Vector3(); box.getSize(s);
    const d = Math.max(Math.max(s.x, s.y, s.z, 1) * 1.8, 10);
    world.camera.controls!.setLookAt(c.x + d, c.y + d, c.z + d, c.x, c.y, c.z, true);
  } catch { /* */ }
}
