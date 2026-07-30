// src/agent/schema.ts
//
// JSON-Schema function declarations for the three JARVIS BIM tools,
// in Gemini's function-calling format. Names + descriptions are in
// Spanish (the locked PoC scope).

export interface ToolParameterProperty {
  type: "string" | "number" | "boolean" | "object";
  description: string;
  enum?: string[];
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
          description: "Ej: 'IfcWall', 'IfcWindow', 'IfcDoor'.",
        },
        seccion_id: {
          type: "string",
          description:
            "ID de sección de la especificación (ej: 'C.1.1.5'). Dispara el filtro del mapeo correspondiente.",
        },
        filtro: {
          type: "object",
          description:
            "Filtro directo (estructura AND/OR). Ver filterEvaluator.",
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
