// src/App.tsx — bim-assistant PoC shell.
//
// Chat-first split-view:
//   - Left rail: ChatPanel (primary surface)
//   - Center column: 3D viewer + PDF below
//   - Right rail: properties panel
//
// The chat panel drives Viewer3D and PdfViewer via the agent loop's
// tool callbacks.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ViewerPane from "./components/ViewerPane";
import PdfViewer from "./components/PdfViewer";
import AgentStatus, { type AgentStatusState } from "./components/AgentStatus";
import ChatPanel, {
  type ChatMessage,
  summarizeToolResult,
} from "./components/ChatPanel";
import ModelPropertyPanel from "./components/ModelPropertyPanel";
import { loadMappings } from "./data/mappings";
import type { ElementClickData, ElementProperties } from "./viewer/Viewer3D";
import { runAgentLoop } from "./agent/loop";
import {
  indexAll,
  forceReindex,
  type IndexProgressCallback,
} from "./agent/indexer";
import type {
  ToolContext,
  ResaltarCallback,
  AbrirPdfCallback,
} from "./agent/tools";
import styles from "./App.module.css";

const MODEL_ID_DEFAULT_IFC_CLASS: string | null = null;

export default function App() {
  const { mappings } = useMemo(() => loadMappings(), []);

  // ----- 3D viewer state -----
  // We expose Viewer3D's filter/IFC class via the ViewerPane's
  // `mapping`/`selectedIfcClass` props. The chat-driven tool result
  // produces an "agentMapping" / "agentIfcClass" pair that's
  // independent of the manual TabbedPanel selection — for PoC, the
  // chat takes priority.
  const [agentMappingId, setAgentMappingId] = useState<string | null>(null);
  const [agentIfcClass, setAgentIfcClass] = useState<string | null>(MODEL_ID_DEFAULT_IFC_CLASS);
  const [resetTrigger, setResetTrigger] = useState(0);
  const [selectedElement, setSelectedElement] = useState<ElementProperties | null>(null);

  // ----- PDF viewer state -----
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfSectionId, setPdfSectionId] = useState<string | null>(null);

  // ----- Chat state -----
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const messageIdCounterRef = useRef(0);
  const newMessageId = useCallback(() => {
    messageIdCounterRef.current += 1;
    return `m-${messageIdCounterRef.current}`;
  }, []);

  // ----- Agent status (indexer) -----
  const [agentStatus, setAgentStatus] = useState<AgentStatusState>({ kind: "idle" });
  const indexerStartedRef = useRef(false);

  // ----- Lookups -----
  const agentMapping = useMemo(
    () => mappings.find((m) => m.section_id === agentMappingId) ?? null,
    [mappings, agentMappingId],
  );

  // ----- Tool callbacks (resaltar / abrir pdf) -----

  const resaltar: ResaltarCallback = useCallback((args) => {
    if (args.reset) {
      setAgentIfcClass(null);
      setAgentMappingId(null);
      setResetTrigger((k) => k + 1);
      return {
        matching: 0,
        total: 0,
        ids: [],
        accion: "reset",
        criterio: "reset",
      };
    }
    if (args.seccion_id) {
      setAgentIfcClass(null);
      setAgentMappingId(args.seccion_id);
      const m = mappings.find((mm) => mm.section_id === args.seccion_id);
      const top = m?.results?.[0];
      const criterio = `sección ${args.seccion_id}` + (top ? ` → ${top.ifc_class}` : "");
      return {
        matching: 0, // computed by Viewer3D after isolation runs
        total: 0,
        ids: [],
        accion: "resaltado",
        criterio,
      };
    }
    if (args.clase_ifc) {
      setAgentMappingId(null);
      setAgentIfcClass(args.clase_ifc);
      return {
        matching: 0,
        total: 0,
        ids: [],
        accion: "resaltado",
        criterio: `clase IFC ${args.clase_ifc}`,
      };
    }
    // filtro object — best-effort: extract the IFC class hint if any.
    const filterClass = (args.filtro as { _ifcClass?: string } | undefined)?._ifcClass ?? null;
    if (filterClass) {
      setAgentMappingId(null);
      setAgentIfcClass(filterClass);
      return {
        matching: 0,
        total: 0,
        ids: [],
        accion: "resaltado",
        criterio: `filtro (${filterClass})`,
      };
    }
    return {
      matching: 0,
      total: 0,
      ids: [],
      accion: "limpiado",
      criterio: "sin criterio",
    };
  }, [mappings]);

  const abrirPdf: AbrirPdfCallback = useCallback(async (args) => {
    if (typeof args.pagina === "number" && args.pagina > 0) {
      setPdfPage(args.pagina);
      setPdfSectionId(null);
      return { pagina: args.pagina, titulo: "", snippet: "", fuente: "pagina directa" };
    }
    if (args.seccion_id) {
      const page = sectionIdToPageHeuristic(args.seccion_id);
      setPdfPage(page);
      setPdfSectionId(args.seccion_id);
      return { pagina: page, titulo: args.seccion_id, snippet: "", fuente: "seccion_id" };
    }
    if (args.consulta) {
      // Best-effort: search the spec chunks in IndexedDB for a page match.
      try {
        const { retrieveSnippets } = await import("./agent/retriever");
        const { hits } = await retrieveSnippets(args.consulta, 1, "especificacion");
        const first = hits[0];
        const page = (first?.chunk.metadata?.page as number | undefined) ?? 1;
        setPdfPage(page);
        setPdfSectionId(null);
        return {
          pagina: page,
          titulo: "",
          snippet: first?.chunk.text.slice(0, 200) ?? "",
          fuente: "consulta",
        };
      } catch {
        setPdfPage(1);
        return { pagina: 1, titulo: "", snippet: "", fuente: "consulta (sin resultados)" };
      }
    }
    setPdfPage(1);
    return { pagina: 1, titulo: "", snippet: "", fuente: "default" };
  }, []);

  const toolContext: ToolContext = useMemo(
    () => ({ resaltar, abrirPdf }),
    [resaltar, abrirPdf],
  );

  // ----- Send handler -----

  const handleSend = useCallback(async (text: string) => {
    const userMsg: ChatMessage = { id: newMessageId(), role: "user", text };
    setMessages((m) => [...m, userMsg]);
    setBusy(true);
    const append = (msg: ChatMessage) =>
      setMessages((m) => [...m, msg]);
    try {
      const finalText = await runAgentLoop(text, toolContext, {
        onToolCallStart: (name, args) => {
          append({
            id: newMessageId(),
            role: "tool",
            toolName: name,
            toolArgs: args,
          });
        },
        onToolCallEnd: (name, result) => {
          // Patch the last "tool start" bubble with the result summary.
          setMessages((m) => {
            const idx = [...m].reverse().findIndex(
              (mm) => mm.role === "tool" && mm.toolName === name && !mm.toolResult,
            );
            if (idx === -1) return m;
            const realIdx = m.length - 1 - idx;
            const copy = [...m];
            const target = copy[realIdx];
            const summary = result.ok
              ? summarizeToolResult(name, result.result)
              : `Error: ${result.error}`;
            copy[realIdx] = { ...target, toolResult: { ok: result.ok, summary } };
            return copy;
          });
        },
        onFinalAnswer: (text) => {
          append({ id: newMessageId(), role: "agent", text });
        },
        onError: (message) => {
          append({ id: newMessageId(), role: "error", error: message });
        },
      });
      // If the agent didn't emit an onFinalAnswer (rare), make sure
      // the answer is on screen.
      setMessages((m) => {
        const last = m[m.length - 1];
        if (last?.role === "agent" && last.text === finalText) return m;
        return [...m, { id: newMessageId(), role: "agent", text: finalText }];
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setMessages((m) => [
        ...m,
        { id: newMessageId(), role: "error", error: message },
      ]);
    } finally {
      setBusy(false);
    }
  }, [toolContext, newMessageId]);

  const handleReset = useCallback(() => {
    setMessages([]);
    setAgentIfcClass(null);
    setAgentMappingId(null);
    setResetTrigger((k) => k + 1);
    setSelectedElement(null);
    setPdfPage(1);
    setPdfSectionId(null);
  }, []);

  // ----- 3D element click -----
  const handleElementClick = useCallback((data: ElementClickData) => {
    if (!data.ifcClass) {
      setSelectedElement(null);
    }
  }, []);
  const handleElementData = useCallback((data: ElementProperties) => {
    setSelectedElement(data);
  }, []);

  // ----- Indexer boot -----
  useEffect(() => {
    if (indexerStartedRef.current) return;
    indexerStartedRef.current = true;
    const onProgress: IndexProgressCallback = (e) => {
      if (e.phase === "start") {
        setAgentStatus({ kind: "indexing", label: "arrancando", progress: 0, total: e.total });
      } else if (e.phase === "corpus") {
        setAgentStatus({
          kind: "indexing",
          label: e.label,
          progress: e.index,
          total: e.total,
        });
      } else if (e.phase === "done") {
        setAgentStatus({ kind: "ready", chunks: e.chunks, embeddings: e.embeddings });
      } else if (e.phase === "error") {
        setAgentStatus({ kind: "error", message: e.message });
      }
    };
    indexAll(onProgress).catch(() => {
      // Error already surfaced via onProgress.
    });
  }, []);

  const handleReindex = useCallback(() => {
    forceReindex((e) => {
      if (e.phase === "start") {
        setAgentStatus({ kind: "indexing", label: "reindexando", progress: 0, total: e.total });
      } else if (e.phase === "corpus") {
        setAgentStatus({
          kind: "indexing",
          label: e.label,
          progress: e.index,
          total: e.total,
        });
      } else if (e.phase === "done") {
        setAgentStatus({ kind: "ready", chunks: e.chunks, embeddings: e.embeddings });
      } else if (e.phase === "error") {
        setAgentStatus({ kind: "error", message: e.message });
      }
    }).catch(() => {});
  }, []);

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <img className={styles.logo} src="/salfa-logo.png" alt="Salfa" />
          <div>
            <div className={styles.title}>JARVIS BIM</div>
            <div className={styles.subtitle}>Asistente IFC + Especificaciones · PoC</div>
          </div>
        </div>
        <div className={styles.headerRight}>
          <span className={styles.metaPill}>{mappings.length} secciones</span>
        </div>
      </header>
      <AgentStatus
        status={agentStatus}
        onReindex={
          agentStatus.kind === "ready" || agentStatus.kind === "error"
            ? handleReindex
            : undefined
        }
      />
      <main className={styles.body}>
        <aside className={styles.left}>
          <ChatPanel
            messages={messages}
            busy={busy}
            onSend={handleSend}
            onReset={handleReset}
          />
        </aside>
        <section className={styles.pdfSlot}>
          <PdfViewer
            pdfUrl="/eett-c.pdf"
            currentPage={pdfPage}
            onPageChange={setPdfPage}
            onClickSection={(id) => {
              setPdfSectionId(id);
              const page = sectionIdToPageHeuristic(id);
              setPdfPage(page);
            }}
            selectedSectionId={pdfSectionId}
          />
        </section>
        <section className={styles.center}>
          <ViewerPane
            mapping={agentMapping}
            selectedIfcClass={agentIfcClass}
            onElementClick={handleElementClick}
            onElementData={handleElementData}
            resetTrigger={resetTrigger}
            onResetViewer={() => {
              setAgentMappingId(null);
              setAgentIfcClass(null);
              setSelectedElement(null);
              setResetTrigger((k) => k + 1);
            }}
          />
        </section>
        <aside className={styles.right}>
          <ModelPropertyPanel data={selectedElement} />
        </aside>
      </main>
    </div>
  );
}

// Local copy of the sectionId → page heuristic. Mirrors the
// mapper's TabbedPanel.sectionIdToPage so we don't have to drag
// in the full TabbedPanel just for that helper.
function sectionIdToPageHeuristic(sectionId: string): number {
  const table: Record<string, number> = {
    C1: 1, C2: 1, C3: 2, C4: 2, C5: 2, C6: 3,
    C7: 4, C8: 4, C9: 5, C10: 6, C11: 6, C12: 6, CEXTRAS: 7,
  };
  const m = sectionId.match(/^C\.(\d+)/i);
  if (m) {
    const key = `C${m[1]}`;
    return table[key] ?? 1;
  }
  if (/^c\.?extras/i.test(sectionId)) return table.CEXTRAS;
  return 1;
}
