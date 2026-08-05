# bim-assistant — Handoff for fresh Architect sessions

> **Read this file first** when picking up bim-assistant in a new session.
> It's the bootstrap doc the workspace-level AGENTS.md can't give you.

## 0. TL;DR

Spanish chat-first "Salfa BIM Agent 01 for BIM" PoC. Chat agent (Gemini) with 3 tools over a single IFC + a spec PDF. Right pane is a tabbed view (Spec PDF | Cuantificación). Local-only, no auth, no deploy, single IFC.

- **Repo:** `~/projects/bim/bim-assistant/`
- **GitHub:** `https://github.com/theagentmarvin/bim-assistant`
- **Branch:** `main`
- **Latest commit:** see `git log --oneline -1` (often `1cd91d4` or newer)

## 1. Project identity

**bim-assistant** is a PoC of a Spanish chat-first agent over a single BIM model (IFC) + a Chilean spec PDF. It points at SalfaCorp internal users (PMs BIM, spec reviewers) doing cross-checking between model and specs.

**Value hypothesis:** reduce manual spec-review time. User asks in Spanish *"muéstrame los muros exteriores y dime qué dice la especificación sobre el siding"* → chat answer with citation + 3D viewer with matching elements highlighted in orange + PDF opened to the relevant page.

**Locked PoC constraints** (Boss-approved, do NOT change without asking):
- Spanish-only UI/prompts/responses (no bilingual)
- Single IFC, single spec PDF
- No auth / no multi-tenant / no Firebase deploy
- No cost / clash / spatial queries in v1.0
- No OCR — pdfjs runtime text extraction only
- 3-tool surface (`consultar_base_de_conocimiento`, `resaltar_elementos`, `abrir_seccion_pdf`)

## 2. Repo layout

```
bim-assistant/
├── AGENTS.md                 ← you are here
├── README.md                 ← Spanish + English setup walkthrough
├── PROJECT-TRACKER.md        ← high-level state (older doc)
├── package.json              ← React 18 + Vite + TOE + pdfjs + Fireworks + Gemini
├── .env.example              ← VITE_GEMINI_API_KEY + VITE_FIREWORKS_API_KEY placeholders
├── .env.local                ← (gitignored) Boss's real keys, mode 0600
├── public/
│   ├── eett-c.pdf            ← the spec PDF (551 KB)
│   └── SZA_BDE3_ARQ_C1.ifc   ← the BIM model (6.4 MB)
├── data/
│   ├── bim_elements.json     ← 291 BIM elements parsed for RAG (369 KB)
│   └── mapping_presets.json  ← spec→IFC mappings (29 KB)
└── src/
    ├── main.tsx, App.tsx, App.module.css
    ├── agent/                ← agent loop, tools, schema, prompts, indexer, retriever
    ├── components/           ← ChatPanel, PdfViewer, ViewerPane, QuantificationPanel, RightPaneTabs, AgentStatus, ModelPropertyPanel
    ├── viewer/               ← Viewer3D (TOE), filterEvaluator, blobWorker, webIfc
    ├── data/                 ← llm.ts (Gemini + Fireworks clients), storage.ts (IndexedDB), elements.ts, mappings.ts
    ├── styles/               ← tokens.css, index.css
    ├── quantification/       ← QuantificationTable type
    ├── utils/                ← copy.ts (TSV/CSV formatters)
    ├── types.ts              ← shared types
    └── .claude/specs/        ← design docs (see §6)
```

## 3. Quick start

```bash
cd ~/projects/bim/bim-assistant
npm install                                  # if needed
# .env.local already exists with Boss's keys (chmod 600)
npm run dev                                   # http://localhost:5173/

# Gating checks before committing
npm run typecheck
npm run build                                 # ~14s, 3-way manualChunks (toe / pdfjs / app)
```

Vite is currently running on `http://127.0.0.1:5173/` (background process — see `process list`). Boss tests via HMR; refresh the browser tab if state goes stale.

## 4. What's working today (Boss verified end-to-end)

| Feature | Commit | Notes |
|---|---|---|
| Vertical split-view (chat \| tabbed pane \| 3D \| props) | `1a6f5e8` | 4-column flex layout |
| LLM client wired to Gemini 3.1-flash-lite + Fireworks dim=1024 | `b9c453d` | See §5 for why gemini-3.1-flash-lite, not gemini-flash-latest |
| RAG-for-IFC step 1: IFC_CLASS_ENUM + filter plumbing + flat property metadata | `14333c7` | Enum prevents class-name hallucinations |
| Gemini v1beta function-call fix: role:"user" + thought_signature round-trip | `fda82f3` | See §5 |
| Quantification tab + 429 quota fix + row-click highlight + group-by-name | `a2cf66a` | 3 tools + tabbed right pane |
| require clase_ifc when user names an element type | `8bc4995` | Prompt rule + tool safeguard |
| Row width + ID strip + clickable rows + dynamic columns | `1cd91d4` | :NNNN stripped, 220px first column, × button, add-column dropdown |
| Zoom-to-row on cuantificación click (camera frames matching set) | `TBD` | Live dev verified 2026-08-05: row click → camera moves to element. See §5i |

