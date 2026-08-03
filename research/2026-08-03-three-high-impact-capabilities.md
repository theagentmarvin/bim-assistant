# Tres Capacidades de Alto Impacto para Salfa BIM Agent 01

**Fecha:** 2026-08-03
**Proyecto:** bim-assistant
**Autor:** Research sub-agent (wiki-marvin)
**Alcance:** Propuesta estratégica para la siguiente iteración del PoC
**Estado:** Completo

---

## 1. RESUMEN EJECUTIVO

Este informe propone **tres capacidades de alto impacto** para la siguiente iteración del Salfa BIM Agent 01, rankeadas por valor agregado al flujo de trabajo actual:

| # | Capacidad | Acción | Esfuerzo |
|---|---|---|---|
| 1 | **verificar_concordancia** | Detectar discrepancias entre modelo IFC y especificación técnica, usando el puente de datos ya existente (`mapping_presets.json`) para responder preguntas como "¿las ventanas del modelo cumplen con lo que pide la especificación?" | Medio (1-2w) |
| 2 | **exportar_informe** | Generar un reporte estructurado de la sesión de revisión (Markdown/CSV/JSON) con hallazgos, tablas de cuantificación, y referencias a secciones de la especificación, descargable con un click desde el chat. | Medio (1-2w) |
| 3 | **calcular_cantidades** | Activar modo de agregación en la pestaña Cuantificación: sumar áreas totales, volúmenes, longitudes lineales desde las propiedades Qto_ ya disponibles en `bim_elements.json`. | Pequeño (≤1w) |

Las tres capacidades **extienden herramientas existentes** en lugar de crear nuevas, respetando la superficie de 3 herramientas. No requieren nuevo hardware, autenticación, ni cambios de stack. Cada una responde a una necesidad real del revisor BIM que el PoC actual deja sin cubrir.

---

## 2. CAPACIDAD 1: `verificar_concordancia` (Mayor Impacto)

### Qué hace

Permite al usuario preguntar si los elementos del modelo IFC coinciden con lo que exige la especificación técnica. El agente cruza la información entre el corpus del modelo (`bim_elements.json`), el corpus de la especificación (PDF extraído vía pdfjs), y los mapeos sección→IFC (`mapping_presets.json`) para detectar discrepancias.

**Comportamiento concreto del usuario:**

1. Usuario pregunta: *"¿las ventanas del modelo cumplen con lo que dice la especificación?"*
2. El agente busca en la especificación la sección que describe ventanas, extrae los requisitos (material, dimensiones, tipo de vidrio, resistencia al fuego), y los compara con las propiedades de los `IfcWindow` en el modelo.
3. El agente responde con una lista de concordancias y discrepancias: *"La especificación C.2.3 pide ventanas de aluminio con área mínima 1.2 m². El modelo tiene 7 ventanas: 5 cumplen, 2 son de PVC y tienen área menor (0.9 m²)."*
4. Opcionalmente, el agente puede resaltar solo los elementos que NO cumplen para revisión visual.

### Por qué agrega valor

El flujo actual permite preguntar sobre el modelo Y sobre la especificación, pero no permite preguntar sobre la RELACIÓN entre ambos. Esa relación es exactamente lo que un PM/revisor BIM hace manualmente: leer la especificación, revisar el modelo, y marcar lo que no cuadra. El mercado lo está pidiendo:

- **Aginera** (2026) identifica *"specification cross-referencing — AI that reads the project specifications alongside the drawings and automatically matches drawn components to spec requirements"* como la tendencia más relevante del mercado de AI takeoff [1].
- **Provision AI** (2025) combina *"automated takeoff, document analysis, and risk detection"* en un solo flujo, detectando *"scope gaps, conflicts, and cost risks"* [2].
- La academia lleva años desarrollando automated compliance checking (ACC) sobre IFC. Xiao et al. (2026) lograron 84.3% de precisión en verificaciones geométricas sobre grafos de conocimiento IFC [3]. Ma et al. (2025) combinaron ontologías semánticas con IFC para verificación de calidad de modelos [4].
- **Ningún competidor combina chat conversacional + modelo 3D + especificación PDF + verificación de concordancia.** Los productos existentes (Solibri, BIMcollab, Navisworks) verifican reglas sobre el modelo, pero no cruzan modelo contra especificación en lenguaje natural. Los AI takeoff tools (Togal.AI, Kreo, Beam AI) extraen cantidades de planos pero no comparan contra especificaciones.

