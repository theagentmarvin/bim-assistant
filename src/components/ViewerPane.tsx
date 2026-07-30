// src/components/ViewerPane.tsx — bim-assistant PoC.
//
// Slim wrapper around Viewer3D: toolbar (mapping label + reset) and
// the canvas. The properties panel lives in the App-level right rail
// (App.tsx); the PDF viewer lives in its own column to the left of
// the viewer (App.tsx). Both are removed from this component so the
// split-view stays single-purpose.

import Viewer3D from "../viewer/Viewer3D";
import type { ElementClickData, ElementProperties } from "../viewer/Viewer3D";
import type { Mapping } from "../types";
import styles from "./ViewerPane.module.css";

interface Props {
  /** The currently selected mapping (drives the toolbar label). */
  mapping: Mapping | null;
  /** The IFC class extracted from the selected mapping's top result. */
  selectedIfcClass: string | null;
  /** Optional click handler. */
  onElementClick?: (data: ElementClickData) => void;
  /** Element properties callback. */
  onElementData?: (data: ElementProperties) => void;
  /** Bump to soft-reset the 3D viewer. */
  resetTrigger?: number;
  /** Callback fired by the Reset view button. */
  onResetViewer?: () => void;
}

export default function ViewerPane({
  mapping,
  selectedIfcClass,
  onElementClick,
  onElementData,
  resetTrigger,
  onResetViewer,
}: Props) {
  return (
    <div className={styles.pane}>
      <div className={styles.toolbar}>
        <span className={styles.toolbarLabel}>
          {mapping
            ? `${mapping.section_id} — ${mapping.section_title}`
            : "Sin sección seleccionada"}
        </span>
        <div className={styles.toolbarRight}>
          <span className={styles.toolbarHint}>Visor 3D · TOE fragments</span>
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
        </div>
      </div>
      <div className={styles.canvas}>
        <Viewer3D
          selectedIfcClass={selectedIfcClass}
          mapping={mapping}
          onElementClick={onElementClick}
          onElementData={onElementData}
          resetTrigger={resetTrigger}
        />
      </div>
    </div>
  );
}