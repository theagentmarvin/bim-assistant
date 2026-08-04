// src/components/SpecRail.tsx
//
// 44px vertical-text rail that replaces the spec PDF column when the
// cuantificación drawer is not in peek. Click → drawer collapses to
// peek, spec column expands.
//
// Stage 1 of the drawer redesign (see .claude/specs/task-drawer-redesign.md).

import styles from "./SpecRail.module.css";

interface Props {
  /** The spec file name — rendered vertically below the label. */
  fileName: string;
  /** Called when the user clicks the rail. Parent uses this to set
   *  the drawer to peek and flip the anti-intrusion flag. */
  onClick: () => void;
}

export default function SpecRail({ fileName, onClick }: Props) {
  return (
    <button
      type="button"
      className={styles.rail}
      onClick={onClick}
      aria-label="Expandir especificación técnica"
      title="Expandir especificación técnica"
    >
      <span className={styles.railChevron} aria-hidden="true">
        ‹
      </span>
      <span className={styles.railLabel}>
        <span className={styles.railLabelPrimary}>Especificación</span>
        <span className={styles.railLabelSecondary}>técnica</span>
      </span>
      <span className={styles.railFile}>{fileName}</span>
    </button>
  );
}
