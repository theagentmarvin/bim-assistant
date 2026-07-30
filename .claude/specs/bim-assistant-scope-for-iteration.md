# bim-assistant — Alcance actual (para iteración de propuesta de valor y features)

**Contexto:** Este prompt se entrega a otro agente para iterar la propuesta de valor y el roadmap de features. El agente que itera NO conoce el proyecto — léelo entero antes de proponer.

---

## 1. Identidad y dominio

**bim-assistant** es un PoC de chat-first "JARVIS para BIM" — un agente conversacional en español sobre un modelo IFC + una especificación técnica PDF. Apunta a usuarios SalfaCorp (PMs BIM, coordinadores de revisión) que hacen revisión cruzada de specs vs modelos.

**Hipótesis de valor:** reducir el tiempo de revisión manual. Hoy el flujo es: PDF en una pestaña, IFC en otra, buscar manualmente términos cruzando ventanas. Con bim-assistant: preguntar en español *"muéstrame los muros exteriores y dime qué dice la especificación sobre el siding"* → respuesta con cita, visor 3D resaltado en naranja, PDF abierto en la página relevante.

**Mercado objetivo:**
- SalfaCorp: multi-unit (HV Salfa Perú, Salfa Austral, Salfa Gestión, Aconcagua, Montajes)
- BIM coordinators / PMs haciendo spec review ad-hoc (hipótesis de persona, no validada)
- Mercado: BIM Forum Chile, Planbim Corfo, BIM 19650. **No hay producto conversacional BIM en LatAm.**
- Competencia: Speckle+AI, Augmenta, Frame, ArchiLabs, Autodesk Forma — todos English-first, BIM-360 ecosystem. Bim-assistant es greenfield en español.

## 2. Capacidades que funcionan end-to-end hoy (jueves 30 julio 2026)

**3 herramientas del agente** (límite locked del PoC):
1. `consultar_base_de_conocimiento(pregunta, fuente)` — RAG sobre 3 corpus: modelo BIM, mapeos spec→IFC, especificación PDF
2. `resaltar_elementos(clase_ifc | filtro)` — aísla elementos en el visor 3D
3. `abrir_seccion_pdf(seccion_id | consulta | pagina)` — navega el PDF de specs

**Flujos verificados:**
- Layout 4 columnas: chat rail | PDF | visor 3D | panel de propiedades
- Indexer idempotente en IndexedDB — solo re-indexa si cambia el contenido
- 3-6 turnos de agent loop con Gemini 2.5 Flash + Fireworks qwen3-embedding-8b (1024-dim)
- Filtrado por clase IFC enum-constrained (`clase_ifc="IfcWall"` → 68 muros, sin alucinaciones de clase)
- Filtrado Navisworks-style por propiedades top-level (e.g. `is_external=true`)
- Tool-call responses con `thought_signature` round-trip (Gemini v1beta compat)
- Visor 3D con TOE fragments, isolation + Highlighter
- PDF viewer con navegación por página + sección-click navigation

## 3. En flight ahora (~30-60 min para entrega)

**Pestañas en la columna PDF:**
- Tab "Spec PDF" (lo que está hoy)
- Tab "Cuantificación" (nuevo) — tabla estructurada con:
  - **Columnas dinámicas según propiedades que el usuario pide** (e.g. "lista los muros con su material" → columnas Nombre | Material, NO todas las propiedades)
  - Sortable, búsqueda en vivo, copy TSV/CSV
  - Auto-switch cuando llega una tabla
  - Empty state con ejemplos de queries

## 4. Restricciones locked (decisiones de Boss — no son del producto final)

- **Español only** — sin bilingual UI
- **Single IFC** — sin multi-modelo
- **No auth, no sharing, no multi-tenant**
- **No deployment** — `npm run dev` local; sin Firebase/hosting
- **No cost / clash / spatial queries** — out of v1.0
- **No OCR** — pdfjs runtime text extraction
- **No bilingual** — UI, prompts, tool descriptions, agent responses todo en español
- **No tool surface > 3** — los 5 deferred: `get_element_details`, `list_sections`, `compare`, `get_model_stats`, `export_session`

## 5. Limitaciones técnicas conocidas (gaps en v1.0)

- **Nested properties inalcanzables** — `filterEvaluator.item[rule.p]` solo top-level. "muros arriba de 3m" → graceful empty
- **Sin spatial / hosted-element queries** — "ventanas de la fachada sur" imposible sin IFC graph traversal
- **Cosine-only RAG** — sin reranker (deferido a v1.1)
- **Schema primer RAG** — deferido a v1.1 (la LLM actualmente aprende de inline JSON examples + property key inventory en chunks)
- **No IFC graph traversal** — no se pueden seguir relaciones `IfcRelContainedInSpatialStructure`, `IfcRelVoidsElement`, etc.

