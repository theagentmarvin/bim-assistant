// src/agent/schema.ts
//
// JSON-Schema function declarations for the three Salfa BIM Agent 01 tools,
// in Gemini's function-calling format. Names + descriptions are in
// Spanish (the locked PoC scope).

import bimElementsRaw from "../../data/bim_elements.json";

// Derive the IFC class enum from bim_elements.json at module-load time.
// Defensive about the envelope shape: the file is documented as
// { elements: [...] } but older extracts were sometimes a flat array.
type BimElementsEnvelope =
  | { elements?: Array<{ ifc_class?: string }> }
  | Array<{ ifc_class?: string }>;
const _bimElements = bimElementsRaw as unknown as BimElementsEnvelope;
const _bimList: Array<{ ifc_class?: string }> = Array.isArray(_bimElements)
  ? _bimElements
  : (_bimElements.elements ?? []);
export const IFC_CLASS_ENUM: readonly string[] = Array.from(
  new Set(
    _bimList
      .map((e) => e.ifc_class)
      .filter((c): c is string => typeof c === "string" && c.length > 0),
  ),
).sort();

export interface ToolParameterProperty {
  type: "string" | "number" | "boolean" | "object" | "array";
  description: string;
  enum?: string[];
  // Optional JSON Schema fields for nested object/array types (kept
  // here so `filtro` can carry a structural hint to the LLM without
  // breaking the rest of the surface).
  properties?: Record<string, ToolParameterProperty>;
  items?: ToolParameterProperty;
  // Boss 2026-08-05 (fix #B1) — nested objects need their own
  // `required` array. The top-level `required` lives on the schema's
  // `parameters` object, but for nested objects like `calcular` we
  // declare required keys here so the LLM knows both `operacion` and
  // `columna` are mandatory.
  required?: string[];
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, ToolParameterProperty>;
    required?: string[];
  };
}

