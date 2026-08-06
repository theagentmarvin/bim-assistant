// src/utils/exportChat.ts
//
// Boss 2026-08-05 (pilot feedback loop) — Session export utility.
// On the same day as the audit, Boss decided one button beats per-
// message share affordances. The tester clicks "↗ Exportar" once
// at the end of a session they want to flag, gets a .md file, and
// attaches it to the feedback WhatsApp/Telegram thread. The dev
// team has the full trajectory + a structured "Resumen para
// reportar" footer the tester fills in.
//
// The formatter is pure and synchronous so it can be exercised by
// a vitest fixture without touching the DOM. The download trigger
// is the only browser-specific path and it mirrors `downloadCSV` in
// src/utils/copy.ts (Blob + object-URL + transient anchor).

import type { ChatMessage } from "../components/ChatPanel";
import type { TurnRecord } from "../data/storage";
import { timestampForFilename } from "./copy";

// ----- Configuration: rules-engine footer stripping -----
//
// The `formatting-append-stats-footer` rule in question-rules.json
// appends "— Salfa BIM Agent 01 · SZA_BDE3_ARQ_C1 · IFC 2x3 · 291
// elementos" to every agent reply. A 30-turn session export would
// otherwise carry 30 identical footers. Strip them in the export
// formatter — the footer is correct in the live chat (scannability)
// but redundant in a markdown transcript.
const FOOTER_REGEX = /\n\n— Salfa BIM Agent 01 · [^\n]+$/;

function stripFooter(text: string | undefined): string | undefined {
  if (!text) return text;
  const stripped = text.replace(FOOTER_REGEX, "");
  return stripped !== text ? stripped.trimEnd() : text;
}

// ----- Section renderers -----

function roleTag(role: ChatMessage["role"]): string {
  switch (role) {
    case "user":
      return "👤 Usuario";
    case "agent":
      return "🤖 Agente";
    case "tool":
      return "🔧 Tool";
    case "error":
      return "⚠ Error";
  }
}

function roleEmoji(role: ChatMessage["role"]): string {
  switch (role) {
    case "user":
      return "👤";
    case "agent":
      return "🤖";
    case "tool":
      return "🔧";
    case "error":
      return "⚠";
  }
}

function formatToolArgs(
  name: string | undefined,
  args: Record<string, unknown> | undefined,
): string {
  if (!name || !args) return "";
  if (Object.keys(args).length === 0) return "(sin argumentos)";
  // Match the same arg-summarization used in ChatPanel.summarizeArgs
  // so the export reads identical to the chat UI.
  if (name === "consultar_base_de_conocimiento") {
    const f = (args.fuente as string) ?? "auto";
    const p = (args.pregunta as string) ?? "";
    return `args: fuente=${f} · pregunta="${p}"`;
  }
  if (name === "resaltar_elementos") {
    if (args.clase_ifc) return `args: clase_ifc=${args.clase_ifc}`;
    if (args.seccion_id) return `args: seccion_id=${args.seccion_id}`;
    if (args.reset) return "args: reset";
    return `args: ${JSON.stringify(args)}`;
  }
  if (name === "abrir_seccion_pdf") {
    if (args.seccion_id) return `args: seccion_id=${args.seccion_id}`;
    if (args.consulta) return `args: consulta="${args.consulta}"`;
    if (args.pagina) return `args: pagina=${args.pagina}`;
    return `args: ${JSON.stringify(args)}`;
  }
  return `args: ${JSON.stringify(args)}`;
}

function renderMessage(msg: ChatMessage): string {
  const out: string[] = [];

  if (msg.role === "tool") {
    const name = msg.toolName ?? "tool";
    out.push(`**${roleEmoji("tool")} ${name}**`);
    const argsLine = formatToolArgs(msg.toolName, msg.toolArgs);
    if (argsLine) out.push(`- ${argsLine}`);
    if (msg.toolResult) {
      const marker = msg.toolResult.ok ? "✅" : "❌";
      out.push(`- → ${marker} ${msg.toolResult.summary}`);
    }
  } else if (msg.role === "error") {
    out.push(`**${roleEmoji("error")} Error:**`);
    out.push("");
    out.push(`> ${msg.error ?? "(sin mensaje)"}`);
  } else if (msg.role === "user") {
    out.push(`**${roleTag("user")}:**`);
    out.push("");
    out.push(msg.text ?? "");
  } else {
    // agent
    out.push(`**${roleTag("agent")}:**`);
    out.push("");
    out.push(stripFooter(msg.text) ?? "");
  }
  return out.join("\n");
}