El Salfa BIM Agent 01 está en una posición única: ya tiene ambos corpus indexados, ya tiene `mapping_presets.json` como puente entre secciones de especificación y clases IFC, y ya tiene un agente conversacional que puede formular y ejecutar verificaciones multi-paso.

**Evidencia del valor económico:** Un estudio canadiense validado en infraestructura real encontró que el QTO automatizado con verificación de calidad identificó un 39% de inconsistencia en cantidades de materiales de muros y redujo el acero en 10% debido a cambios de diseño [5]. Para un proyecto como Brisas del Estrecho 3 (68 muros, 7 tipos de ventana, múltiples materiales), una discrepancia no detectada entre siding especificado y siding modelado puede costar millones de CLP en retrabajo.

### Cómo se integra con las 3 herramientas existentes

**Extiende `consultar_base_de_conocimiento`** sin modificarla. La implementación propuesta:

1. El LLM detecta la intención de verificación en la pregunta del usuario (palabras clave: "cumplen", "coinciden", "concuerdan", "verifica", "revisa", "discrepancias", "diferencias").
2. El agente realiza un **ReAct loop de 3 pasos**:
   - **Paso 1:** Llama a `consultar_base_de_conocimiento(pregunta, fuente="mapeos")` para obtener las secciones de la especificación que aplican a la clase IFC mencionada.
   - **Paso 2:** Llama a `consultar_base_de_conocimiento(pregunta, fuente="especificacion")` para extraer los requisitos específicos de esas secciones.
   - **Paso 3:** Llama a `consultar_base_de_conocimiento(pregunta, fuente="modelo", tabla={clase_ifc, columnas})` para obtener las propiedades reales del modelo.
   - **Paso 4 (síntesis):** Gemini compara los requisitos extraídos del paso 2 con las propiedades del paso 3 y genera un veredicto en prosa + tabla de discrepancias.
3. Opcional: el agente puede llamar a `resaltar_elementos` con un filtro construido a partir de las discrepancias encontradas, para mostrar visualmente los elementos que no cumplen.

**No requiere un nuevo tool.** La lógica de comparación vive en el prompt del sistema y en la capacidad de razonamiento multi-paso de Gemini. El `mapping_presets.json` ya contiene:
- `section_id` → `ifc_class`
- `conf` (confianza del mapeo)
- `rationale` (razón del mapeo)

Esto es suficiente para que el agente construya la cadena de verificación.

### Demo query + resultado esperado

**Query del usuario:**
> "verifica si los muros exteriores del modelo cumplen con lo que pide la especificación para el siding"

**Flujo del agente:**
1. `consultar_base_de_conocimiento("muros exteriores siding especificación", fuente="mapeos")` → retorna secciones C.1.1.x que mapean a `IfcWall` con `is_external=true`
2. `consultar_base_de_conocimiento("requisitos de siding para muros exteriores sección C.1.1", fuente="especificacion")` → extrae: "Siding fibrocemento, espesor mínimo 8mm, fijación según norma NChXXX"
3. `consultar_base_de_conocimiento("muros exteriores material", fuente="modelo", tabla={clase_ifc:"IfcWall", columnas:["Nombre","Material","is_external"]})` → tabla de 12 muros exteriores, material: "Siding SIP" o similar
4. `abrir_seccion_pdf(seccion_id="C.1.1.5")` → abre la página relevante del PDF

