# bim-assistant PoC v1 — implementation spec

**Project:** `~/projects/bim/bim-assistant/` · branch `main` · repo `theagentmarvin/bim-assistant` (public)
**Brief:** Chat-first "JARVIS for BIM" — Spanish-only PoC over a single IFC + spec PDF.
**Date:** 2026-07-30
**Author:** Architect (Marvin)

## Goal

A runnable Spanish-first chat surface that:

1. Answers questions about the current IFC model.
2. Highlights / isolates matching BIM elements in the 3D viewer.
3. Opens the relevant page of the spec PDF when the question touches a spec section.

No cost, no clash, no multi-IFC, no bilingual, no auth, no Firebase, no deployment — just the chat layer wired to the existing TOE viewer + pdfjs viewer already living in `bim-specs-mapper`. The chat is the wedge.

## Scope lock (Boss 2026-07-30 14:05)

- **Out (v1 PoC):** cost estimation, clash queries, multi-IFC, bilingual UI, auth, OCR pipeline, Firebase deployment.
- **(A) API key management** — env vars (`.env.local`, git-ignored, `VITE_GEMINI_API_KEY` + `VITE_FIREWORKS_API_KEY`). No Cloud Function proxy.
- **(B) Multi-IFC** — single IFC for PoC. Multi-IFC is an upcoming stage.
- **(C) Spanish-only** — all UI strings, system prompts, tool descriptions, agent responses, error messages in Spanish. No bilingual UI.
- **(D partial) PDF source** — NO OCR. Use pdfjs runtime text extraction from `eett-c.pdf`. The bim-specs-mapper `PdfViewer.tsx` is reused as-is.
- **(D partial) Shell layout** — same split-view logic from bim-specs-mapper (PDF left, 3D viewer center, properties panel right). Chat panel added as primary surface (left rail).
- **(D partial) Deployment** — local-only. `npm run dev` from the repo. No Firebase, no hosting. GitHub repo for source control: `theagentmarvin/bim-assistant`.

## Architecture (locked)

**App shell.** `App.tsx` keeps bim-specs-mapper's split-view (PDF left, 3D viewer center, properties right) and adds a chat panel as the primary surface. On first paint: chat is visible; tabbed review collapses behind a toggle.

**Agent loop.** ReAct on Gemini 2.5 Flash. Three tools. Plain TypeScript state machine: receive user message → call Gemini with the message + tool schemas → if Gemini returns tool calls, execute, append tool-result messages, call Gemini again → when Gemini returns a final text answer, surface it in the chat. Max turns = 4 for PoC budget.

**RAG strategy.** IndexedDB-backed vector cache, populated by an idempotent indexer that runs on app boot:

- **Model corpus** — `data/bim_elements.json` chunked by `ifc_class`, embedded via `fireworks/qwen3-embedding-8b`.
- **Mapping corpus** — `data/mapping_presets.json` chunked per section, embedded.
- **Spec corpus** — pdfjs runtime text extraction from `public/eett-c.pdf`, page-level chunks, embedded.

No reranker for PoC. Cosine similarity, top-K=5.

**Storage.** Vanilla IndexedDB (no extra dep). Three object stores:

- `chunks` (text + metadata, chunkId key)
- `embeddings` (Float32Array vectors keyed by chunkId)
- `meta` (corpus hash + timestamp for idempotency)

**APIs.**

- Gemini 2.5 Flash via Google AI API: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`. Verify model id is GA at impl time; fall back to `gemini-2.0-flash` if needed.
- Fireworks embedding: `https://api.fireworks.ai/inference/v1/embeddings` with model `fireworks/qwen3-embedding-8b`. 1024-dim output.

**Env vars** (Vite loads from `.env.local`, git-ignored, exposed as `import.meta.env.VITE_*`):

- `VITE_GEMINI_API_KEY`
- `VITE_FIREWORKS_API_KEY`

Document in `.env.example` (committed) and in README.

## Tool surface (3 tools — locked)

### 1. `consultar_base_de_conocimiento`

```typescript
{
  name: "consultar_base_de_conocimiento",
  description: "Responde preguntas sobre el modelo BIM y las especificaciones técnicas. Usa esta herramienta cuando el usuario pregunta por propiedades, cantidades, secciones de la especificación, o relaciones entre especificación y elementos del modelo.",
  parameters: {
    type: "object",
    properties: {
      pregunta: { type: "string", description: "La pregunta del usuario." },
      fuente: {
        type: "string",
        enum: ["modelo", "especificacion", "mapeos", "auto"],
        description: "De dónde obtener la respuesta. 'auto' decide según la pregunta (default)."
      }
    },
    required: ["pregunta"]
  }
}
```

