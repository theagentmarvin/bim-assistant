// Shared types for Stage 4 Review UI.
// Mirrors the schema produced by src/mapper/map.py / data/processed/validation/mapping_presets.json.

export interface FilterRule {
  p: string;
  op: string;
  v: string;
}

export interface FilterGroup {
  c: "AND" | "OR";
  r: FilterRule[];
}

export interface Filter {
  c: "AND" | "OR";
  g: FilterGroup[];
}

export type Pass = "canonical" | "high" | "medium" | "review" | "offline";

export type TargetMode =
  | "element"
  | "layer"
  | "unmodeled_layer"
  | "assembly"
  | "hardware"
  | "coating"
  | "offline";

export interface MatchStats {
  matched_elements: number;
  match_share: number;
  specificity_status: string;
  rule_count: number;
  class_only: boolean;
}

export interface MappingResult {
  ifc_class: string;
  conf: number;
  base_conf?: number;
  rationale: string;
  filter: Filter;
  pass: Pass;
  analysis_class?: string;
  quantity_type?: string;
  target_mode?: TargetMode;
  canonical_concept?: string;
  match_stats?: MatchStats;
}

export interface Mapping {
  section_id: string;
  section_title: string;
  unit: string | null;
  analysis_class?: string;
  quantity_type?: string;
  target_mode?: TargetMode;
  canonical_concept?: string;
  results: MappingResult[];
  status: string;
}

export interface MappingPresets {
  run: {
    method: string;
    judge: string;
    sections: number;
    elements: number;
    note: string;
  };
  mappings: Mapping[];
}

// Convenience: pick the best (highest confidence) result for header display.
export function topResult(m: Mapping): MappingResult | null {
  if (!m.results || m.results.length === 0) return null;
  return m.results.reduce((best, r) => (r.conf > best.conf ? r : best), m.results[0]);
}