## 6. Roadmap v1.1+ (mencionado en specs, NO priorizado)

- Spatial / hosted-element queries
- Multi-IFC navigation + cross-model compare
- Cost estimation (cubicar)
- Clash detection
- NL-to-filter DSL (free-text para no-programadores)
- Schema primer como chunk RAG separado
- Pre-compute embeddings at build time (zero Fireworks en dev)
- Bilingual / English mode
- Saved filter presets / usuario-defined filters
- Export session / sharable review notes

## 7. Stack técnico

- **Frontend:** React 18 + Vite + TypeScript
- **3D:** TOE (@thatopen/components) + web-ifc + fragments
- **PDF:** pdfjs-dist (runtime text extraction, no OCR)
- **LLM:** Gemini 2.5 Flash via Google AI Studio (alias `gemini-flash-latest`)
- **Embeddings:** Fireworks qwen3-embedding-8b (1024-dim via `dimensions` param)
- **Storage:** IndexedDB vanilla wrapper (no idb-keyval, no dexie)
- **RAG:** cosine top-K=5, sin reranker
- **Deploy:** ninguno (local-only por decisión del PoC)

## 8. Estado del repo (commits de hoy)

| Commit | Qué |
|---|---|
| `1a6f5e8` | Layout fix — vertical split-view 4 columnas |
| `b9c453d` | LLM client fix — Gemini flash-latest + Fireworks dim=1024 |
| `14333c7` | RAG-for-IFC step 1 — enum + filter plumbing + flat property metadata |
| `fda82f3` | Gemini v1beta fix — role:"user" + thought_signature round-trip |

Specs en `.claude/specs/`:
- `task-rag-for-ifc.md` — implementado en `14333c7`
- `task-quantification-tab.md` — en flight ahora

App de source reusada: `~/projects/bim/bim-specs-mapper/` (deployada a Firebase, base para Viewer3D, PdfViewer, mappings, IFC schema).

## 9. Pregunta de iteración

Necesito que el agente que itera proponga:

1. **Value prop:** ¿"JARVIS para BIM" resuena? ¿Hay un positioning más fuerte (ej: "spec review copilot", "BIM that talks back")?
2. **Persona:** ¿PM/coordinator haciendo spec review es el target correcto, o hay otro (jefe de obra, calidad, ITO) con más urgencia?
3. **Killer feature:** ¿Las 3 capacidades actuales (Q&A, show elements, open PDF) son suficientes para MVP, o falta una killer feature para el lanzamiento (ej: comparison entre spec-as-built vs spec-as-designed, mobile, voice)?
4. **Pricing/billing model** (si lo piensas): ¿internal SalfaCorp tool, multi-tenant SaaS, freemium? Esto afecta el scope de auth/multi-tenant.
5. **Roadmap ranking:** de la lista v1.1+, ¿qué 2-3 features deberían ser prioridad post-PoC y por qué?
6. **Diferenciación vs competencia:** Speckle+AI, Augmenta, Frame, etc. ya hacen partes de esto. ¿Cuál es la ventaja sostenible? (Sugerencia inicial: español nativo, dominio construcción chileno, integrated PDF + IFC, no auth friction.)

## 10. Output esperado del agente que itera

- **2-3 opciones de value prop reformulada**, cada una con: tagline de 1 línea, elevator pitch de 3 líneas, qué cambia en el producto, riesgo de confundir con competidores.
- **Análisis de persona**: validar PM/coordinator como target, o proponer alternativa con justificación (datos, fricción, urgencia).
- **Lista priorizada de 3 features para post-PoC**, cada una con: descripción de 1 línea, esfuerzo relativo (S/M/L), valor relativo al usuario (S/M/L), dependencias técnicas.
- **Recomendación de pricing/billing model** con justificación de 2-3 líneas.
- **Honestidad sobre lo que NO incluir** — qué，看起来-atractivas ideas，我们应该 descartar y por qué.

---

**Nota final:** el agente que itera debe asumir que el código está en estado PoC funcional, no de producto final. La pregunta NO es "qué features agregar" sino "qué subset del espacio de features tiene el mejor ratio valor/esfuerzo para SalfaCorp / mercado BIM chileno". Defender cada recomendación con evidencia o razonamiento explícito, no con vibes.