import { describe, it, expect } from "vitest";
import {
  resolveColumnKey,
  getPropertyByPath,
  getScalarTopLevelKeys,
  buildTabla,
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

// -----------------------------------------------------------------------
// buildTabla — calcular_cantidades (Boss 2026-08-03)
// -----------------------------------------------------------------------

describe("buildTabla — calcular_cantidades", () => {
  it("sums Volumen for IfcWall and adds a TOTAL row", () => {
    // IfcWall has Qto_WallBaseQuantities.GrossVolume; IfcWindow has
    // only Width/Height/Area (no Volume). Test runs against walls
    // so the alias "volumen" resolves to a real key.
    const tabla = buildTabla("modelo", {
      clase_ifc: "IfcWall",
      columnas: ["Nombre", "Volumen"],
      calcular: { operacion: "suma", columna: "Volumen" },
    });
    expect(tabla).toBeDefined();
    expect(tabla!.totales).toBeDefined();
    expect(tabla!.totales!.operacion).toBe("suma");
    expect(tabla!.totales!.columna).toBe("Volumen");
    expect(tabla!.totales!.unidad).toBe("m³");
    expect(tabla!.totales!.valor).toBeGreaterThan(0);
    const lastRow = tabla!.filas[tabla!.filas.length - 1];
    expect(lastRow._tipo).toBe("total");
    expect(lastRow["Volumen"]).toContain("m³");
    // Non-target columns are "—" in the TOTAL row.
    expect(lastRow["Nombre"]).toBe("—");
  });

  it("averages a numeric column (operacion: promedio)", () => {
    const tabla = buildTabla("modelo", {
      clase_ifc: "IfcWall",
      columnas: ["Área"],
      calcular: { operacion: "promedio", columna: "Área" },
    });
    expect(tabla!.totales!.operacion).toBe("promedio");
    expect(tabla!.totales!.columna).toBe("Área");
    expect(tabla!.totales!.unidad).toBe("m²");
  });

  it("min operation on Ancho for IfcWindow (unit: m)", () => {
    const tabla = buildTabla("modelo", {
      clase_ifc: "IfcWindow",
      columnas: ["Ancho"],
      calcular: { operacion: "min", columna: "Ancho" },
    });
    expect(tabla!.totales!.operacion).toBe("min");
    expect(tabla!.totales!.unidad).toBe("m");
  });

  it("max operation on Alto for IfcWall (unit: m)", () => {
    const tabla = buildTabla("modelo", {
      clase_ifc: "IfcWall",
      columnas: ["Alto"],
      calcular: { operacion: "max", columna: "Alto" },
    });
    expect(tabla!.totales!.operacion).toBe("max");
    expect(tabla!.totales!.unidad).toBe("m");
  });

  it("TOTAL row string matches `${valor.toFixed(3)} ${unidad}`", () => {
    const tabla = buildTabla("modelo", {
      clase_ifc: "IfcWall",
      columnas: ["Volumen"],
      calcular: { operacion: "suma", columna: "Volumen" },
    });
    const lastRow = tabla!.filas[tabla!.filas.length - 1];
    const formatted = lastRow["Volumen"] as string;
    const expected = `${tabla!.totales!.valor.toFixed(3)} ${tabla!.totales!.unidad}`;
    expect(formatted).toBe(expected);
  });

  it("no totales when target column has no numeric values", () => {
    const tabla = buildTabla("modelo", {
      clase_ifc: "IfcWall",
      columnas: ["Nombre"],
      calcular: { operacion: "suma", columna: "Nombre" },
    });
    expect(tabla!.totales).toBeUndefined();
    const hasTotalRow = tabla!.filas.some((r) => r._tipo === "total");
    expect(hasTotalRow).toBe(false);
  });

  it("available_properties does not expose _tipo as a column", () => {
    const tabla = buildTabla("modelo", {
      clase_ifc: "IfcWall",
      columnas: ["Volumen"],
      calcular: { operacion: "suma", columna: "Volumen" },
    });
    expect(tabla!.available_properties).toBeDefined();
    expect(tabla!.available_properties).not.toContain("_tipo");
  });

  it("totales expr resolves to the same Qto_ key as the column projection", () => {
    // "Volumen" resolves to Qto_WallBaseQuantities.GrossVolume.
    // The unit inference must agree with the projection or the
    // rendered TOTAL row will show the wrong unit.
    const tabla = buildTabla("modelo", {
      clase_ifc: "IfcWall",
      columnas: ["Volumen"],
      calcular: { operacion: "suma", columna: "Volumen" },
    });
    expect(tabla!.totales!.unidad).toBe("m³");
  });
});

describe("buildTabla — refinement negation operators (Boss 2026-08-05 R2.5)", () => {
  // Each test rebuilds its own baseline so filter values are pulled
  // from real cache rows (avoids dependency on hypothetical "Wall-1"
  // fixtures that don't exist in bim_elements.json).

  it("no_igual excludes rows with matching name", () => {
    const baseline = buildTabla("modelo", {
      clase_ifc: "IfcWall",
      columnas: ["Nombre"],
    });
    expect(baseline).toBeDefined();
    if (!baseline || baseline.filas.length === 0) return;
    const target = String(baseline.filas[0]["Nombre"] ?? "");
    const refined = buildTabla("modelo", {
      refinar: {
        filtrar_por: { columna: "Nombre", valor: target, operador: "no_igual" },
      },
    });
    expect(refined).toBeDefined();
    if (!refined) return;
    // No refined row should still match the target value.
    expect(refined.filas.every((r) => r["Nombre"] !== target)).toBe(true);
    // Refined rows = baseline minus the rows whose name matched target.
    const baselineMatches = baseline.filas.filter(
      (r) => r["Nombre"] === target,
    ).length;
    expect(refined.filas.length).toBe(baseline.filas.length - baselineMatches);
  });

  it("no_contiene excludes rows whose name contains the substring", () => {
    const baseline = buildTabla("modelo", {
      clase_ifc: "IfcWall",
      columnas: ["Nombre"],
    });
    expect(baseline).toBeDefined();
    if (!baseline || baseline.filas.length === 0) return;
    // Pick a real substring of the first row's name (first 3 chars).
    const target = String(baseline.filas[0]["Nombre"] ?? "").slice(0, 3);
    const refined = buildTabla("modelo", {
      refinar: {
        filtrar_por: {
          columna: "Nombre",
          valor: target,
          operador: "no_contiene",
        },
      },
    });
    expect(refined).toBeDefined();
    if (!refined) return;
    expect(
      refined.filas.every(
        (r) =>
          !String(r["Nombre"] ?? "").toLowerCase().includes(target.toLowerCase()),
      ),
    ).toBe(true);
  });

  it("no_mayor_que keeps values <= threshold; skips non-numeric cells", () => {
    const baseline = buildTabla("modelo", {
      clase_ifc: "IfcWall",
      columnas: ["Volumen"],
    });
    expect(baseline).toBeDefined();
    if (!baseline || baseline.filas.length === 0) return;
    const firstV = baseline.filas[0]["Volumen"];
    if (typeof firstV !== "number" || !Number.isFinite(firstV)) return;
    const threshold = firstV;
    const refined = buildTabla("modelo", {
      refinar: {
        filtrar_por: {
          columna: "Volumen",
          valor: String(threshold),
          operador: "no_mayor_que",
        },
      },
    });
    expect(refined).toBeDefined();
    if (!refined) return;
    refined.filas.forEach((r) => {
      const v = Number(r["Volumen"]);
      if (Number.isFinite(v)) {
        expect(v).toBeLessThanOrEqual(threshold);
      }
    });
  });

  it("no_menor_que keeps values >= threshold; skips non-numeric cells", () => {
    const baseline = buildTabla("modelo", {
      clase_ifc: "IfcWall",
      columnas: ["Volumen"],
    });
    expect(baseline).toBeDefined();
    if (!baseline || baseline.filas.length === 0) return;
    const firstV = baseline.filas[0]["Volumen"];
    if (typeof firstV !== "number" || !Number.isFinite(firstV)) return;
    const threshold = firstV;
    const refined = buildTabla("modelo", {
      refinar: {
        filtrar_por: {
          columna: "Volumen",
          valor: String(threshold),
          operador: "no_menor_que",
        },
      },
    });
    expect(refined).toBeDefined();
    if (!refined) return;
    refined.filas.forEach((r) => {
      const v = Number(r["Volumen"]);
      if (Number.isFinite(v)) {
        expect(v).toBeGreaterThanOrEqual(threshold);
      }
    });
  });

  it("default operador is 'igual' (backwards-compatible)", () => {
    // Build baseline to pick a real name that's actually in the data.
    const baseline = buildTabla("modelo", {
      clase_ifc: "IfcWall",
      columnas: ["Nombre"],
    });
    expect(baseline).toBeDefined();
    if (!baseline || baseline.filas.length === 0) return;
    const target = String(baseline.filas[0]["Nombre"] ?? "");

    const igualRows = buildTabla("modelo", {
      refinar: { filtrar_por: { columna: "Nombre", valor: target } },
    });
    const negatedRows = buildTabla("modelo", {
      refinar: {
        filtrar_por: {
          columna: "Nombre",
          valor: target,
          operador: "no_igual",
        },
      },
    });
    expect(igualRows).toBeDefined();
    expect(negatedRows).toBeDefined();
    if (!igualRows || !negatedRows) return;

    // igualRows ⊆ rows where Nombre === target.
    expect(igualRows.filas.every((r) => r["Nombre"] === target)).toBe(true);
    // negatedRows ⊆ rows where Nombre !== target.
    expect(negatedRows.filas.every((r) => r["Nombre"] !== target)).toBe(true);
    // Disjoint: no row name appears in both refinements.
    const igualNames = new Set(igualRows.filas.map((r) => r["Nombre"]));
    for (const r of negatedRows.filas) {
      expect(igualNames.has(r["Nombre"])).toBe(false);
    }
    // Sum of refined row counts equals baseline count (no rows lost
    // between igual + no_igual partitioning).
    expect(igualRows.filas.length + negatedRows.filas.length).toBe(
      baseline.filas.length,
    );
  });
});