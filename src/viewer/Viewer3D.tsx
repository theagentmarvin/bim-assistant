// Viewer3D.tsx — v8
// Two independent filter mechanisms, selected by the SOURCE of the filter:
//   1. Agent-driven filter (prompt / mapping / IFC class)
//      → OBC.Hider isolates (hide non-matching). The original "focus
//        mode" UX, restored in this commit after the v7 over-correction
//        removed it (Boss 2026-07-30 17:26: "cuando el filtro corra por
//        un promp del usuario debera aislar los elementos de interes en la
//        vista. asi funcionaba antes pero perdimos la funcionaidad").
//   2. User-driven selection (row click in cuantificación table, element
//      click in viewer)
//      → OBCF.Highlighter 'filter' style (yellow, 0.35) for row clicks
//      → OBCF.Highlighter 'select' style (orange, 0.6) for element clicks
//      Standard viewer behavior (TOE Highlighter example.ts).
// Both effects are independent: agent filter AND user selection can
// coexist. White space click → clear('select') only; the filter
// highlight persists.
// Properties: onElementData callback.

import React, { useEffect, useRef, useState } from "react";
import * as OBC from "@thatopen/components";
import * as OBCF from "@thatopen/components-front";
import * as FRAGS from "@thatopen/fragments";
import * as BUI from "@thatopen/ui-obc";
import * as THREE from "three";

import type { Filter, Mapping } from "../types";
import styles from "./Viewer3D.module.css";
import { getFragmentWorkerUrl } from "./blobWorker";
import { WEBIFC_WASM_BASE } from "./webIfc";
import { evaluateFilter, type FragmentItem } from "./filterEvaluator";
import { evaluationItemFor } from "../data/elements";

// Initialize the BUI manager once at module load. @thatopen/ui-obc
// re-exports BUI from @thatopen/ui plus a Manager class that wires up
// the bim-* custom elements (bim-view-cube, bim-viewport, etc.) for
// use as regular DOM elements. The call is idempotent — safe under
// React StrictMode double-invocation and harmless if invoked more
// than once. The `typeof window` guard lets Vite SSR / test harnesses
// import this module without crashing.
if (typeof window !== "undefined") {
  BUI.Manager.init();
}

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

// FILTER_MAT for the Highlighter 'filter' style. Used by the isolation
// effect to highlight (not hide) elements that match the active agent
// filter / mapping / IFC class. Subtle yellow at 0.35 opacity so the
// SELECT_MAT (orange, 0.6) reads as the dominant highlight when an
// element is both filtered AND selected — the Highlighter's "select
// takes precedence over custom" rule applies here. (TOE Highlighter
// example.ts, "select overrides custom until deselected".)
const FILTER_MAT: FRAGS.MaterialDefinition = {
  color: new THREE.Color(0xffeb3b),
  opacity: 0.35,
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
  // Combined bounding box of the given localIds in the model's local
  // space. Declared optional because not every TOE release has it on
  // the same surface; callers fall back to model.getFullBBox() when
  // missing. (OBC 3.4.8's @thatopen/fragments 3.4.7 declares this as
  // `getBBoxes(items: number[]): THREE.Box3` — synchronous, returns the
  // union box of the listed items in the model's local space.)
  getBBoxes?: (items: number[]) => THREE.Box3;
};

export interface ElementClickData { ifcClass: string; name: string; expressID: number; modelId: string; }
export interface ElementProperties { modelId: string; expressId: number; guid?: string; ifcClass: string; name: string; properties: Record<string, string>; }

