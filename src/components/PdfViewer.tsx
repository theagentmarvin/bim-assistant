import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import styles from "./PdfViewer.module.css";

// Configure the PDF.js worker once at module load. The CDN URL (with
// `cdnjs.cloudflare.com` and the explicit `.min.mjs` extension) is the
// shipped-worker path that matches the locally installed `pdfjs-dist`
// version (4.0.379). v4.x ships ESM-only; do not use the legacy
// `pdf.worker.js` URL.
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs";

interface Props {
  /**
   * URL of the PDF to load. Resolved relative to the Vite public
   * directory (e.g. `/eett-c.pdf`).
   */
  pdfUrl: string;
  /**
   * Optional 1-indexed page to display. If provided, the viewer
   * becomes controlled and the parent owns the page state. If
   * omitted, the viewer uses internal state and reports changes
   * via `onPageChange`.
   */
  currentPage?: number;
  /**
   * Called whenever the user navigates to a new page via the
   * toolbar. Always fires, even when the viewer is controlled —
   * parent can use it to mirror state if it wants to.
   */
  onPageChange?: (page: number) => void;
  /**
   * Called when the user clicks a text-layer span whose content
   * looks like a Chilean spec section id (e.g. `C.1`, `C.1.1.5`).
   * The viewer extracts the id, normalizes it to canonical form
   * (`C.<digits>(.<digits>)*`), and hands it to this callback so
   * the parent can wire the click into selection / 3D highlight.
   */
  onClickSection?: (sectionId: string) => void;
  /** Selected mapped section to highlight in the text layer. */
  selectedSectionId?: string | null;
}

// Fit-to-width: how much of the container width the canvas should
// occupy. We subtract some padding to leave a small gutter on each
// side of the rendered page.
const PAGE_PADDING = 16;

// Clamp the device-pixel-ratio multiplier so huge hi-dpi screens
// don't create absurd backing-store sizes.
const MAX_DPR = 2;

