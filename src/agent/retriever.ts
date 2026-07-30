// src/agent/retriever.ts
//
// Embedding-based retrieval over the IndexedDB RAG cache.
//
// Public surface:
//   embed(text):  Promise<number[]>      — single Fireworks embed call
//   cosineSearch(queryVector, topK, corpus)
//                  Promise<RetrievedHit[]> — top-K cosine matches
//
// No reranker for PoC (locked decision). Cosine similarity only.

import { fireworksEmbed, EMBEDDING_DIM } from "../data/llm";
import {
  getAllChunks,
  getAllEmbeddings,
  type ChunkRecord,
  type EmbeddingRecord,
} from "../data/storage";

export interface RetrievedHit {
  chunk: ChunkRecord;
  score: number;
}

function cosine(a: number[], b: number[]): number {
  // We know both are EMBEDDING_DIM long at write time — guard with a
  // length check at runtime to surface any cache corruption early.
  if (a.length !== b.length) return -Infinity;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i];
    const bv = b[i];
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) return -Infinity;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Embed a string via Fireworks. Single-call wrapper for clarity. */
export async function embed(text: string, signal?: AbortSignal): Promise<number[]> {
  return fireworksEmbed(text, signal);
}

/** Top-K cosine search against the in-memory chunk/embedding arrays. */
export async function cosineSearch(
  queryVector: number[],
  topK: number,
  corpus: ChunkRecord["corpus"] | "all" = "all",
  signal?: AbortSignal,
): Promise<RetrievedHit[]> {
  if (queryVector.length !== EMBEDDING_DIM) {
    throw new Error(
      `Vector de embedding con dimensión incorrecta (${queryVector.length} vs ${EMBEDDING_DIM}).`,
    );
  }
  const [allChunks, allEmbs] = await Promise.all([
    getAllChunks(),
    getAllEmbeddings(),
  ]);
  if (signal?.aborted) throw new Error("Cancelado");

  // Build an id → embedding map (O(N) memory).
  const byId = new Map<string, number[]>();
  for (const e of allEmbs as EmbeddingRecord[]) {
    byId.set(e.id, e.vector);
  }

  const scored: RetrievedHit[] = [];
  for (const chunk of allChunks as ChunkRecord[]) {
    if (corpus !== "all" && chunk.corpus !== corpus) continue;
    const vec = byId.get(chunk.id);
    if (!vec) continue; // chunk without embedding — skip
    const score = cosine(queryVector, vec);
    scored.push({ chunk, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

/** Convenience: retrieve chunks for a single query against one corpus
 *  (or all). Returns the text chunks in score order, concatenated. */
export async function retrieveSnippets(
  question: string,
  topK: number,
  corpus: ChunkRecord["corpus"] | "all" = "all",
  signal?: AbortSignal,
): Promise<{ hits: RetrievedHit[]; queryVector: number[] }> {
  const queryVector = await embed(question, signal);
  const hits = await cosineSearch(queryVector, topK, corpus, signal);
  return { hits, queryVector };
}
