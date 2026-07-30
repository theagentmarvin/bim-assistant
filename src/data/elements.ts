// BIM element data index.
//
// The 3D fragments carry enough information to render and raycast, but not
// the enriched property bag our filters were written against. This module
// joins fragment/express IDs back to the extractor output in
// data/processed/validation/bim_elements.json.

import bimElementsRaw from "../../data/bim_elements.json";

export interface BimElement {
  element_id?: string;
  express_id: number;
  ifc_class?: string;
  predefined_type?: string | null;
  name?: string | null;
  is_external?: boolean | null;
  fire_rating?: string | null;
  material_name?: string | null;
  material_layers?: string[];
  spatial_container?: string | null;
  geometry_summary?: Record<string, number | null>;
  [key: string]: unknown;
}

interface BimElementsFile {
  elements: BimElement[];
}

const data = bimElementsRaw as BimElementsFile;

const byExpressId = new Map<number, BimElement>();
const byGlobalId = new Map<string, BimElement>();
for (const element of data.elements ?? []) {
  if (typeof element.express_id === "number") {
    byExpressId.set(element.express_id, element);
  }
  if (typeof element.element_id === "string" && element.element_id.trim() !== "") {
    byGlobalId.set(element.element_id.toLowerCase(), element);
  }
}

function stringCandidate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed.toLowerCase();
}

function numericCandidate(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function findBimElement(
  fragmentId: number,
  item?: Record<string, unknown>,
): BimElement | undefined {
  const guid = stringCandidate(
    item?.element_id ?? item?.guid ?? item?.GlobalId ?? item?.globalId,
  );
  if (guid && byGlobalId.has(guid)) {
    return byGlobalId.get(guid);
  }

  const candidates = [
    fragmentId,
    numericCandidate(item?.express_id),
    numericCandidate(item?.expressID),
    numericCandidate(item?.id),
  ];
  for (const candidate of candidates) {
    if (candidate !== null && byExpressId.has(candidate)) {
      return byExpressId.get(candidate);
    }
  }
  return undefined;
}

export function evaluationItemFor(
  fragmentId: number,
  item: Record<string, unknown>,
): Record<string, unknown> {
  const bimElement = findBimElement(fragmentId, item) ?? {};
  const merged: Record<string, unknown> = { ...bimElement };
  // Keep render-side values when they exist, but never let undefined/null
  // fragment fields erase the richer extractor fields.
  for (const [key, value] of Object.entries(item)) {
    if (value !== undefined && value !== null) merged[key] = value;
  }
  return merged;
}

export function bimElementCount(): number {
  return byExpressId.size;
}
