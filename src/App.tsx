// src/App.tsx — bim-assistant PoC shell.
//
// Chat-first split-view (3 columns):
//   - Left rail: ChatPanel (primary surface)
//   - Center column: MappedSidebar + PdfViewer (or 44px SpecRail
//     when closed)
//   - Right column: ViewerPane + CuantificaciónDrawer
//
// Stage 1 (2026-08-05): MappedSidebar integrated from bim-specs-mapper.
// Agent-driven sidebar filtering + precise filter-expression viewer
// highlight wired in.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ViewerPane from "./components/ViewerPane";
import PdfViewer from "./components/PdfViewer";
import AgentStatus, { type AgentStatusState } from "./components/AgentStatus";
import ChatPanel, {
  type ChatMessage,
  summarizeToolResult,
} from "./components/ChatPanel";
import CuantificacionDrawer, { type DrawerState } from "./components/CuantificacionDrawer";
import PropertiesOverlay from "./components/PropertiesOverlay";
import SpecRail from "./components/SpecRail";
import MappedSidebar from "./components/MappedSidebar";
import { loadMappings } from "./data/mappings";
import {
  getContextualPrompts,
  loadPromptRegistry,
} from "./data/prompts";
import type { ElementClickData, ElementProperties } from "./viewer/Viewer3D";
import { runAgentLoop } from "./agent/loop";
import {
  buildTableContextPreamble,
  clearTablaRefinementCache,
} from "./agent/tools";
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

// Boss #14917 (follow-up): user-resizable spec column width.
// Persisted in localStorage. The default mirrors the prior minmax
// (420px). Min/max clamp prevents the user from squeezing the column
// to nothing or pushing the 3D viewer off-screen.
const PDF_SLOT_WIDTH_KEY = "bim-as…idth";
const PDF_SLOT_WIDTH_DEFAULT = 380;
const PDF_SLOT_WIDTH_MIN = 320;
const PDF_SLOT_WIDTH_MAX = 1000;

// Boss 2026-08-05 — drawer state is intentionally NOT persisted.
// The drawer always starts collapsed (peek) on every app load, so
// a fresh session opens with an unobtrusive handle and the spec
// column at full width. The agent's auto-expand effect on
// `latestTable` change (see below) is the only path that opens the
// drawer — a user who previously expanded it during testing
// shouldn't carry that state across reloads.
const SPEC_RAIL_WIDTH = 44;