**Respuesta esperada del agente:**
> "Revisé la especificación C.1.1.5 y el modelo. La especificación pide siding de fibrocemento de 8mm. El modelo tiene 12 muros exteriores con material 'Siding SIP'. ⚠️ **Discrepancia detectada:** el material 'Siding SIP' no coincide con 'fibrocemento' especificado. Los 12 muros exteriores requieren verificación. He resaltado los muros afectados en el visor 3D y abierto la sección C.1.1.5 en el PDF."

**Resultado visual:** Los 12 muros exteriores aparecen resaltados en naranja. El PDF está abierto en la sección C.1.1.5. La pestaña Cuantificación muestra la tabla de los 12 muros con su material actual.

### Esfuerzo estimado

**Medio (1-2 semanas).** La implementación requiere:

1. **Prompt engineering** (~2 días): Extender `JARVIS_SYSTEM_PROMPT` con reglas de verificación y ejemplos few-shot del patrón de 3 pasos.
2. **Mejora del indexer** (~1 día): Asegurar que los chunks de `mapeos` incluyan los requisitos extraíbles de la especificación (actualmente solo tienen título, confianza, y rationale — necesitan un campo `requisitos_extraidos` o similar poblado desde el texto del PDF).
3. **Tabla de discrepancias** (~2 días): Extender `buildTabla` con un campo opcional `discrepancias` que el agente puede poblar. El `QuantificationPanel` ya soporta columnas dinámicas, así que el trabajo es principalmente de datos.
4. **Testing con el modelo real** (~3 días): Probar con el IFC y PDF de Brisas del Estrecho 3, ajustar prompts, documentar falsos positivos.

### Fuentes citadas

- [1] Aginera, "Best AI Construction Takeoff Software in 2026", Mar 2026. https://aginera.ai/blog/ai-construction-takeoff-software-guide
- [2] Provision AI, "Best Automated Takeoff Software for Preconstruction in 2025", Mar 2026. https://provision.com/blog/best-automated-takeoff-software-for-preconstruction-in-2025-provision-ai
- [3] Xiao et al., "Automating Geometry-Intensive Compliance Checking in BIM: Graph-Based Semantic Reasoning Framework", Automation in Construction 189, Jun 2026. https://arxiv.org/abs/2606.12065
- [4] Ma et al., "Automatic compliance checking of BIM models against quality standards based on ontology technology", Automation in Construction, Jul 2024. https://www.sciencedirect.com/science/article/abs/pii/S0926580524003923
- [5] "Automated system for high-accuracy quantity takeoff using BIM", Automation in Construction, Nov 2023. https://www.sciencedirect.com/science/article/abs/pii/S0926580523004156

---

## 3. CAPACIDAD 2: `exportar_informe` (Segundo Mayor Impacto)

### Qué hace

Permite al usuario generar un reporte descargable de la sesión de revisión actual con un solo comando en el chat. El reporte incluye: todas las preguntas y respuestas de la sesión, las tablas de cuantificación generadas, las secciones del PDF consultadas, y cualquier discrepancia detectada. Se descarga como archivo Markdown (con metadatos YAML frontmatter), CSV (datos tabulares), o JSON (datos estructurados completos).

**Comportamiento concreto del usuario:**

1. Después de una sesión de revisión (ej. 5-6 consultas sobre muros, ventanas, y especificaciones), el usuario escribe: *"genera un informe de esta revisión"* o *"exporta la sesión como reporte"*.
2. El agente compila el historial de la sesión, extrae todas las tablas generadas, las secciones consultadas, y los hallazgos clave.
3. Se dispara una descarga del navegador con un archivo `informe-brisas-del-estrecho-2026-08-03.md` que contiene el reporte completo en español.

### Por qué agrega valor

El flujo actual es **efímero**: el usuario hace preguntas, obtiene respuestas, ve elementos resaltados y tablas, pero al cerrar el navegador todo desaparece. No hay registro de lo que se revisó, qué se encontró, ni qué quedó pendiente. Esto rompe el ciclo de revisión real:

1. Un PM/revisor hace una sesión de revisión.
2. **Necesita documentar sus hallazgos** para compartir con el equipo de diseño o el contratista.
3. Sin exportación, el PM tiene que tomar screenshots manualmente y escribir un correo o informe aparte.
4. Esto anula gran parte del valor del agente: el agente ya "sabe" lo que se encontró, pero no puede comunicarlo fuera de la sesión.