Implementation: embed `pregunta` via Fireworks → cosine top-5 against the chosen corpus (or all three if `auto`) → concatenate snippets → return `{ respuesta: string, citas: [{ fuente, id, snippet }] }`.

### 2. `resaltar_elementos`

```typescript
{
  name: "resaltar_elementos",
  description: "Resalta y aísla elementos en el visor 3D según su clase IFC, sección de la especificación, o expresión de filtro.",
  parameters: {
    type: "object",
    properties: {
      clase_ifc: { type: "string", description: "Ej: 'IfcWall', 'IfcWindow', 'IfcDoor'." },
      seccion_id: { type: "string", description: "ID de sección de la especificación (ej: 'C.1.1.5'). Dispara el filtro del mapeo." },
      filtro: { type: "object", description: "Filtro directo del tipo Filter. Ver filterEvaluator.ts." },
      reset: { type: "boolean", description: "Si true, limpia cualquier resaltado previo." }
    }
  }
}
```

Implementation: maps to the existing `Viewer3D.tsx` isolation + Highlighter pipeline (the `matchingSetR` + `hl.highlight` pattern from bim-specs-mapper). Returns `{ matching: number, total: number, ids: number[] }`.

### 3. `abrir_seccion_pdf`

```typescript
{
  name: "abrir_seccion_pdf",
  description: "Abre una página específica del PDF de especificaciones técnicas.",
  parameters: {
    type: "object",
    properties: {
      seccion_id: { type: "string", description: "ID de sección (ej: 'C.1.1.5')." },
      consulta: { type: "string", description: "Búsqueda en lenguaje natural si no se conoce el ID." },
      pagina: { type: "number", description: "Número de página directo (1-indexed)." }
    }
  }
}
```

Implementation: navigates the existing `PdfViewer.tsx` to the matching page. For `seccion_id`/`consulta`, look up the page via the sectionIdToPage heuristic from the mapper + a cosine-search fallback through the spec chunks. Returns `{ pagina: number, titulo: string, snippet: string }`.

## Spanish system prompt (locked)

```
Eres JARVIS, un asistente BIM útil y directo. Tu trabajo es responder preguntas sobre el modelo IFC y las especificaciones técnicas del proyecto.

Reglas:
- Responde SIEMPRE en español, incluso si la pregunta está en otro idioma.
- Sé conciso. Prefiere respuestas cortas y directas. Detalla solo cuando el usuario lo pide.
- Cuando uses herramientas, no narres el proceso — solo muestra el resultado.
- Cita secciones y elementos específicos con su ID cuando los menciones.
- Si no sabes la respuesta, dilo claramente. No inventes.
- NUNCA ejecutes acciones destructivas (no tenemos ninguna en PoC, pero la regla queda).
```

## What to copy verbatim from bim-specs-mapper

`~/projects/bim/bim-specs-mapper/` is read-only. Copy these files via `cp -r` into the new project (path flattened — the new project has no `src/ui/` prefix). Update internal import paths after copy. Do NOT modify the source repo.

| Source | Destination |
|---|---|
| `src/ui/src/viewer/Viewer3D.tsx` | `src/viewer/Viewer3D.tsx` |
| `src/ui/src/viewer/filterEvaluator.ts` | `src/viewer/filterEvaluator.ts` |
| `src/ui/src/viewer/blobWorker.ts` | `src/viewer/blobWorker.ts` |
| `src/ui/src/viewer/webIfc.ts` | `src/viewer/webIfc.ts` |
| `src/ui/src/components/ModelPropertyPanel.tsx` | `src/components/ModelPropertyPanel.tsx` |
| `src/ui/src/components/ModelPropertyPanel.module.css` | `src/components/ModelPropertyPanel.module.css` |
| `src/ui/src/components/ViewerPane.tsx` | `src/components/ViewerPane.tsx` |
| `src/ui/src/components/ViewerPane.module.css` | `src/components/ViewerPane.module.css` |
| `src/ui/src/components/PdfViewer.tsx` | `src/components/PdfViewer.tsx` |
| `src/ui/src/components/PdfViewer.module.css` | `src/components/PdfViewer.module.css` |
| `src/ui/src/data/elements.ts` | `src/data/elements.ts` |
| `src/ui/src/data/mappings.ts` | `src/data/mappings.ts` |
| `src/ui/src/styles/tokens.css` | `src/styles/tokens.css` |
| `src/ui/src/styles/index.css` | `src/styles/index.css` |
| `src/ui/public/eett-c.pdf` | `public/eett-c.pdf` |
| `src/ui/public/SZA_BDE3_ARQ_C1.ifc` | `public/SZA_BDE3_ARQ_C1.ifc` |
| `src/ui/public/salfa-logo.png` | `public/salfa-logo.png` |
| `data/processed/validation/bim_elements.json` | `data/bim_elements.json` |
| `data/processed/validation/mapping_presets.json` | `data/mapping_presets.json` |

