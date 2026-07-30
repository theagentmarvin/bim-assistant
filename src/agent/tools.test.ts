import { describe, it, expect } from "vitest";
import {
  resolveColumnKey,
  getPropertyByPath,
  getScalarTopLevelKeys,
} from "./tools";

/**
 * Unit tests for the column-resolution layer added by
 * Boss 2026-07-30 task-psets-flattening. Covers:
 *   - resolveColumnKey: 9 new Spanish aliases + regex + bare-name
 *     partial-match + snake_case fallback + edge cases
 *   - getPropertyByPath: literal-key-first fix for flat dotted
 *     keys + legacy nested-walk + missing-key handling
 *   - getScalarTopLevelKeys: filter out object values
 *
 * Run via: npm run test
 */

const WALL_AVAILABLE = [
  "Qto_WallBaseQuantities.Width",
  "Qto_WallBaseQuantities.Height",
  "Qto_WallBaseQuantities.Length",
  "Qto_WallBaseQuantities.GrossVolume",
  "Qto_WallBaseQuantities.NetVolume",
  "Qto_WallBaseQuantities.GrossSideArea",
  "Qto_WallBaseQuantities.NetSideArea",
  "Pset_WallCommon.IsExternal",
  "Pset_WallCommon.LoadBearing",
  "Pset_WallCommon.ThermalTransmittance",
  "name",
  "ifc_class",
  "is_external",
  "fire_rating",
  "material_name",
  "spatial_container",
  "predefined_type",
  "element_id",
  "express_id",
];

const WALL_ROW: Record<string, unknown> = {
  express_id: 226,
  ifc_class: "IfcWall",
  name: "Wall-1",
  "Qto_WallBaseQuantities.GrossVolume": 0.4071380288002922,
  "Qto_WallBaseQuantities.Width": 0.09609999999999999,
  "Qto_WallBaseQuantities.Height": 2.6,
  "Qto_WallBaseQuantities.Length": 3.0,
  "Qto_WallBaseQuantities.NetSideArea": 2.4959999999999996,
  "Qto_WallBaseQuantities.GrossSideArea": 3.12,
  "Qto_WallBaseQuantities.NetVolume": 0.395,
  "Pset_WallCommon.IsExternal": true,
  "Pset_WallCommon.LoadBearing": false,
  "Pset_WallCommon.ThermalTransmittance": 5.756457564575646,
  geometry_summary: {
    length_m: 3.0,
    width_m: 0.096,
    height_m: 2.6,
    volume_m3: 0.407,
  },
  is_external: true,
  fire_rating: "REI 60",
  material_name: "Hormigón",
  psets: { Pset_WallCommon: { IsExternal: true } },
};

// -----------------------------------------------------------------------
// resolveColumnKey — flattened Qto aliases (Boss 2026-07-30)
// -----------------------------------------------------------------------

describe("resolveColumnKey — flattened Qto aliases", () => {
  it("volumen → Qto_WallBaseQuantities.GrossVolume via regex", () => {
    expect(resolveColumnKey("volumen", WALL_AVAILABLE)).toBe(
      "Qto_WallBaseQuantities.GrossVolume",
    );
  });

  it("altura → Qto_WallBaseQuantities.Height via bare-name endsWith", () => {
    expect(resolveColumnKey("altura", WALL_AVAILABLE)).toBe(
      "Qto_WallBaseQuantities.Height",
    );
  });

  it("ancho → Qto_WallBaseQuantities.Width via bare-name endsWith", () => {
    expect(resolveColumnKey("ancho", WALL_AVAILABLE)).toBe(
      "Qto_WallBaseQuantities.Width",
    );
  });

  it("largo → Qto_WallBaseQuantities.Length via bare-name endsWith", () => {
    expect(resolveColumnKey("largo", WALL_AVAILABLE)).toBe(
      "Qto_WallBaseQuantities.Length",
    );
  });

  it("alto → Qto_WallBaseQuantities.Height via bare-name endsWith", () => {
    expect(resolveColumnKey("alto", WALL_AVAILABLE)).toBe(
      "Qto_WallBaseQuantities.Height",
    );
  });

  it("area neta → Qto_WallBaseQuantities.NetSideArea via bare-name endsWith", () => {
    expect(resolveColumnKey("area neta", WALL_AVAILABLE)).toBe(
      "Qto_WallBaseQuantities.NetSideArea",
    );
  });

  it("area bruta → Qto_WallBaseQuantities.GrossSideArea via bare-name endsWith", () => {
    expect(resolveColumnKey("area bruta", WALL_AVAILABLE)).toBe(
      "Qto_WallBaseQuantities.GrossSideArea",
    );
  });

  it("volumen bruto → Qto_WallBaseQuantities.GrossVolume via bare-name endsWith", () => {
    expect(resolveColumnKey("volumen bruto", WALL_AVAILABLE)).toBe(
      "Qto_WallBaseQuantities.GrossVolume",
    );
  });

  it("volumen neto → Qto_WallBaseQuantities.NetVolume via bare-name endsWith", () => {
    expect(resolveColumnKey("volumen neto", WALL_AVAILABLE)).toBe(
      "Qto_WallBaseQuantities.NetVolume",
    );
  });

  it("area (bare) → Qto_WallBaseQuantities.NetSideArea (first endsWith match)", () => {
    expect(resolveColumnKey("area", WALL_AVAILABLE)).toBe(
      "Qto_WallBaseQuantities.NetSideArea",
    );
  });
});