**El mercado valida esta necesidad:**

- **Autodesk Takeoff** (2026) integra *"automated quantity exports directly from the BIM data"* como su diferenciador principal [6].
- **DesignDrafter** (2026) promete *"generate detailed Bills of Quantities (BOQ), cost estimates, and procurement-ready reports"* como tercer paso de su pipeline AI [7].
- **Planaut** (2026) genera *"cost estimates directly from extracted scope — and who need schedule generation alongside the estimate"* como parte de su propuesta de valor [8].
- La arquitectura de investigación previa de bim-assistant identificó `export_session` como la capacidad #5 del backlog vNext, pero con prioridad más baja que QTO. Sin embargo, con el PoC funcionando y el flujo de revisión demostrado (ver demo-recording.webm), **la exportación de sesión es el puente entre "herramienta de revisión" y "herramienta de entrega"** — es lo que convierte una sesión de chat en un entregable profesional.

**El timing es óptimo:** el PoC ya produce tablas estructuradas (`QuantificationTable`), navegación de PDF, y respuestas en prosa con citas. Todos los datos necesarios para un informe ya existen en memoria durante la sesión. Solo falta empaquetarlos.

### Cómo se integra con las 3 herramientas existentes

**Extiende `consultar_base_de_conocimiento`** con un nuevo parámetro opcional `informe: boolean` que, cuando es `true`, dispara la compilación del reporte en lugar de una búsqueda normal. Alternativamente, se puede implementar como una **detección de intención en el prompt** que el agente maneja sin modificar los tool schemas:

1. El usuario pide "genera un informe" o "exporta la sesión".
2. El agente detecta la intención y compila el estado actual de `chatHistory` (que ya se mantiene en `App.tsx`), más las tablas generadas (que ya están en el estado de `QuantificationPanel`), más las secciones de PDF consultadas.
3. El agente invoca `consultar_base_de_conocimiento` para obtener un resumen ejecutivo de los hallazgos principales.
4. La respuesta del agente incluye un resumen en prosa Y un blob descargable.

**Los datos ya existen en el frontend:**
- `chatHistory` en `App.tsx` → preguntas y respuestas de la sesión
- `QuantificationTable[]` en el estado de paneles → tablas generadas
- `sectionIdToPage` en PdfViewer → secciones consultadas
- Las respuestas del agente ya incluyen IDs de elementos y citas

**Formato del reporte Markdown:**

```markdown
---
proyecto: Brisas del Estrecho 3
cliente: Salfa Austral
ubicacion: Punta Arenas
fecha_revision: 2026-08-03
revisor: Salfa BIM Agent 01
ifc: SZA_BDE3_ARQ_C1.ifc
especificacion: eett-c.pdf
---

# Informe de Revisión BIM — Brisas del Estrecho 3

## Resumen Ejecutivo
- 7 consultas realizadas en esta sesión
- 3 tablas de cuantificación generadas
- 2 secciones de especificación consultadas
- [si aplica] 1 discrepancia detectada

## Consultas y Hallazgos

### 1. "muéstrame las ventanas"
**Respuesta:** Se identificaron 7 ventanas (IfcWindow) en el modelo...

### 2. "muéstrame las ventanas como una tabla con nombre, nivel, ancho y alto"
**Tabla generada:** [7 filas] — ver Anexo A

[...]

## Tablas de Cuantificación
### Anexo A: Listado de IfcWindow
| Nombre | Nivel | Ancho | Alto |
|---|---|---|---|
| VENTANA_01 | Planta 1 | 1.220m | 1.200m |
[...]

## Secciones de Especificación Consultadas
- C.1.1.5 — Siding exterior (página 3)
- C.2.3 — Ventanas (página 5)

---
*Reporte generado por Salfa BIM Agent 01 el 2026-08-03T17:00:00-04:00*
```

### Demo query + resultado esperado

