# bim-assistant — project tracker

**Status:** scoping · research phase · no code yet.
**Started:** 2026-07-30 · Boss #14725.
**Source app to refactor from:** `~/projects/bim/bim-specs-mapper/` (HEAD `8cba4cb`, live at https://bim-specs-mapper.web.app).
**Owner:** Architect (Marvin) — Architect session `agent:architect:main`.

> *Folder name is a placeholder. Confirm or rename before first commit.*

## Concept (Boss, verbatim)

> "Instead of just mapping I want to add a chatbot UI so the user can
> have a sort of BIM agent to ask information about the model, show
> elements from the model or open PDFs based on information asked.
> Basically give the user an Iron Man Salfa BIM Agent 01 experience in terms of
> IFC models and PDF docs."

**Three core capabilities called out:**

1. Q&A about the IFC model.
2. Show elements on the 3D viewer (highlight / isolate / zoom).
3. Open relevant spec PDFs based on the question.

**LLM stack called out:** Gemini + Fireworks embeddings (qwen3 family).

## What comes from bim-specs-mapper

- **Reuse as-is:** TOE viewer (`Viewer3D.tsx` + selection / isolation
  / soft-reset), `bim_elements.json`, `mapping_presets.json`,
  Firebase hosting config (`firebase.json`, `.firebaserc`), design
  tokens (`src/ui/src/styles/`), PDF rendering (pdfjs).
- **Lift into agent tools (callable instead of single-shot):** OCR
  pipeline (`src/ocr/`), WBS discovery (`src/structure/`), mapping
  rules (`src/mapper/`), correction log (`mapping_corrections.jsonl`).
- **Sunset / rework:** the single-shot spec → mapping → highlight UI
  flow in `TabbedPanel` + `SpecPanel` becomes one of several tools
  the agent can invoke, not the primary interaction.

## Open questions (asked 2026-07-30 13:54 GMT-4)

1. **Persona + scope of MVP.** Who is the primary user — SalfaCorp
   internal PM / BIM coordinator, external client reviewer, Boss
   himself doing ad-hoc review? Which of the three capabilities
   must ship first?
2. **Beyond the three pillars?** Are Q&A / show elements / open PDFs
   the full MVP, or are there more capabilities on the backlog (cost
   estimation, quantity takeoffs, clash queries, spec drafting)?
3. **Reference products to study.** Specific apps to benchmark
   (Speckle AI, Autodesk Forma, ChatAEC, BrickML, etc.), or should
   the researcher pick?

## Research phase output (completed 2026-07-30)

**Report:** `research/2026-07-30-jarvis-bim-market-and-modifications.md`

**Top 5 recommendations (digest):**
1. Ship all three pillars (Q&A + show-elements + open-PDFs) in v1 — the market has no combined offering; this is a greenfield wedge for SalfaCorp review workflows.
2. Build a ReAct agent loop around Gemini function-calling + Fireworks embeddings/reranker, reusing the existing Viewer3D, PdfViewer, and RAG corpus (bim_elements.json, mapping_presets.json, OCR markdown) from bim-specs-mapper with zero modification.
3. The chat panel becomes the primary interaction surface; TabbedPanel/SpecPanel/MappingDetail demote to agent-invokable tools, with the old 3-panel review UI kept as a fallback via `?mode=classic`.
4. Target SalfaCorp internal PM/reviewers as v1 persona — chat-first, zero-onboarding, single IFC + single spec PDF, no auth needed. The Chilean BIM market (Planbim Corfo, BIM 19650 certification) is ready but has no conversational BIM product in Latin America.
5. Adjacent capabilities (takeoffs, cost, clash, multi-IFC, draft-specs) deferred to vNext — ranked by user pull, with quantity takeoffs as the top next priority.

### Open questions resolved by research
- ✅ **Persona:** PM/BIM coordinator doing ad-hoc review. Chat-first, zero-onboarding.
- ✅ **Scope:** All three pillars ship v1. Go wide.
- ✅ **Reference products:** 6 profiled (ArchiLabs, Frame, Augmenta, Speckle, DAVE, Autodesk community prototype). Free scan picked by researcher.

### Open questions still need Boss input
1. ✅ ~~Persona + scope of MVP~~ — resolved: PM/reviewer, all 3 pillars v1.
2. ✅ ~~Beyond the three pillars?~~ — resolved: vNext backlog defined, takeoffs #1.
3. ✅ ~~Reference products to study~~ — resolved: researcher picked 6 verified products.
4. ❓ API key management (Cloud Function proxy vs client-side key)
5. ❓ Gemini model tier (Flash vs Pro for agent loop)
6. ❓ Full PDF OCR completion before v1
7. ❓ Multi-IFC timeline
8. ❓ Spanish-only or bilingual chat surface
9. ❓ Firebase site naming (rename to bim-assistant or parallel deploy)
10. ❓ Final project name (bim-assistant, Salfa BIM Agent 01 BIM, SpecQA, BIM Chat)

## What is NOT done yet (per Boss's constraint)

No `git init`. No `src/`, `data/`, `docs/`, `scripts/`, `.claude/`.
No package.json, no Python pipeline files. Nothing scaffolding-shaped.
Only this tracker file + research report. The next agent (or Architect
session) will scaffold after the research lands.

## PoC scope lock (Boss 2026-07-30 14:05)

Boss reframed v1 as a **PoC — top-priority functionality only**. The
research's "go-wide" instinct rescoped; cost and clash are explicitly
out. This is a major scope-down from the research report.

### Locked decisions (Boss answers to research open questions)

- **(A) API key management** — env vars (`.env.local`, git-ignored,
  `VITE_GEMINI_API_KEY` + `VITE_FIREWORKS_API_KEY`). No Cloud Function
  proxy. PoC simplicity over hardening.
- **(B) Multi-IFC** — single IFC for PoC. Multi-IFC is an upcoming
  stage.
- **(C) Spanish-only** — all UI strings, system prompts, tool
  descriptions, agent responses, error messages are in Spanish. No
  bilingual UI. Users are Spanish-speaking reviewers.
- **(D partial) PDF source** — NO OCR pipeline. Use pdfjs runtime
  text extraction from the existing `eett-c.pdf`. The bim-specs-mapper
  `PdfViewer.tsx` is reused as-is. RAG corpus is `bim_elements.json`
  + `mapping_presets.json` + runtime-extracted PDF text.
- **(D partial) Shell layout** — same split-view logic from
  bim-specs-mapper (PDF left, 3D viewer center, properties panel
  right). Chat panel added as the primary surface (left rail).
- **(D partial) Deployment** — local-only. `npm run dev` from the
  repo. NO Firebase, no `firebase.json`, no `.firebaserc`. GitHub
  repo for source control: `theagentmarvin/bim-assistant` (public).

### Explicit out-of-scope for PoC

- ❌ Cost estimation
- ❌ Clash queries
- ❌ Multi-IFC navigation
- ❌ Bilingual UI (Spanish only)
- ❌ Authentication / sharing / multi-tenant
- ❌ OCR pipeline (pdfjs runtime text extraction only)
- ❌ Firebase deployment / Firestore / hosting
- ❌ Tool breadth beyond 3 (`get_element_details`, `list_sections`,
  `compare`, `get_model_stats`, `export_session` deferred to v1.1)
- ❌ Corrections feedback loop
- ❌ OpenRouter DeepSeek V3 judge

### PoC tool surface (3 tools only — Spanish names)

- ✅ `consultar_base_de_conocimiento(pregunta, fuente)` — RAG over
  model + spec + mapping corpora.
- ✅ `resaltar_elementos(clase_ifc | seccion_id | filtro | reset)` —
  reuses `Viewer3D.tsx` isolation + Highlighter pipeline.
- ✅ `abrir_seccion_pdf(seccion_id | consulta | pagina)` — reuses
  `PdfViewer.tsx` page navigation + a sectionIdToPage heuristic.

### RAG strategy (replaces OCR-markdown chunks)

- **Model corpus** — `data/bim_elements.json` chunked by `ifc_class`,
  embedded via `fireworks/qwen3-embedding-8b` at app boot, cached in
  IndexedDB.
- **Mapping corpus** — `data/mapping_presets.json` chunked per section.
- **Spec corpus** — pdfjs runtime text extraction on app boot,
  page-level chunks, embedded.
- **No reranker for PoC.** Cosine similarity only, top-K=5.

### GitHub repo

- Repo: `theagentmarvin/bim-assistant` (public).
- Initial commit: planning artifacts (this tracker + research + spec).
- Subsequent commits per workspace sub-agent commit policy:
  sub-agents leave work uncommitted; Architect reviews + commits.

## Next action

- This turn: `.gitignore` + `.claude/specs/task-poc-v1.md`.
- This turn: `git init -b main` + first commit + `gh repo create` + push.
- This turn: dispatch `webdev-marvin` sub-agent with the spec.
- Architect reviews the diff, runs gates, commits, reports to Boss.

## PoC scope lock (Boss 2026-07-30 14:05)

Boss reframed v1 as a **PoC — top-priority functionality only**. The
research's "go-wide" instinct rescoped; cost and clash are explicitly
out. This is a major scope-down from the research report.

### Locked decisions (Boss answers to research open questions)

- **(A) API key management** — env vars (`.env.local`, git-ignored,
  `VITE_GEMINI_API_KEY` + `VITE_FIREWORKS_API_KEY`). No Cloud Function
  proxy. PoC simplicity over hardening.
- **(B) Multi-IFC** — single IFC for PoC. Multi-IFC is an upcoming
  stage.
- **(C) Spanish-only** — all UI strings, system prompts, tool
  descriptions, agent responses, error messages are in Spanish. No
  bilingual UI. Users are Spanish-speaking reviewers.
- **(D partial) PDF source** — NO OCR pipeline. Use pdfjs runtime
  text extraction from the existing `eett-c.pdf`. The bim-specs-mapper
  `PdfViewer.tsx` is reused as-is. RAG corpus is `bim_elements.json`
  + `mapping_presets.json` + runtime-extracted PDF text.
- **(D partial) Shell layout** — same split-view logic from
  bim-specs-mapper (PDF left, 3D viewer center, properties panel
  right). Chat panel added as the primary surface (left rail).
- **(D partial) Deployment** — local-only. `npm run dev` from the
  repo. NO Firebase, no `firebase.json`, no `.firebaserc`. GitHub
  repo for source control: `theagentmarvin/bim-assistant` (public).

### Explicit out-of-scope for PoC

- ❌ Cost estimation
- ❌ Clash queries
- ❌ Multi-IFC navigation
- ❌ Bilingual UI (Spanish only)
- ❌ Authentication / sharing / multi-tenant
- ❌ OCR pipeline (pdfjs runtime text extraction only)
- ❌ Firebase deployment / Firestore / hosting
- ❌ Tool breadth beyond 3 — `get_element_details`, `list_sections`,
  `compare`, `get_model_stats`, `export_session` all deferred to v1.1
- ❌ Corrections feedback loop
- ❌ OpenRouter DeepSeek V3 judge

### PoC tool surface (3 tools only — Spanish names)

- ✅ `consultar_base_de_conocimiento(pregunta, fuente)` — RAG over
  model + spec + mapping corpora.
- ✅ `resaltar_elementos(clase_ifc | seccion_id | filtro | reset)` —
  reuses `Viewer3D.tsx` isolation + Highlighter pipeline.
- ✅ `abrir_seccion_pdf(seccion_id | consulta | pagina)` — reuses
  `PdfViewer.tsx` page navigation + a sectionIdToPage heuristic.

### RAG strategy (replaces OCR-markdown chunks)

- **Model corpus** — `bim_elements.json` chunked by `ifc_class`,
  embedded via `fireworks/qwen3-embedding-8b` at app boot, cached in
  IndexedDB.
- **Mapping corpus** — `mapping_presets.json` chunked per section.
- **Spec corpus** — pdfjs runtime text extraction on app boot,
  page-level chunks, embedded.
- **No reranker for PoC.** Cosine similarity only, top-K=5.

### GitHub repo

- Repo: `theagentmarvin/bim-assistant` (public).
- Initial commit: planning artifacts (this tracker + research + spec).
- Subsequent commits per workspace sub-agent commit policy:
  sub-agents leave work uncommitted; Architect reviews + commits.

## Next action

- This turn: write .gitignore, write `.claude/specs/task-poc-v1.md`
  (the full implementation spec for the sub-agent).
- This turn: `git init` + first commit + `gh repo create` + push.
- This turn: dispatch `webdev-marvin` sub-agent with the spec.
- Architect reviews the diff, runs gates, commits, reports to Boss.

## Session log — 2026-08-04

### v1.1 — viewer experience pass 1 (Boss 09:50 CLT)

Locked two improvements on `src/viewer/Viewer3D.tsx`:

1. **`camera.controls.addEventListener("update", () => fragments.core.update())`** — adopted from `engine_components/packages/core/src/core/Worlds/example.ts`. Eliminates the perception of rigid / laggy navigation by repainting fragments on every camera tick.
2. **Click-vs-drag pointer split** — replaced the previous `pointerdown`-only async castRay with `pointerdown` / `pointermove` / `pointerup` / `pointercancel` + `setPointerCapture`. The previous flow raced against camera-controls, so a click+drag (camera orbit) would resolve the castRay against the new camera state and clear the selection. New flow: only picks on `pointerup` if the pointer moved less than `DRAG_THRESHOLD_PX = 5` from its down position. Drags preserve the active selection.

Style polish from the same example file:
- `world.renderer.showLogo = false` (branded as Salfa BIM Agent 01 — no upstream watermark).
- Removed redundant `renderer.three.setClearColor` call. `scene.three.background` remains as the single source of truth for the background.

**Commit pending** (to be `feat(viewer): TOE Worlds/example.ts styling + click-vs-drag pointer handling`).
