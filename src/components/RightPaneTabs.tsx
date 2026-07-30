// src/components/RightPaneTabs.tsx
//
// Tab strip for the second column of the App shell. Hosts the
// existing PdfViewer (Spec PDF tab) and the new QuantificationPanel
// (Cuantificación tab). The parent owns the active tab id so the
// agent loop can auto-switch when a `tabla` arrives.

import { type ReactNode } from "react";
import styles from "./RightPaneTabs.module.css";

export type RightPaneTabId = "pdf" | "cuantificacion";

interface TabDef {
  id: RightPaneTabId;
  label: string;
  ariaLabel: string;
}

const TABS: TabDef[] = [
  { id: "pdf", label: "Spec PDF", ariaLabel: "Pestaña del PDF de especificaciones" },
  { id: "cuantificacion", label: "Cuantificación", ariaLabel: "Pestaña de cuantificación" },
];

interface Props {
  tab: RightPaneTabId;
  onTabChange: (tab: RightPaneTabId) => void;
  /** Spec PDF body — always rendered when this tab is active. */
  pdf: ReactNode;
  /** Cuantificación body — always rendered when this tab is active. */
  cuantificacion: ReactNode;
}

export default function RightPaneTabs({ tab, onTabChange, pdf, cuantificacion }: Props) {
  return (
    <div className={styles.container}>
      <div className={styles.strip} role="tablist" aria-label="Pestañas del panel derecho">
        {TABS.map((t) => {
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`tab-panel-${t.id}`}
              aria-label={t.ariaLabel}
              id={`tab-${t.id}`}
              tabIndex={active ? 0 : -1}
              className={`${styles.tab}${active ? ` ${styles.tabActive}` : ""}`}
              onClick={() => onTabChange(t.id)}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div className={styles.body}>
        <div
          id="tab-panel-pdf"
          role="tabpanel"
          aria-labelledby="tab-pdf"
          className={styles.panel}
          hidden={tab !== "pdf"}
        >
          {pdf}
        </div>
        <div
          id="tab-panel-cuantificacion"
          role="tabpanel"
          aria-labelledby="tab-cuantificacion"
          className={styles.panel}
          hidden={tab !== "cuantificacion"}
        >
          {cuantificacion}
        </div>
      </div>
    </div>
  );
}
