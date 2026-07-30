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
import RightPaneTabs, { type RightPaneTabId } from "./components/RightPaneTabs";
import QuantificationPanel from "./components/QuantificationPanel";
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
import { countByClass } from "./agent/tools";
import type { QuantificationTable } from "./quantification/types";
import type { Filter } from "./types";
import styles from "./App.module.css";

const MODEL_ID_DEFAULT_IFC_CLASS: string | null = null;

// Boss #14917 (follow-up): user-resizable cuantificación panel width.
// Persisted in localStorage. The default mirrors the prior minmax
// (420px). Min/max clamp prevents the user from squeezing the panel
// to nothing or pushing the 3D viewer off-screen.
const PDF_SLOT_WIDTH_KEY = "bim-assistant:pdf-slot-width";
const PDF_SLOT_WIDTH_DEFAULT = 420;
const PDF_SLOT_WIDTH_MIN = 280;
const PDF_SLOT_WIDTH_MAX = 1000;

export default function App() {
  const { mappings } = useMemo(() => loadMappings(), []);

  // Boss #14917 (follow-up): resize state for the cuantificación
  // panel (column #2). Persists across reloads.
  const [pdfSlotWidth, setPdfSlotWidth] = useState<number>(() => {
    try {
      const raw = window.localStorage.getItem(PDF_SLOT_WIDTH_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (
          typeof parsed === "number" &&
          parsed >= PDF_SLOT_WIDTH_MIN &&
          parsed <= PDF_SLOT_WIDTH_MAX
        ) {
          return parsed;
        }
      }
    } catch {
      // ignore
    }
    return PDF_SLOT_WIDTH_DEFAULT;
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(PDF_SLOT_WIDTH_KEY, JSON.stringify(pdfSlotWidth));
    } catch {
      // ignore
    }
  }, [pdfSlotWidth]);

  const startPanelResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = pdfSlotWidth;

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      setPdfSlotWidth(
        Math.max(
          PDF_SLOT_WIDTH_MIN,
          Math.min(PDF_SLOT_WIDTH_MAX, startWidth + delta),
        ),
      );
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [pdfSlotWidth]);

  // ----- 3D viewer state -----
  // We expose Viewer3D's filter/IFC class via the ViewerPane's
  // `mapping`/`selectedIfcClass` props. The chat-driven tool result
  // produces an "agentMapping" / "agentIfcClass" pair that's
  // independent of the manual TabbedPanel selection — for PoC, the
  // chat takes priority.
  const [agentMappingId, setAgentMappingId] = useState<string | null>(null);
  const [agentIfcClass, setAgentIfcClass] = useState<string | null>(MODEL_ID_DEFAULT_IFC_CLASS);
  // Chat-driven Filter (Navisworks-style) — takes precedence over
  // mapping. Set by the agent when it calls
  // `resaltar_elementos({ filtro })`; cleared by reset / clase_ifc /
  // seccion_id so the viewer doesn't carry stale filter state across
  // calls. (RAG-for-IFC interaction step 1.)
  const [agentFilter, setAgentFilter] = useState<Filter | null>(null);
  // User-driven Filter (Navisworks-style) — set when the user clicks
  // a row in the cuantificación table. Drives the Highlighter 'filter'
  // style (yellow tint) in the viewer, NOT the Hider. The agent
  // filter isolates (Hider); the user selection highlights
  // (Highlighter). Both can coexist — e.g., agent says "show me
  // muros" (Hider hides 4295 down to 187) and the user clicks a row
  // (Highlighter yellows the 7 in that row, visible inside the
  // Hider-filtered set). Boss clarification 2026-07-30 17:26.
  const [userSelectionFilter, setUserSelectionFilter] = useState<Filter | null>(null);
  const [resetTrigger, setResetTrigger] = useState(0);
  const [selectedElement, setSelectedElement] = useState<ElementProperties | null>(null);
  // ----- Right pane (Spec PDF | Cuantificación) -----
  // Active tab id. Auto-switches to "cuantificacion" when the agent
  // returns a `tabla`; sticky after (user can flip back manually).
  const [rightPaneTab, setRightPaneTab] = useState<RightPaneTabId>("pdf");
  // Latest structured table from the agent. Renders inside the
  // Cuantificación tab. Replaced on each new arrival.
  const [latestTable, setLatestTable] = useState<QuantificationTable | null>(null);

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
      setAgentFilter(null);
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
      setAgentFilter(null);
      setAgentIfcClass(null);
      setAgentMappingId(args.seccion_id);
      const m = mappings.find((mm) => mm.section_id === args.seccion_id);
      const top = m?.results?.[0];
      const criterio = `sección ${args.seccion_id}` + (top ? ` → ${top.ifc_class}` : "");
      const matching = top?.ifc_class ? countByClass(top.ifc_class) : 0;
      return {
        matching,
        total: matching,
        ids: [],
        accion: "resaltado",
        criterio,
      };
    }
    if (args.clase_ifc) {
      setAgentFilter(null);
      setAgentMappingId(null);
      setAgentIfcClass(args.clase_ifc);
      const matching = countByClass(args.clase_ifc);
      return {
        matching,
        total: matching,
        ids: [],
        accion: "resaltado",
        criterio: `clase IFC ${args.clase_ifc}`,
      };
    }
    // filtro (Navisworks-style) — plumbed through to Viewer3D via
    // agentFilter. The viewer evaluates against fragment items and
    // exposes the actual matching count via the existing isolation
    // effect; this return value is best-effort because the agent
    // doesn't have access to the live item array.
    if (args.filtro) {
      setAgentMappingId(null);
      setAgentIfcClass(null);
      setAgentFilter(args.filtro);
      return {
        matching: 0,
        total: 0,
        ids: [],
        accion: "resaltado",
        criterio: "filtro del agente",
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

  // ----- Row click in Cuantificación tab → user selection highlight -----
  // When the user clicks a row in the quantification table, build a
  // Filter that matches the row's express_ids and route it through
  // userSelectionFilter (NOT agentFilter). The userSelectionFilter
  // drives the Highlighter 'filter' style (yellow tint) in the
  // viewer, while the agentFilter drives the Hider (isolation). For
  // grouping rows this fans out to every element in the bucket.
  // Boss clarification 2026-07-30 17:26: the highlight is for user
  // clicks only; the agent filter still isolates.
  const handleRowSelect = useCallback((ids: number[]) => {
    if (ids.length === 0) return;
    const filter: Filter = {
      c: "AND",
      g: [
        {
          c: "OR",
          r: ids.map((id) => ({
            p: "express_id",
            op: "equals",
            v: String(id),
          })),
        },
      ],
    };
    setUserSelectionFilter(filter);
  }, []);

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
          // Lift the structured `tabla` payload into the right-pane
          // state and auto-switch the active tab. The chat bubble
          // already shows the prose summary; the table is the
          // canonical view.
          if (result.ok && result.tool === "consultar_base_de_conocimiento") {
            const t = result.result.tabla;
            if (t) {
              setLatestTable(t);
              setRightPaneTab("cuantificacion");
            }
          }
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
    setAgentFilter(null);
    setUserSelectionFilter(null);
    setResetTrigger((k) => k + 1);
    setSelectedElement(null);
    setPdfPage(1);
    setPdfSectionId(null);
    // Clear the Cuantificación tab so the next query starts fresh.
    setLatestTable(null);
    setRightPaneTab("pdf");
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
      <main
        className={styles.body}
        style={{
          // Boss #14917 (follow-up): inline grid-template-columns
          // so the cuantificacion panel width is user-controlled. The
          // other three columns keep their minmax cap from the CSS.
          gridTemplateColumns: `minmax(300px, 340px) ${pdfSlotWidth}px minmax(420px, 1fr) minmax(260px, 320px)`,
        }}
      >
        <aside className={styles.left}>
          <ChatPanel
            messages={messages}
            busy={busy}
            onSend={handleSend}
            onReset={handleReset}
          />
        </aside>
        <section className={styles.pdfSlot}>
          <RightPaneTabs
            tab={rightPaneTab}
            onTabChange={setRightPaneTab}
            pdf={
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
            }
            cuantificacion={
              <QuantificationPanel
                data={latestTable}
                onRowSelect={handleRowSelect}
              />
            }
          />
          <div
            className={styles.splitter}
            onMouseDown={startPanelResize}
            role="separator"
            aria-label="Ajustar ancho del panel de cuantificación"
            aria-orientation="vertical"
            title="Arrastrar para ajustar ancho"
          />
        </section>
        <section className={styles.center}>
          <ViewerPane
            mapping={agentMapping}
            selectedIfcClass={agentIfcClass}
            agentFilter={agentFilter}
            userSelectionFilter={userSelectionFilter}
            onElementClick={handleElementClick}
            onElementData={handleElementData}
            resetTrigger={resetTrigger}
            onResetViewer={() => {
              setAgentMappingId(null);
              setAgentIfcClass(null);
              setAgentFilter(null);
              setUserSelectionFilter(null);
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
