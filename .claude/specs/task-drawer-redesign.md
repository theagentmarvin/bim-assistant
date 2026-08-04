# bim-assistant — Cuantificación drawer + Spec rail redesign

**Project:** `~/projects/bim/bim-assistant/` · branch `main` · on top of `c036beb`
**Brief:** Replace the 4-column tabbed layout with a 3-column layout where the
spec PDF is its own column (collapsible to a 44px rail when the cuantificación
drawer is open) and the cuantificación table is a bottom-anchored drawer under
the 3D viewer. Stage 1: drawers only. Stage 2: properties overlay (modal).
**Author:** Architect (Marvin, MiniMax M3)
**Boss request:** #15872 (2026-08-04 17:02 GMT-4) — *"ok go start working on it"*

## 1. Motivation

The current layout forces a tab trade-off between the spec PDF and the
cuantificación table. The user can only see one at a time; switching costs at
least one click and the table data is hidden whenever the spec is open. Opus's
design treats them as **complementary surfaces** that layer over the 3D viewer
based on the user's current task, not as competing tabs.

The triangulation the user actually wants:

> I asked the agent a question. The agent returned a table. While looking at
> the table, I want to keep seeing the windows it refers to. When I click a
> row, I want to see the elements highlighted in the model. When I want to
> cross-check the spec, I want to glance across — not close the table.

The drawer + rail layout makes this triangulation literal: the viewer is the
anchor, the table is evidence, the spec is reference, all stacked rather than
tabbed.

## 2. Scope — Stage 1 (this spec)

**In scope:**
- 3-column layout: `chat | spec-or-rail | viewer+drawer`.
- Cuantificación drawer at the bottom of the viewer column with **three states**:
  `peek` (40px), `expanded` (40vh), `full` (95vh, clamped to `viewport − 80px`).
- Top-edge drag handle. Drag updates pixel height in real-time; release snaps
  to the nearest state. Throttled to `requestAnimationFrame` during drag.
- **240ms ease-out** height transition; **80ms-delayed fade-in** on the table
  body so content doesn't appear stretched during the slide.
- **No bounce, no scrim.** Sibling surface.
- Spec column collapses to a **44px vertical-text rail** when the drawer leaves
  peek. Rail is clickable (cursor: pointer, hover state, chevron, ARIA label).
  Rail click → drawer to peek, spec expands.
- Auto-expand: when `latestTable` updates (new agent response), the drawer
  transitions to `expanded`.
- Anti-intrusion: if the user manually collapsed the drawer during the current
  turn, the drawer goes to `peek` instead and the badge pulses once.
- `userHasCollapsedThisTurn` resets to `false` at the start of every `handleSend`.
- Drawer state persisted in `localStorage` as `bim-assistant:drawerState`
  (enum: `peek` | `expanded` | `full`, validated on restore).
- `ResizeObserver` on the viewer canvas → `camera.aspect` + `renderer.setSize`
  only. **No scene reinit, no reframe.** Throttled to `requestAnimationFrame`.