interface Props {
  selectedIfcClass: string | null;
  mapping: Mapping | null;
  /** Chat-driven Filter (Navisworks-style). Takes precedence over the
   *  mapping's `results[].filter` when present. Wired in for RAG-for-IFC
   *  interaction step 1: the agent builds the Filter from RAG chunks
   *  and the viewer evaluates it against fragment items. Drives the
   *  Hider (isolation) — see Viewer3D v8 header. */
  agentFilter?: Filter | null;
  /** User-driven Filter (Navisworks-style). Set when the user clicks
   *  a row in the cuantificación table. Drives the Highlighter 'filter'
   *  style (yellow tint) — independent from the Hider. */
  userSelectionFilter?: Filter | null;
  onElementClick?: (data: ElementClickData) => void;
  onElementData?: (data: ElementProperties) => void;
  /** Bump to soft-reset the viewer: clears the 'select' highlight and
   *  the 'filter' highlight in the Highlighter without disposing the
   *  model. Boss directive 2026-07-27 09:40 — reset view should not
   *  reload the IFC. */
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

function V({ selectedIfcClass, mapping, agentFilter, userSelectionFilter, onElementClick, onElementData, resetTrigger }: Props) {
  const cr = useRef<HTMLDivElement | null>(null);
  const compR = useRef<OBC.Components | null>(null);
  const fragsR = useRef<OBC.FragmentsManager | null>(null);
  const worldR = useRef<OBC.World | null>(null);
  const hlR = useRef<OBCF.Highlighter | null>(null);
  // v8 (Boss 2026-07-30 17:26): the Hider is BACK for agent-driven
  // filters. The user wants the original "focus mode" UX — agent
  // prompt hides non-matching. The user-driven selection (row click)
  // goes through the Highlighter 'filter' style, which is independent.
  const hiderR = useRef<OBC.Hider | null>(null);
  const disR = useRef(false);
  const loadedR = useRef(false);
  const itemsR = useRef<ItemsMap | null>(null);

  const [status, setStatus] = useState("Initializing…");
  const [loaded, setLoaded] = useState(false);

  const clickR = useRef(onElementClick); clickR.current = onElementClick;
  const dataR = useRef(onElementData); dataR.current = onElementData;

  useEffect(() => {
    if (!cr.current) return;
    disR.current = false; loadedR.current = false; itemsR.current = null;
    const c = new OBC.Components(); compR.current = c;
    const w = c.get(OBC.Worlds).create<OBC.SimpleScene, OBC.OrthoPerspectiveCamera, OBCF.PostproductionRenderer>();
    w.scene = new OBC.SimpleScene(c); w.scene.setup();
    // Solid neutral background — `scene.three.background` is the source
    // of truth. The previous `showLogo = false` line on SimpleRenderer
    // is gone because the new PostproductionRenderer (below) does not
    // surface a `showLogo` property — it doesn't ship the upstream
    // "That Open Company" watermark in the first place, so the
    // branding opt-out becomes implicit.
    w.scene.three.background = new THREE.Color(0xf2f3f4);
    // v1.1 (Boss 2026-08-04 12:52 GMT-4): swap SimpleRenderer for
    // PostproductionRenderer so we can apply the COLOR_SHADOWS visual
    // style. This is the SINGLE preset we ship for v1.1 — no UI
    // dropdown, no other PostproductionAspect values exposed. The
    // styles we are explicitly NOT shipping (kept out of scope per
    // Boss's "we wont implement the rest for now" directive):
    //   - COLOR               (plain shaded)
    //   - PEN                 (white model with black outline)
    //   - PEN_SHADOWS         (pen + AO shadows)
    //   - COLOR_PEN           (color + outline, no shadows)
    //   - COLOR_PEN_SHADOWS   (color + outline + AO shadows)
    // COLOR_SHADOWS = color shading + AO shadows only — gives contact
    // shadows in concave regions and clean depth cues without the
    // outlined "blueprint" look. Pairs cleanly with our existing
    // SELECT_MAT / FILTER_MAT highlighting layer; outlines-enabled
    // is true by default at this aspect, so OBF.Outliner (separate
    // component, not wired in this commit) can be added later
    // without flipping renderer state.
    w.renderer = new OBCF.PostproductionRenderer(c, cr.current);
    // dynamicAnchor=false is the documented pairing for
    // PostproductionRenderer (per the upstream
    // packages/front/src/core/PostproductionRenderer/example.ts):
    // picks stay anchored to a stable world-space position instead
    // of recomputing on camera change, which can desync with the
    // depth-buffer-driven postprocessing passes (GTAO and PD AO
    // read depth). Cheap flag, breaks subtly if you forget it.
    w.dynamicAnchor = false;
    w.camera = new OBC.OrthoPerspectiveCamera(c);
    w.camera.controls!.setLookAt(15, 15, 15, 0, 0, 0);
    // Smoother orbit / pan / zoom. yomotsu/camera-controls exposes a
    // runtime dampingFactor on the controls instance; the TOE typings
    // (3.4.8) do NOT surface it on the CameraControls abstract surface,
    // so we cast through `unknown` for the assignment. Default is 0.05
    // (a touch snappy); 0.15 keeps input responsive but adds a clear
    // ease-out on release. Not exposed as a UI control per Boss
    // directive 2026-08-04 09:58 ("keep it short" — bake in, don't add
    // a knob).
    (w.camera.controls as unknown as { dampingFactor?: number }).dampingFactor = 0.15;
    // Live re-render during navigation. Without this listener the
    // fragments manager doesn't repaint between camera ticks and orbit
    // / zoom feels rigid / laggy. This is the canonical TOE pattern from
    // engine_components packages/core/src/core/Worlds/example.ts:
    //     world.camera.controls.addEventListener("update",
    //       () => fragments.core.update());
    // fragsR is the closure-captured FragmentsManager from below; it's
    // set before this init IIFE observes any pointer events, so it's
    // safe to reference here. We attach the listener to the controls
    // directly (no "change" handler) — "update" fires only on input/
    // programmatic camera changes, which is exactly what we want.
    w.camera.controls!.addEventListener("update", () => {
      const fr = fragsR.current;
      if (fr) void fr.core.update();
    });

    // Cleanup hook for the ViewCube overlay (camera-controls listener,
    // face-click listeners, DOM removal). Declared here so the
    // synchronous `if (cr.current)` block below can assign it without
    // hitting a let TDZ; consumed by the outer useEffect return.
    let viewCubeCleanup: (() => void) | null = null;

    // v1.1 (Boss 2026-08-04 09:58): nav cube overlay. The
    // <bim-view-cube> LitElement from @thatopen/ui-obc renders a small
    // orientation indicator in the canvas corner; clicking a face snaps
    // the camera to that direction with a smooth tween. The bim-view-cube
    // custom element is registered by BUI.Manager.init() at module load
    // (see top of file) — no manual LitElement registration needed.
    //
    // The cube appends to a positioned wrapper div (.viewCubeContainer
    // in the CSS module, top-right corner) so it sits in the corner of
    // the canvas without disturbing the existing overlays (status badge
    // top-left, class badge top-right — class badge is pushed below the
    // cube by the cube's height).
    if (cr.current) {
      const viewCubeBox = document.createElement("div");
      viewCubeBox.className = styles.viewCubeContainer ?? "viewCubeContainer";
      cr.current.appendChild(viewCubeBox);

      type ViewCubeLike = HTMLElement & {
        camera: THREE.Camera | null;
        updateOrientation: () => void;
      };
      const vc = document.createElement("bim-view-cube") as unknown as ViewCubeLike;
      vc.camera = w.camera.three;
      viewCubeBox.appendChild(vc as unknown as HTMLElement);

      // Keep the cube in sync with the camera. The cube reads
      // camera.position/quaternion directly; updateOrientation()
      // re-projects those into the cube's CSS 3D transform.
      // Listener is independent from the fragments.core.update one
      // (added above) so they can be removed independently in
      // cleanup.
      const updateVcOrientation = () => {
        try { vc.updateOrientation(); } catch { /* */ }
      };
      w.camera.controls!.addEventListener("update", updateVcOrientation);

      // Face-click handlers — snap the camera to the canonical
      // axis-aligned direction while preserving the current
      // distance to target. We read the live target via
      // camera.controls.getTarget() and the live eye from
      // camera.position so the snap feels anchored to whatever the
      // user was looking at, never a hardcoded world origin.
      // setLookAt(eye, target, true) → yomotsu's smooth tween
      // (~600ms ease-in-out by default).
      const FACES = ["top", "bottom", "left", "right", "front", "back"] as const;
      type Face = typeof FACES[number];
      const AXIS: Record<Face, [number, number, number]> = {
        top:    [ 0,  1,  0],
        bottom: [ 0, -1,  0],
        left:   [-1,  0,  0],
        right:  [ 1,  0,  0],
        front:  [ 0,  0,  1],
        back:   [ 0,  0, -1],
      };
      const faceListeners: Array<[string, EventListener]> = [];
      for (const face of FACES) {
        const eventName = `${face}click` as const;
        const axis = AXIS[face];
        const handler: EventListener = () => {
          const ctrls = w.camera.controls;
          const cam = w.camera.three;
          if (!ctrls) return;
          const target = ctrls.getTarget(new THREE.Vector3());
          const dist = cam.position.distanceTo(target);
          void ctrls.setLookAt(
            target.x + axis[0] * dist,
            target.y + axis[1] * dist,
            target.z + axis[2] * dist,
            target.x, target.y, target.z,
            true,                                                 // enableTransition
          );
        };
        vc.addEventListener(eventName, handler);
        faceListeners.push([eventName, handler]);
      }

      viewCubeCleanup = () => {
        for (const [ev, lst] of faceListeners) {
          try { vc.removeEventListener(ev, lst); } catch { /* */ }
        }
        try { w.camera.controls!.removeEventListener("update", updateVcOrientation); } catch { /* */ }
        try { viewCubeBox.remove(); } catch { /* */ }
      };

      // Boss 2026-08-05 — stop the pointerdown / pointerup bubbles
      // here so a click on the nav cube never reaches the canvas
      // pointer handler below. (The previous "ignore child overlays"
      // check at the canvas handler used `ev.target !== cr.current`,
      // which is broken — the renderer's injected <canvas> is a
      // CHILD of cr.current, so every click failed the check and
      // selection was completely disabled. The cube is the only
      // pointer-active child of cr.current we need to exclude; the
      // statusOverlay / classBadge are siblings with
      // `pointer-events: none` and never bubble through here.)
      const stopCube = (e: Event) => e.stopPropagation();
      viewCubeBox.addEventListener("pointerdown", stopCube);
      viewCubeBox.addEventListener("pointerup", stopCube);
    }

    worldR.current = w; c.init();
    // Postproduction preset — locked to COLOR_SHADOWS per Boss
    // directive 2026-08-04 12:52 GMT-4. We enable here (after
    // components.init()) rather than inside the async IIFE so the
    // empty world doesn't render and churn the postprocessing passes
    // for nothing; the first frame after fragments load will pick
    // this up automatically via the AUTO render loop.
    // The `outlinesEnabled` flag stays at its postproduction
    // COLOR_SHADOWS default (true) so a future OBF.Outliner wire-up
    // works without re-toggling renderer state. SMAA stays at its
    // default (true) for clean edge anti-aliasing on the POST passes.
    if (w.renderer) {
      w.renderer.postproduction.enabled = true;
      w.renderer.postproduction.style = OBCF.PostproductionAspect.COLOR_SHADOWS;
    }
    const frags = c.get(OBC.FragmentsManager); fragsR.current = frags;
    const stale = () => compR.current !== c;
    // Holder for the custom pointerdown listener cleanup; written by
    // the async init IIFE once the canvas + Highlighter are ready.
    // (Declared after the IIFE-block scope check because the IIFE
    // runs synchronously up to its first await — by which point this
    // let-binding has been initialized.)
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

      // Pre-warm raycaster + register Hider (used by the agent-filter
      // effect below to isolate matching elements).
      c.get(OBC.Raycasters).get(w);
      hiderR.current = c.get(OBC.Hider);

      if (w.renderer) {
        const hl = c.get(OBCF.Highlighter);
        hl.setup({ world: w, selectMaterialDefinition: SELECT_MAT, autoHighlightOnClick: false });
        // hl.multiple stays at the default ("none") — single-select for
        // the click-to-select style. The 'filter' custom style (below)
        // is independent of this setting: highlightByID accepts a
        // Map<modelId, Set<localId>> with any number of elements, so
        // the filter highlight can color N matching elements without
        // overriding the select style's single-element behavior.
        hl.styles.set("filter", FILTER_MAT);
        hlR.current = hl;
        hl.events.select.onHighlight.add(async (mids: Record<string, Set<number>>) => {
          if (stale() || disR.current) return;
          const [mid, ids] = Object.entries(mids)[0] ?? []; const id = ids?.values().next().value;
          if (mid == null || id == null) return;
          // Note: the previous matchingSetR ghost-filter is gone — the
          // pointerdown handler now allows clicks on any element
          // (standard viewer behavior), so by the time we reach this
          // handler the picked element is always a valid pick.
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
          // No ghost re-apply here. The 'filter' style (yellow) is a
          // Highlighter-driven material override, not a setOpacity-based
          // ghost — it's persistent across renders and survives
          // highlightByID / updateColors() / frags.core.update(true) on
          // its own. (The previous Hider comment about resetOpacity
          // short-circuiting the SELECT_MAT no longer applies; the
          // Hider is gone.)
        });
        // Per Boss directive 2026-07-26 20:10:39: onClear is intentionally
        // a no-op. Selection state is managed by:
        //   - the pointerdown handler's empty branch below (true deselect —
        //     emits setSelectedElement(null) explicitly when castRay
        //     returns null), AND
        //   - the onHighlight handler above (valid pick — populates the
        //     panel via clickR.current + dataR.current).
        // Auto-emitting empty on every onClear was the source of the
        // "selection glitches / deselects on click" symptom: when
        // highlightByID() runs with removePrevious:true (e.g., re-clicking
        // the same element to re-highlight), onClear fires synchronously
        // between the clear-previous and apply-new passes, briefly nulling
        // out selectedElement. The panel flicker that the user saw is now
        // eliminated.

        // Custom click handler — replaces autoHighlightOnClick. Owns
        // the full down/move/up cycle so we can distinguish a click
        // (pick on release) from a drag (camera orbit, no pick,
        // preserve selection).
        //
        // Why we disabled autoHighlightOnClick (see hl.setup() above):
        //  * It synchronously applies SELECT_MAT on every click, including
        //    on elements that aren't part of the current filter. The user
        //    couldn't tell if the pick was "valid" — every click flashed
        //    orange, even on a wall when they were inspecting windows.
        //  * The material change triggers an internal frags.core.update(true)
        //    which can rebuild the scene and reset the camera view.
        //  * Every new click also fires onClear → setSelectedElement(null),
        //    wiping the property panel even when the new click is on an
        //    off-filter element.
        //
        // v9 (Boss 2026-08-04 09:50): split into pointerdown / move / up
        // with a DRAG_THRESHOLD guard. The previous handler did the
        // castRay synchronously *on pointerdown*. That meant a click
        // followed by a drag (a camera orbit) left the ray's resolution
        // racing with the camera-controls motion: by the time
        // castRay resolved, the GPU pick pass saw a stale frame, the
        // hit often resolved to empty space, and the handler cleared
        // 'select' — stealing the user's selection on what felt like a
        // normal orbit. The fix: only cast on pointerup, only when the
        // pointer moved less than DRAG_THRESHOLD_PX from the down
        // position. setPointerCapture ensures we still receive the up
        // event when the cursor leaves the canvas mid-drag (important
        // for trackpad gestures that overshoot the viewport).
        const DRAG_THRESHOLD_PX = 5;
        type DragInfo = { x: number; y: number; pointerId: number };
        let dragInfoR: DragInfo | null = null;
        let isDraggingR = false;
        const resetDrag = () => { dragInfoR = null; isDraggingR = false; };

        const onPointerDown = (ev: PointerEvent) => {
          if (ev.button !== 0) return;                                  // left-click only
          if (disR.current || !loadedR.current) return;
          if (!cr.current) return;
          // Boss 2026-08-05 — removed `if (ev.target !== cr.current) return;`.
          // The renderer injects the actual <canvas> INSIDE cr.current,
          // so ev.target is always that canvas element, never
          // cr.current itself. The previous check rejected every click
          // and made selection completely broken. The only child we
          // actually need to exclude is the nav cube — handled by
          // viewCubeBox.stopPropagation above. The statusOverlay /
          // classBadge are siblings of cr.current with
          // `pointer-events: none` so they don't reach this handler.
          // Defer the raycast until pointerup so we can distinguish
          // a click (pick) from a drag (preserve selection). Capture
          // the pointer so pointermove/pointerup still fire on the
          // canvas even if the cursor leaves the bounds mid-drag.
          dragInfoR = { x: ev.clientX, y: ev.clientY, pointerId: ev.pointerId };
          isDraggingR = false;
          try { cr.current.setPointerCapture(ev.pointerId); } catch { /* */ }
        };

        const onPointerMove = (ev: PointerEvent) => {
          if (!dragInfoR || dragInfoR.pointerId !== ev.pointerId) return;
          const dx = ev.clientX - dragInfoR.x;
          const dy = ev.clientY - dragInfoR.y;
          // Hypotenuse: Euclidean distance. 5px is forgiving enough
          // for trackpad jitter without accidentally treating a real
          // click as a drag. yomotsu/camera-controls (the controls TOE
          // wraps) uses a similar magnitude internally for its own
          // click-vs-drag separation, so we're aligned with the
          // library's threshold semantics.
          if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) isDraggingR = true;
        };

        const onPointerUp = async (ev: PointerEvent) => {
          if (ev.button !== 0) return;
          if (!dragInfoR || dragInfoR.pointerId !== ev.pointerId) return;
          const wasDragging = isDraggingR;
          const upX = ev.clientX;
          const upY = ev.clientY;
          resetDrag();
          try { cr.current?.releasePointerCapture(ev.pointerId); } catch { /* */ }
          if (wasDragging) return;  // drag — preserve selection, do not pick

          if (disR.current || !loadedR.current) return;
          if (!cr.current) return;
          // Boss 2026-08-05 — removed the symmetric `ev.target !== cr.current`
          // guard that mirrored the pointerdown check. Same bug as
          // above: ev.target is the inner <canvas>, never cr.current.
          // The setPointerCapture at pointerdown ensures pointerup
          // always lands here regardless of where the cursor went,
          // so we don't need a target guard at release.
          const items = itemsR.current; if (!items) return;
          const hl = hlR.current;      if (!hl) return;
          const w = worldR.current;     if (!w) return;
          const c = compR.current;      if (!c) return;

          const rect = cr.current.getBoundingClientRect();
          const mouse = new THREE.Vector2(
            ((upX - rect.left) / rect.width)  *  2 - 1,
            -((upY - rect.top) / rect.height) *  2 + 1,
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
            // Empty-space click — emit setSelectedElement(null) directly.
            // The onClear event handler above is intentionally a no-op
            // (see the rationale there), so this branch is the only path
            // that nulls out the panel for a true deselect.
            void hl.clear("select").catch(() => {});
            clickR.current?.({ ifcClass: "", name: "", expressID: 0, modelId: "" });
            dataR.current?.(null as unknown as ElementProperties);
            return;
          }

          const localId = hit.localId;
          if (!items[localId]) return;  // hit an element not in our items map

          // Valid pick — manually invoke the Highlighter's pick flow so the
          // existing onHighlight handler runs. Standard viewer
          // behavior is "click any element to select it", regardless of
          // whether it's part of the active filter highlight. The 'filter'
          // style (yellow) is purely a visual aid for the agent-driven
          // query result; clicks on off-filter elements still work.
          void hl.highlightByID(
            "select",
            { [MODEL_ID]: new Set([localId]) },
            true,                         // removePrevious: clear prior selection first
          ).catch(() => {});
        };

        const onPointerCancel = (ev: PointerEvent) => {
          if (!dragInfoR || dragInfoR.pointerId !== ev.pointerId) return;
          resetDrag();
          try { cr.current?.releasePointerCapture(ev.pointerId); } catch { /* */ }
        };

        if (cr.current) {
          cr.current.addEventListener("pointerdown", onPointerDown);
          cr.current.addEventListener("pointermove", onPointerMove);
          cr.current.addEventListener("pointerup", onPointerUp);
          cr.current.addEventListener("pointercancel", onPointerCancel);
          pointerDownCleanup = () => {
            if (cr.current) {
              cr.current.removeEventListener("pointerdown", onPointerDown);
              cr.current.removeEventListener("pointermove", onPointerMove);
              cr.current.removeEventListener("pointerup", onPointerUp);
              cr.current.removeEventListener("pointercancel", onPointerCancel);
            }
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
      viewCubeCleanup?.();
      const h = hlR.current; if (h) { void h.dispose().catch(() => {}); } hlR.current = null;
      hiderR.current = null;
      try { c.dispose(); } catch { /* */ }
      compR.current = null; fragsR.current = null; worldR.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stage 1 (drawer redesign): ResizeObserver on the canvas container
  // so the camera aspect + renderer size track the viewer's changing
  // height as the cuantificación drawer slides up and down. The
  // PostproductionRenderer does NOT auto-resize — without this hook
  // the canvas would visibly squash / stretch during drag.
  //
  // Design constraints (Boss 2026-08-04 16:50 #15872):
  //   - Update camera.aspect + renderer.setSize ONLY.
  //   - No scene reinit, no controls.fitToBox, no frags.core.update().
  //   - Throttled to requestAnimationFrame (one resize per frame max).
  //   - Skip while the renderer is mid-init (worldR.current is null);
  //     the initial observation fires once now and once more after the
  //     async init completes, which is fine — the second observation
  //     carries the correct size.
  useEffect(() => {
    if (!cr.current) return;
    let rafId: number | null = null;
    const observer = new ResizeObserver((entries) => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const entry = entries[0];
        if (!entry) return;
        const { width, height } = entry.contentRect;
        if (width <= 0 || height <= 0) return;
        const world = worldR.current;
        if (!world || !world.renderer) return;
        // TOE types `world.camera.three` as `THREE.Camera` (abstract);
        // `aspect` and `updateProjectionMatrix()` live on the concrete
        // PerspectiveCamera. Cast through `unknown` to access them
        // without an `any` escape hatch. The OrthoPerspectiveCamera
        // instance we create in the init effect always has a
        // perspective camera on the .three surface, so this cast is
        // sound at runtime.
        const camera = world.camera.three as unknown as {
          aspect: number;
          updateProjectionMatrix: () => void;
        };
        if (camera) {
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
        }
        // PostproductionRenderer wraps THREE.WebGLRenderer; the
        // underlying `setSize(w, h)` is what we want. The TOE
        // typings don't surface it on the abstract renderer
        // surface, hence the cast.
        const renderer = world.renderer as unknown as {
          setSize?: (w: number, h: number) => void;
        };
        if (typeof renderer.setSize === "function") {
          renderer.setSize(width, height);
        }
      });
    });
    observer.observe(cr.current);
    return () => {
      observer.disconnect();
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Agent-driven filter → OBC.Hider isolation.
  //
  // Sources: agentFilter (chat-driven), mapping (PDF section click),
  // selectedIfcClass (chat-driven IFC class). This is the
  // "focus mode" — non-matching elements are hidden so the user
  // sees only the elements of interest. Boss directive 2026-07-30
  // 17:26: "cuando el filtro corra por un promp del usuario debera
  // aislar los elementos de interes en la vista. asi funcionaba
  // antes pero perdimos la funcionaidad". The Hider primitives were
  // brought back in v8 after v7 (commit 5dedd4b) over-corrected and
  // removed them entirely.
  useEffect(() => {
    if (!loadedR.current) return;
    const items = itemsR.current; if (!items) return;
    const hider = hiderR.current; if (!hider) return;

    const filters: Filter[] = agentFilter
      ? [agentFilter]
      : (mapping?.results ?? [])
          .map(r => r.filter)
          .filter((f): f is Filter => !!f && (f.g?.length ?? 0) > 0);
    const hasFilter = filters.length > 0;

    const allIds = Object.keys(items).map(Number);
    const all = new Set(allIds);

    let matching: Set<number>;
    if (hasFilter || selectedIfcClass) {
      matching = new Set<number>();
      for (const [idStr, item] of Object.entries(items)) {
        const id = Number(idStr);
        const evaluationItem = evaluationItemFor(id, item) as FragmentItem;
        const m = hasFilter
          ? filters.some(f => evaluateFilter(f, evaluationItem))
          : evaluationItem.ifc_class === selectedIfcClass;
        if (m) matching.add(id);
      }
    } else {
      matching = new Set(all);
    }

    console.log("[V3D] hider (agent filter):", {
      matching: matching.size,
      total: all.size,
      filters: filters.length,
      selectedIfcClass,
      agentFilter: agentFilter ? "(set)" : null,
    });

    if (hasFilter || selectedIfcClass) {
      if (matching.size < all.size) {
        const nonMatchingIds = allIds.filter(id => !matching.has(id));
        const visibleMap = { [MODEL_ID]: new Set([...matching]) };
        const hiddenMap  = { [MODEL_ID]: new Set(nonMatchingIds) };
        Promise.all([
          hider.set(true,  visibleMap),
          hider.set(false, hiddenMap),
        ]).then(() => {
          if (disR.current) return;
          setStatus(`1 model · ${matching.size} matching / ${all.size} total`);
        }).catch((e) => console.warn("[V3D] hide failed:", e));
      } else {
        // All elements match (full coverage) — just show all.
        hider.set(true, { [MODEL_ID]: new Set(allIds) }).then(() => {
          if (disR.current) return;
          setStatus("1 model loaded");
        }).catch((e) => console.warn("[V3D] reset hide failed:", e));
      }
    } else {
      // No agent filter — show all.
      hider.set(true, { [MODEL_ID]: new Set(allIds) }).then(() => {
        if (disR.current) return;
        setStatus("1 model loaded");
      }).catch((e) => console.warn("[V3D] reset hide failed:", e));
    }
  }, [agentFilter, mapping, selectedIfcClass, loaded]);

  // User-driven selection → OBCF.Highlighter 'filter' style.
  //
  // Source: userSelectionFilter (set by row click in the
  // cuantificación table). This is the "highlight mode" — all
  // elements stay visible, matching elements get a soft yellow
  // tint via the Highlighter. Boss directive 2026-07-30 17:26:
  // "lo del highlight al selecionar es solo si el usuario da click
  // a una fila de la tabla o elemento en el modelo". Independent
  // from the Hider (which is agent-driven only).
  useEffect(() => {
    if (!loadedR.current) return;
    const items = itemsR.current; if (!items) return;
    const hl = hlR.current; if (!hl) return;

    if (userSelectionFilter) {
      const matching = new Set<number>();
      for (const [idStr, item] of Object.entries(items)) {
        const id = Number(idStr);
        const evaluationItem = evaluationItemFor(id, item) as FragmentItem;
        if (evaluateFilter(userSelectionFilter, evaluationItem)) {
          matching.add(id);
        }
      }

      const total = Object.keys(items).length;
      console.log("[V3D] highlighter (user selection):", {
        matching: matching.size,
        total,
      });

      // Always clear first so the previous run's matching set
      // doesn't leak. Then re-apply to the new matching set.
      hl.clear("filter").catch(() => {});
      if (matching.size > 0) {
        hl.highlightByID(
          "filter",
          { [MODEL_ID]: new Set([...matching]) },
          false,
        ).catch((e) => console.warn("[V3D] filter highlight failed:", e));
      }

      // v1.1 (Boss 2026-08-04 09:58): when the user clicks a row in the
      // cuantificación table and the filter narrows down to a meaningful
      // subset, smoothly orbit to fit the matching elements in the
      // viewport. The agentFilter useEffect above does NOT auto-fit —
      // chat-driven filters are typically narrow by element category
      // and a jumping camera on every reply feels unstable.
      // We only auto-fit when matching is a *non-trivial* subset: skip
      // the trivial cases (empty set, full set, identity) where the
      // current framing is already correct.
      if (matching.size > 0 && matching.size < total) {
        try {
          const model = fragsR.current?.list.get(MODEL_ID) as unknown as
            | (FragmentsModelLike & { getBBoxes?: (items: number[]) => THREE.Box3 | Promise<THREE.Box3> })
            | undefined;
          const boxOrPromise = model?.getBBoxes?.([...matching]);
          // fitToBox lives on the yomotsu/camera-controls instance
          // wrapped by TOE — not on the TOE-typed abstract surface in
          // 3.4.8, hence the cast. The boolean argument enables the
          // smooth tween (~600ms ease-in-out by default).
          const applyFit = (box: THREE.Box3) => {
            if (box.isEmpty?.()) return;
            const ctrl = worldR.current?.camera.controls as unknown as {
              fitToBox?: (b: THREE.Box3, t: boolean) => void | Promise<void>;
              setLookAt?: (
                px: number, py: number, pz: number,
                tx: number, ty: number, tz: number,
                enableTransition?: boolean,
              ) => void;
            } | undefined;
            if (!ctrl) return;
            // v1.1 (Boss 2026-08-05 14:50): the yomotsu camera-controls
            // `fitToBox` proved unreliable in TOE 3.4.8 — the call
            // returns cleanly but the camera doesn't move. Fall back
            // to a manual `setLookAt` orbit with a distance derived
            // from the box size. `setLookAt` is the yomotsu primitive
            // and is always present on the controls.
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            const distance = Math.max(maxDim * 2.5, 1);
            const cameraPos = center.clone().add(
              new THREE.Vector3(distance, distance * 0.7, distance),
            );
            if (typeof ctrl.setLookAt === "function") {
              ctrl.setLookAt(
                cameraPos.x, cameraPos.y, cameraPos.z,
                center.x, center.y, center.z,
                true,
              );
            } else if (typeof ctrl.fitToBox === "function") {
              ctrl.fitToBox(box, true);
            }
          };
          if (boxOrPromise instanceof Promise) {
            boxOrPromise.then(applyFit).catch((e) => {
              console.warn("[V3D] fitToBox (async) failed:", e);
            });
          } else if (boxOrPromise) {
            applyFit(boxOrPromise);
          }
        } catch (e) {
          console.warn("[V3D] fitToBox failed:", e);
        }
      }
    } else {
      hl.clear("filter").catch(() => {});
    }
  }, [userSelectionFilter, loaded]);

  // Soft reset: bump resetTrigger to clear BOTH highlighter styles.
  // 'select' = the click highlight; 'filter' = the agent-filter
  // pre-highlight. Both go away on a clean reset (e.g., the user
  // clicks the ⟳ Reset view button or the chat issues a new query
  // that resets the page state). Boss directive 2026-07-27 09:40 —
  // reset view should remove filters and deselect the spec section,
  // not dispose+reload the model.
  useEffect(() => {
    if (resetTrigger === undefined || resetTrigger === 0) return;
    if (!loadedR.current) return;
    const hl = hlR.current;
    if (!hl) return;
    void hl.clear("select").catch(() => {});
    void hl.clear("filter").catch(() => {});
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
