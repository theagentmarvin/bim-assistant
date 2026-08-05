// src/components/CuantificacionDrawer.tsx
//
// Bottom-anchored drawer under the 3D viewer. Two states:
// closed (40px handle only) and open (40% viewport height with
// the table). The handle is a click-to-toggle button — Boss
// 2026-08-05 11:40 retired the height-adjust affordance (drag-to-
// resize + full state + grip pill) because it kept racing with
// click detection and the user only wants a binary toggle.
//
// Parent owns the drawer state, persistence, auto-expand, and the
// pulse trigger. This component owns the toggle handler, the
// height math, and the body fade-in.

import { useEffect, useMemo, useRef, useState } from "react";
import QuantificationPanel from "./QuantificationPanel";
import type { QuantificationTable } from "../quantification/types";
import styles from "./CuantificacionDrawer.module.css";

export type DrawerState = "closed" | "open";

// Locked pixel heights. Closed is the handle strip; open is a
// share of viewport height. The component listens for viewport
// resize and re-renders so the open height stays accurate when
// the window changes.
const CLOSED_HEIGHT = 40;
const OPEN_RATIO = 0.4;

interface Props {
  data: QuantificationTable | null;
  onRowSelect?: (ids: number[]) => void;
  selectedRowIndex?: number | null;
  state: DrawerState;
  onStateChange: (s: DrawerState) => void;
  /** Fired when the user manually collapses from an open state.
   *  Parent uses this to set the `userHasCollapsedThisTurn` flag so
   *  the agent auto-expand respects the anti-intrusion rule. */
  onUserCollapse?: () => void;
  /** Bump to fire the badge pulse animation once (typical when
   *  the agent pushes to closed because the user collapsed
   *  manually). */
  pulseCounter: number;
}

export default function CuantificacionDrawer({
  data,
  onRowSelect,
  selectedRowIndex,
  state,
  onStateChange,
  onUserCollapse,
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
    if (s === "closed") return CLOSED_HEIGHT;
    return viewportHeight * OPEN_RATIO;
  };

  const drawerHeight = useMemo(
    () => heightForState(state),
    [state, viewportHeight],
  );

  // Toggle semantics: closed → open, open → closed.
  // Manual collapse from open → fire the anti-intrusion callback
  // so the next agent response doesn't auto-reopen the drawer over
  // the user's collapse.
  const handleClick = () => {
    if (state === "closed") {
      onStateChange("open");
    } else {
      onUserCollapse?.();
      onStateChange("closed");
    }
  };

  // Body fade-in: 80ms after the slide starts. Achieved by
  // holding the body at opacity 0 for 80ms after the state opens,
  // then flipping to opacity 1. The CSS transition (200ms) means
  // the body is fully visible at ~280ms — slightly after the slide
  // ends.
  const [bodyVisible, setBodyVisible] = useState<boolean>(state === "open");
  useEffect(() => {
    if (state === "closed") {
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
      aria-expanded={state === "open"}
    >
      <button
        type="button"
        className={styles.handle}
        onClick={handleClick}
        aria-label={
          state === "closed"
            ? "Expandir cuantificación"
            : "Cerrar cuantificación"
        }
        aria-expanded={state === "open"}
        title={state === "closed" ? "Expandir" : "Cerrar"}
      >
        <span
          className={`${styles.handleChevron} ${state === "closed" ? styles.handleChevronUp : styles.handleChevronDown}`}
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
      </button>
      {state === "open" && (
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
