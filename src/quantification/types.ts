// src/quantification/types.ts
//
// Shared types for the Cuantificación tab + the structured-mode of
// the `consultar_base_de_conocimiento` tool. Kept in its own module
// so the agent layer (no React) and the panel layer (no agent
// internals) can both reference the same shape.

export type TableFuente = "modelo" | "especificacion" | "mapeos";

export interface QuantificationTable {
  /** Spanish title for the table header. */
  titulo: string;
  /** Column labels, in display order. <= 24 chars each. */
  columnas: string[];
  /** Rows keyed by column label. Values are scalars. Boss #14917:
   *  rows carry ALL top-level properties of each BIM element, not
   *  just the agent-chosen columns — the UI can add columns at runtime
   *  via available_properties without re-querying. */
  filas: Array<Record<string, string | number | boolean>>;
  /**
   * Parallel array of BIM element ids per row — filas_express_ids[i]
   * carries every express_id that filas[i] represents. Same length
   * as filas when populated (undefined when the corpus doesn't carry
   * element ids, e.g. spec/PDF tables). Drives the row-click → viewer
   * highlight interaction (Boss #14882): one row for a listing, many
   * ids for a grouping bucket.
   */
  filas_express_ids?: number[][];
  /**
   * Properties available for the user to add as columns at runtime
   * (Boss #14917). Computed at build time from the source rows minus
   * the ones the agent already chose. Powers the "Agregar columna"
   * dropdown in QuantificationPanel.
   */
  available_properties?: string[];
  /** Source corpus the table was computed from. */
  fuente: TableFuente;
  /** ISO 8601 timestamp the table was generated. */
  generadaEn: string;
}