// -----------------------------------------------------------------------
// resolveColumnKey — legacy aliases (backward compat)
// -----------------------------------------------------------------------

describe("resolveColumnKey — legacy aliases", () => {
  it("fire_rating → literal 'fire_rating' (legacy map value)", () => {
    expect(resolveColumnKey("fire_rating", WALL_AVAILABLE)).toBe("fire_rating");
  });

  it("largo without availableColumns → 'Length' literal fallback", () => {
    expect(resolveColumnKey("largo")).toBe("Length");
  });

  it("volumen without availableColumns → null (regex requires columns)", () => {
    expect(resolveColumnKey("volumen")).toBeNull();
  });
});

// -----------------------------------------------------------------------
// resolveColumnKey — fallback paths
// -----------------------------------------------------------------------

describe("resolveColumnKey — fallback paths", () => {
  it("empty label → null", () => {
    expect(resolveColumnKey("", WALL_AVAILABLE)).toBeNull();
  });

  it("whitespace label → null", () => {
    expect(resolveColumnKey("   ", WALL_AVAILABLE)).toBeNull();
  });

  it("unmapped snake_case label → returns snake_case form", () => {
    expect(resolveColumnKey("custom_field", WALL_AVAILABLE)).toBe(
      "custom_field",
    );
  });

  it("case-insensitive map lookup (VOLUMEN works)", () => {
    expect(resolveColumnKey("VOLUMEN", WALL_AVAILABLE)).toBe(
      "Qto_WallBaseQuantities.GrossVolume",
    );
  });
});

// -----------------------------------------------------------------------
// resolveColumnKey — partial match against availableColumns
// -----------------------------------------------------------------------

describe("resolveColumnKey — partial match against availableColumns", () => {
  it("substring match when no map entry", () => {
    // "grossvolume" not in map, but matches Qto_WallBaseQuantities.GrossVolume
    expect(resolveColumnKey("grossvolume", WALL_AVAILABLE)).toBe(
      "Qto_WallBaseQuantities.GrossVolume",
    );
  });

  it("exact match against availableColumns when no map entry", () => {
    expect(
      resolveColumnKey("Qto_WallBaseQuantities.Height", WALL_AVAILABLE),
    ).toBe("Qto_WallBaseQuantities.Height");
  });
});

// -----------------------------------------------------------------------
// getPropertyByPath — Boss 2026-07-30 fix (literal-key-first)
// -----------------------------------------------------------------------

describe("getPropertyByPath — literal-key-first fix", () => {
  it("returns literal value for flat dotted top-level keys", () => {
    expect(
      getPropertyByPath(WALL_ROW, "Qto_WallBaseQuantities.GrossVolume"),
    ).toBe(0.4071380288002922);
  });

  it("returns literal value for Pset_WallCommon.ThermalTransmittance", () => {
    expect(
      getPropertyByPath(WALL_ROW, "Pset_WallCommon.ThermalTransmittance"),
    ).toBe(5.756457564575646);
  });

  it("walks nested object for legacy geometry_summary.length_m", () => {
    expect(getPropertyByPath(WALL_ROW, "geometry_summary.length_m")).toBe(3.0);
  });

  it("returns undefined for missing literal key", () => {
    expect(
      getPropertyByPath(WALL_ROW, "Pset_DoorCommon.IsExternal"),
    ).toBeUndefined();
  });

  it("returns undefined for missing nested segment", () => {
    expect(
      getPropertyByPath(WALL_ROW, "geometry_summary.breadth_m"),
    ).toBeUndefined();
  });

  it("returns undefined when walking into a null intermediate", () => {
    expect(getPropertyByPath(WALL_ROW, "psets.nonexistent.deep")).toBeUndefined();
  });
});

// -----------------------------------------------------------------------
// getScalarTopLevelKeys
// -----------------------------------------------------------------------

describe("getScalarTopLevelKeys", () => {
  it("includes flat dotted keys (scalar values)", () => {
    const keys = getScalarTopLevelKeys([WALL_ROW]);
    expect(keys).toContain("Qto_WallBaseQuantities.GrossVolume");
    expect(keys).toContain("Pset_WallCommon.IsExternal");
    expect(keys).toContain("name");
  });

  it("excludes nested object values", () => {
    const keys = getScalarTopLevelKeys([WALL_ROW]);
    expect(keys).not.toContain("psets");
    expect(keys).not.toContain("geometry_summary");
  });
});