- Row click → existing `handleRowSelect` flow (unchanged). Properties panel
  hookup is stage 2; the `setSelectedElement` call still fires (state is set
  but the panel doesn't render in stage 1).

**Out of scope (explicit):**
- Properties overlay (72% opacity, blur, ×/Esc close) — stage 2.
- Differentiated 3D highlight styles for agent-set vs. user-selected — stage 3.
- 56px peek adjustment, skeleton rows, 180-row search — stage 3+.
- Row hover preview — explicitly not building per Boss 2026-08-04 16:57.
- Spec PDF tab-strip removal (already gone with the tabs component).

## 3. Layout (Stage 1)

```
┌─────────────────────────────────────────────────────────────────────┐
│ Header (unchanged)                                                  │
├─────────────────────────────────────────────────────────────────────┤
│ [ChatPanel]   [Spec column]    [3D viewer column]                   │
│  300-340px    pdfSlotWidth      minmax(420, 1fr)                    │
│                OR 44px rail       ├─────────────────────────────────┤
│                (rail when         │  Viewer3D canvas (flex: 1)       │
│                drawer > peek)    │  (ResizeObserver)                │
│                                   ├─────────────────────────────────┤
│                                   │  CuantificacionDrawer           │
│                                   │  peek(40) | expanded(40vh) |    │
│                                   │  full(95vh)                     │
└─────────────────────────────────────────────────────────────────────┘
```

The properties column disappears from the grid. The `setSelectedElement` state
remains in `App.tsx` (still wired) but `<ModelPropertyPanel>` is not rendered
in stage 1.

## 4. Components

### `CuantificacionDrawer.tsx` (new)

Container for the table. State machine: `peek | expanded | full`. Owns the
drag handle, the body, and the local fade-in state.

**Props:**
- `data: QuantificationTable | null`
- `onRowSelect: (ids: number[]) => void`
- `selectedRowIndex: number | null`
- `state: DrawerState` (controlled by parent)
- `onStateChange: (s: DrawerState) => void` (snapped after drag release)
- `userCollapsedPulse: number` (a number that increments to trigger the badge pulse animation)
- `expandedHeightPx: number` (provided by parent based on viewport)

**Behavior:**
- Height reads from `state` unless a drag is in progress (parent passes
  `dragHeight` separately).
- During drag: `transition: none` on the container; height is the raw pixel
  value from the drag handler.
- On release: parent snaps to nearest state via `onStateChange`.
- Body content has `opacity: 0` initially; on height transition start, a
  `setTimeout(80ms)` flips the class to `opacity: 1`. The 240ms + 80ms
  timing means the user sees the slide start, the table fades in at 80ms,
  and the slide completes at 240ms — content is fully visible at ~280ms.
- Drag handle is a 6px tall, full-width strip at the top of the drawer
  with a visible 1px separator and a centered chevron icon (rotates 180°
  when expanded).

### `SpecRail.tsx` (new)

The 44px-wide vertical-text rail that replaces the spec column when the
drawer leaves peek.

**Props:**
- `fileName: string` (e.g., `"eett-c.pdf"`)
- `onClick: () => void` (collapse drawer to peek, expand spec column)

**Behavior:**
- `writing-mode: vertical-rl; text-orientation: mixed;` for the label.
- Chevron icon at the top, rotated to hint "click to expand right".
- Hover state: subtle background tint + chevron nudges right.
- `cursor: pointer`, `aria-label="Expandir especificación técnica"`.
- `transition: width 240ms ease-out` to match the column expansion.

### `App.tsx` (modified)

- Reads `latestTable` and triggers the auto-expand.
- Owns `drawerState`, `userHasCollapsedThisTurn`, and `dragHeight`.
- `userHasCollapsedThisTurn` is set to `true` whenever the user manually
  collapses the drawer:
  - Drag release to peek (drag height ≤ 80px)
  - Rail click (sets drawer to peek)
- `userHasCollapsedThisTurn` is set to `false` at the start of each
  `handleSend` call.
- Auto-expand on `latestTable` change:
  - If `userHasCollapsedThisTurn` → `setDrawerState('peek')` + bump
    `pulseBadgeCounter` for the badge animation.
  - Otherwise → `setDrawerState('expanded')`.
- Viewport-height recomputation: `window.innerHeight` is read on `resize`
  and re-renders the drawer with the correct expanded/full heights.

### `Viewer3D.tsx` (modified)

- Add a `ResizeObserver` on the canvas ref.
- On resize:
  - Update `worldR.current.renderer.setSize(width, height)` (cast to
    `{ setSize: (w: number, h: number) => void }`).
  - Update `worldR.current.camera.three.aspect = width / height`.
  - Call `worldR.current.camera.three.updateProjectionMatrix()`.
- Throttled to `requestAnimationFrame` via a `pendingRaf` flag.
- Cleanup: disconnect the observer on unmount.

## 5. State machine details

```
        ┌─────────────────────────────────────────┐
        │                                         │
        ▼                                         │
     ┌──────┐  drag-to-1 (≤80px)    ┌──────────┐  │
     │ peek │ ◄──────────────────── │ expanded │  │
     │ 40px │                       │   40vh   │  │
     └──────┘                       └──────────┘  │
        ▲                              ▲    │    │
        │ rail click                   │    │    │
        │                              │    │ drag-to-3 (≥85vh)
        │                              │    ▼    │
        │                         ┌──────────┐ ◄┘
        │                         │   full   │
        │ drag-to-1 (≤80px)       │   95vh   │
        └────────────────────────┴──────────┘
```

**Release snap thresholds:**
- Final height ≤ 80px → `peek`
- Final height ≥ 85vh → `full`
- Otherwise → `expanded`

**Drag updates:**
- `mousedown` on top edge → start drag, capture `dragStartY` and
  `dragStartHeight`, set `dragHeight = startHeight`.
- `mousemove` → `dragHeight = startHeight - (currentY - startY)`, clamped
  to `[40, viewportHeight - 80]`. Throttled via `requestAnimationFrame`.
- `mouseup` → snap to nearest state via `onStateChange(...)`, clear
  `dragHeight`.

## 6. Research & validation

- **CSS height transition behavior**: transitions on `height` from
  `auto` to a fixed value are not interpolatable. Both end states
  must be concrete pixel values. The drawer always uses a concrete
  height (40px, 40vh in px, 95vh in px), so transitions work cleanly.
- **TOE PostproductionRenderer resize**: the renderer is created with
  the canvas container. The renderer does NOT auto-resize when the
  container resizes. We must call `setSize` explicitly on resize.
  Verified by reading `Viewer3D.tsx` — no existing resize handler.
- **Existing `frameModel` is one-shot** at model load. We don't want
  to trigger it on resize; the existing useEffect on `[]` only runs
  once. The resize handler is a separate effect that does not
  re-trigger frame-to-fit.
- **localStorage key collision check**: existing key is
  `bim-as…idth` (truncated; the original was `bim-assistant:pdfSlotWidth`).
  The new key `bim-assistant:drawerState` is unique and obvious.
- **Tests**: `src/agent/tools.test.ts` (27 assertions) and the
  underlying `tools.ts` are unaffected. The UI refactor is
  DOM-only; no agent logic changes.

## 7. Open decisions for stage 3+

- Peek height: locked at 40px for stage 1. Boss's "sube a 56" follow-up
  is a single constant change.
- Spec column width: kept on the existing slider (default 420px, range
  280–1000px). Unchanged.
- A11y for the auto-expand: an `aria-live="polite"` region announces
  "Tabla de cuantificación disponible" when `latestTable` arrives.
  Not implemented in stage 1 (deferred to stage 3) since the chat
  bubble already announces the data in text.
- Visual differentiation between agent-set highlight and user-selected
  highlight: deferred to stage 3.

## 8. Definition of done

- [ ] Drawer renders in all three states (peek, expanded, full) with
      correct heights.
- [ ] Drag updates height in real-time; release snaps to nearest state.
- [ ] Animation: 240ms ease-out on height, 80ms-delayed fade-in on body.
- [ ] Spec column collapses to 44px rail when drawer is not in peek.
- [ ] Rail is clickable and toggles back to peek state.
- [ ] Auto-expand on `latestTable` change.
- [ ] Anti-intrusion: user-collapsed drawer → agent pushes to peek with
      badge pulse.
- [ ] Drawer state persisted in localStorage and restored on reload.
- [ ] Viewer3D resize handler updates camera aspect + renderer size
      without reframe.
- [ ] `npm run typecheck` → exit 0.
- [ ] `npm run build` → success.
- [ ] `npm run test` → 35/35 passing.
- [ ] Manual smoke test: send a query that returns a table, click a row,
      drag the drawer, click the rail, reload the page.
