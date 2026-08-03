// src/data/llm.ts
//
// Thin HTTP clients for the two LLM APIs the Salfa BIM Agent 01 agent uses.
//
// Both keys come from VITE_* env vars (Vite replaces
// import.meta.env.VITE_* at build time). The .env.example documents
// the two variables.
//
// No retries, no streaming — this is the PoC. Errors are thrown as
// Error with Spanish messages so the agent loop can surface them
// directly in the chat.

import type { ToolSchema } from "../agent/schema";

const GEMINI_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta/models";
// Gemini Flash is the locked model for PoC. We use `gemini-3.1-flash-lite`
// because `gemini-flash-latest` aliases to `gemini-3.6-flash` which has a
// 20-req/day free-tier quota that exhausts quickly under dev/QA testing.
// Verified 2026-07-30 with Boss's AQ. token: gemini-flash-latest → 429
// (RESOURCE_EXHAUSTED, gemini-3.6-flash free-tier), gemini-3.1-flash-lite
// → 200 OK with a fresh quota bucket. Fallback chain (priority order):
// gemini-flash-latest (if quota resets), gemini-3.5-flash (503 observed
// under load). The agent loop is model-agnostic as long as the
// function-calling shape is preserved.
const GEMINI_MODEL = "gemini-3.1-flash-lite";

const FIREWORKS_EMBED_URL =
  "https://api.fireworks.ai/inference/v1/embeddings";
const FIREWORKS_EMBED_MODEL = "fireworks/qwen3-embedding-8b";
// qwen3-embedding-8b defaults to 4096-dim output. We pin to 1024 via
// the OpenAI-compatible `dimensions` parameter (Matryoshka truncation),
// matching the dim the spec mapper pipeline uses (MEMORY.md §
// bim-specs-mapper — 1024-dim embeddings). Lower dim = 4× less memory
// in IndexedDB + faster cosine math. Verified via Fireworks API probe
// on 2026-07-30: explicit `dimensions: 1024` returns a 1024-dim vector.
const EMBEDDING_DIM = 1024;

export interface GeminiContent {
  // Function responses also come back as "user" in the current Gemini
  // v1beta API (legacy "function" role returns HTTP 400).
  role: "user" | "model";
  parts: Array<{
    text?: string;
    // Function-call parts emitted by the model.
    functionCall?: { name: string; args: Record<string, unknown> };
    // Function-response parts (we send these back to Gemini).
    functionResponse?: { name: string; response: Record<string, unknown> };
    // Gemini v1beta (gemini-2.5+, gemini-flash-latest) attaches a
    // thoughtSignature to each functionCall part to preserve the
    // model's internal reasoning across turns. Stripping it triggers
    // HTTP 400 "Function call is missing a thought_signature". The
    // signature must round-trip verbatim — opaque base64.
    thoughtSignature?: string;
  }>;
}

export interface GeminiRequest {
  contents: GeminiContent[];
  tools?: Array<{ functionDeclarations: ToolSchema[] }>;
  systemInstruction?: { parts: Array<{ text: string }> };
  // We don't enable generationConfig for v1 — defaults are fine.
}

export interface GeminiResponsePart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  // Gemini v1beta (gemini-2.5+, gemini-flash-latest) returns a
  // thoughtSignature on every functionCall part. Round-trip it back
  // in subsequent turns — stripping it triggers HTTP 400
  // "Function call is missing a thought_signature in functionCall parts".
  // Opaque base64 string; do not interpret.
  thoughtSignature?: string;
}

export interface GeminiResponseCandidate {
  content: {
    role: "model";
    parts: GeminiResponsePart[];
  };
  finishReason?: string;
}

export interface GeminiResponse {
  candidates?: GeminiResponseCandidate[];
}

export interface FireworksEmbedResponse {
  data: Array<{ embedding: number[] }>;
}

function geminiKey(): string {
  const key = import.meta.env.VITE_GEMINI_API_KEY;
  if (!key || typeof key !== "string") {
    throw new Error(
      "Falta VITE_GEMINI_API_KEY. Configura tu clave de Gemini en .env.local.",
    );
  }
  return key;
}

function fireworksKey(): string {
  const key = import.meta.env.VITE_FIREWORKS_API_KEY;
  if (!key || typeof key !== "string") {
    throw new Error(
      "Falta VITE_FIREWORKS_API_KEY. Configura tu clave de Fireworks en .env.local.",
    );
  }
  return key;
}

/**
 * One round-trip to Gemini. Returns the first candidate's parts
 * (the model is configured for single-response mode by default).
 */
export async function geminiComplete(
  request: GeminiRequest,
  signal?: AbortSignal,
): Promise<GeminiResponse> {
  const url = `${GEMINI_BASE_URL}/${GEMINI_MODEL}:generateContent?key=${geminiKey()}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Error de Gemini (${res.status}): ${text || res.statusText}`,
    );
  }
  const json = (await res.json()) as GeminiResponse;
  return json;
}

/**
 * Embed a single string via Fireworks qwen3-embedding-8b. Returns a
 * 1024-dim Float32Array-ready number[].
 */
export async function fireworksEmbed(
  text: string,
  signal?: AbortSignal,
): Promise<number[]> {
  const res = await fetch(FIREWORKS_EMBED_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${fireworksKey()}`,
    },
    body: JSON.stringify({
      model: FIREWORKS_EMBED_MODEL,
      input: text,
      dimensions: EMBEDDING_DIM,
    }),
    signal,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Error de Fireworks embeddings (${res.status}): ${body || res.statusText}`,
    );
  }
  const json = (await res.json()) as FireworksEmbedResponse;
  const embedding = json.data?.[0]?.embedding;
  if (!embedding || embedding.length !== EMBEDDING_DIM) {
    throw new Error(
      `Fireworks devolvió un embedding inválido (dim=${embedding?.length ?? 0}, esperado ${EMBEDDING_DIM}).`,
    );
  }
  return embedding;
}

export { EMBEDDING_DIM };