## What to build new

### Agent layer (`src/agent/`)
- `loop.ts` — ReAct state machine. Exports `runAgentLoop(userMessage, callbacks)` where callbacks fire on tool-call start/end + final answer.
- `tools.ts` — 3 tool implementations. Each is a typed async fn `(args) => Promise<result>` with Spanish descriptions used in the schema.
- `schema.ts` — JSON Schema for the 3 tools, in Gemini function-calling format.
- `retriever.ts` — `embed(text)` and `cosineSearch(queryVector, topK, corpus)` against IndexedDB. 30s timeout. Spanish error messages.
- `indexer.ts` — `indexAll()` called once at app boot. Idempotent — checks IndexedDB `meta` store for corpus hash; if hash matches prior run, skip. Otherwise: pull corpora, chunk all three, embed, write IndexedDB. Emits progress events for `AgentStatus`.
- `prompts.ts` — Spanish system prompt above + one brief few-shot for tool-calling shape.

### Data layer (`src/data/`)
- `llm.ts` — `geminiComplete(messages, tools)` with optional streaming; `fireworksEmbed(text)`. Both keys via `import.meta.env.VITE_*`. Spanish error messages.
- `storage.ts` — vanilla IndexedDB wrapper with three object stores (`chunks`, `embeddings`, `meta`).

### UI
- `components/ChatPanel.tsx` — message list, input box, tool-call status indicators, streaming cursor. Spanish UI strings.
- `components/ChatPanel.module.css` — uses `tokens.css`.
- `components/AgentStatus.tsx` — small indicator: "Indexando documentos…" / "Listo" / "Error de conexión, reindexar" button.
- `components/AgentStatus.module.css`.
- `App.tsx` — REWRITE of mapper's. Split-view layout (PDF left, 3D viewer center, properties panel right) with chat panel as the primary rail. Tabbed review collapses to a toggle.
- `App.module.css` — new layout.
- `main.tsx` — boot indexer + AgentStatus on first paint.
- `index.css` — global styles (copied from mapper).

### Other
- `.env.example` — `VITE_GEMINI_API_KEY=***` `VITE_FIREWORKS_API_KEY=***` placeholders + brief setup notes (Spanish).
- `README.md` — Spanish + English sections. Cover: what it is, how to run (`cp .env.example .env.local`, `npm install`, `npm run dev`), three-pillar walkthrough with example Spanish queries ("¿Cuántos muros hay?", "muéstrame los muros exteriores", "abre la sección sobre siding").
- `package.json` — minimal: react, react-dom, typescript, vite, `@thatopen/components`, `@thatopen/components-front`, `pdfjs-dist`. NO additional deps unless truly needed (no idb-keyval, no zod, no langchain).
- `tsconfig.json`, `vite.config.ts`, `index.html` — standard Vite + React TS, copied/adapted from the mapper. Apply `manualChunks` (toe, pdfjs, app) at the start so build works on low-RAM machines.

