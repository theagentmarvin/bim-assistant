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
  /** Callback fired by the Reset View icon in the viewer tools toolbar
   *  (under the NavCube). Same surface as the previous floating
   *  button — App.tsx wires the same `handleResetViewer` callback. */
  onResetViewer?: () => void;
  /** Callback fired by the Properties Panel toggle icon. Toggles the
   *  visibility of the PropertiesOverlay (independent of whether an
   *  element is currently selected). Optional: if not provided, the
   *  toggle icon is not rendered. */
  onToggleProperties?: () => void;
  /** Current state of the PropertiesOverlay. Drives the toggle icon's
   *  active styling via `data-active`. Optional. */
  propertiesVisible?: boolean;
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
  onToggleProperties,
  propertiesVisible,
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
          onToggleProperties={onToggleProperties}
          propertiesVisible={propertiesVisible}
        />
      </div>
    </div>
  );
}