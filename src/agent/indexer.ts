// src/agent/indexer.ts
//
// Idempotent app-boot indexer. Runs once when the app mounts.
//
// Three corpora:
//   - modelo       ← data/bim_elements.json (chunked per ifc_class)
//   - mapeos       ← data/mapping_presets.json (chunked per section)
//   - especificacion ← PDF (chunked per page, runtime extraction)
//
// The indexer is idempotent: a content hash is stored in IndexedDB
// meta. On re-run, if the hash matches, we skip. The user can also
// force a reindex via AgentStatus's "Reindexar" button (which calls
// resetIndex() then indexAll()).

import bimElementsRaw from "../../data/bim_elements.json";
import mappingPresetsRaw from "../../data/mapping_presets.json";
import type { MappingPresets } from "../types";
import {
  putChunks,
  putEmbeddings,
  putMeta,
  getMeta,
  resetIndex,
} from "../data/storage";
import { embed } from "./retriever";

export type IndexProgressEvent =
  | { phase: "start"; total: number }
  | { phase: "corpus"; corpus: string; index: number; total: number; label: string }
  | { phase: "done"; chunks: number; embeddings: number }
  | { phase: "error"; message: string };

export type IndexProgressCallback = (e: IndexProgressEvent) => void;

const META_HASH_KEY = "index.hash.v1";
const META_TS_KEY = "index.timestamp.v1";
const META_VERSION = "2"; // bump when chunk shape changes (e.g. flat property keys added)

// ---------- Chunking ----------

interface RawElement {
  express_id?: number;
  ifc_class?: string;
  name?: string;
  is_external?: boolean | null;
  fire_rating?: string | null;
  material_name?: string | null;
  spatial_container?: string | null;
  predefined_type?: string | null;
  [key: string]: unknown;
}

function chunkModelo(): Array<{
  id: string;
  corpus: "modelo";
  text: string;
  metadata: Record<string, unknown>;
}> {
  const elements = (bimElementsRaw as { elements?: RawElement[] }).elements ?? [];
  // Group by ifc_class → one chunk per class with a summary table.
  const byClass = new Map<string, RawElement[]>();
  for (const el of elements) {
    const cls = el.ifc_class ?? "IfcUnknown";
    const list = byClass.get(cls) ?? [];
    list.push(el);
    byClass.set(cls, list);
  }
  const chunks: Array<{
    id: string;
    corpus: "modelo";
    text: string;
    metadata: Record<string, unknown>;
  }> = [];
  for (const [cls, els] of byClass) {
    const total = els.length;
    const externalCount = els.filter((e) => e.is_external === true).length;
    const materials = Array.from(
      new Set(els.map((e) => e.material_name).filter((m): m is string => !!m)),
    );
    const fireRatings = Array.from(
      new Set(els.map((e) => e.fire_rating).filter((m): m is string => !!m)),
    );

    // Flat property key inventory per class — embedded in the chunk
    // text so the LLM learns which top-level property names are
    // valid for a given class when the agent goes to build a `filtro`.
    // Nested objects (geometry_summary, material_layers, psets) are
    // intentionally excluded because filterEvaluator only supports
    // top-level access via `item[rule.p]`.
    const allKeys = new Set<string>();
    for (const it of els) {
      for (const k of Object.keys(it)) {
        if (k === "ifc_class") continue;
        allKeys.add(k);
      }
    }
    // Filter to scalar-ish top-level properties for the LLM-facing
    // list. Object-valued keys (geometry_summary, material_layers,
    // psets) are still in the allKeys set but won't show up as
    // useful filter targets in `Propiedades filtrables`.
    const scalarKeys = [...allKeys].filter((k) => {
      const sample = els.find((e) => k in e)?.[k];
      return sample === null || sample === undefined ||
        typeof sample === "string" || typeof sample === "number" ||
        typeof sample === "boolean";
    }).sort();
    const sample = els.slice(0, 2).map((it) => {
      const sample_props: Record<string, unknown> = {};
      for (const k of scalarKeys.slice(0, 8)) {
        if (k in it) sample_props[k] = it[k];
      }
      return {
        name: it.name ?? null,
        predefined_type: it.predefined_type ?? null,
        spatial_container: it.spatial_container ?? null,
        sample_props,
      };
    });

    const text = [
      `Clase IFC: ${cls}.`,
      `Total de elementos: ${total}.`,
      externalCount ? `Elementos exteriores: ${externalCount}.` : null,
      materials.length ? `Materiales: ${materials.join(", ")}.` : null,
      fireRatings.length ? `Resistencia al fuego: ${fireRatings.join(", ")}.` : null,
      `Propiedades filtrables (top-level): ${scalarKeys.join(", ") || "(solo ifc_class)"} .`,
      `Muestra: ${JSON.stringify(sample).slice(0, 600)}.`,
    ]
      .filter(Boolean)
      .join("\n");
    chunks.push({
      id: `modelo:${cls}`,
      corpus: "modelo",
      text,
      metadata: { ifc_class: cls, count: total, scalar_keys: scalarKeys },
    });
  }
  return chunks;
}

