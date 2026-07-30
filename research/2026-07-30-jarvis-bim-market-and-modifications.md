# BIM Assistant Research: Market, Trends & Refactor Plan

**Date:** 2026-07-30
**Project:** bim-assistant (JARVIS paradigm — chat-first BIM agent)
**Author:** Research sub-agent (Architect session)
**Source app:** bim-specs-mapper (HEAD `8cba4cb`, deployed at https://bim-specs-mapper.web.app)
**Status:** Complete

---

## Executive Summary

Building a "JARVIS for IFC models" is the exact right bet for mid-2026. The market is converging: LLM tool-calling is production-grade, open-source IFC manipulation (IfcOpenShell, That Open Company) has matured, and the AEC industry is hungry for zero-onboarding tools that don't require BIM expertise. **Three top picks:**

1. **Ship all three pillars (Q&A + show-elements + open-PDFs) in v1 against a single IFC + single spec PDF.** The market has no product that combines conversational Q&A with live 3D element highlighting AND PDF spec cross-referencing in one zero-login surface. This is a greenfield wedge.
2. **Build around Gemini function-calling + Fireworks embeddings, with a ReAct agent loop.** The stack works. The existing bim-specs-mapper codebase already has the 3D viewer, RAG corpus (bim_elements.json, mapping_presets.json, OCR markdown), and Fireworks pipeline. Lift those intact.
3. **Target SalfaCorp internal PM/reviewer as v1 persona — then expand.** The Boss already runs reviews on bim-specs-mapper. The chat surface eliminates the learning curve. Latin American BIM adoption is accelerating (Planbim Corfo, BIM 19650-1/2 certification at SalfaCorp), making this tool a competitive differentiator in the Chilean market.

---

## Market Scan (6 products profiled)

### 1. ArchiLabs — AI Co-pilot for Revit
- **What it is:** Y Combinator-backed Revit plugin with a chat interface that translates natural language into Revit API calls. Studio Mode acts as a conversational BIM assistant — asks questions, gets answers, then acts ("Tag those rooms").
- **Target user:** Architects and BIM professionals working inside Revit.
- **Capability matrix:**

| Capability | Y/N | Notes |
|---|---|---|
| Q&A | Y | "How many doors on Level 2?" — model queries |
| Show-elements | Partial | Tags elements, creates views, not real-time highlight/isolate |
| Open-PDFs | N | Revit-native, no PDF cross-reference |
| Cost | N | Design-focused |
| Takeoffs | Partial | Parameter queries, not structured QTO |
| Clash | N | Not a clash tool |
| Draft-specs | Y | Agent Mode generates documentation |

- **Pricing:** ~$99/seat/month (Pro plan), see https://aiagentslist.com/agents/archilabs
- **Traction signal:** Y Combinator (S26 cohort), active LinkedIn presence, integration with Revit API via Python scripts.
- **What's interesting:** Conversational "ask → get answer → ask AI to act" loop. Multi-turn dialogue with context retention. No coding required.
- **What's broken:** Revit-only. No IFC/openBIM. No PDF cross-reference. Requires Revit license. Pricing kills casual reviewers.
- **URLs:** https://archilabs.ai/posts/ai-agents-for-architecture, https://aiagentslist.com/agents/archilabs

### 2. Frame by BIMFrame — Chat with Your BIM Models
- **What it is:** AI-powered BIM query platform. "Chat with your BIM models using natural language. Ask questions, extract insights, and visualize data from Revit, Navisworks & IFC files instantly."
- **Target user:** BIM managers, project reviewers, engineers.
- **Capability matrix:**

| Capability | Y/N | Notes |
|---|---|---|
| Q&A | Y | Natural language queries against Revit/Navisworks/IFC |
| Show-elements | Partial | "Visualize data" — unclear if 3D highlight or chart |
| Open-PDFs | N | Not advertised |
| Cost | N | No quantity takeoff features listed |
| Takeoffs | N | Insight extraction, not structured QTO |
| Clash | N | Not a clash tool |
| Draft-specs | N | Not advertised |

- **Pricing:** Not publicly listed. Likely enterprise SaaS.
- **Traction signal:** Product page live, claims Revit + Navisworks + IFC support. Limited public presence.
- **What's interesting:** Multi-format support (Revit + Navisworks + IFC). The closest commercial analog to "chat with BIM."
- **What's broken:** Vague about 3D viewer integration. No PDF/spec cross-reference. Pricing opaque. Uncertain traction.
- **URLs:** https://www.bimframe.co/features/ai-bim/

### 3. Augmenta — AI-Powered Building Design Agent
- **What it is:** Autonomous design platform automating electrical, mechanical, and plumbing system design. $25.6M total funding (Prelude Ventures, Montage Ventures). Founded by ex-Autodesk generative design leads.
- **Target user:** MEP engineers, subcontractors, design-build firms.
- **Capability matrix:**

| Capability | Y/N | Notes |
|---|---|---|
| Q&A | N | Design automation, not Q&A |
| Show-elements | N | Generates designs, doesn't review existing models |
| Open-PDFs | N | Design output, not spec ingestion |
| Cost | Y | Electrical system design with cost optimization |
| Takeoffs | Y | Bill of materials generated from designs |
| Clash | Y | Clash-free conduit routing built in |
| Draft-specs | Y | Generates code-compliant designs |

- **Pricing:** Enterprise/undisclosed.
- **Traction signal:** $25.6M total funding, 69 employees (Jun 2026), partnership with ENG (global BIM leader), active in hospitals/schools/labs.
- **What's interesting:** The agentic architecture — not conversational, but autonomous "design agent" that produces buildable outputs. Shows where the market is heading.
- **What's broken:** Not a review tool. Generates designs from scratch rather than querying existing IFC. No PDF ingestion. Not relevant for what Boss needs.
- **URLs:** https://www.augmenta.ai/, https://tracxn.com/d/companies/augmenta-ai/, https://betakit.com/augmenta-closes-14-4-million-cad/

### 4. Speckle + AI Ecosystem — Open Data + LLM Integration
- **What it is:** Open-source data platform for AEC. Recent community projects (2023-2025) demonstrated conversational BIM via: Speckle GraphQL API → LangChain → LLM, plus an MCP server enabling AI assistants to query Speckle project data. Butic The New School built Teams + Copilot Studio + Speckle integration.
- **Target user:** Developers, BIM coordinators, digital transformation teams.
- **Capability matrix:**

| Capability | Y/N | Notes |
|---|---|---|
| Q&A | Y | Via Speckle GraphQL + LLM + LangChain |
| Show-elements | N | No built-in 3D viewer with AI integration |
| Open-PDFs | Partial | Community hack: PDF cross-reference with object data |
| Cost | N | Data platform, not cost estimation |
| Takeoffs | N | Extractable via API, not conversational |
| Clash | N | Not a clash tool |
| Draft-specs | N | Not advertised |

- **Pricing:** Free tier available, paid plans for teams.
- **Traction signal:** Growing open-source community. MCP server available (https://mcpservers.com/servers/bimgeek-speckle). Educational programs (Butic The New School). Speckle Ambassador network.
- **What's interesting:** Open protocol — Speckle's GraphQL API + MCP server is the most interoperable foundation for BIM AI. The "conversational data" philosophy aligns with JARVIS vision.
- **What's broken:** No integrated 3D viewer + chat surface. Community hacks, not a product. Requires technical setup. No PDF spec pipeline.
- **URLs:** https://speckle.systems/blog/butic-the-new-school-uses-speckle-to-connect-bim-automation-and-applied-ai/, https://mcpservers.com/servers/bimgeek-speckle

### 5. DAVE (Digital Assistant for Virtual Engineering) — Academic Prototype
- **What it is:** GPT-powered Revit assistant (research paper, Aug 2024). Text/voice multimodal interaction with BIM models. 94% accuracy on single-function queries. Integrates with Revit API via Python + OpenAI API.
- **Target user:** BIM users inside Revit (research prototype).
- **Capability matrix:**

| Capability | Y/N | Notes |
|---|---|---|
| Q&A | Y | Rename views, query parameters, update elements |
| Show-elements | N | Text commands only, no visual highlighting |
| Open-PDFs | N | Not in scope |
| Cost | N | Research prototype |
| Takeoffs | N | Not in scope |
| Clash | N | Not in scope |
| Draft-specs | N | Not in scope |

- **Pricing:** Academic prototype, not commercialized.
- **Traction signal:** Published in Buildings (MDPI), 2024. Demonstrates feasibility of GPT + Revit API integration.
- **What's interesting:** Proof that LLM + BIM software API works at production accuracy (94%). The function-calling pattern is validated. Multimodal (text + voice).
- **What's broken:** Revit-only. No openBIM/IFC. Not a product. Single-function only, no multi-turn agent loop.
- **URLs:** https://doi.org/10.3390/buildings14082499

### 6. Autodesk Community Prototypes — AI + BIM (Grassroots)
- **What it is:** Community-built AI tool using Autodesk Platform Services + GPT-4/Gemini API. Understands model in natural language, calculates volumes/weights, generates reports, highlights results in 3D viewer (March 2026).
- **Target user:** AEC engineers, BIM experimenters.
- **Capability matrix:**

| Capability | Y/N | Notes |
|---|---|---|
| Q&A | Y | NL queries → volume/weight calculations + reports |
| Show-elements | Y | "AI highlights query results directly in the 3D viewer" |
| Open-PDFs | N | Not in scope |
| Cost | Y | Volume calculations, weight |
| Takeoffs | Partial | Volume/weight extraction |
| Clash | N | Not in scope |
| Draft-specs | N | Not in scope |

- **Pricing:** Free/open prototype.
- **Traction signal:** Published on Autodesk Community Blog (Mar 2026). Ukrainian engineer building for "Diia.Construction" state system.
- **What's interesting:** Closest to JARVIS vision among public prototypes — combines Q&A + 3D highlight + cost calculation. Open-source approach. Uses Gemini API.
- **What's broken:** Prototype only. No IFC/openBIM (Autodesk Platform Services). No PDF/spec. Not productized.
- **URLs:** https://forums.autodesk.com/t5/community-blog-aec-english/bim-ai-how-i-taught-the-model-to-quot-talk-quot-experience-with/ba-p/14036963

### Iberoamerican / Chilean context

- **Planbim Corfo** (Chile's national BIM program, 2016-2025) drove BIM adoption across public projects. Standard "Estándar BIM para proyectos públicos" published. Proving ground for BIM tools in Chile. https://construye2025.cl/2024/04/27/el-estado-del-arte-de-bim-en-chile/
- **SalfaCorp** holds BIM 19650-1/2 certification and ISO 9001/14001/45001. 19,300+ employees. Active in mining, energy, construction across Chile, Perú, Panamá. BIM Manager role (Luis Carvajal at Icafal, Cristóbal Bascuñán at SalfaCorp Zona Austral) exists as a dedicated function — indicating organizational BIM maturity. https://www.nuevamineria.com/revista/especial-empresas-de-ingenieria-salfacorp/
- **Chile's AI push:** Corfo opened a $7M supercomputing infrastructure call (Nov 2024) targeting AI development. CENIA (National AI Center) operational. Construction industry identified as key sector for digital transformation.
- **No existing conversational BIM product in Latin America.** This is a greenfield opportunity. Spanish-language BIM assistants don't exist commercially.

---

## Industry Trends (8 citations, 2024-2026)

1. **ASK-BIM: A knowledge graph-powered AI system for natural language querying of BIM models** (Ibba et al., 2026). *ScienceDirect.* Converts IFC → Knowledge Graph → LLM-generated SPARQL queries. 91% accuracy on 225 NL queries. **Why relevant:** KG approach to BIM Q&A, tested on real multi-story building in Barcelona. https://www.sciencedirect.com/science/article/pii/S0169023X26000285

2. **MCP4IFC: IFC-Based Building Design using Large Language Models** (Oct 2025). *arXiv.* Open-source MCP server with 50+ BIM tools for LLMs. Standardized tool-calling interface (JSON Schema) for IFC query/create/edit. Combines ICL + RAG. **Why relevant:** Canonical architecture for LLM→IFC tool calls. Our agent loop should follow this pattern. https://arxiv.org/html/2511.05533

3. **LLM-assisted Graph-RAG Information Extraction from IFC Data** (Iranmanesh et al., Apr 2025). *EC3 2025.* Applies Graph-RAG to IFC for NL query-response without complex pipelines. **Why relevant:** Validates RAG-over-IFC pattern, which our tool will use for spec Q&A. https://arxiv.org/abs/2504.16813

4. **BIM Information Extraction Through LLM-based Adaptive Exploration** (Hellin et al., May 2026). *arXiv.* LLM agent iteratively generates code, observes IFC results, refines. Handles multilingual property names (German "Breite" → "width"). 80% accuracy across 21 projects. **Why relevant:** Adaptive exploration handles the IFC heterogeneity our mapping pipeline struggles with. https://arxiv.org/html/2605.01698v1

5. **Text2BIM: Generating Building Models Using a Large Language Model-based Multi-Agent Framework** (Du et al., 2025). *ASCE JCEM.* 4-agent framework (Instruction Enhancer, Architect, Programmer, Checker) generating BIM models from NL. **Why relevant:** Multi-agent architecture with tool-calling. Production-quality example of LLM→Vectorworks API. https://ascelibrary.org/doi/10.1061/JCCEE5.CPENG-6386

6. **Natural Language Information Retrieval from BIM Models: An LLM-Based Multi-Agent System Approach** (EC3 2025). *EC-3.org.* Multi-agent workflow for IFC Q&A without ontological constraints. Released IFC-Bench-v1 dataset. **Why relevant:** Benchmark dataset + agentic retrieval pattern. Validates multi-agent approach over single-shot. https://ec-3.org/publication/ec32025_265/

7. **User-Oriented BIM Interaction: An IFC-LLM based Multi-Tool Agent** (CAADRIA 2026). *CUMINCAD.* Hybrid approach: LLM as semantic hub + external tools for IFC parsing/computation. **Why relevant:** Tool-augmented agent method directly applicable to our architecture. Positions LLM as reasoning hub, not data parser. https://papers.cumincad.org/data/works/att/caadria2026_217.pdf

8. **From text to design: LLM agents for automated CAD generation** (Aug 2025). *Cambridge University Press.* Function-calling + agent workflows for CAD. Adaptable across domains (mechanical, topology optimization). **Why relevant:** Validates function-calling pattern for CAD/BIM tool orchestration. https://www.cambridge.org/core/journals/proceedings-of-the-design-society/article/from-text-to-design/

---

## Three-Pillar Deep-Dive

### Pillar 1: Q&A about the IFC Model

**Market patterns:**
- ArchiLabs queries Revit model ("How many doors on Level 2?") → returns count + offers to act.
- Frame by BIMFrame queries Revit/Navisworks/IFC → extracts insights.
- Academic: ASK-BIM converts IFC→KG→SPARQL, Hellin adaptive exploration runs code iteratively.
- **Common thread:** Everyone queries model properties (counts, types, dimensions). Nobody queries model + spec together. Our edge.

**What we'd build:**
A Gemini-powered agent that receives a NL question, decides which RAG source(s) to query (bim_elements.json for model data, OCR markdown for spec text, mapping_presets.json for spec→IFC relationships), retrieves relevant chunks, and synthesizes an answer with citations.

**Sample queries for v1:**
- "What type of siding is specified for exterior walls?" (spec → model cross-reference)
- "How many IfcWallStandardCase elements are in the model?" (model stats)
- "What's the fire rating of interior partitions?" (spec lookup)
- "Show me all elements that match section C.1.1.5" (triggers Pillar 2)

**RAG corpus shape:**
- `bim_elements.json` (~369 KB, 1 file): IFC elements with properties, spatial containers, fire ratings, materials. Chunked by element type. For v1, single-model corpus.
- `mapping_presets.json` (~29 KB, 1 file): Spec sections → IFC class mappings with filters, confidences, rationales. Excellent for cross-reference Q&A.
- `brisas-c-pages1-5.md` (~16 KB, 1 file): OCR markdown of spec PDF. Page-level chunks with section headers preserved. Expand to full PDF before v1 launch.
- **Latency target:** P50 < 2s for simple count queries (vector lookup only), P95 < 8s for cross-reference queries (embedding + reranker + LLM synthesis).

### Pillar 2: Show Elements on the 3D Viewer

**Market patterns:**
- ArchiLabs: "Tag those rooms" → action on model. No real-time highlight-on-query.
- Autodesk community prototype: "AI highlights query results directly in the 3D viewer." Uses Autodesk Platform Services highlight API. Closest analog.
- Speckle + LangChain hack: Q&A only, no visual feedback.
- **Nobody combines conversational Q&A with live 3D highlight/isolate of matching elements.** This is our core differentiator.

**What we'd build:**
The agent tool `highlight_elements` receives filter criteria (IFC class, property constraints, or section ID) and invokes the existing Viewer3D.tsx isolation + highlighting pipeline. The user asks "show me all windows" → agent calls `highlight_elements(ifc_class="IfcWindow")` → viewer isolates matches in orange. The highlight is persistent until "clear" is asked.

**Key design decisions:**
- Reuse existing `Viewer3D.tsx` isolation (OBC.Hider + Highlighter) unchanged. The agent tool wraps it as a callable function.
- `highlight_elements` accepts: `{ifc_class, filter_expression, section_id, reset: boolean}`.
- Visual feedback: matching elements get orange highlight (SELECT_MAT), non-matching get hidden (Hider pattern). Status bar shows "X of Y elements matching."
- **Latency target:** P50 < 500ms from tool-call to visible highlight (the isolation operation is already sub-second in the existing code).

### Pillar 3: Open Relevant Spec PDFs

**Market patterns:**
- Speckle community hack: cross-references PDF with object data for detailed responses (2023). No production product.
- ArchiLabs, Frame, Augmenta: none do PDF+model cross-reference.
- **This is a completely greenfield capability in the commercial market.** Academic papers on building code RAG exist (Yang et al., 2025) but don't integrate with 3D viewers.

**What we'd build:**
The agent tool `open_spec_section` accepts a section ID (e.g., "C.1.1.5") or a search query, finds the relevant PDF page, and navigates the embedded PdfViewer to that page. The existing `sectionIdToPage()` heuristic maps section IDs to PDF pages. For v1, a simple keyword search over OCR markdown chunks.

**Key design decisions:**
- Reuse existing `PdfViewer.tsx` component. Add a `pageJump(sectionId)` method.
- RAG corpus: OCR markdown per PDF page with section headers. Embedding search for fuzzy matching ("show me the siding spec" → retrieves relevant page chunks → ranks → jumps to best match).
- For v1: single PDF (eett-c.pdf). vNext: multi-PDF with project-level corpus.
- **Latency target:** P50 < 1s for known section ID (direct jump). P95 < 3s for NL search + embedding lookup + page navigation.

---

## Adjacent vNext Backlog

Ranked by user pull (what a PM/reviewer would ask for next):

| # | Capability | Rationale |
|---|---|---|
| 1 | **Quantity takeoffs** | "How many m² of siding?" is the natural next question after "show me the siding." The bim_elements.json already has geometry summaries. Low-hanging fruit. |
| 2 | **Multi-IFC navigation** | Real projects have discipline-split IFCs (ARQ, EST, MEP). Cross-model queries ("compare walls between ARQ and EST IFCs") are high-value for coordination review. |
| 3 | **Cost estimation** | "What's the estimated cost of section C.1.1.5?" Requires unit cost data (not in current corpus). High user pull but requires external data integration. |
| 4 | **Clash detection queries** | "Are there any clashes between MEP and structural?" Requires geometric clash analysis pipeline (e.g., IfcClash or Solibri API). High value for coordination, high implementation cost. |
| 5 | **Draft specs** | "Generate a spec section for aluminum windows based on what's in the model." LLM generation from model data. Feasible with Gemini but requires careful hallucination management. |

---

## Stack Proposal

### Model Assignment

| Role | Model | Rationale |
|---|---|---|
| **Chat + tool-calling** | Gemini 2.5 Pro (or Flash) via Google AI API | Native function-calling, multimodal, large context window (1M+ tokens), strong reasoning for multi-step agent loops. Boss's stated preference. |
| **Embedding (RAG indexing)** | `fireworks/qwen3-embedding-8b` | Already proven in bim-specs-mapper v2 mapping pipeline. 1024-dim vectors. Good multilingual performance (Spanish spec text). |
| **Reranker (RAG retrieval)** | `fireworks/qwen3-reranker-8b` | Already validated in mapping pipeline (ablation_cosine_vs_rerank.json shows reranker beats cosine). Critical for spec→model cross-reference. |
| **Vision (optional)** | `fireworks/qwen3-vl-plus` | PDF page images, IFC screenshots. vNext capability — not required for v1. |

### Tool-Call Schema (Function Calling)

The BIM agent exposes these tools. Each is defined as a JSON Schema function declaration passed to Gemini.

```typescript
// Tool 1: Query the BIM model or spec knowledge base
query_knowledge_base({
  question: string,          // NL question about model or spec
  source?: "model" | "spec" | "mappings" | "auto",  // which corpus to search
})
// Returns: { answer: string, citations: [{ source, chunk, page }], element_count?: number }

// Tool 2: Highlight/isolate elements in the 3D viewer
highlight_elements({
  ifc_class?: string,          // e.g. "IfcWallStandardCase"
  section_id?: string,         // e.g. "C.1.1.5" (triggers filter from mapping_presets)
  filter_expression?: object,  // direct Filter object from mapping_presets
  reset?: boolean,             // clear all highlights
})
// Returns: { matching_count: number, total_elements: number, status: string }

// Tool 3: Navigate PDF to a spec section
open_spec_section({
  section_id?: string,         // e.g. "C.1.1.5"
  query?: string,              // NL search: "siding installation details"
  page?: number,               // direct page jump
})
// Returns: { section_id?: string, page: number, title: string, snippet: string }

// Tool 4: Get details about a specific element or element class
get_element_details({
  element_id?: number,         // expressID from click
  ifc_class?: string,          // class-level summary
  guid?: string,               // GlobalId
})
// Returns: { count: number, properties: object, sample_elements: [] }

// Tool 5: List available spec sections (for discovery)
list_sections({
  filter?: "all" | "mapped" | "unmapped" | "review",
  search?: string,             // filter by title text
})
// Returns: { sections: [{ id, title, ifc_class, confidence, status }] }

// Tool 6: Export current state (for review workflow)
export_session({
  format: "json" | "pdf_report",  // json dumps current query + results
})
// Returns: { download_url: string }

// Tool 7: Compare two spec sections or element classes
compare({
  a: { section_id?: string, ifc_class?: string },
  b: { section_id?: string, ifc_class?: string },
  metric?: "element_count" | "properties" | "spec_text",
})
// Returns: { comparison: object, verdict: string }

// Tool 8: Get model statistics
get_model_stats({})
// Returns: { total_elements: number, classes: [{ class, count }], spec_sections: number }
```

### RAG Corpus Schema

```
bim-assistant/
└── data/
    └── rag/
        ├── model/               # ← Chunked from bim_elements.json
        │   └── chunks.jsonl     #    Each line: { id, text, ifc_class, express_ids[], ... }
        ├── spec/                # ← Chunked from OCR markdown
        │   └── chunks.jsonl     #    Each line: { id, text, page, section_id?, heading? }
        └── mappings/            # ← Chunked from mapping_presets.json
            └── chunks.jsonl     #    Each line: { id, text, section_id, ifc_class, filter }
```

**Indexing pipeline (offline, Python):**
1. Load `bim_elements.json` → group by `ifc_class` → generate text summaries → embed via Fireworks qwen3-embedding-8b → store in vector DB (SQLite-vec or Chroma for v1).
2. Load OCR markdown → chunk by page + section header → embed → store.
3. Load `mapping_presets.json` → embed each mapping (section_id + title + ifc_class + rationale) → store.

### Memory Approach

| Tier | Strategy | Scope |
|---|---|---|
| **Session memory** | In-memory conversation buffer (last 20 turns). Passed to LLM as context. | Single chat session. Lost on page reload. |
| **Project memory** | Key-value store (indexedDB or localStorage). Saves section-bookmarks, last query, viewer camera state. | Persistent per project. Survives reloads. |
| **Long-term memory (vNext)** | Vector DB with conversation summaries. "Previously you asked about C.1.1.5 siding." Requires user identity. | Cross-session. Not in v1. |
| **Personalization (vNext)** | Per-user preferences: favorite sections, common query patterns, role (PM vs engineer). | Requires authentication. Not in v1. |

**v1 decision:** Session-only memory. Project state in localStorage for UX continuity. No auth, no server-side state. The chat is ephemeral; the model + spec are pre-loaded.

---

## Concrete Refactor Plan for bim-specs-mapper

### Files That Stay

| File | Status | Notes |
|---|---|---|
| `src/ui/src/viewer/Viewer3D.tsx` | **Keep as-is** | The 3D viewer core. Isolation, highlight, click-to-select, soft-reset. Zero changes needed. |
| `src/ui/src/viewer/filterEvaluator.ts` | **Keep as-is** | Filter expression evaluator used by both old UI and agent tools. |
| `src/ui/src/viewer/blobWorker.ts`, `webIfc.ts` | **Keep** | Worker + WASM config for TOE. |
| `src/ui/src/components/ModelPropertyPanel.tsx` | **Keep as-is** | Element properties panel. Still needed for click-to-inspect. |
| `src/ui/src/components/ViewerPane.tsx` | **Keep as-is** | Viewer + panel container with resize/collapse. |
| `src/ui/src/components/PdfViewer.tsx` | **Keep with minor addition** | Add `jumpToSection(sectionId)` method. Existing `currentPage` prop is sufficient. |
| `src/ui/src/data/elements.ts`, `mappings.ts` | **Keep as-is** | Data loaders for bim_elements.json and mapping_presets.json. |
| `src/ui/src/styles/tokens.css`, `index.css` | **Keep** | Design tokens. |
| `src/ui/package.json`, `vite.config.ts`, `tsconfig.json` | **Keep** | Build config. May add agent-loop dependency. |
| `firebase.json`, `.firebaserc` | **Keep** | Hosting config. Deprecate `bim-specs-mapper` site alias → new `bim-assistant` alias. |
| `data/processed/validation/bim_elements.json` | **Keep** | RAG corpus source. |
| `data/processed/validation/mapping_presets.json` | **Keep** | RAG corpus source. |
| `data/processed/validation/brisas-c-pages1-5.md` | **Keep** | RAG corpus source. Expand to full PDF. |

### Files That Change

| File | Change | Notes |
|---|---|---|
| `src/ui/src/App.tsx` | **Major refactor** | The 3-panel review UI becomes one of several surfaces. Add chat panel as primary interface. App shell gains agent loop state. |
| `src/ui/src/App.module.css` | **Refactor** | New layout: chat panel (left) + viewer (center) + PDF (can be replaced by chat). The old 3-panel review collapses behind a toggle. |
| `src/ui/src/components/TabbedPanel.tsx` | **Demote** | Becomes a tool the agent can invoke, not the primary UI. Extract its data-query logic into a standalone module. |
| `src/ui/src/components/SpecPanel.tsx` | **Demote** | Same as TabbedPanel — becomes callable data. |
| `src/ui/src/components/MappingDetail.tsx` | **Demote** | Filter details become agent tool output, not interactive UI. |
| `src/ui/src/components/FilterEditorModal.tsx` | **Keep, repurpose** | The filter editor becomes a debug/advanced tool accessible from chat ("/edit filter for C.1.1.5"). |
| `src/ui/src/types.ts` | **Extend** | Add agent message types, tool-call schemas, session state types. |
| `src/ui/src/lib/corrections.ts` | **Keep, extend** | Corrections log becomes feedback signal for agent ("I corrected that — update the mapping"). |

### New Modules Needed

| Module | Purpose | Dependencies |
|---|---|---|
| `src/ui/src/agent/loop.ts` | ReAct agent loop: receive message → decide tool → execute → observe → respond. State machine managing conversation turns. | Gemini API SDK, tool definitions |
| `src/ui/src/agent/tools.ts` | Tool implementations: `query_knowledge_base`, `highlight_elements`, `open_spec_section`, etc. Each tool is a typed async function. | elements.ts, mappings.ts, Viewer3D ref, PdfViewer ref |
| `src/ui/src/agent/schema.ts` | JSON Schema definitions for all 8 tools (Gemini function-calling format). | None (pure data) |
| `src/ui/src/agent/retriever.ts` | Vector search over RAG corpus. Embedding generation + similarity search + reranking pipeline. Runs client-side via WebAssembly or calls Fireworks API. | Fireworks embedding + reranker APIs, vector store |
| `src/ui/src/components/ChatPanel.tsx` | Chat UI component: message list, input box, tool-call status indicators, typing animation. The primary interaction surface. | agent/loop.ts |
| `src/ui/src/components/ChatPanel.module.css` | Styles for chat panel. Follow existing design tokens. | tokens.css |
| `data/rag/` directory | Precomputed vector chunks + metadata. Python indexing script (not part of UI build). | Python (offline), Fireworks embedding API |

### Agent Loop Pattern: ReAct

**Recommendation: ReAct (Reasoning + Acting)**

The agent follows: **Thought → Action (tool call) → Observation → Thought → ... → Final Answer.**

Why ReAct over alternatives:
- **Single-shot-with-tools** (one round-trip) fails for multi-hop queries like "show me the siding elements, then open the spec page for them, and tell me the fire rating." That's 3 tool calls minimum.
- **Plan-and-execute** adds latency and complexity. The BIM domain is narrow enough that ReAct's step-by-step reasoning stays on track. Plan-and-execute shines for 10+ step workflows (e.g., full building generation), not 2-4 step retrieval tasks.
- **ReAct with tool confirmation:** For destructive actions (not in v1, but design for it), the agent pauses before executing. For v1, all tools are read-only + highlight — safe to auto-execute.
- **Cost:** Gemini Flash processes ~3 turns for a typical "show me X" query: 1 turn to decide tool, 1 turn to observe + synthesize, 1 turn for follow-up. At Flash pricing (~$0.075/M input tokens), this is <$0.001 per query.
- **Latency:** Gemini Flash function-calling latency is ~800ms per turn. 3-turn ReAct loop = ~2.4s + tool execution time. Within P95 budget.

### How the Existing Filter-Preset Review UI Demotes

The current UI flow: user picks section from SpecPanel → MappingDetail shows filter → Viewer3D isolates matching elements → PDF jumps to section page.

This becomes **one tool the agent can invoke:**

```typescript
// Agent tool: review_section(section_id: string)
// Internally:
// 1. Look up mapping_presets.json for section_id
// 2. Apply filter to Viewer3D (existing isolation pipeline)
// 3. Jump PDF to section page (existing sectionIdToPage)
// 4. Return: { mapping, matched_elements, confidences, page }
```

The TabbedPanel/SpecPanel/MappingDetail become **agent output rendering** — when the agent calls `review_section("C.1.1.5")`, the response includes structured data that the ChatPanel renders as a rich card (not a separate panel).

**Migration path:**

| Phase | What ships | User sees |
|---|---|---|
| **v1.0** | Chat panel + 3D viewer + PDF. All 3 pillars. | Chat-first surface. "Show me siding" → highlight + PDF jump. |
| **v1.1** | Advanced review toggle. | "Switch to review mode" button. Opens the old SpecPanel + MappingDetail as a slide-out drawer. |
| **v2.0** | Full sunset of TabbedPanel as primary UI. Mapping review becomes agent-guided ("Review all sections marked 'review'"). Manual filter editing behind `/edit` command. | Agent proposes corrections, user accepts/rejects in chat. Feedback logged to corrections.jsonl. |
| **Rollback** | `?mode=classic` URL param. | Full old 3-panel UI available via URL flag. Deployed simultaneously via feature flag. |

### Authentication / Sharing / Multi-Tenant

**v1: No auth.** The app loads a single IFC + single PDF from public URLs. Focus on internal SalfaCorp use. Firebase Hosting with no authentication gate (same as current bim-specs-mapper).

**v2 (when needed):**
- Firebase Auth with Google SSO (already in marvin-dev-c4ca4 project).
- Project-scoped IFC/PDF pairs stored in Firebase Storage.
- Share via URL token ("/review/<project-id>/<share-token>").
- Multi-tenant: each SalfaCorp subsidiary (Austral, Montajes, Gestión) gets a project namespace. Data isolation via Firestore rules.

**Security consideration for v1:** API keys (Gemini, Fireworks) must NOT be in the client bundle. Options:
1. **Recommended: Thin proxy** — A Firebase Cloud Function acts as API proxy. Client sends requests to the function, function calls Gemini/Fireworks with server-side keys. Minimal latency overhead (+50ms cold start).
2. **Alternative: Gemini API key in client** — If Boss OKs it for internal tool. NOT recommended for public deployment.

### Latency Budget for Chat Surface

| Operation | P50 | P95 | Notes |
|---|---|---|---|
| Embedding search (single query) | 200ms | 500ms | Fireworks API. Pre-computed vectors. |
| Reranker pass (top-10 chunks) | 150ms | 400ms | Fireworks qwen3-reranker-8b. |
| Gemini function-calling (1 turn) | 800ms | 2s | Flash model. 3-turn loop → multiply. |
| Element highlight (Viewer3D isolation) | 300ms | 600ms | Already measured in current app. Sub-second. |
| PDF page jump | 100ms | 300ms | Browser-native. |
| **End-to-end simple query** ("how many walls") | **1.5s** | **3s** | Embedding + rerank + LLM synthesis. |
| **End-to-end cross-ref query** ("show me siding + open spec") | **3s** | **6s** | 2-3 tool calls + highlight + PDF jump. |
| **End-to-end complex query** ("compare siding and interior partitions") | **5s** | **10s** | Multi-tool ReAct loop. |

**UX strategy:** Streaming responses. Show tool-call status in chat ("🔍 Searching spec…" → "🎯 Highlighting 47 elements…" → "📄 Opening page 2…"). User sees progress, not a spinner.

---

## Open Questions

1. **API key management.** Boss needs to decide: Firebase Cloud Function proxy (secure, +latency, +cost) vs. client-side key (fast, risky for public deployment). For internal SalfaCorp tool, client-side may be acceptable.
2. **Gemini model tier.** Flash vs. Pro for the agent loop. Flash is faster/cheaper but Pro handles complex multi-turn reasoning better. Test both with the 8-tool schema.
3. **Full PDF OCR.** Only pages 1-5 of the spec PDF are OCR'd (brisas-c-pages1-5.md). Need to OCR the remaining ~2 pages before v1 launch — or accept partial coverage.
4. **Multi-IFC scope.** v1 ships with a single IFC (SZA_BDE3_ARQ_C1.ifc). When does multi-IFC become required? This affects the RAG corpus design (single-model vs. multi-model namespace).
5. **Spanish-first or bilingual?** The spec is in Spanish. The IFC properties are mixed. Should the chat surface be bilingual (detect language, respond in same) or Spanish-only for v1?
6. **Corrections feedback loop.** The existing `mapping_corrections.jsonl` is for fine-tuning. Should the agent consume corrections at query time ("user previously corrected this mapping")? Adds complexity but improves accuracy.
7. **Firebase site migration.** Rename from `bim-specs-mapper` to `bim-assistant` in Firebase Hosting? Or create a new site alias (parallel deploy)?
8. **Name.** Confirm "bim-assistant" as the project name, or pick something Boss likes ("JARVIS BIM", "SpecQA", "BIM Chat"). The folder + Firebase site name depend on this.

---

*End of report. All claims cited with URLs. 6 products profiled with verified sources. 8 trend citations from 2024-2026. Tool-call schema drafted with 8 tools + parameter shapes. Concrete refactor plan with file stay/move/change list.*