function renderTurn(turn: TurnRecord, ordinal: number): string {
  const out: string[] = [];
  const started = new Date(turn.created_at).toLocaleString();
  const dur =
    typeof turn.duration_ms === "number"
      ? ` · ${(turn.duration_ms / 1000).toFixed(1)}s`
      : "";
  out.push(`## Turno ${ordinal} · ${started}${dur}`);
  out.push("");
  for (const msg of turn.messages) {
    out.push(renderMessage(msg));
    out.push("");
  }
  return out.join("\n");
}

export interface SessionMeta {
  exportedAt: Date;
  tester: string | null;
  totalTurns: number;
  totalMessages: number;
}

function renderHeader(meta: SessionMeta): string {
  const out: string[] = [];
  out.push("# Salfa BIM Agent 01 — Sesión de chat");
  out.push("");
  out.push(`Exportado:  ${meta.exportedAt.toLocaleString()}`);
  out.push(`Tester:     ${meta.tester ?? "[rellenar]"}`);
  out.push(`Turnos:     ${meta.totalTurns}`);
  out.push(`Mensajes:   ${meta.totalMessages}`);
  out.push("");
  return out.join("\n");
}

function renderFooter(): string {
  const out: string[] = [];
  out.push("---");
  out.push("");
  out.push("## 📝 Resumen para reportar (rellenar en el hilo)");
  out.push("");
  out.push("**Qué funcionó bien:**");
  out.push("");
  out.push("> ");
  out.push("");
  out.push("**Qué salió mal o sorprendió:**");
  out.push("");
  out.push("> ");
  out.push("");
  out.push("**Sugerencias:**");
  out.push("");
  out.push("> ");
  out.push("");
  return out.join("\n");
}

/**
 * Build the markdown transcript of a session. Pure — does not
 * access the DOM, IndexedDB, or any global state. Sort the turns
 * by `turn_index` ascending so the export reads chronologically
 * regardless of completion order on the JS event loop.
 */
export function formatSessionMarkdown(
  turns: TurnRecord[],
  meta: SessionMeta,
): string {
  if (turns.length === 0) {
    return (
      "# Salfa BIM Agent 01 — Sesión de chat\n\n" +
      "Sesión vacía — no hay turnos para exportar.\n"
    );
  }

  const sorted = [...turns].sort((a, b) => a.turn_index - b.turn_index);
  const sections: string[] = [];
  sections.push(renderHeader(meta));
  sections.push("---");
  sections.push("");

  sorted.forEach((turn, i) => {
    sections.push(renderTurn(turn, i + 1));
    sections.push("---");
    sections.push("");
  });

  sections.push(renderFooter());
  return sections.join("\n");
}

/**
 * Trigger a markdown file download via Blob + object URL. Mirrors
 * `downloadCSV` in copy.ts — UTF-8 BOM so editors without auto-
 * encoding-detection (older Windows Notepad) keep Spanish accents,
 * transient anchor with `rel="noopener"` to avoid the
 * `browsertabs.opener` warning on Chromium-based browsers.
 */
export function downloadMarkdown(filename: string, content: string): boolean {
  if (typeof document === "undefined") return false;
  if (typeof URL === "undefined" || typeof Blob === "undefined") return false;
  try {
    const BOM = "﻿";
    const blob = new Blob([BOM, content], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Defer revoke so Chromium's download pipeline has a tick to
    // commit before the URL invalidates. Same race the CSV helper
    // works around.
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return true;
  } catch (err) {
    console.warn("[exportChat] downloadMarkdown failed:", err);
    return false;
  }
}

/**
 * Filename for a session export. Mirrors the Cuantificación tab's
 * `timestampForFilename` so files sort cleanly: salfa-bim-session-
 * 2026-08-05-2017.md.
 */
export function sessionFilename(d: Date = new Date()): string {
  return `salfa-bim-session-${timestampForFilename(d)}.md`;
}

/**
 * One-shot helper for the UI: format + download. Returns true if
 * the download fired; false if the environment lacks DOM/Blob
 * (e.g. server-side test runner). The caller (ChatPanel Export
 * button) should treat either return value as fire-and-forget —
 * there's nothing actionable to surface on a false.
 */
export function exportSession(
  turns: TurnRecord[],
  tester: string | null = null,
): boolean {
  const meta: SessionMeta = {
    exportedAt: new Date(),
    tester,
    totalTurns: turns.length,
    totalMessages: turns.reduce((sum, t) => sum + t.messages.length, 0),
  };
  const md = formatSessionMarkdown(turns, meta);
  return downloadMarkdown(sessionFilename(), md);
}
