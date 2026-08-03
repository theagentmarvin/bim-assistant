# bim-assistant (PoC) — Salfa BIM Agent 01

Asistente conversacional en español para revisar modelos IFC y
especificaciones técnicas. Es la primera versión (PoC) de un chat-first
"Salfa BIM Agent 01 para BIM" que responde preguntas sobre el modelo, resalta
elementos en el visor 3D y abre la página relevante del PDF de
especificaciones.

> Tres pilares:
> 1. **Q&A** sobre el modelo BIM (`consultar_base_de_conocimiento`).
> 2. **Resaltado / aislamiento** de elementos en el visor 3D
>    (`resaltar_elementos`).
> 3. **Apertura de secciones** del PDF de especificaciones
>    (`abrir_seccion_pdf`).

## Requisitos

- Node.js 20+ (probado con Node 24).
- Una clave de API de **Google Gemini** (`gemini-2.5-flash`):
  <https://aistudio.google.com/apikey>
- Una clave de API de **Fireworks AI** (modelo de embeddings
  `qwen3-embedding-8b`): <https://fireworks.ai/account/api-keys>

## Cómo correrlo

```bash
cp .env.example .env.local       # rellena las claves
npm install
npm run dev                       # http://localhost:5173
```

Al abrir la app:

1. El visor 3D carga el IFC (`public/SZA_BDE3_ARQ_C1.ifc`).
2. El indexer popula IndexedDB con embeddings del modelo, los mapeos
   sección→IFC, y el texto del PDF de especificaciones.
3. La barra de estado pasa de `Indexando…` a `Listo` (típicamente en
   menos de 10 segundos con claves válidas).
4. Escribe una pregunta en el panel izquierdo y presiona Enter.

## Consultas de ejemplo (en español)

| Pregunta | Qué dispara |
|---|---|
| ¿Cuántos muros hay en el modelo? | `consultar_base_de_conocimiento` (fuente=modelo) |
| muéstrame los muros exteriores | `resaltar_elementos(clase_ifc="IfcWall")` |
| abre la sección sobre siding | `abrir_seccion_pdf(consulta="siding")` |
| ¿qué dice la especificación sobre el siding? | `consultar_base_de_conocimiento` + `abrir_seccion_pdf` |

## Stack

- **React 18 + Vite 5 + TypeScript 5**
- **Gemini 2.5 Flash** vía Google AI API (function-calling)
- **Fireworks qwen3-embedding-8b** para embeddings RAG (1024 dim)
- **@thatopen/components-front** para el visor 3D IFC
- **pdfjs-dist 4.x** para renderizar y extraer texto del PDF
- **IndexedDB** (vanilla, sin dependencias) para el caché RAG

## Estructura

```
src/
├── agent/         # bucle ReAct, herramientas, indexer, retriever, prompts
├── components/    # ChatPanel, AgentStatus, PdfViewer, ViewerPane, ModelPropertyPanel
├── data/          # clientes LLM (Gemini + Fireworks), storage IndexedDB,
│                  # loaders bim_elements.json / mapping_presets.json
├── viewer/        # Viewer3D, filterEvaluator, blobWorker, webIfc
├── styles/        # tokens.css (paleta Free Field)
├── types.ts       # tipos compartidos (Mapping, Filter, etc.)
├── App.tsx        # shell chat-first (rewrite del App del mapper)
└── main.tsx
```

## Fuera de alcance (PoC)

- Coste, clash, multi-IFC.
- UI bilingüe. Solo español.
- OCR. Extracción de texto del PDF con pdfjs en runtime.
- Autenticación / multi-tenant.
- Deploy en Firebase / hosting. `npm run dev` es el despliegue.
- Bucle de retroalimentación de correcciones.

Ver `.claude/specs/task-poc-v1.md` y `PROJECT-TRACKER.md` para el
contrato completo.

## English (brief)

Chat-first BIM assistant for SalfaCorp reviewers. Spanish-only PoC
over a single IFC + spec PDF. Asks in Spanish, answers in Spanish,
runs three tools against the model and the PDF. Local-only — no
hosting, no auth, no Firebase.

## License

Internal PoC. Not for distribution.
