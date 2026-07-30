import { useCallback, useRef, useState } from "react";
import type { ElementClickData, ElementProperties } from "../viewer/Viewer3D";
import type { Mapping } from "../types";
import Viewer3D from "../viewer/Viewer3D";
import ModelPropertyPanel from "./ModelPropertyPanel";
import styles from "./ViewerPane.module.css";

const PANEL_DEFAULT_WIDTH = 288; // 320px × 0.9 per Boss directive
const PANEL_MIN_WIDTH = 200;
const PANEL_MAX_WIDTH = 600;

interface Props {
  /** The currently selected mapping (drives the toolbar label AND the
   *  filter-based highlight in the 3D viewer). */
  mapping: Mapping | null;
  /** The IFC class extracted from the selected mapping's top result,
   *  used for the badge display and as fallback when no filter exists. */
  selectedIfcClass: string | null;
  /** Optional click handler. */
  onElementClick?: (data: ElementClickData) => void;
  /** Element properties callback (Free Field PropertiesDrawer pattern). */
  onElementData?: (data: ElementProperties) => void;
  /** Bump to soft-reset the 3D viewer: clears the Highlighter's 'select'
   *  highlight without remounting Viewer3D or reloading the IFC.
   *  Boss directive 2026-07-27 09:40 — reset view should remove filters
   *  and deselect the spec section, not dispose+reload the model.
   *  (Companion state in App.tsx clears selectedId + selectedElement in
   *  the same tick so the isolation effect runs with mapping=null and
   *  the whole model becomes visible again.) */
  resetTrigger?: number;
  /** Callback fired by the Reset view button. */
  onResetViewer?: () => void;
  /** The currently selected element's runtime metadata from the 3D viewer.
   *  Drives the ModelPropertyPanel on the right of the canvas. */
  selectedElement?: ElementProperties | null;
}

export default function ViewerPane({
  mapping,
  selectedIfcClass,
  onElementClick,
  onElementData,
  resetTrigger,
  onResetViewer,
  selectedElement,
}: Props) {
  const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT_WIDTH);
  const [panelCollapsed, setPanelCollapsed] = useState(false);

  // Drag state for the resize handle. Kept in a ref so updates don't re-render
  // the parent on every pointer-move — we only commit to state on pointer-up
  // (or throttled via setState). For this size we just commit on move; React
  // batches and the canvas is GPU-backed so re-renders are cheap.
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  const onHandlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = { startX: e.clientX, startW: panelWidth };
    },
    [panelWidth],
  );

  const onHandlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      // Moving the handle LEFT (negative dx) widens the panel.
      const dx = drag.startX - e.clientX;
      const next = Math.max(
        PANEL_MIN_WIDTH,
        Math.min(PANEL_MAX_WIDTH, drag.startW + dx),
      );
      setPanelWidth(next);
    },
    [],
  );

  const onHandlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      dragRef.current = null;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // Pointer may already be released; ignore.
      }
    },
    [],
  );

  return (
    <div className={styles.pane}>
      <div className={styles.toolbar}>
        <span className={styles.toolbarLabel}>
          {mapping
            ? `${mapping.section_id} — ${mapping.section_title}`
            : "No section selected"}
        </span>
        <div className={styles.toolbarRight}>
          <span className={styles.toolbarHint}>Task 4b — TOE fragment viewer</span>
          {onResetViewer && (
            <button
              type="button"
              className={styles.toolbarResetBtn}
              onClick={onResetViewer}
              title="Reset 3D view — re-centers camera and reloads model"
              aria-label="Reset 3D view"
            >
              ⟳ Reset view
            </button>
          )}
          <button
            type="button"
            className={styles.toolbarCollapseBtn}
            onClick={() => setPanelCollapsed((c) => !c)}
            title={
              panelCollapsed
                ? "Show properties panel"
                : "Hide properties panel"
            }
            aria-label={panelCollapsed ? "Show properties panel" : "Hide properties panel"}
            aria-expanded={!panelCollapsed}
          >
            {panelCollapsed ? "‹" : "›"}
          </button>
        </div>
      </div>
      <div className={styles.body}>
        <div className={styles.canvas}>
          <Viewer3D
            selectedIfcClass={selectedIfcClass}
            mapping={mapping}
            onElementClick={onElementClick}
            onElementData={onElementData}
            resetTrigger={resetTrigger}
          />
        </div>
        {!panelCollapsed && (
          <div
            className={styles.resizeHandle}
            onPointerDown={onHandlePointerDown}
            onPointerMove={onHandlePointerMove}
            onPointerUp={onHandlePointerUp}
            onPointerCancel={onHandlePointerUp}
            role="separator"
            aria-label="Resize properties panel"
            aria-orientation="vertical"
            title="Drag to resize properties panel"
          />
        )}
        <div
          className={styles.propertiesContainer}
          style={{
            width: panelCollapsed ? 0 : panelWidth,
            borderLeftWidth: panelCollapsed ? 0 : undefined,
          }}
          aria-hidden={panelCollapsed}
        >
          <ModelPropertyPanel data={selectedElement ?? null} />
        </div>
        {panelCollapsed && (
          <div className={styles.collapsedStrip}>
            <button
              type="button"
              className={styles.collapsedExpandBtn}
              onClick={() => setPanelCollapsed(false)}
              title="Show properties panel"
              aria-label="Show properties panel"
            >
              ‹
            </button>
          </div>
        )}
      </div>
    </div>
  );
}