function chunkMapeos(): Array<{
  id: string;
  corpus: "mapeos";
  text: string;
  metadata: Record<string, unknown>;
}> {
  const data = mappingPresetsRaw as unknown as MappingPresets;
  const mappings = data.mappings ?? [];
  return mappings.map((m) => {
    const top = m.results?.[0];
    const text = [
      `Sección ${m.section_id} — ${m.section_title}.`,
      m.unit ? `Unidad: ${m.unit}.` : null,
      top
        ? `Mejor mapeo: ${top.ifc_class} (confianza ${(top.conf * 100).toFixed(0)}%).`
        : "Sin mapeo.",
      top?.rationale ? `Razón: ${top.rationale}` : null,
      `Estado: ${m.status}.`,
    ]
      .filter(Boolean)
      .join("\n");
    return {
      id: `mapeos:${m.section_id}`,
      corpus: "mapeos",
      text,
      metadata: {
        section_id: m.section_id,
        section_title: m.section_title,
        ifc_class: top?.ifc_class ?? null,
      },
    };
  });
}

/**
 * Runtime-extracted PDF text chunks. We use pdfjs to pull page-level
 * text out of /eett-c.pdf without any OCR pipeline. Returns chunks
 * shaped like the others so the storage layer is uniform.
 */
async function chunkEspecificacion(): Promise<
  Array<{
    id: string;
    corpus: "especificacion";
    text: string;
    metadata: Record<string, unknown>;
  }>
> {
  // Lazy import pdfjs so the indexer's start phase doesn't pay the
  // worker-cost if PDF loading fails (e.g. dev without network).
  const pdfjsLib: typeof import("pdfjs-dist") = await import("pdfjs-dist");
  // Same CDN as PdfViewer.tsx — the worker is shipped from cdnjs.
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs";
  const url = "/eett-c.pdf";
  const doc = await pdfjsLib.getDocument({ url }).promise;
  const chunks: Array<{
    id: string;
    corpus: "especificacion";
    text: string;
    metadata: Record<string, unknown>;
  }> = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    let text = "";
    try {
      const content = await page.getTextContent();
      text = content.items
        .map((it) => ("str" in it ? String(it.str ?? "") : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
    } finally {
      try { page.cleanup(); } catch { /* ignore */ }
    }
    chunks.push({
      id: `especificacion:p${pageNumber}`,
      corpus: "especificacion",
      text: text || `(Página ${pageNumber} sin texto extraído.)`,
      metadata: { page: pageNumber },
    });
  }
  return chunks;
}

// ---------- Content hash ----------

function hashInputs(
  modeloChunks: Array<{ id: string; text: string }>,
  mapeosChunks: Array<{ id: string; text: string }>,
  specChunks: Array<{ id: string; text: string }>,
): string {
  // Cheap FNV-1a 32-bit hash over the concatenated chunk texts.
  // Sufficient for idempotency — collisions are astronomically unlikely
  // for our corpus size and a wrong hit just means a re-index.
  const data =
    modeloChunks.map((c) => c.id + "\0" + c.text).join("\n") +
    "\u0001" +
    mapeosChunks.map((c) => c.id + "\0" + c.text).join("\n") +
    "\u0001" +
    specChunks.map((c) => c.id + "\0" + c.text).join("\n");
  let hash = 0x811c9dc5;
  for (let i = 0; i < data.length; i += 1) {
    hash ^= data.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // Mix in the version so we can invalidate the cache on schema bumps.
  return `${META_VERSION}:${(hash >>> 0).toString(16)}`;
}

// ---------- Public entry point ----------

export async function indexAll(
  onProgress: IndexProgressCallback,
  opts: { force?: boolean } = {},
): Promise<void> {
  try {
    onProgress({ phase: "start", total: 0 });
    const modeloChunks = chunkModelo();
    const mapeosChunks = chunkMapeos();
    const specChunks = await chunkEspecificacion();
    const allChunks = [
      ...modeloChunks,
      ...mapeosChunks,
      ...specChunks,
    ];
    const total = allChunks.length;
    onProgress({ phase: "start", total });

    const newHash = hashInputs(modeloChunks, mapeosChunks, specChunks);
    const existingHash = opts.force ? null : await getMeta<string>(META_HASH_KEY);
    if (existingHash === newHash) {
      onProgress({ phase: "done", chunks: total, embeddings: total });
      return;
    }
    if (opts.force) await resetIndex();

    // Index corpus-by-corpus so the progress UI is informative.
    const corpora: Array<{ label: string; chunks: typeof allChunks }> = [
      { label: "modelo BIM", chunks: modeloChunks },
      { label: "mapeos", chunks: mapeosChunks },
      { label: "especificación PDF", chunks: specChunks },
    ];
    let chunkCursor = 0;
    let embCount = 0;
    for (const { label, chunks } of corpora) {
      onProgress({
        phase: "corpus",
        corpus: chunks[0]?.corpus ?? "?",
        index: chunkCursor,
        total,
        label,
      });
      if (chunks.length > 0) {
        await putChunks(
          chunks.map((c) => ({
            id: c.id,
            corpus: c.corpus,
            text: c.text,
            metadata: c.metadata,
          })),
        );
        const embs: Array<{ id: string; vector: number[] }> = [];
        for (const c of chunks) {
          const vec = await embed(c.text);
          embs.push({ id: c.id, vector: vec });
          embCount += 1;
          chunkCursor += 1;
          onProgress({
            phase: "corpus",
            corpus: c.corpus,
            index: chunkCursor,
            total,
            label,
          });
        }
        await putEmbeddings(embs);
      }
    }
    await putMeta(META_HASH_KEY, newHash);
    await putMeta(META_TS_KEY, new Date().toISOString());
    onProgress({ phase: "done", chunks: total, embeddings: embCount });
  } catch (err) {
    onProgress({
      phase: "error",
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export async function forceReindex(
  onProgress: IndexProgressCallback,
): Promise<void> {
  return indexAll(onProgress, { force: true });
}