**Query del usuario (después de una sesión de revisión):**
> "genera un informe de todo lo que revisamos en esta sesión"

**Respuesta esperada del agente:**
> "He generado el informe de revisión para el proyecto Brisas del Estrecho 3. Incluye 7 consultas, 3 tablas de cuantificación, y las secciones de especificación consultadas. El archivo `informe-brisas-del-estrecho-2026-08-03.md` se está descargando."

**Resultado:** El navegador dispara una descarga. El archivo .md se puede abrir en cualquier editor de texto, VS Code, o Notion.

### Esfuerzo estimado

**Medio (1-2 semanas).** La implementación requiere:

1. **Compilador de reporte** (~3 días): Un módulo `src/agent/reporter.ts` que recibe `chatHistory`, `quantificationTables`, y `pdfSections` y produce Markdown con frontmatter YAML.
2. **Trigger de descarga** (~1 día): Lógica en `App.tsx` que genera un Blob y dispara `URL.createObjectURL` + click en `<a>` para la descarga. Ya existe `src/utils/copy.ts` con formateo TSV/CSV — se puede extender.
3. **Prompt engineering** (~1 día): Añadir al `JARVIS_SYSTEM_PROMPT` la regla de que cuando el usuario pida "informe", "reporte", "exporta", o "descarga", el agente compile y devuelva el resumen.
4. **Testing de formatos** (~2 días): Verificar que el Markdown se renderiza correctamente en VS Code, GitHub, y Notion.

No requiere cambios en los tool schemas. No requiere nuevas dependencias npm.

### Fuentes citadas

- [6] Bidi Contracting, "Autodesk Takeoff Review 2026", May 2026. https://www.bidicontracting.com/blog/autodesk-takeoff-review-2026
- [7] DesignDrafter, "AI Quantity Takeoff Software for Construction & MEP", May 2026. https://designdrafter.com/extract-quantity/
- [8] Nomic, "Best AI for Construction Cost Estimation in 2026", Jul 2026. https://www.nomic.ai/compare/best-ai-for-cost-estimation

---

## 4. CAPACIDAD 3: `calcular_cantidades` (Tercer Mayor Impacto)

### Qué hace

Activa un **modo de agregación** en la pestaña Cuantificación: cuando el usuario pide totales ("¿cuál es el área total de muros exteriores?"), la tabla incluye una fila de suma al final con totales calculados desde las propiedades Qto_ ya presentes en `bim_elements.json`. El agente responde en prosa con la cifra calculada y la tabla muestra el desglose + total.

**Comportamiento concreto del usuario:**

1. Usuario pregunta: *"¿cuál es el área total de muros exteriores?"* o *"suma el área de todas las ventanas"*.
2. El agente llama a `consultar_base_de_conocimiento` con un objeto `tabla` que incluye un nuevo campo `calcular: {operacion: "suma", columna: "Área"}`.
3. La pestaña Cuantificación muestra la tabla de muros exteriores con una fila "TOTAL" al final que suma la columna Área.
4. El agente responde: *"El área total de muros exteriores es 156.3 m² (12 muros)."*

### Por qué agrega valor

La pestaña Cuantificación actual es un **listado**, no una **cuantificación**. Muestra filas individuales con propiedades, pero no calcula totales. Esto es una brecha semántica grande: el nombre "Cuantificación" promete cantidades agregadas, pero entrega datos desagregados.

**El mercado de AI takeoff prioriza la agregación sobre el listado:**

- **Todo el mercado de AI takeoff 2026** (Togal.AI, Kreo, Beam AI, STACK, PlanSwift, Autodesk Takeoff) se organiza alrededor de la agregación: sumar áreas, volúmenes, longitudes, y conteos por categoría [6][9].
- **DataDrivenConstruction** publicó un skill de extracción QTO para Claude Code que prioriza *"element counts, areas, volumes, lengths with grouping and reporting"* — la agregación es el producto, no el listado [10].
- **ifcreport.app** y **QTOpro** (2026) compiten en *"free IFC quantity takeoff"* donde el diferenciador es qué tan bien agregan y presentan totales [11].
- La arquitectura de investigación previa de bim-assistant **ranked QTO como la prioridad #1 del backlog vNext**, por encima de multi-IFC, costos, y clash detection [12].

