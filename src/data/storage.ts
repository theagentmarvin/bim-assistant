// src/data/storage.ts
//
// Vanilla IndexedDB wrapper for the Salfa BIM Agent 01 RAG cache.
//
// Three object stores:
//   - chunks:     { id, corpus, text, metadata }  (small metadata)
//   - embeddings: { id, vector: Float32Array }    (1024-dim per chunk)
//   - meta:       { key, value }                  (indexing state)
//
// Schema version 1. No migrations needed for PoC — bump on breaking
// changes and add an upgrade callback.

import { EMBEDDING_DIM } from "./llm";

const DB_NAME = "bim-assistant";
// Boss 2026-08-05 — bumped 1 → 2 to add the `agent-turns` store used
// by the pilot feedback loop. v1 IndexedDB existing stores are
// preserved verbatim; the upgrade callback only creates the new
// store when missing, so existing users' RAG caches survive.
const DB_VERSION = 2;

const STORE_CHUNKS = "chunks";
const STORE_EMBEDDINGS = "embeddings";
const STORE_META = "meta";
const STORE_TURNS = "agent-turns";

export interface ChunkRecord {
  id: string;
  corpus: "modelo" | "especificacion" | "mapeos";
  text: string;
  metadata: Record<string, unknown>;
}

export interface EmbeddingRecord {
  id: string;
  vector: number[];
}

export interface MetaRecord {
  key: string;
  value: unknown;
}

/**
 * Boss 2026-08-05 — Pilot feedback loop. One record per `handleSend`
 * invocation: the user message, every tool call, every tool result,
 * and the agent's final answer. Schema is intentionally loose — we
 * mirror the ChatPanel ChatMessage shape so a turn re-rendered to
 * the UI looks identical. Indexed by `turn_id` (uuid-like). The
 * `session_id` field groups turns between resets; exporters walk
 * `getAllTurns()` and sort by turn_index to render a markdown file.
 */
export interface ChatMessageShape {
  id: string;
  role: "user" | "agent" | "tool" | "error";
  text?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: { ok: boolean; summary: string };
  error?: string;
}

export interface TurnRecord {
  turn_id: string;
  session_id: string;
  turn_index: number;
  created_at: string;
  duration_ms?: number;
  messages: ChatMessageShape[];
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
        db.createObjectStore(STORE_CHUNKS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_EMBEDDINGS)) {
        db.createObjectStore(STORE_EMBEDDINGS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: "key" });
      }
      // Boss 2026-08-05 — agent-turns store added in DB v2.
      // Keyed by `turn_id` (caller-generated uuid). Index on
      // session_id + turn_index would let us fast-path per-session
      // queries for export, but with <1000 turns typical for a
      // 10-day pilot, full-table scan + in-memory sort is fine.
      if (!db.objectStoreNames.contains(STORE_TURNS)) {
        db.createObjectStore(STORE_TURNS, { keyPath: "turn_id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
  return dbPromise;
}

function tx(
  db: IDBDatabase,
  storeNames: string | string[],
  mode: IDBTransactionMode,
): IDBTransaction {
  return db.transaction(storeNames, mode);
}

function awaitTx(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IDB tx error"));
    tx.onabort = () => reject(tx.error ?? new Error("IDB tx aborted"));
  });
}

export async function putChunks(chunks: ChunkRecord[]): Promise<void> {
  if (chunks.length === 0) return;
  const db = await openDb();
  const t = tx(db, STORE_CHUNKS, "readwrite");
  const store = t.objectStore(STORE_CHUNKS);
  for (const c of chunks) store.put(c);
  await awaitTx(t);
}

export async function putEmbeddings(embs: EmbeddingRecord[]): Promise<void> {
  if (embs.length === 0) return;
  const db = await openDb();
  const t = tx(db, STORE_EMBEDDINGS, "readwrite");
  const store = t.objectStore(STORE_EMBEDDINGS);
  for (const e of embs) store.put(e);
  await awaitTx(t);
}