export default function PdfViewer({ pdfUrl, currentPage, onPageChange, onClickSection, selectedSectionId }: Props) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [internalPage, setInternalPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState(1);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Text layer DOM node. PDF.js appends absolutely-positioned <span>
  // children here, one per text run, so users can select / search the
  // text that the canvas renders.
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  // Tracks the in-flight PDF.js text-layer task so we can cancel it
  // when the page changes (mirrors how we handle the canvas render).
  const textLayerTaskRef = useRef<pdfjsLib.TextLayerRenderTask | null>(null);
  // Tracks the AbortController for the text-layer click listener so
  // we can detach it when the page re-renders or the component
  // unmounts. Using AbortController keeps the effect-side cleanup
  // symmetric and avoids stale-closure issues if `onClickSection`
  // changes between renders.
  const clickControllerRef = useRef<AbortController | null>(null);
  // Tracks component unmount so we can ignore late-arriving async
  // work (PDF.js worker callbacks) that would otherwise setState on
  // an unmounted component.
  const disposedRef = useRef(false);
  const highlightRef = useRef<HTMLDivElement | null>(null);
  const selectedSectionRef = useRef<string | null>(selectedSectionId ?? null);

  const isControlled = currentPage !== undefined;
  const page = isControlled ? currentPage : internalPage;

  const updateSectionHighlight = () => {
    const layer = textLayerRef.current;
    const band = highlightRef.current;
    if (!layer || !band) return;

    const selected = selectedSectionRef.current;
    if (!selected) {
      band.style.display = "none";
      return;
    }

    const normalizeSection = (value: string): string | null => {
      const compact = value.trim().replace(/\s+/g, "");
      const match = compact.match(/^C\.?\d+(?:\.\d+)*$/i);
      if (!match) return null;
      let id = match[0].toUpperCase();
      if (!id.startsWith("C.")) id = id.replace(/^C(\d)/, "C.$1");
      return id;
    };

    const spans = Array.from(layer.querySelectorAll("span"))
      .map((span) => ({
        span,
        text: span.textContent?.trim() ?? "",
        section: normalizeSection(span.textContent ?? ""),
      }))
      .filter((entry) => entry.text !== "");

    const selectedUpper = selected.toUpperCase();
    const startIndex = spans.findIndex(({ section }) => {
      if (!section) return false;
      if (section === selectedUpper) return true;
      if (!section.startsWith(selectedUpper)) return false;
      const next = section.charAt(selectedUpper.length);
      return next !== "" && !/[.\d]/.test(next);
    });

    // ---- Fallback: PDF text is often split across many tiny spans.
    // "C.1.3.3" may land as ["C", ".", "1", ".", "3", ".", "3"] in
    // separate DOM elements, so no single span matches. Group spans
    // into text lines by Y-coordinate and search each line.
    let highlightLineSpans: { span: Element; text: string }[] | null = null;
    if (startIndex === -1) {
      const tolerance = 3; // px — spans within 3px are same line
      const lines: { y: number; spans: typeof spans }[] = [];
      for (const entry of spans) {
        const rect = entry.span.getBoundingClientRect();
        let placed = false;
        for (const line of lines) {
          if (Math.abs(rect.top - line.y) < tolerance) {
            line.spans.push(entry);
            placed = true;
            break;
          }
        }
        if (!placed) lines.push({ y: rect.top, spans: [entry] });
      }
      for (const line of lines) {
        const lineText = line.spans.map((s) => s.text).join("");
        const idx = lineText.toUpperCase().indexOf(selectedUpper);
        if (idx !== -1) {
          highlightLineSpans = line.spans;
          break;
        }
      }
    }

    if (startIndex === -1 && !highlightLineSpans) {
      band.style.display = "none";
      return;
    }

    let endIndex = -1;
    if (!highlightLineSpans && startIndex !== -1) {
      for (let i = startIndex + 1; i < spans.length; i += 1) {
        const section = spans[i].section;
        if (section && section !== selectedUpper) {
          endIndex = i;
          break;
        }
      }
    }

    const layerRect = layer.getBoundingClientRect();
    let startRect: DOMRect;
    let endRect: DOMRect | null;

    if (highlightLineSpans) {
      startRect = highlightLineSpans[0].span.getBoundingClientRect();
      const last = highlightLineSpans[highlightLineSpans.length - 1];
      endRect = highlightLineSpans.length > 1 ? last.span.getBoundingClientRect() : null;
    } else {
      startRect = spans[startIndex].span.getBoundingClientRect();
      endRect = endIndex >= 0 ? spans[endIndex].span.getBoundingClientRect() : null;
    }

    const top = Math.max(0, startRect.top - layerRect.top - 4);
    const bottom = endRect
      ? Math.max(top + 20, endRect.top - layerRect.top - 2)
      : layerRect.height;
    const height = Math.max(24, bottom - top);

    band.style.display = "block";
    band.style.top = `${top}px`;
    band.style.height = `${height}px`;
    band.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  useEffect(() => {
    selectedSectionRef.current = selectedSectionId ?? null;
    // The text-layer render callback also calls updateSectionHighlight,
    // but spans may not be laid out yet. A requestAnimationFrame retry
    // catches late-arriving layout so the box always appears — even after
    // rapid page jumps from 3D element clicks.
    const handle = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        updateSectionHighlight();
      });
    });
    return () => cancelAnimationFrame(handle);
  }, [selectedSectionId]);

  // ----- Find the real page for the selected section -----
  // The old chapter→page heuristic is only a first guess. Once the document
  // is loaded, search its text content and correct the page if the selected
  // section actually lives somewhere else (e.g. C.9.2.1 on page 4, not 5).
  useEffect(() => {
    if (!doc || !selectedSectionId) return;
    let cancelled = false;
    const target = selectedSectionId.toUpperCase().replace(/\s+/g, "");
    const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const targetPattern = new RegExp(`${escaped}(?![.\\d])`, "i");

    (async () => {
      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
        if (cancelled) return;
        const pageProxy = await doc.getPage(pageNumber);
        try {
          const textContent = await pageProxy.getTextContent();
          const pageText = textContent.items
            .map((item) => "str" in item ? String(item.str ?? "") : "")
            .join(" ")
            .replace(/\s+/g, "");
          if (targetPattern.test(pageText)) {
            if (!cancelled && pageNumber !== page) {
              onPageChange?.(pageNumber);
            }
            return;
          }
        } finally {
          try { pageProxy.cleanup(); } catch { /* ignore */ }
        }
      }
    })().catch((err) => {
      console.warn("[PdfViewer] section page search failed:", err);
    });

    return () => { cancelled = true; };
  }, [doc, selectedSectionId]);

  // ----- Load PDF on mount / URL change -----
  useEffect(() => {
    disposedRef.current = false;
    setLoading(true);
    setError(null);
    setDoc(null);
    setTotalPages(0);

    const loadingTask = pdfjsLib.getDocument({ url: pdfUrl });
    let cancelled = false;

    loadingTask.promise
      .then((pdf) => {
        if (cancelled || disposedRef.current) {
          pdf.destroy();
          return;
        }
        setDoc(pdf);
        setTotalPages(pdf.numPages);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled || disposedRef.current) return;
        console.error("[PdfViewer] Failed to load PDF:", err);
        setError(err instanceof Error ? err.message : "Failed to load PDF");
        setLoading(false);
      });

    return () => {
      cancelled = true;
      // Best-effort cancel of the in-flight network load.
      loadingTask.destroy().catch(() => {});
    };
  }, [pdfUrl]);

  // ----- Observe container width for fit-to-width -----
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Initial measurement (synchronous — the element exists at this point).
    // Use clientWidth (includes padding) so the value matches what the
    // ResizeObserver emits below. The render math subtracts padding
    // explicitly.
    const measure = () => container.clientWidth;
    setContainerWidth(measure());

    const observer = new ResizeObserver(() => {
      const width = measure();
      if (width > 0) setContainerWidth(width);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // ----- Render the current page -----
  useEffect(() => {
    if (!doc) return;
    if (page < 1 || page > doc.numPages) return;
    if (containerWidth <= 0) return;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    // Cancel any in-flight render from a previous page/render.
    if (renderTaskRef.current) {
      try {
        renderTaskRef.current.cancel();
      } catch {
        // ignore
      }
      renderTaskRef.current = null;
    }
    // Same idea for the text layer task.
    if (textLayerTaskRef.current) {
      try {
        textLayerTaskRef.current.cancel();
      } catch {
        // ignore
      }
      textLayerTaskRef.current = null;
    }

    // Clear any stale text layer content from a previous render so
    // PDF.js starts from a clean slate.
    if (textLayerRef.current) {
      textLayerRef.current.innerHTML = "";
      // Reset the scale factor; it'll be re-set per-page below.
      textLayerRef.current.style.removeProperty("--scale-factor");
    }
    // Detach the previous page's click listener — we re-attach
    // once the new text layer is fully populated (see below).
    clickControllerRef.current?.abort();
    clickControllerRef.current = new AbortController();
    const clickSignal = clickControllerRef.current.signal;

    let cancelled = false;
    let pageProxy: PDFPageProxy | null = null;

    doc
      .getPage(page)
      .then((p) => {
        if (cancelled || disposedRef.current) {
          p.cleanup();
          return;
        }
        pageProxy = p;

        const baseViewport = p.getViewport({ scale: 1 });
        const usableWidth = Math.max(1, containerWidth - PAGE_PADDING * 2);
        const scale = usableWidth / baseViewport.width * zoom;
        const viewport = p.getViewport({ scale });

        // Account for device pixel ratio so text/edges stay crisp
        // on hi-dpi displays. Cap at MAX_DPR to bound memory.
        const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        // Reset transform before rendering (PDF.js multiplies by dpr).
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // Drive the text-layer's CSS-based sizing off the same scale
        // we used for the canvas. PDF.js's `setLayerDimensions` sets
        // the container's inline width/height to
        // `calc(var(--scale-factor) * <rawPageWidth>px)`, and each
        // text span uses the same var for its font-size and (in
        // marked-content subtrees) absolute offsets — so passing the
        // canvas scale here makes the overlay align pixel-perfectly
        // with the canvas rendering.
        const textLayer = textLayerRef.current;
        if (textLayer) {
          textLayer.style.setProperty("--scale-factor", String(scale));
        }

        const renderTask = p.render({
          canvasContext: ctx,
          viewport,
        });
        renderTaskRef.current = renderTask;

        // Render the text layer in parallel with the canvas. We
        // intentionally don't `await` this — both are independent
        // worker round-trips and starting them concurrently keeps
        // the UI responsive.
        let textTask: pdfjsLib.TextLayerRenderTask | null = null;
        const textLayerPromise = p
          .getTextContent()
          .then((textContent) => {
            if (cancelled || disposedRef.current) return;
            const layer = textLayerRef.current;
            if (!layer) return;
            textTask = pdfjsLib.renderTextLayer({
              textContentSource: textContent,
              container: layer,
              viewport,
              textDivs: [],
            });
            textLayerTaskRef.current = textTask;
            return textTask.promise.then(() => {
              if (cancelled || disposedRef.current) return;
              // Ensure browser layout is complete before measuring
              // span positions. Without this, getBoundingClientRect
              // may returns zeros, making the highlight invisible
              // after rapid page changes.
              requestAnimationFrame(() => {
                if (cancelled || disposedRef.current) return;
                updateSectionHighlight();
              });
              if (!onClickSection) return;
              const clickLayer = textLayerRef.current;
              if (!clickLayer) return;
              clickLayer.addEventListener(
                "click",
                (event) => {
                  const target = event.target as HTMLElement | null;
                  if (!target) return;
                  const span = target.closest("span");
                  if (!span) return;
                  const text = span.textContent?.trim() ?? "";
                  // Match Chilean spec section ids: C.1, C.1.1, C.1.1.5
                  // (the dot after `C` is optional so bare `C1` also
                  // matches and gets normalized below).
                  const match = text.match(/^C\.?\d+(\.\d+)*$/i);
                  if (!match) return;
                  let sectionId = match[0];
                  // Normalize to canonical `C.<digits>(.<digits>)*`
                  // form so lookups against `mappings[].section_id`
                  // succeed regardless of whether the PDF rendered
                  // the dot or not.
                  if (!sectionId.startsWith("C.")) {
                    sectionId = sectionId.replace(/^C(\d)/, "C.$1");
                  }
                  onClickSection(sectionId);
                },
                { signal: clickSignal },
              );
            });
          })
          .catch((err: unknown) => {
            if (cancelled || disposedRef.current) return;
            // Cancellation is expected on rapid page changes.
            const name = (err as { name?: string })?.name;
            if (name === "RenderingCancelledException") return;
            console.error("[PdfViewer] Text layer render failed:", err);
          });

        return Promise.all([renderTask.promise, textLayerPromise]);
      })
      .catch((err: unknown) => {
        // Cancellation is an expected outcome when the user pages
        // quickly — don't surface it as an error.
        const name = (err as { name?: string })?.name;
        if (name === "RenderingCancelledException") return;
        if (cancelled || disposedRef.current) return;
        console.error("[PdfViewer] Render failed:", err);
        setError(err instanceof Error ? err.message : "Render failed");
      })
      .finally(() => {
        if (pageProxy && !cancelled) {
          try {
            pageProxy.cleanup();
          } catch {
            // ignore
          }
        }
      });

    return () => {
      cancelled = true;
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch {
          // ignore
        }
        renderTaskRef.current = null;
      }
      if (textLayerTaskRef.current) {
        try {
          textLayerTaskRef.current.cancel();
        } catch {
          // ignore
        }
        textLayerTaskRef.current = null;
      }
      // Belt-and-braces: also wipe the DOM so unmount-time work
      // can't leave spans behind if the cancellation races.
      if (textLayerRef.current) {
        textLayerRef.current.innerHTML = "";
      }
      // Detach the click listener — superseded by the next render.
      clickControllerRef.current?.abort();
    };
  }, [doc, page, containerWidth, onClickSection]);

  // ----- Cleanup on unmount -----
  useEffect(() => {
    return () => {
      disposedRef.current = true;
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch {
          // ignore
        }
        renderTaskRef.current = null;
      }
      if (textLayerTaskRef.current) {
        try {
          textLayerTaskRef.current.cancel();
        } catch {
          // ignore
        }
        textLayerTaskRef.current = null;
      }
      clickControllerRef.current?.abort();
      clickControllerRef.current = null;
    };
  }, []);

  const goToPage = (next: number) => {
    const max = totalPages || 1;
    const clamped = Math.max(1, Math.min(max, next));
    if (clamped === page) return;
    if (!isControlled) {
      setInternalPage(clamped);
    }
    onPageChange?.(clamped);
  };

  const headerFilename = (() => {
    const parts = pdfUrl.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? pdfUrl;
  })();

  const pageMax = totalPages || 0;
  const canPrev = !loading && !error && page > 1;
  const canNext = !loading && !error && page < pageMax;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>Spec PDF</span>
        <span className={styles.headerFilename} title={pdfUrl}>
          {headerFilename}
        </span>
      </div>
      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.navBtn}
          onClick={() => goToPage(page - 1)}
          disabled={!canPrev}
          aria-label="Previous page"
        >
          ‹ Prev
        </button>
        <span className={styles.pageCounter} aria-live="polite">
          {loading
            ? "Loading…"
            : error
              ? "—"
              : `Page ${page} of ${pageMax}`}
        </span>
        <button
          type="button"
          className={styles.navBtn}
          onClick={() => goToPage(page + 1)}
          disabled={!canNext}
          aria-label="Next page"
        >
          Next ›
        </button>
        <span style={{ fontSize: 12 }}>
          <button type="button" className={styles.navBtn}
            onClick={() => setZoom(z => Math.max(0.25, z - 0.25))}
            disabled={zoom <= 0.25}
            style={{ minWidth: 28, padding: '4px 6px' }}>−</button>
          <span style={{ padding: '0 4px', fontVariantNumeric: 'tabular-nums', color: 'var(--ff-text-primary)' }}>{Math.round(zoom * 100)}%</span>
          <button type="button" className={styles.navBtn}
            onClick={() => setZoom(z => Math.min(3, z + 0.25))}
            disabled={zoom >= 3}
            style={{ minWidth: 28, padding: '4px 6px' }}>+</button>
        </span>
      </div>
      <div className={styles.canvasWrap} ref={containerRef}>
        {error ? (
          <div className={styles.error}>
            <div className={styles.errorTitle}>Failed to load PDF</div>
            <div className={styles.errorMessage}>{error}</div>
          </div>
        ) : (
          <div className={styles.pageContainer} data-testid="pdf-page">
            <canvas
              ref={canvasRef}
              className={styles.canvas}
              data-testid="pdf-canvas"
            />
            <div
              ref={highlightRef}
              className={styles.sectionHighlight}
              aria-hidden="true"
            />
            <div
              ref={textLayerRef}
              className={styles.textLayer}
              data-testid="pdf-text-layer"
            />
          </div>
        )}
      </div>
    </div>
  );
}