export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: "consultar_base_de_conocimiento",
    description:
      "Responde preguntas sobre el modelo BIM y las especificaciones técnicas. Usa esta herramienta cuando el usuario pregunta por propiedades, cantidades, secciones de la especificación, o relaciones entre especificación y elementos del modelo.",
    parameters: {
      type: "object",
      properties: {
        pregunta: {
          type: "string",
          description: "La pregunta del usuario, en sus propias palabras.",
        },
        fuente: {
          type: "string",
          enum: ["modelo", "especificacion", "mapeos", "auto"],
          description:
            "De dónde obtener la respuesta. 'auto' decide según la pregunta (default).",
        },
        tabla: {
          type: "object",
          description:
            "OPCIONAL. Solicita una tabla estructurada en la pestaña Cuantificación. Úsalo cuando el usuario pida listados, conteos por grupo, o desglose por propiedad. Omite el campo para obtener solo prosa.",
          properties: {
            clase_ifc: {
              type: "string",
              description: "Clase IFC para filtrar (ej: 'IfcWall').",
            },
            columnas: {
              type: "array",
              description: "Columnas a mostrar. Etiquetas en español que el tool resuelve a sus claves (top-level o nested bajo geometry_summary). Ejemplos: 'Nombre' → name, 'Material' → material_name, 'Largo' → geometry_summary.length_m, 'Ancho' → geometry_summary.width_m, 'Alto' → geometry_summary.height_m. NO listes propiedades que no existen en la clase.",
              items: { type: "string", description: "Etiqueta de columna en español." },
            },
            agrupar_por: {
              type: "array",
              description: "Cuando se pide conteo agrupado (ej: 'por planta', 'por material'), pasa las claves aquí. El tool emite una fila por grupo con columna Cantidad.",
              items: { type: "string", description: "Clave top-level de la propiedad para agrupar." },
            },
            titulo: {
              type: "string",
              description: "Título en español para la cabecera de la tabla.",
            },
            // Boss 2026-08-05 (fix #B1) — `calcular` was wired up
            // in tools.ts (buildTabla + refinarTabla) earlier but
            // never exposed to the LLM via the JSON schema. Without
            // this field, the LLM had no slot to emit, so totales
            // were never computed and the TOTAL row never rendered.
            //
            // 2026-08-05 (fix #B1.b) — Boss screenshot showed 3
            // columns (Area, Largo, Alto) with no totals. The
            // original schema was a single object, so the LLM could
            // only pick ONE column per call. Array form lets the
            // LLM emit "sum Area + sum Largo + sum Alto" in a
            // single tool call → one TOTAL row per column, all
            // aligned at the bottom of the table.
            //
            // Works alongside `refinar`: re-emit `calcular` next
            // to a `refinar` filter and the refinement inherits
            // the totals from the same spec.
            calcular: {
              type: "array",
              description:
                "Lista de operaciones agregadas. Cada elemento añade una fila TOTAL al final de la tabla con la operación indicada sobre su columna. Úsalo cuando el usuario pide 'suma total', 'promedio', 'mínimo', 'máximo' de UNA O MÁS propiedades. Cada columna DEBE estar en `columnas`. La unidad se infiere del sufijo Qto_ (m², m³, m).",
              items: {
                type: "object",
                description: "Una operación de agregación sobre una columna.",
                properties: {
                  operacion: {
                    type: "string",
                    enum: ["suma", "promedio", "min", "max"],
                    description: "Operación de agregación.",
                  },
                  columna: {
                    type: "string",
                    description:
                      "Etiqueta en español de la columna a agregar (de las que ya pasaste en `columnas`).",
                  },
                },
                required: ["operacion", "columna"],
              },
            },
            refinar: {
              type: "object",
              description:
                "Boss 2026-08-05 (R2) — refina la tabla activa del último buildTabla. Reemplaza la reconstrucción desde cero. Bypassea el safeguard de clase_ifc; el refinamiento hereda el contexto de clase del cache.",
              properties: {
                filtrar_por: {
                  type: "object",
                  description:
                    "Filtra filas según una columna y un valor. Default operador=igual.",
                  properties: {
                    columna: {
                      type: "string",
                      description: "Etiqueta de la columna a evaluar.",
                    },
                    valor: {
                      type: "string",
                      description: "Valor a comparar (como string).",
                    },
                    operador: {
                      type: "string",
                      enum: ["igual", "no_igual", "contiene", "no_contiene", "mayor_que", "no_mayor_que", "menor_que", "no_menor_que"],
                      description: "Operador de comparación. Default igual. Prefijo 'no_' invierte (no_igual = no exactamente igual, no_contiene = no incluye el substring, etc).",
                    },
                  },
                },
                agregar_columnas: {
                  type: "array",
                  description: "Columnas a agregar al display (de available_properties).",
                  items: {
                    type: "string",
                    description: "Etiqueta de columna en español.",
                  },
                },
                quitar_columnas: {
                  type: "array",
                  description: "Columnas a ocultar del display (no se eliminan).",
                  items: {
                    type: "string",
                    description: "Etiqueta de columna en español.",
                  },
                },
                ordenar_por: {
                  type: "object",
                  description: "Re-ordena las filas cacheadas por esta columna.",
                  properties: {
                    columna: {
                      type: "string",
                      description: "Etiqueta de la columna a ordenar.",
                    },
                    direccion: {
                      type: "string",
                      enum: ["asc", "desc"],
                      description: "Dirección del orden.",
                    },
                  },
                },
                quitar_filtro: {
                  type: "boolean",
                  description: "Si true, restaura el conjunto de filas original (re-query con el clase_ifc cacheado).",
                },
              },
            },
          },
        },
      },
      required: ["pregunta"],
    },
  },
  {
    name: "resaltar_elementos",
    description:
      "Resalta y aísla elementos en el visor 3D según su clase IFC, sección de la especificación, o expresión de filtro.",
    parameters: {
      type: "object",
      properties: {
        clase_ifc: {
          type: "string",
          enum: [...IFC_CLASS_ENUM],
          description:
            "Clase IFC presente en el modelo. Solo las clases de IFC_CLASS_ENUM son válidas.",
        },
        seccion_id: {
          type: "string",
          description:
            "ID de sección de la especificación (ej: 'C.1.1.5'). Dispara el filtro del mapeo correspondiente.",
        },
        filtro: {
          type: "object",
          description:
            "Filtro Navisworks-style. Acceso solo a propiedades top-level (ej: 'is_external', 'predefined_type', 'name'). NO anidados (geometry_summary.x no funciona). Ejemplo real para 'muros exteriores': { c: 'AND', g: [{ c: 'AND', r: [{ p: 'ifc_class', op: 'equals', v: 'IfcWall' }, { p: 'is_external', op: 'equals', v: 'true' }] }] }. Operadores: equals, not_equals, contains, >, <, >=, <=, is_empty, is_not_empty.",
          properties: {
            c: { type: "string", enum: ["AND", "OR"], description: "Combinador global." },
            g: {
              type: "array",
              description: "Grupos de reglas (AND/OR de reglas).",
              items: {
                type: "object",
                description: "Grupo de reglas.",
                properties: {
                  c: { type: "string", enum: ["AND", "OR"], description: "Combinador del grupo." },
                  r: {
                    type: "array",
                    description: "Reglas del grupo.",
                    items: {
                      type: "object",
                      description: "Regla: propiedad + operador + valor (todos string).",
                      properties: {
                        p: { type: "string", description: "Nombre de la propiedad top-level (ej: 'is_external')." },
                        op: { type: "string", description: "Operador: equals, not_equals, contains, >, <, >=, <=, is_empty, is_not_empty." },
                        v: { type: "string", description: "Valor a comparar (como string)." },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        reset: {
          type: "boolean",
          description: "Si true, limpia cualquier resaltado previo.",
        },
      },
    },
  },
  {
    name: "abrir_seccion_pdf",
    description:
      "Abre una página específica del PDF de especificaciones técnicas.",
    parameters: {
      type: "object",
      properties: {
        seccion_id: {
          type: "string",
          description: "ID de sección (ej: 'C.1.1.5').",
        },
        consulta: {
          type: "string",
          description:
            "Búsqueda en lenguaje natural si no se conoce el ID exacto.",
        },
        pagina: {
          type: "number",
          description: "Número de página directo (1-indexed).",
        },
      },
    },
  },
];

/**
 * Map tool name → Spanish status string used in the chat panel
 * while the tool is running. Short, present-tense.
 */
export const TOOL_STATUS_LABELS: Record<string, string> = {
  consultar_base_de_conocimiento: "Buscando en la base de conocimiento…",
  resaltar_elementos: "Resaltando elementos…",
  abrir_seccion_pdf: "Abriendo sección del PDF…",
};