**3-tool surface** (`src/agent/tools.ts`):
1. `consultar_base_de_conocimiento(pregunta, fuente?, tabla?)` — RAG; can return `tabla` for the Quantificación tab
2. `resaltar_elementos(clase_ifc? \| seccion_id? \| filtro? \| reset?)` — viewer highlight
3. `abrir_seccion_pdf(seccion_id? \| consulta? \| pagina?)` — PDF navigation

**Sample queries Boss uses to verify (all in Spanish):**
- "muéstrame las ventanas" → enum → 7 windows highlighted in orange
- "lista los muros con su material" → tabla: 68 rows, Nombre + Material columns, :NNNN stripped
- "qué tipo de muro se usa más" → grouped by name, Cantidad > 1 per type
- "dame una tabla con las ventanas que se están utilizando en el proyecto su largo y ancho" → 7 VENTANA_* types in tab

## 5. Known gotchas (read this before debugging anything)

### 5a. `gemini-flash-latest` aliases to `gemini-3.6-flash` which has a 20 req/day free-tier quota

`gemini-3.6-flash` is the default for the `gemini-flash-latest` alias. Free tier = 20 requests/day. We exhaust it in ~30 minutes of dev/QA testing.

**Fix:** `src/data/llm.ts` is pinned to `gemini-3.1-flash-lite` (separate quota bucket, fresh 20/day, verified 200 OK with Boss's AQ. token). Do NOT switch back to `gemini-flash-latest` without confirming the quota has reset.

Fallback chain (verified 2026-07-30):
- `gemini-flash-latest` → 429 (RESOURCE_EXHAUSTED on gemini-3.6-flash)
- `gemini-3.1-flash-lite` → 200 OK ✓
- `gemini-3.5-flash` → 503 (overloaded)
- `gemini-2.0-flash` / `gemini-2.5-pro` → 429 (also quota-exhausted)
- `gemini-2.5-flash-lite` → 404 (deprecated)

### 5b. Function-call roles: `role: "user"`, NOT `role: "function"`

Gemini v1beta (gemini-2.5+, gemini-flash-latest, gemini-3.x) deprecated the legacy `role: "function"` for function responses. HTTP 400: *"Role 'function' is not supported."*

```ts
// ✅ correct (Gemini v1beta)
contents.push({ role: "user", parts: [{ functionResponse: { name, response } }] });

// ❌ broken (legacy)
contents.push({ role: "function", parts: [{ functionResponse: { name, response } }] });
```

The TypeScript type union in `src/data/llm.ts` is `role: "user" | "model"`. Don't add `"function"`.

### 5c. `thoughtSignature` must round-trip on `functionCall` parts

Newer Gemini models attach a `thoughtSignature` (opaque base64) to every `functionCall` part to preserve reasoning context across turns. Stripping it triggers HTTP 400: *"Function call is missing a thought_signature"*.

`src/data/llm.ts` includes `thoughtSignature?: string` in both `GeminiContent.parts` (request) and `GeminiResponsePart` (response). `src/agent/loop.ts` propagates it when capturing the model's response.

### 5d. `thought_signature` URL has Cloudflare email-obfuscation gotcha

If you ever pin an unpkg CDN URL with `@thatopen/fragments@3.4.5` and a literal `@`, Cloudflare rewrites `@` to `[email protected]`. Use `%40` instead. (Not currently relevant — we use the Vite-bundled worker.)

### 5e. Tool calls need `role: "user"` even for tool results

Yes, redundant with 5b but worth repeating: when the agent calls a tool and you want to feed the result back to Gemini, the role is **always** `user`. The tool's response goes inside `parts[].functionResponse`. See `src/agent/loop.ts` for the working pattern.

### 5f. `projectRowFull` uses Spanish labels as keys for agent's columns

The Quantification table's `filas[i]` is keyed by Spanish labels (`row["Nombre"]`) for the agent's chosen columns, and by raw property names (`row["is_external"]`) for the rest. The panel can directly `row[col]` without re-resolving labels. Don't refactor this — TS index-signature constraints make Record intersections collapse to the value type.

### 5g. `filterEvaluator.item[rule.p]` is top-level only

No nested-property queries. "muros arriba de 3m" → empty result. Documented as expected-broken. v1.1 candidate.

### 5h. Sub-agent dispatch policy (workspace-level)

- **Default implementation sub-agents** (coder, webdev-marvin, pixel-marvin, wiki-marvin, etc.) → model `minimax-portal/MiniMax-M3`, free tier.
- **Critic + Architect reasoning work** → model `deepseek/deepseek-v4-pro`.
- **Sub-agents leave work UNCOMMITTED.** Architect reviews the diff + runs gates + commits.
- **Two-layer completion signal:** overwrite `.last-task.md` + best-effort `sessions_send` to Architect's stable key.

### 5i. FragmentsModel bounding-box API: `getMergedBox`, NOT `getBBoxes` (Boss 2026-08-05 15:38)

The runtime model returned by `frags.load()` is `_FragmentsModel`. Its bounding-box surface is:

- `model.getMergedBox(localIds): Promise<THREE.Box3>` — the **merged** union box, already in **world space** (the manager applies `model.object.matrixWorld` before returning). **This is what zoom-to-row needs.**
- `model.getBoxes(localIds): Promise<THREE.Box3[]>` — an **array** of per-item boxes (NOT merged). Don't use for fit.
- `model.getBBoxes(...)` — **does not exist** on the runtime model. It's a `VirtualFragmentsModel` method. Calling it returns `undefined` and the auto-fit path silently no-ops (highlight fires, camera stays still).
- `model.getFullBBox(): Promise<THREE.Box3>` — the full model box in world space. Use for the "Reset view" handler.

Lesson: don't trust the OBC surface names without `grep`-ing the actual `@thatopen/fragments` `dist/index.cjs` — the typed view is happy to lie about a method that compiles but throws / returns undefined at runtime.

## 6. Specs (read in this order if you're picking up work)

- `.claude/specs/task-poc-v1.md` — the locked PoC scope (constraints, locked decisions)
- `.claude/specs/task-rag-for-ifc.md` — implemented in `14333c7`
- `.claude/specs/task-quantification-tab.md` — implemented in `a2cf66a` + refined in `8bc4995`/`1cd91d4`
- `.claude/specs/bim-assistant-scope-for-iteration.md` — value-prop / features scope doc Boss used with an external agent (no code, just product context)

## 7. What's deferred to v1.1+ (do NOT scope-creep into the PoC)

| Capability | Why deferred | Status |
|---|---|---|
| Spatial / hosted-element queries ("ventanas de la fachada sur") | No IFC graph traversal in PoC | v1.1 candidate |
| Cost estimation (cubicar) | Out of PoC scope per Boss | v1.1 candidate |
| Clash detection | Out of PoC scope per Boss | v1.1 candidate |
| NL-to-filter DSL | Agent constructs Filter JSON directly | v1.1 candidate |
| Schema-primer RAG chunk (separate doc) | Inline JSON example + flat property inventory sufficient | v1.1 candidate |
| Pre-compute embeddings at build time | Manual `?t=fresh-…` reload OK for now | v1.1 candidate |
| Multi-IFC navigation | Single IFC locked | v1.1 candidate |
| Bilingual (English) UI | Spanish-only locked | v1.1 candidate |
| Saved filter presets / user-defined filters | None yet | v1.1 candidate |
| Export session / sharable review notes | None yet | v1.1 candidate |
| 5 additional tools (get_element_details, list_sections, compare, get_model_stats, export_session) | 3-tool surface locked for PoC | v1.1 candidate |
| Nested-property queries (`geometry_summary.height_m`) | `filterEvaluator` top-level only | Graceful empty path, v1.1 candidate |

## 8. Hard out-of-scope reminders (don't accidentally add)

- ❌ No Firebase deploy / hosting (PoC is local-only via `npm run dev`)
- ❌ No OCR pipeline (pdfjs runtime text extraction only)
- ❌ No bilingual UI / Spanish-English toggle
- ❌ No cost / clash / spatial queries
- ❌ No tool surface beyond the 3 listed
- ❌ No corrections feedback loop
- ❌ No auth / multi-tenant / sharing

## 9. Current state — what's running

- **Dev server:** `npm run dev` running on `http://127.0.0.1:5173/` (background process, see `process list`). Boss tests via HMR.
- **API quota:** `gemini-3.1-flash-lite` — fresh 20 req/day bucket (Boss's AQ. token). After 20 dev/QA queries today the bucket will exhaust and we'll see 429s; switch model OR wait until tomorrow UTC.
- **IndexedDB:** caches 45 chunks (18 model + 20 mappings + 7 PDF pages). Persists across reloads. Click "Reindexar" in AgentStatus to force rebuild.
- **GitHub:** all 9 of today's commits pushed to `main` (`0a42572..1cd91d4`).

## 10. Known quirks / things to check first if something breaks

1. **API key missing?** → `.env.local` exists at `~/projects/bim/bim-assistant/.env.local`, mode 0600, with `VITE_GEMINI_API_KEY` and `VITE_FIREWORKS_API_KEY`. If Vite was started before the file existed, restart it.
2. **Quota 429?** → already on `gemini-3.1-flash-lite`. If still 429, the daily bucket is exhausted; wait for reset OR rotate to a different free model.
3. **Viewer doesn't render the IFC?** → check the worker's blob URL: should be a Vite-bundled asset, not a hard-coded CDN URL.
4. **Agent loop stuck / no response?** → check `src/agent/loop.ts` callbacks (`onToolCallStart`, `onToolCallEnd`, `onFinalAnswer`, `onError`) and `src/App.tsx`'s `handleSend`. The chat should never be silent — at minimum `onError` fires.
5. **Chat says "Listo · 45 fragmentos indexados" but queries fail?** → keys exist but are stale; Vite needs a restart to re-read `.env.local`.

## 11. How to keep this doc fresh

When you ship a new feature or change something load-bearing (model, auth, deployment, architecture), update AGENTS.md in the same commit. This is the first thing the next session reads.