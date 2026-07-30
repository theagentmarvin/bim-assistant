import { useEffect, useState } from "react";
import styles from "./AgentStatus.module.css";

export type AgentStatusState =
  | { kind: "idle" }
  | { kind: "indexing"; label: string; progress: number; total: number }
  | { kind: "ready"; chunks: number; embeddings: number }
  | { kind: "error"; message: string };

interface Props {
  status: AgentStatusState;
  onReindex?: () => void;
}

export default function AgentStatus({ status, onReindex }: Props) {
  const [, setNow] = useState(() => new Date());
  useEffect(() => {
    if (status.kind !== "ready") return;
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, [status.kind]);
  if (status.kind === "idle") {
    return (
      <div className={styles.bar} data-kind="idle" aria-live="polite">
        <span className={styles.dot} /> Inicializando…
      </div>
    );
  }
  if (status.kind === "indexing") {
    const pct = status.total > 0 ? Math.round((status.progress / status.total) * 100) : 0;
    return (
      <div className={styles.bar} data-kind="indexing" aria-live="polite">
        <span className={styles.dot} /> Indexando {status.label} · {status.progress}/{status.total}
        <span className={styles.progressTrack}>
          <span className={styles.progressFill} style={{ width: `${pct}%` }} />
        </span>
      </div>
    );
  }
  if (status.kind === "ready") {
    return (
      <div className={styles.bar} data-kind="ready" aria-live="polite">
        <span className={styles.dot} /> Listo · {status.chunks} fragmentos indexados
        {onReindex && (
          <button
            type="button"
            className={styles.reindexBtn}
            onClick={onReindex}
            title="Reindexar el corpus (limpia el caché y reconstruye)."
          >
            ⟳ Reindexar
          </button>
        )}
      </div>
    );
  }
  return (
    <div className={styles.bar} data-kind="error" aria-live="polite">
      <span className={styles.dot} /> Error: {status.message}
      {onReindex && (
        <button
          type="button"
          className={styles.reindexBtn}
          onClick={onReindex}
        >
          Reintentar
        </button>
      )}
    </div>
  );
}
