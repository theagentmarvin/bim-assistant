// Type declaration for the static JSON imports of bim_elements.json and
// mapping_presets.json. Both files live at <project>/data/ (one level
// above src/), so the relative path is `../../data/<file>.json`.
declare module "../../data/mapping_presets.json" {
  import type { MappingPresets } from "../types";
  const value: MappingPresets;
  export default value;
}
declare module "../../data/bim_elements.json" {
  const value: { elements: Array<Record<string, unknown>> };
  export default value;
}