**Los datos ya están en `bim_elements.json`.** El flattening de PSets (Boss 2026-07-30, task-psets-flattening) ya expuso propiedades como `Qto_WallBaseQuantities.GrossSideArea`, `Qto_WallBaseQuantities.GrossVolume`, `Qto_WindowBaseQuantities.Width`, y `Qto_WindowBaseQuantities.Height` como keys top-level. La función `getPropertyByPath()` ya resuelve estas keys. La función `buildTabla()` ya proyecta filas completas. Solo falta la fila de suma.

**La brecha actual es UX, no datos:** Si un PM quiere saber el área total de siding, hoy tiene que mirar la tabla de 12 muros y sumar manualmente (o exportar a CSV y abrir Excel). Con `calcular_cantidades`, la respuesta es inmediata dentro del chat.

### Cómo se integra con las 3 herramientas existentes

**Extiende `consultar_base_de_conocimiento`** añadiendo un campo opcional al objeto `tabla`:

```typescript
// Extensión de TablaSpec en tools.ts
export interface TablaSpec {
  clase_ifc?: string;
  columnas?: string[];
  agrupar_por?: string[];
  titulo?: string;
  // NUEVO:
  calcular?: {
    operacion: "suma" | "promedio" | "min" | "max";
    columna: string;  // label en español, ej: "Área", "Volumen"
  };
}
```

La función `buildTabla()` se extiende para:

1. Si `calcular` está presente, después de construir las filas, calcular el agregado sobre la columna indicada.
2. Añadir una fila especial `{_tipo: "total", ...columnas, [columna]: valorCalculado}` al final del array `filas`.
3. Retornar un campo adicional `totales: {operacion, columna, valor, unidad}` en el `QuantificationTable`.

**El `QuantificationPanel` se extiende para:**
- Detectar la fila `_tipo: "total"` y renderizarla con un estilo visual distinto (negrita, fondo gris claro, borde superior doble).
- Mostrar la unidad (m², m³, m) extraída del nombre de la columna Qto_.

**No requiere un nuevo tool.** La lógica vive completamente dentro de `buildTabla()` en `src/agent/tools.ts`. El prompt del sistema se actualiza para que el agente sepa cuándo incluir `calcular`.

### Demo query + resultado esperado

**Query del usuario:**
> "¿cuál es el área total de todas las ventanas?"

**Flujo del agente:**
1. Gemini detecta intención de agregación ("área total")
2. Llama a `consultar_base_de_conocimiento(pregunta="área total de ventanas", fuente="modelo", tabla={clase_ifc:"IfcWindow", columnas:["Nombre","Área"], calcular:{operacion:"suma", columna:"Área"}})`

**Tabla en Cuantificación:**

| Nombre | Área |
|---|---|
| VENTANA_01 | 1.464 m² |
| VENTANA_02 | 1.464 m² |
| VENTANA_03 | 1.464 m² |
| VENTANA_04 | 2.100 m² |
| VENTANA_05 | 2.100 m² |
| VENTANA_06 | 3.318 m² |
| VENTANA_07 | 3.318 m² |
| **TOTAL** | **15.228 m²** |

**Respuesta del agente:**
> "El área total de las 7 ventanas es 15.228 m². Revisa la tabla en la pestaña Cuantificación para el detalle por ventana."

### Esfuerzo estimado

**Pequeño (≤1 semana).** La implementación es acotada:

1. **Extensión de `TablaSpec`** (~1 día): Añadir el tipo `calcular`, extender `buildTabla()`, validar que la columna existe y contiene valores numéricos.
2. **Fila de total en `QuantificationPanel`** (~2 días): Detectar `_tipo: "total"`, aplicar estilos CSS, manejar unidades.
3. **Prompt engineering** (~1 día): Añadir regla al `JARVIS_SYSTEM_PROMPT` para detectar intenciones de agregación ("área total", "suma de", "total de", "promedio de", "cuánto suma").
4. **Testing** (~1 día): Verificar con muros (GrossSideArea), ventanas (área), losas (GrossVolume).