### AGENTS.md
DEFER. Write at the end of the scaffold (mirroring bim-specs-mapper's pattern). The implementation brief is THIS spec, not AGENTS.md.

## Folder structure (PoC)

```
bim-assistant/
├── .env.example
├── .gitignore
├── .last-task.md                       # overwritten by sub-agent on completion
├── AGENTS.md                           # written post-scaffold
├── PROJECT-TRACKER.md
├── README.md
├── data/
│   ├── bim_elements.json               # copied from mapper
│   └── mapping_presets.json            # copied from mapper
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html
├── public/
│   ├── eett-c.pdf
│   ├── SZA_BDE3_ARQ_C1.ifc
│   └── salfa-logo.png
├── research/
│   └── 2026-07-30-jarvis-bim-market-and-modifications.md
├── .claude/
│   └── specs/
│       └── task-poc-v1.md              # this file
└── src/
    ├── main.tsx
    ├── App.tsx                         # REWRITTEN with chat-first split-view
    ├── App.module.css
    ├── agent/
    │   ├── loop.ts
    │   ├── tools.ts
    │   ├── schema.ts
    │   ├── retriever.ts
    │   ├── indexer.ts
    │   └── prompts.ts
    ├── components/
    │   ├── ChatPanel.tsx
    │   ├── ChatPanel.module.css
    │   ├── AgentStatus.tsx
    │   ├── AgentStatus.module.css
    │   ├── ModelPropertyPanel.tsx      # copied
    │   ├── ModelPropertyPanel.module.css
    │   ├── ViewerPane.tsx              # copied
    │   ├── ViewerPane.module.css
    │   └── PdfViewer.tsx               # copied
    ├── data/
    │   ├── elements.ts                 # copied
    │   ├── mappings.ts                 # copied
    │   ├── llm.ts                      # Gemini + Fireworks clients
    │   └── storage.ts                  # IndexedDB wrapper
    ├── styles/
    │   ├── tokens.css                  # copied
    │   └── index.css                   # copied
    └── viewer/
        ├── Viewer3D.tsx                # copied
        ├── filterEvaluator.ts          # copied
        ├── blobWorker.ts               # copied
        └── webIfc.ts                   # copied
```

## Definition of Done (gates)

The PoC is shippable when ALL of the following are true:

- [ ] `npm run dev` boots cleanly on `localhost:5173` with no console errors.
- [ ] `.env.example` documents both API keys; `.env.local` is git-ignored.
- [ ] On first load, the indexer runs and `AgentStatus` shows "Listo" within ~10s (model + mappings + spec PDF indexed).
- [ ] The chat panel is the primary visible surface on first paint.
- [ ] Spanish sample queries work end-to-end:
  - "¿Cuántos muros hay en el modelo?" → numerical answer with citation.
  - "muéstrame los muros exteriores" → viewer isolates matching walls in orange.
  - "abre la sección sobre siding" → PDF jumps to the right page.
  - "¿qué dice la especificación sobre el siding?" → PDF jumps + answer cites spec text.
- [ ] `npm run build` produces a clean `dist/` (chunked like the mapper's 3-way split: toe / pdfjs / app). Apply `manualChunks` from the start to avoid OOM.
- [ ] No real keys leak into `dist/` — only `VITE_*` env-key strings present (PoC by-design client-visible; document in README).
- [ ] All UI strings in Spanish; English only in code comments + console.error context.
- [ ] Reset / clear button clears the chat, the highlight in the viewer, and the PDF navigation.
- [ ] README has Spanish + English sections: setup, three-pillar walkthrough with sample queries, env-var notes.
- [ ] `npm run typecheck` is clean.

## Sub-agent execution contract

- **Working directory:** `~/projects/bim/bim-assistant/`
- **Read first:** `PROJECT-TRACKER.md`, this spec (`.claude/specs/task-poc-v1.md`), then `research/2026-07-30-jarvis-bim-market-and-modifications.md` for full v1 context (apply the PoC cut).
- **Commit policy:** leave all work uncommitted. Do NOT run `git add` / `git commit` / `git push`. The Architect handles commits.
- **Completion signal (two-layer):**

  **File.** Overwrite `/home/marvin/projects/bim/bim-assistant/.last-task.md` with:

  ```
  Completed: <ISO timestamp>
  Status: <one line, e.g. "PoC v1 scaffold complete, ready for Architect review">
  Files touched:
  - <list every file created or modified, including copied files>
  Gates:
  - npm run dev clean — YES/NO
  - .env.example present — YES/NO
  - indexer boots within 10s — YES/NO
  - chat panel primary on first paint — YES/NO
  - 4 sample Spanish queries pass — YES/NO
  - npm run build clean — YES/NO
  - Only VITE_ env keys in dist/ — YES/NO
  - Spanish UI confirmed — YES/NO
  - Reset works — YES/NO
  - README has setup section — YES/NO
  - typecheck clean — YES/NO
  ```

  **Best-effort push.** `sessions_send` to `agent:architect:telegram:architect:direct:8450148189` with subject `bim-assistant PoC v1 landed` and a 1-paragraph summary. Skip silently if the tool isn't available.

- **Time budget:** ~30-60 min for scaffold + smoke test.

## Hard out-of-scope reminders (do NOT build)

- ❌ No Firebase setup. No `firebase.json`, no `.firebaserc`.
- ❌ No Cloud Functions proxy. Keys come from `.env.local` via Vite.
- ❌ No bilingual UI. Spanish only.
- ❌ No multi-IFC. Single IFC for PoC.
- ❌ No OCR pipeline. Use pdfjs runtime text extraction.
- ❌ No cost estimation, no clash queries, no draft specs.
- ❌ No tool beyond the three listed above.
- ❌ No deployment setup. `npm run dev` is the deployment.
- ❌ No corrections feedback loop.
- ❌ Do NOT commit. Do NOT push.