export async function putMeta(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  const t = tx(db, STORE_META, "readwrite");
  t.objectStore(STORE_META).put({ key, value } as MetaRecord);
  await awaitTx(t);
}

export async function getMeta<T = unknown>(key: string): Promise<T | null> {
  const db = await openDb();
  return new Promise<T | null>((resolve, reject) => {
    const t = tx(db, STORE_META, "readonly");
    const req = t.objectStore(STORE_META).get(key);
    req.onsuccess = () => {
      const result = req.result as MetaRecord | undefined;
      resolve(result ? (result.value as T) : null);
    };
    req.onerror = () => reject(req.error ?? new Error("IDB getMeta failed"));
  });
}

export async function getAllChunks(): Promise<ChunkRecord[]> {
  const db = await openDb();
  return new Promise<ChunkRecord[]>((resolve, reject) => {
    const t = tx(db, STORE_CHUNKS, "readonly");
    const req = t.objectStore(STORE_CHUNKS).getAll();
    req.onsuccess = () => resolve((req.result ?? []) as ChunkRecord[]);
    req.onerror = () => reject(req.error ?? new Error("IDB getAllChunks failed"));
  });
}

export async function getChunksByCorpus(
  corpus: ChunkRecord["corpus"],
): Promise<ChunkRecord[]> {
  const all = await getAllChunks();
  return all.filter((c) => c.corpus === corpus);
}

export async function getAllEmbeddings(): Promise<EmbeddingRecord[]> {
  const db = await openDb();
  return new Promise<EmbeddingRecord[]>((resolve, reject) => {
    const t = tx(db, STORE_EMBEDDINGS, "readonly");
    const req = t.objectStore(STORE_EMBEDDINGS).getAll();
    req.onsuccess = () => resolve((req.result ?? []) as EmbeddingRecord[]);
    req.onerror = () => reject(req.error ?? new Error("IDB getAll failed"));
  });
}

/** Wipe all chunks + embeddings. Keeps meta so callers can track
 *  that a reset happened (timestamp). */
export async function resetIndex(): Promise<void> {
  const db = await openDb();
  const t = tx(db, [STORE_CHUNKS, STORE_EMBEDDINGS], "readwrite");
  t.objectStore(STORE_CHUNKS).clear();
  t.objectStore(STORE_EMBEDDINGS).clear();
  await awaitTx(t);
}

export async function indexStats(): Promise<{
  chunks: number;
  embeddings: number;
  expectedDim: number;
}> {
  const [allChunks, allEmbs] = await Promise.all([
    getAllChunks(),
    getAllEmbeddings(),
  ]);
  return {
    chunks: allChunks.length,
    embeddings: allEmbs.length,
    expectedDim: EMBEDDING_DIM,
  };
}

// ----- agent-turns store (Boss 2026-08-05, pilot feedback loop) -----

/** Append one turn. No-op if `turn.messages` is empty. */
export async function putTurn(turn: TurnRecord): Promise<void> {
  if (!turn.messages || turn.messages.length === 0) return;
  const db = await openDb();
  const t = tx(db, STORE_TURNS, "readwrite");
  t.objectStore(STORE_TURNS).put(turn);
  await awaitTx(t);
}

/** Read all turns. Returned in insertion order (newest first when
 *  the caller reverses). Sort by `turn_index` ascending for export. */
export async function getAllTurns(): Promise<TurnRecord[]> {
  const db = await openDb();
  return new Promise<TurnRecord[]>((resolve, reject) => {
    const t = tx(db, STORE_TURNS, "readonly");
    const req = t.objectStore(STORE_TURNS).getAll();
    req.onsuccess = () => resolve((req.result ?? []) as TurnRecord[]);
    req.onerror = () =>
      reject(req.error ?? new Error("IDB getAllTurns failed"));
  });
}

/** Clear all turns. Used by the test suite + by Reset. */
export async function clearTurns(): Promise<void> {
  const db = await openDb();
  const t = tx(db, STORE_TURNS, "readwrite");
  t.objectStore(STORE_TURNS).clear();
  await awaitTx(t);
}
