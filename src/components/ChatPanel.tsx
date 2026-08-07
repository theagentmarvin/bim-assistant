// src/components/ChatPanel.tsx
//
// Spanish-first chat surface. The primary interaction for the
// bim-assistant PoC. Handles message list, input box, tool-call
// status indicators, and a Reset button.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { TOOL_STATUS_LABELS } from "../agent/schema";
import styles from "./ChatPanel.module.css";

export type ChatRole = "user" | "agent" | "tool" | "error";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  /** Main text content (user / agent). */
  text?: string;
  /** Tool-call start indicator. */
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  /** Tool-call end indicator (status text after the tool ran). */
  toolResult?: { ok: boolean; summary: string };
  /** Error message (red). */
  error?: string;
}

interface Props {
  messages: ChatMessage[];
  busy: boolean;
  onSend: (text: string) => void;
  onReset: () => void;
  // Boss 2026-08-05 R3 — contextual suggested prompts. When the
  // chat is empty, the parent (App) passes a dynamic list sourced
  // from getContextualPrompts + the user-prompts registry. Empty
  // array (default) falls back to the static examples that shipped
  // before R3. Click flow unchanged — both forms are displayed, not
  // auto-submitted.
  contextualPrompts?: string[];
  // Boss 2026-08-05 (pilot feedback loop) — Export session as a
  // markdown file. The parent reads the IndexedDB agent-turns store
  // and triggers a browser download. We don't take the turns as a
  // prop because the chat UI doesn't own persistence — App does.
  // Disabled when `messages` is empty (no transcript to export).
  onExport?: () => void;
}

// Fallback suggested prompts shown when App hasn't supplied any.
// Kept verbatim so existing users see zero behavior change until the
// parent explicitly opts in via the contextualPrompts prop.
const DEFAULT_EXAMPLES: readonly string[] = [
  "¿Cuántos muros hay en el modelo?",
  "muéstrame los muros exteriores",
  "abre la sección sobre siding",
  "¿qué dice la especificación sobre el siding?",
];

export default function ChatPanel({
  messages,
  busy,
  onSend,
  onReset,
  contextualPrompts = [],
  onExport,
}: Props) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-scroll on new messages.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, busy]);

  const submit = useCallback(
    (e?: FormEvent) => {
      if (e) e.preventDefault();
      const trimmed = draft.trim();
      if (!trimmed || busy) return;
      onSend(trimmed);
      setDraft("");
    },
    [draft, busy, onSend],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    },
    [submit],
  );

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.headerTitle}>
          <img className={styles.brandLogo} src="/logo-bim-agent.png" alt="BIM Agent" />
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.exportBtn}
            onClick={onExport}
            disabled={!onExport || messages.length === 0 || busy}
            title="Descargar la conversación como archivo .md para reportar errores al equipo"
          >
            ↗ Exportar
          </button>
          <button
            type="button"
            className={styles.resetBtn}
            onClick={onReset}
            title="Limpiar chat, resaltado y navegación del PDF"
          >
            ⟳ Limpiar
          </button>
        </div>
      </div>
      <div className={styles.list} ref={listRef}>
        {(() => {
          if (messages.length > 0) return null;
          const list = contextualPrompts.length > 0 ? contextualPrompts : DEFAULT_EXAMPLES;
          return (
            <div className={styles.empty}>
              <div className={styles.emptyTitle}>Pregúntale a BIM Agent</div>
              <ul className={styles.examples}>
                {list.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          );
        })()}
        {messages.map((m) => (
          <MessageRow key={m.id} message={m} />
        ))}
        {busy && (
          <div className={styles.busyRow} aria-live="polite">
            <span className={styles.busyDots}>
              <span /> <span /> <span />
            </span>
            Pensando…
          </div>
        )}
      </div>
      <form className={styles.inputRow} onSubmit={submit}>
        <textarea
          ref={inputRef}
          className={styles.input}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Pregúntale a BIM Agent…"
          rows={3}
          disabled={busy}
          aria-label="Mensaje para BIM Agent"
        />
      </form>
    </div>
  );
}

function MessageRow({ message }: { message: ChatMessage }) {
  if (message.role === "tool") {
    return (
      <div className={styles.toolBubble} data-ok={message.toolResult?.ok ?? true}>
        <div className={styles.toolLabel}>
          🔧 {labelForTool(message.toolName)}
        </div>
        {message.toolArgs && Object.keys(message.toolArgs).length > 0 && (
          <div className={styles.toolArgs}>
            {summarizeArgs(message.toolName, message.toolArgs)}
          </div>
        )}
        {message.toolResult && (
          <div className={styles.toolResult}>{message.toolResult.summary}</div>
        )}
      </div>
    );
  }
  if (message.role === "error") {
    return (
      <div className={styles.errorBubble}>
        <span className={styles.errorIcon}>⚠</span>
        {message.error ?? "Error desconocido."}
      </div>
    );
  }
  const roleClass =
    message.role === "user" ? styles.userBubble : styles.agentBubble;
  return (
    <div className={`${styles.bubble} ${roleClass}`}>
      {message.role === "agent" && (
        <div className={styles.agentTag}>BIM Agent</div>
      )}
      <div className={styles.text}>{message.text}</div>
    </div>
  );
}

function labelForTool(name?: string): string {
  if (!name) return "Llamando herramienta…";
  return TOOL_STATUS_LABELS[name] ?? `Llamando ${name}…`;
}

function summarizeArgs(
  name: string | undefined,
  args: Record<string, unknown>,
): string {
  if (!name) return JSON.stringify(args);
  if (name === "consultar_base_de_conocimiento") {
    const f = (args.fuente as string) ?? "auto";
    const p = (args.pregunta as string) ?? "";
    return `fuente=${f} · pregunta="${p}"`;
  }
  if (name === "resaltar_elementos") {
    if (args.clase_ifc) return `clase_ifc=${args.clase_ifc}`;
    if (args.seccion_id) return `seccion_id=${args.seccion_id}`;
    if (args.reset) return "reset";
    return JSON.stringify(args);
  }
  if (name === "abrir_seccion_pdf") {
    if (args.seccion_id) return `seccion_id=${args.seccion_id}`;
    if (args.consulta) return `consulta="${args.consulta}"`;
    if (args.pagina) return `pagina=${args.pagina}`;
    return JSON.stringify(args);
  }
  return JSON.stringify(args);
}

export function summarizeToolResult(
  name: string | undefined,
  result: unknown,
): string {
  if (!name) return "…";
  if (name === "consultar_base_de_conocimiento") {
    const r = result as { citas?: Array<{ fuente: string; id: string }> };
    const n = r.citas?.length ?? 0;
    return `${n} fragmento${n === 1 ? "" : "s"} relevante${n === 1 ? "" : "s"}`;
  }
  if (name === "resaltar_elementos") {
    const r = result as { matching?: number; total?: number; accion?: string };
    if (r.accion === "limpiado" || r.accion === "reset") return "Visor limpiado";
    return `${r.matching ?? 0} elementos resaltados de ${r.total ?? 0}`;
  }
  if (name === "abrir_seccion_pdf") {
    const r = result as { pagina?: number };
    return `Página ${r.pagina ?? "?"}`;
  }
  return "ok";
}
