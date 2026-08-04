// src/components/CuantificacionDrawer.tsx
//
// Bottom-anchored drawer under the 3D viewer. Three states with locked
// pixel heights (peek | expanded | full). Top edge draggable.
//
// Stage 1 of the drawer redesign
// (see .claude/specs/task-drawer-redesign.md).
//
// Parent owns the drawer state, persistence, auto-expand, and the
// pulse trigger. This component owns the drag mechanics, the height
// math, and the body fade-in.

import { useEffect, useMemo, useRef, useState } from "react";
import QuantificationPanel from "./QuantificationPanel";
import type { QuantificationTable } from "../quantification/types";
import styles from "./CuantificacionDrawer.module.css";

export type DrawerState = "peek" | "expanded" | "full";

// Locked pixel heights. Resolved against `window.innerHeight` for the
// vh-keyed states — the component listens for viewport resize and
// re-renders so the heights stay accurate when the window changes.
const PEEK_HEIGHT = 40;
const EXPANDED_RATIO = 0.4;
const FULL_RATIO = 0.95;
const FULL_MIN_FREE = 80;

// Snap thresholds. Released drag height gets mapped to the nearest state.
const SNAP_TO_PEEK_THRESHOLD = 80;
const SNAP_TO_FULL_RATIO = 0.85;

interface Props {
  data: QuantificationTable | null;
  onRowSelect?: (ids: number[]) => void;
  selectedRowIndex?: number | null;
  state: DrawerState;
  onStateChange: (s: DrawerState) => void;
  /** Fired when the user releases the drag and the snap-target is
   *  `peek` (i.e., a manual collapse from a non-peek state). The
   *  parent uses this to set the `userHasCollapsedThisTurn` flag so
   *  the agent auto-expand respects the anti-intrusion rule. */
  onDragCollapseToPeek?: () => void;
  /** Bump to fire the badge pulse animation once (typical when the
   *  agent pushes to peek because the user collapsed manually). */
  pulseCounter: number;
}

export default function CuantificacionDrawer({
  data,
  onRowSelect,
  selectedRowIndex,
  state,
  onStateChange,
  onDragCollapseToPeek,
  pulseCounter,
}: Props) {
  const [viewportHeight, setViewportHeight] = useState<number>(
    typeof window !== "undefined" ? window.innerHeight : 800,
  );

  useEffect(() => {
    const onResize = () => setViewportHeight(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const heightForState = (s: DrawerState): number => {
    if (s === "peek") return PEEK_HEIGHT;
    if (s === "expanded") return viewportHeight * EXPANDED_RATIO;
    return Math.min(viewportHeight * FULL_RATIO, viewportHeight - FULL_MIN_FREE);
  };

  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const dragStateRef = useRef<{
    startHeight: number;
    startY: number;
    currentHeight: number;
    pending: boolean;
    wasNonPeek: boolean;
  } | null>(null);

  const drawerHeight = useMemo(() => {
    if (dragHeight !== null) return dragHeight;
    return heightForState(state);
  }, [state, dragHeight, viewportHeight]);

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const currentHeight = heightForState(state);
    dragStateRef.current = {
      startHeight: currentHeight,
      startY: e.clientY,
      currentHeight,
      pending: false,
      wasNonPeek: state !== "peek",
    };
    setDragHeight(currentHeight);

    const onMove = (ev: MouseEvent) => {
      const r = dragStateRef.current;
      if (!r) return;
      if (r.pending) return;
      r.pending = true;
      requestAnimationFrame(() => {
        if (!dragStateRef.current) return;
        const max = viewportHeight - FULL_MIN_FREE;
        const delta = dragStateRef.current.startY - ev.clientY;
        dragStateRef.current.currentHeight = Math.max(
          PEEK_HEIGHT,
          Math.min(max, dragStateRef.current.startHeight + delta),
        );
        setDragHeight(dragStateRef.current.currentHeight);
        dragStateRef.current.pending = false;
      });
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      const r = dragStateRef.current;
      if (r) {
        const finalHeight = r.currentHeight;
        const snapped = snapToState(finalHeight, viewportHeight);
        if (r.wasNonPeek && snapped === "peek") {
          onDragCollapseToPeek?.();
        }
        onStateChange(snapped);
        setDragHeight(null);
      }
      dragStateRef.current = null;
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  // Body fade-in: 80ms after the slide starts. Achieved by holding
  // the body at opacity 0 for 80ms after the state leaves peek, then
  // flipping to opacity 1. The CSS transition (200ms) means the body
  // is fully visible at ~280ms — slightly after the slide ends.
  const [bodyVisible, setBodyVisible] = useState<boolean>(state !== "peek");
  useEffect(() => {
    if (state === "peek") {
      setBodyVisible(false);
      return;
    }
    const t = window.setTimeout(() => setBodyVisible(true), 80);
    return () => window.clearTimeout(t);
  }, [state]);

  // Pulse: when pulseCounter bumps, animate the badge once.
  const [pulse, setPulse] = useState(false);
  const lastPulseRef = useRef(pulseCounter);
  useEffect(() => {
    if (pulseCounter === lastPulseRef.current) return;
    lastPulseRef.current = pulseCounter;
    setPulse(true);
    const t = window.setTimeout(() => setPulse(false), 600);
    return () => window.clearTimeout(t);
  }, [pulseCounter]);

  const meta = useMemo(() => {
    if (!data) return null;
    const total = data.filas.length;
    return `${total} fila${total === 1 ? "" : "s"}`;
  }, [data]);

  // Clicking the handle while at peek expands to expanded. The drag
  // handler also fires because mousedown→mouseup with no movement
  // resolves to snap-to-current-state (no change). The click event
  // fires after mouseup, so the two compose cleanly.
  const onHandleClick = () => {
    if (state === "peek") {
      onStateChange("expanded");
    }
  };

  const animating = dragHeight === null;

  return (
    <div
      className={styles.drawer}
      style={{
        height: `${drawerHeight}px`,
        transition: animating ? "height 240ms cubic-bezier(0.2, 0.8, 0.2, 1)" : "none",
      }}
      data-state={state}
      aria-expanded={state !== "peek"}
    >
      <div
        className={styles.handle}
        onMouseDown={startDrag}
        onClick={onHandleClick}
        role="separator"
        aria-label="Arrastrar para redimensionar el drawer; clic para expandir"
        aria-orientation="horizontal"
        aria-valuenow={Math.round(drawerHeight)}
        aria-valuemin={PEEK_HEIGHT}
        aria-valuemax={viewportHeight - FULL_MIN_FREE}
        title="Arrastrar para ajustar alto · clic para expandir"
      >
        <span className={styles.handleGrip} aria-hidden="true" />
        <div className={`${styles.handleBadge} ${pulse ? styles.handleBadgePulse : ""}`}>
          <span className={styles.handleBadgeLabel}>Cuantificación</span>
          {meta && <span className={styles.handleBadgeMeta}>· {meta}</span>}
          {data && (
            <span className={styles.handleBadgeSource}>
              · fuente {data.fuente}
            </span>
          )}
        </div>
      </div>
      {state !== "peek" && (
        <div className={`${styles.body} ${bodyVisible ? styles.bodyVisible : ""}`}>
          <QuantificationPanel
            data={data}
            onRowSelect={onRowSelect}
            selectedRowIndex={selectedRowIndex}
          />
        </div>
      )}
    </div>
  );
}

function snapToState(height: number, viewportHeight: number): DrawerState {
  if (height <= SNAP_TO_PEEK_THRESHOLD) return "peek";
  if (height >= viewportHeight * SNAP_TO_FULL_RATIO) return "full";
  return "expanded";
}