La implementación toca exclusivamente `src/agent/tools.ts` (buildTabla) y `src/components/QuantificationPanel.tsx` (renderizado de fila total). No requiere cambios en schemas, retriever, indexer, ni loop.

### Fuentes citadas

- [9] Easy Takeoffs, "Best AI Takeoff Software in 2026", Jul 2026. https://easytakeoffs.com/blog/best-ai-takeoff-software
- [10] DataDrivenConstruction, "ifc-qto-extraction Skill", 2026. https://claudeskills.info/skills/datadrivenconstruction/ddc_skills_for_ai_agents_in_construction/ifc-qto-extraction/
- [11] ifcreport.app, "Best free IFC quantity takeoff tools (2026)". https://ifcreport.app/guides/free-ifc-quantity-takeoff-tools
- [12] bim-assistant, "Research: BIM Market & Refactor Plan", Jul 2026. `~/projects/bim/bim-assistant/research/2026-07-30-jarvis-bim-market-and-modifications.md`

---

## 5. LO QUE DELIBERADAMENTE NO ESTAMOS PROPONIENDO

**1. Detección de clashes (conflictos geométricos).** Tentador porque Navisworks y Solibri lo hacen, pero requiere un pipeline de análisis geométrico (IfcClash, intersección de mallas) completamente nuevo. Está explícitamente fuera del alcance del PoC y no aprovecha ninguna capacidad existente.

**2. Estimación de costos.** Sería el siguiente paso natural después de `calcular_cantidades`, pero requiere datos externos de precios unitarios que no existen en el corpus actual. Sin una base de precios (ONDAC, precios Salfa internos), cualquier estimación sería ficción del LLM. Esto es v2, no v1.1.

**3. Multi-IFC o multi-PDF.** La restricción de single IFC + single PDF está lockeada por el Boss. Agregar navegación entre modelos introduciría complejidad de coordinación espacial que excede el alcance del PoC.

---

## 6. RAZONAMIENTO ESTRATÉGICO

### Por qué estas 3 y en este orden

El PoC actual demuestra que el chat conversacional + 3D + PDF funciona. Las 7 ventanas resaltadas + tabla de cuantificación del demo recording prueban el loop completo. La pregunta ahora es: **¿qué convierte esto de "demo técnico" a "herramienta de revisión"?**

**verificar_concordancia** es la capacidad que ningún competidor tiene. El mercado de AI BIM está fragmentado: unos hacen Q&A sobre modelo (ArchiLabs, Frame), otros hacen extracción de cantidades (Togal.AI, Kreo), y otros hacen verificación de reglas (Solibri). Nadie combina las tres cosas en un chat en español. El `mapping_presets.json` ya es el puente de datos — solo falta la lógica de comparación en el prompt y una tabla de resultados.

**exportar_informe** es el puente entre "sesión de chat" y "entregable profesional". Sin esto, el PM revisa en el agente y luego re-escribe todo en un correo. Con esto, el agente produce el entregable. Es la diferencia entre una herramienta de consumo interno y una herramienta de producción.

**calcular_cantidades** es la fruta más baja. Los datos ya están. La tabla ya existe. Solo falta la fila de suma. Una semana de trabajo para cerrar la brecha semántica entre "listado" y "cuantificación".

### Por qué no proponemos herramientas nuevas

La restricción de 3 herramientas es una decisión de liderazgo. Respetarla fuerza creatividad: en lugar de añadir `verificar_concordancia` como un 4° tool, extendemos `consultar_base_de_conocimiento` para que soporte el patrón de verificación vía prompting. En lugar de añadir `exportar_informe` como un tool, lo implementamos como una intención detectada que dispara lógica en el frontend. En lugar de añadir `calcular_cantidades`, extendemos el objeto `tabla` que ya existe.

