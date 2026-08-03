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
const DB_VERSION = 1;

const STORE_CHUNKS = "chunks";
const STORE_EMBEDDINGS = "embeddings";
const STORE_META = "meta";

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
