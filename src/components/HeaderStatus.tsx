// src/components/HeaderStatus.tsx
//
// Compact trigger + popover for the agent's indexation status.
// Replaces the previous standalone AgentStatus row that lived
// between the header and the body. The trigger sits in the
// header (title bar) as a small pill; clicking it opens a
// popover with the full status breakdown (incl. the Reindexar
// button). Click outside or Escape closes the popover.
//
// Architecture (Boss 2026-08-05 19:20 — "small change" #3):
// - Inline status text in the title bar — always visible, zero chrome.
// - Popover body reuses the existing AgentStatus component as-is
//   (the colored `.bar` styles work in both contexts).
// - `click` (not `mousedown`) for click-outside detection so the
//   trigger's own click handler doesn't race with the close check
//   (mousedown would close, then click would re-open — flicker).
//
// The AgentStatusState type is re-exported so existing call-sites
// keep importing it from "./AgentStatus" without churn. (App.tsx
// still pulls the type from there; HeaderStatus does the same.)

import { useEffect, useRef, useState } from "react";
import AgentStatus, { type AgentStatusState } from "./AgentStatus";
import styles from "./HeaderStatus.module.css";

export type { AgentStatusState };

interface Props {
  status: AgentStatusState;
  onReindex?: () => void;
}

// Compact trigger text — derived from the same state object that
// AgentStatus uses internally. Kept inline (not extracted to a
// shared helper) because the helper would be 5 lines and the
// dependency direction (HeaderStatus → AgentStatus) doesn't
// benefit from a circular indirection.
function getStatusText(status: AgentStatusState): string {
  if (status.kind === "idle") return "Inicializando…";
  if (status.kind === "indexing") {
    // Drop the phase label — it's not actionable in the trigger
    // pill (corpus progress is what the user wants at-a-glance).
    return `Indexando ${status.progress}/${status.total}`;
  }
  if (status.kind === "ready") return `Listo · ${status.chunks} fragmentos`;
  // Error — truncate to keep the trigger pill single-line.
  return `Error${status.message ? `: ${status.message.slice(0, 40)}` : ""}${status.message.length > 40 ? "…" : ""}`;
}

export default function HeaderStatus({ status, onReindex }: Props) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (popoverRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={styles.wrap}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        data-kind={status.kind}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Estado del agente (${getStatusText(status)})`}
      >
        <span className={styles.dot} aria-hidden="true" />
        <span className={styles.text}>{getStatusText(status)}</span>
      </button>
      {open && (
        <div ref={popoverRef} className={styles.popover} role="dialog" aria-label="Estado del agente">
          <div className={styles.popoverHeader}>Estado del agente</div>
          <AgentStatus status={status} onReindex={onReindex} />
        </div>
      )}
    </div>
  );
}