Este enfoque de **"extender, no multiplicar"** mantiene la superficie de herramientas en 3 mientras agrega 3 capacidades nuevas. Es una restricción productiva.

### Riesgos

1. **verificar_concordancia** depende de la calidad del `mapping_presets.json`. Si los mapeos son incorrectos o incompletos, las verificaciones producirán falsos positivos. **Mitigación:** El reporte debe incluir el nivel de confianza del mapeo y advertir cuando es bajo.

2. **exportar_informe** asume que el historial de chat en memoria es suficiente. Si el usuario recarga la página, pierde la sesión. **Mitigación:** Guardar el historial en IndexedDB (ya tenemos la infraestructura de storage) para persistencia entre recargas.

3. **calcular_cantidades** asume que las propiedades Qto_ son numéricas y están presentes. Para algunas clases IFC, `GrossSideArea` o `GrossVolume` pueden ser null. **Mitigación:** La función `detectEmptyColumns()` ya existe y puede advertir al usuario cuando una columna no tiene datos agregables.

---

## 7. REFERENCIAS

1. Aginera, "Best AI Construction Takeoff Software in 2026", Mar 2026. https://aginera.ai/blog/ai-construction-takeoff-software-guide
2. Provision AI, "Best Automated Takeoff Software for Preconstruction in 2025", Mar 2026. https://provision.com/blog/best-automated-takeoff-software-for-preconstruction-in-2025-provision-ai
3. Xiao et al., "Automating Geometry-Intensive Compliance Checking in BIM: Graph-Based Semantic Reasoning Framework", Automation in Construction 189, Jun 2026. https://arxiv.org/abs/2606.12065
4. Ma et al., "Automatic compliance checking of BIM models against quality standards based on ontology technology", Automation in Construction, Jul 2024. https://www.sciencedirect.com/science/article/abs/pii/S0926580524003923
5. "Automated system for high-accuracy quantity takeoff using BIM", Automation in Construction, Nov 2023. https://www.sciencedirect.com/science/article/abs/pii/S0926580523004156
6. Bidi Contracting, "Autodesk Takeoff Review 2026", May 2026. https://www.bidicontracting.com/blog/autodesk-takeoff-review-2026
7. DesignDrafter, "AI Quantity Takeoff Software for Construction & MEP Projects", May 2026. https://designdrafter.com/extract-quantity/
8. Nomic, "Best AI for Construction Cost Estimation in 2026", Jul 2026. https://www.nomic.ai/compare/best-ai-for-cost-estimation
9. Easy Takeoffs, "Best AI Takeoff Software in 2026", Jul 2026. https://easytakeoffs.com/blog/best-ai-takeoff-software
10. DataDrivenConstruction, "ifc-qto-extraction Skill", 2026. https://claudeskills.info/skills/datadrivenconstruction/ddc_skills_for_ai_agents_in_construction/ifc-qto-extraction/
11. ifcreport.app, "Best free IFC quantity takeoff tools (2026)". https://ifcreport.app/guides/free-ifc-quantity-takeoff-tools
12. bim-assistant, "Research: BIM Market & Refactor Plan — 2026-07-30". `~/projects/bim/bim-assistant/research/2026-07-30-jarvis-bim-market-and-modifications.md`
13. BIM Heroes, "IFC Validation Tools for BIM Projects", Mar 2026. https://bimheroes.com/ifc-validation-tools-for-bim-projects/
14. Mirage Metrics, "AI Quantity Takeoff from Plans: Speed and Accuracy", Apr 2026. https://miragemetrics.com/blog/ai-quantity-takeoff-construction-plans/
15. DBF Signal, "Generative QA/QC for BIM Discrepancy Detection", Mar 2026. https://www.dbfsignal.com/article/594787e8-522f-4860-99e3-7161791c6714

---

*Fin del reporte. Las tres capacidades propuestas extienden la superficie de 3 herramientas existentes, respetan todas las restricciones lockeadas del PoC, y tienen evidencia de mercado y académica que las respalda.*