export default function App() {
  const { mappings } = useMemo(() => loadMappings(), []);

  // Boss #14917 (follow-up): resize state for the spec column.
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
  const [agentMappingId, setAgentMappingId] = useState<string | null>(null);
  const [agentIfcClass, setAgentIfcClass] = useState<string | null>(MODEL_ID_DEFAULT_IFC_CLASS);
  const [agentFilter, setAgentFilter] = useState<Filter | null>(null);
  const [userSelectionFilter, setUserSelectionFilter] = useState<Filter | null>(null);
  const [resetTrigger, setResetTrigger] = useState(0);
  const [selectedElement, setSelectedElement] = useState<ElementProperties | null>(null);

  // ----- Spec column (PdfViewer | SpecRail) -----
  // The spec column shows the PdfViewer when the drawer is at peek
  // (full width = pdfSlotWidth), and the SpecRail otherwise (44px).
  // We previously kept a separate tab id; the new layout has the
  // spec as a sibling column and the table as a drawer — no tab.
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

  // ----- Drawer state -----
  // Binary toggle (closed | open). Initial state is open so the
  // cuantificación panel is visible on app load. The agent's auto-
  // expand effect below fires when latestTable changes.
  const [drawerState, setDrawerState] = useState<DrawerState>("closed");

  // Boss 2026-08-05 09:42 — spec column starts CLOSED. Independent
  // of drawerState: the user clicks the SpecRail to open the spec
  // column, and clicks the ‹ button in the PdfViewer header to
  // close it. Both panels now have a click-to-open pattern that
  // mirrors the cuantificación drawer's handle-click-to-expand.
  const [specOpen, setSpecOpen] = useState<boolean>(false);

  // Latest structured table from the agent. When this changes, the
  // auto-expand effect below drives the drawer.
  const [latestTable, setLatestTable] = useState<QuantificationTable | null>(null);

  // Boss 2026-07-30 17:48 — synchronize selection between the
  // cuantificación table and the 3D model.
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);

  // Anti-intrusion: while a turn is in flight (user message → agent
  // response), the user can manually collapse the drawer. If they
  // did, the agent's auto-expand must respect that and only push to
  // peek (with a badge pulse). The ref resets to false at the start
  // of each handleSend call.
  const userHasCollapsedThisTurnRef = useRef(false);
  const [pulseCounter, setPulseCounter] = useState(0);

  const handleUserCollapsed = useCallback(() => {
    userHasCollapsedThisTurnRef.current = true;
  }, []);

  // Boss 2026-08-05 14:45 — explicit "Limpiar tabla" button. The voice
  // agent doesn't understand the request; the only reliable way to
  // clear the table is a UI affordance. Resets the table, the row
  // selection, the user-driven viewer highlight, and the properties
  // overlay state. The agent-driven Hider (selectedIfcClass,
  // agentFilter, agentMappingId) is preserved so the chat context
  // stays intact.
  const handleClearTable = useCallback(() => {
    setLatestTable(null);
    // Boss 2026-08-05 (R2) — clear the refinement cache so the next
    // refinement call doesn't operate on stale rows from the
    // freshly-cleared table.
    clearTablaRefinementCache();
    setSelectedRowIndex(null);
    setUserSelectionFilter(null);
    setSelectedElement(null);
  }, []);

  // Auto-expand on a new latestTable. If the user collapsed during
  // the current turn, only push to closed with a badge pulse.
  useEffect(() => {
    if (!latestTable) return;
    if (userHasCollapsedThisTurnRef.current) {
      setDrawerState("closed");
      setPulseCounter((c) => c + 1);
    } else {
      setDrawerState("open");
    }
  }, [latestTable]);

  // Rail click → spec column opens. The cuantificación drawer is
  // untouched — both panels are now independent.
  const handleSpecOpen = useCallback(() => {
    setSpecOpen(true);
  }, []);

  const handleSpecCollapse = useCallback(() => {
    setSpecOpen(false);
  }, []);

  // Stage 1 Improvement 2 — build a combined filter from all of a
  // mapping's results. Union with OR so any result's filter can
  // match. Used by resaltar(seccion_id) + sidebar section click.
  const buildMappingFilter = useCallback((sectionId: string): Filter | null => {
    const m = mappings.find((mm) => mm.section_id === sectionId);
    if (!m || !m.results.length) return null;
    const filters = m.results.map((r) => r.filter).filter((f) => f.g.length > 0);
    if (filters.length === 0) return null;
    if (filters.length === 1) return filters[0];
    return { c: "OR", g: filters.flatMap((f) => f.g) };
  }, [mappings]);

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
      setAgentIfcClass(null);
      setAgentMappingId(args.seccion_id);
      // Stage 1 Improvement 2: use the mapping's full filter
      // instead of just ifc_class. Precise highlight — only
      // the elements the mapping actually targets.
      const combinedFilter = buildMappingFilter(args.seccion_id);
      if (combinedFilter) {
        setAgentFilter(combinedFilter);
      } else {
        setAgentFilter(null);
      }
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

  // ----- Row click in Cuantificación drawer → user selection highlight -----
  const handleRowSelect = useCallback((ids: number[]) => {
    if (ids.length === 0) return;
    const rowIndex = latestTable?.filas_express_ids?.findIndex(
      rowIds => rowIds.length === ids.length && rowIds.every(id => ids.includes(id)),
    ) ?? -1;
    setSelectedRowIndex(rowIndex !== -1 ? rowIndex : null);
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

    if (latestTable && rowIndex !== -1) {
      const row = latestTable.filas[rowIndex];
      const guid = (row?.element_id ?? row?.guid ?? row?.GlobalId) as string | undefined;
      const ifcClass = (row?.ifc_class ?? row?.["ifc_class"] ?? "") as string;
      const name = (row?.Nombre ?? row?.nombre ?? row?.name ?? row?.Name ?? "") as string;
      setSelectedElement({
        modelId: "sza-bde3-arq-c1",
        expressId: ids[0],
        guid,
        ifcClass,
        name,
        properties: {},
      });
    }
  }, [latestTable]);

  // ----- Send handler -----

  const handleSend = useCallback(async (text: string) => {
    // Reset the anti-intrusion flag at the start of every new turn.
    // The user is about to send a new message; the agent's auto-expand
    // for the upcoming response should trigger normally unless the user
    // collapses the drawer again during this turn.
    userHasCollapsedThisTurnRef.current = false;

    const userMsg: ChatMessage = { id: newMessageId(), role: "user", text };
    setMessages((m) => [...m, userMsg]);
    setBusy(true);
    const append = (msg: ChatMessage) => setMessages((m) => [...m, msg]);
    // Boss 2026-08-05 R1 — inject a table-state preamble so the agent
    // can answer follow-up questions without rebuilding the table
    // from scratch. Latest table + selected IFC class come from
    // App.tsx state; viewer match-count isn't surfaced yet so we
    // pass null (preamble degrades gracefully without it).
    const tableContext = buildTableContextPreamble(
      latestTable,
      agentIfcClass,
      null,
    );
    try {
      const finalText = await runAgentLoop(text, toolContext, {
        onToolCallStart: (name, args) => {
          append({ id: newMessageId(), role: "tool", toolName: name, toolArgs: args });
        },
        onToolCallEnd: (name, result) => {
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
          // Lift the structured `tabla` payload into the drawer state.
          // The auto-expand effect (driven by latestTable) handles the
          // drawer transition with anti-intrusion.
          if (result.ok && result.tool === "consultar_base_de_conocimiento") {
            const t = result.result.tabla;
            if (t) {
              setLatestTable(t);
            }
            // Stage 1 Improvement 1 — extract agent-driven sidebar filter.
            // When the agent sets filtrar_mapeos, the tool returns
            // tarjetas_visibles. Null/undefined → clear filter (show all).
            // Empty array → filter returned nothing (sidebar shows empty state).
            if (result.result.tarjetas_visibles !== undefined) {
              setSidebarFilterIds(
                result.result.tarjetas_visibles.length > 0
                  ? result.result.tarjetas_visibles
                  : null,
              );
              // Auto-expand spec column when agent filters cards.
              if (result.result.tarjetas_visibles.length > 0) {
                setSpecOpen(true);
                // Auto-isolate: apply the first matching section's
                // mapping filter to the 3D viewer so elements light
                // up immediately without a manual card click.
                const firstId = result.result.tarjetas_visibles[0];
                const combined = buildMappingFilter(firstId);
                if (combined) {
                  setAgentFilter(combined);
                  setAgentIfcClass(null);
                  setAgentMappingId(firstId);
                } else {
                  // Fallback: if the section has no filter expression,
                  // highlight by ifc_class instead.
                  setAgentFilter(null);
                  setAgentMappingId(firstId);
                  const m = mappings.find((mm) => mm.section_id === firstId);
                  if (m?.results?.[0]?.ifc_class) {
                    setAgentIfcClass(m.results[0].ifc_class);
                  }
                }
              }
            }
          }
        },
        onFinalAnswer: (text) => {
          append({ id: newMessageId(), role: "agent", text });
        },
        onError: (message) => {
          append({ id: newMessageId(), role: "error", error: message });
        },
      },
        undefined, // signal — chat path doesn't pass AbortSignal today
        tableContext ?? undefined,
      );
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
    setLatestTable(null);
    // Boss 2026-08-05 (R2) — clear the refinement cache so a full
    // reset doesn't leave stale rows in `lastTablaCache`.
    clearTablaRefinementCache();
    // Boss 2026-08-05 11:40 — reset to the default ("open"), matching
    // the initial state. Earlier this was "expanded"; with the
    // binary closed/open model the button now starts and resets to
    // the same state.
    setDrawerState("open");
    setSpecOpen(false);
    setSidebarFilterIds(null);
    userHasCollapsedThisTurnRef.current = false;
  }, []);

  // Boss 2026-08-05 R3 — contextual suggested prompts. Registry is
  // loaded once at module-init (Vite bundles the JSON statically,
  // HMR replays the loader on save). The actual prompt list
  // rebuilds whenever the table or selected class changes. Viewer
  // match count isn't surfaced yet → null (preamble and prompt list
  // both degrade gracefully without it).
  const promptRegistry = useMemo(() => loadPromptRegistry(), []);
  const contextualPrompts = useMemo(
    () =>
      getContextualPrompts(
        promptRegistry,
        latestTable,
        agentIfcClass,
        null,
      ),
    [promptRegistry, latestTable, agentIfcClass],
  );

  // ----- 3D element click -----
  const handleElementClick = useCallback((data: ElementClickData) => {
    if (!data.ifcClass) {
      setSelectedElement(null);
      setSelectedRowIndex(null);
      return;
    }
    if (latestTable?.filas_express_ids) {
      const rowIndex = latestTable.filas_express_ids.findIndex(
        ids => Array.isArray(ids) && ids.includes(data.expressID),
      );
      if (rowIndex !== -1) {
        setSelectedRowIndex(rowIndex);
        const rowIds = latestTable.filas_express_ids[rowIndex];
        const filter: Filter = {
          c: "AND",
          g: [
            {
              c: "OR",
              r: rowIds.map((id) => ({
                p: "express_id",
                op: "equals",
                v: String(id),
              })),
            },
          ],
        };
        setUserSelectionFilter(filter);
      } else {
        setSelectedRowIndex(null);
      }
    } else {
      setSelectedRowIndex(null);
    }
  }, [latestTable]);
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

  useEffect(() => {
    setSelectedRowIndex(null);
  }, [latestTable]);

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

  // Spec column width: pdfSlotWidth when specOpen, 44px otherwise.
  const specColumnWidthPx = specOpen ? pdfSlotWidth : SPEC_RAIL_WIDTH;

  // Stage 1 Improvement 1: agent-driven sidebar filtering.
  const [sidebarFilterIds, setSidebarFilterIds] = useState<string[] | null>(null);

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <img className={styles.logo} src="/salfa-logo.png" alt="Salfa" />
          <div>
            <div className={styles.title}>Salfa BIM Agent 01</div>
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
            contextualPrompts={contextualPrompts}
          />
        </aside>
        <section
          className={styles.specColumn}
          style={{ width: `${specColumnWidthPx}px` }}
          data-state={specOpen ? "open" : "closed"}
        >
          {specOpen ? (
            <>
              <div className={styles.specCompound}>
                <div className={styles.specPdfWrap}>
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
                    onCollapse={handleSpecCollapse}
                  />
                </div>
                <MappedSidebar
                  mappings={mappings}
                  selectedId={agentMappingId ?? pdfSectionId}
                  onSelect={(id) => {
                    setPdfSectionId(id);
                    const combined = buildMappingFilter(id);
                    if (combined) {
                      setAgentFilter(combined);
                      setAgentIfcClass(null);
                      setAgentMappingId(id);
                    } else {
                      setAgentFilter(null);
                      setAgentMappingId(id);
                      const m = mappings.find((mm) => mm.section_id === id);
                      if (m?.results?.[0]?.ifc_class) {
                        setAgentIfcClass(m.results[0].ifc_class);
                      }
                    }
                    const page = sectionIdToPageHeuristic(id);
                    setPdfPage(page);
                  }}
                  activeTab="mapped"
                  agentFilterIds={sidebarFilterIds}
                />
              </div>
              <div
                className={styles.splitter}
                onMouseDown={startPanelResize}
                role="separator"
                aria-label="Ajustar ancho del panel de especificación"
                aria-orientation="vertical"
                title="Arrastrar para ajustar ancho"
              />
            </>
          ) : (
            <SpecRail fileName="eett-c.pdf" onClick={handleSpecOpen} />
          )}
        </section>
        <section className={styles.viewerColumn}>
          <div className={styles.viewerArea}>
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
            <PropertiesOverlay
              data={selectedElement}
              onClose={() => setSelectedElement(null)}
            />
          </div>
          <CuantificacionDrawer
            data={latestTable}
            onRowSelect={handleRowSelect}
            selectedRowIndex={selectedRowIndex}
            state={drawerState}
            onStateChange={setDrawerState}
            onUserCollapse={handleUserCollapsed}
            pulseCounter={pulseCounter}
            onClear={handleClearTable}
          />
        </section>
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
