// src/components/PropertiesOverlay.tsx
//
// Stage 2 properties overlay. The ModelPropertyPanel was removed
// from the grid in stage 1 (it lived in a fourth column that we
// collapsed); it returns here as a floating panel over the 3D
// viewer with 72% opacity + blur, × / Esc to close, z-index above
// the cuantificación drawer so the user can have both visible at
// once.
//
// Parent owns the selectedElement state and the close callback.
// This component owns the close UX (× button, Esc key, focus
// trap is not implemented — the × is the explicit dismiss).

import { useEffect } from "react";
import ModelPropertyPanel from "./ModelPropertyPanel";
import type { ElementProperties } from "../viewer/Viewer3D";
import styles from "./PropertiesOverlay.module.css";

interface Props {
  data: ElementProperties | null;
  onClose: () => void;
}

export default function PropertiesOverlay({ data, onClose }: Props) {
  // Esc key closes — only when the overlay is open.
  useEffect(() => {
    if (!data) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [data, onClose]);

  if (!data) return null;

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-label="Propiedades del elemento"
    >
      <button
        type="button"
        className={styles.close}
        onClick={onClose}
        aria-label="Cerrar propiedades"
        title="Cerrar (Esc)"
      >
        ×
      </button>
      <div className={styles.body}>
        <ModelPropertyPanel data={data} />
      </div>
    </div>
  );
}
