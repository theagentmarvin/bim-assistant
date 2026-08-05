// src/components/ViewerPane.tsx — bim-assistant PoC.
//
// Thin wrapper around Viewer3D. Previously hosted a toolbar with
// the section label ("Sin sección seleccionada" empty state +
// mapping title) and the Reset View button. Both moved out:
//   - Section label dropped (Boss 2026-08-05 19:20 — the empty
//     state was the only piece explicitly called out; the full
//     mapping title is duplicated in the MappedSidebar so this
//     toolbar carried redundant info).
//   - Reset View button re-homed as a floating button under the
//     NavCube, rendered inside Viewer3D itself.
//
// This file remains as a pass-through so the App-level ViewerPane
// import surface stays stable. If the toolbar never comes back, it
// can be deleted and Viewer3D rendered directly from App.tsx.

import Viewer3D from "../viewer/Viewer3D";
import type { ElementClickData, ElementProperties } from "../viewer/Viewer3D";
import type { Filter, Mapping } from "../types";
import styles from "./ViewerPane.module.css";

interface Props {
  /** The currently selected mapping. Passed through to Viewer3D
   *  for the toolbar label / highlight source. */
  mapping: Mapping | null;
  /** The IFC class extracted from the selected mapping's top result. */
  selectedIfcClass: string | null;
  /** Chat-driven Filter (Navisworks-style). Takes precedence over
   *  `mapping` in the viewer when present. Drives the Hider
   *  (isolation) — see Viewer3D. */
  agentFilter?: Filter | null;
  /** User-driven Filter (Navisworks-style). Set by row clicks in the
   *  Cuantificación table. Drives the Highlighter 'filter' style
   *  (yellow tint) — independent from the Hider. */
  userSelectionFilter?: Filter | null;
  /** Optional click handler. */
  onElementClick?: (data: ElementClickData) => void;
  /** Element properties callback. */
  onElementData?: (data: ElementProperties) => void;
  /** Bump to soft-reset the 3D viewer. */
  resetTrigger?: number;
  /** Callback fired by the floating Reset View button (anchored
   *  under the NavCube inside Viewer3D). Same surface as the old
   *  toolbar button — App.tsx wires the same `handleResetViewer`
   *  callback that the parent state expects. */
  onResetViewer?: () => void;
}

export default function ViewerPane({
  mapping,
  selectedIfcClass,
  agentFilter,
  userSelectionFilter,
  onElementClick,
  onElementData,
  resetTrigger,
  onResetViewer,
}: Props) {
  return (
    <div className={styles.pane}>
      <div className={styles.canvas}>
        <Viewer3D
          selectedIfcClass={selectedIfcClass}
          mapping={mapping}
          agentFilter={agentFilter}
          userSelectionFilter={userSelectionFilter}
          onElementClick={onElementClick}
          onElementData={onElementData}
          resetTrigger={resetTrigger}
          onResetView={onResetViewer}
        />
      </div>
    </div>
  );
}