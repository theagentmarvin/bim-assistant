// src/components/CuantificacionDrawer.tsx
//
// Bottom-anchored drawer under the 3D viewer. Three states with
// locked pixel heights (peek | expanded | full). Top edge is a
// click-to-toggle handle — drag-to-resize was retired entirely
// because it kept racing with click detection on touchpad jitter
// (Boss 2026-08-05 11:06: "deactivate the draw to adjutst size
// on the cuantification table, remove it since its the main
// issue right now").
//
// Stage 1 of the drawer redesign.
// Parent owns the drawer state, persistence, auto-expand, and the
// pulse trigger. This component owns the toggle handler, the
// height math, and the body fade-in.

import { useEffect, useMemo, useRef, useState } from "react";
import QuantificationPanel from "./QuantificationPanel";
import type { QuantificationTable } from "../quantification/types";
import styles from "./CuantificacionDrawer.module.css";

export type DrawerState = "peek" | "expanded" | "full";

// Locked pixel heights. Resolved against `window.innerHeight` for
// the vh-keyed states — the component listens for viewport resize
// and re-renders so the heights stay accurate when the window
// changes.
const PEEK_HEIGHT = 40;
const EXPANDED_RATIO = 0.4;
const FULL_RATIO = 0.95;
const FULL_MIN_FREE = 80;

interface Props {
  data: QuantificationTable | null;
  onRowSelect?: (ids: number[]) => void;
  selectedRowIndex?: number | null;
  state: DrawerState;
  onStateChange: (s: DrawerState) => void;
  /** Fired when the user manually collapses from a non-peek state.
   *  Parent uses this to set the `userHasCollapsedThisTurn` flag so
   *  the agent auto-expand respects the anti-intrusion rule. */
  onDragCollapseToPeek?: () => void;
  /** Bump to fire the badge pulse animation once (typical when
   *  the agent pushes to peek because the user collapsed
   *  manually). */
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

  const drawerHeight = useMemo(
    () => heightForState(state),
    [state, viewportHeight],
  );

  // Boss 2026-08-05 11:06 — handle is click-only. Drag-to-resize is
  // retired entirely (it was the root cause of every close→reopen
  // and click-vs-touchpad race). Toggle semantics:
  //   peek    → click → expanded
  //   expanded → click → peek
  //   full    → click → peek
  // The chevron icon still rotates up↔down to indicate the
  // current state's direction.
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (state === "peek") {
      onStateChange("expanded");
    } else {
      // Manual collapse from a non-peek state → fire the
      // anti-intrusion callback so the next agent response
      // doesn't auto-reopen the drawer over the user's collapse.
      onDragCollapseToPeek?.();
      onStateChange("peek");
    }
  };

  // Body fade-in: 80ms after the slide starts. Achieved by
  // holding the body at opacity 0 for 80ms after the state leaves
  // peek, then flipping to opacity 1. The CSS transition (200ms)
  // means the body is fully visible at ~280ms — slightly after the
  // slide ends.
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

  return (
    <div
      className={styles.drawer}
      style={{
        height: `${drawerHeight}px`,
        transition: "height 240ms cubic-bezier(0.2, 0.8, 0.2, 1)",
      }}
      data-state={state}
      aria-expanded={state !== "peek"}
    >
      <div
        className={styles.handle}
        onMouseDown={handleClick}
        role="button"
        aria-label="Click para expandir o colapsar la cuantificación"
        title="Click para expandir / colapsar"
      >
        <span className={styles.handleGrip} aria-hidden="true" />
        <span
          className={`${styles.handleChevron} ${state === "peek" ? styles.handleChevronUp : styles.handleChevronDown}`}
          aria-hidden="true"
        >
          ‹
        </span>
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