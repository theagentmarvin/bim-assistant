/* ModelPropertyPanel.tsx
 *
 * Property panel for the selected 3D element, rendered as a single flat
 * vertical key-value list (Dalux-style).
 *
 * Reads the full PSet + Qto data from the parsed BIM extraction
 * (data/processed/validation/bim_elements.json) via the existing
 * findBimElement(expressId) helper. The 3D viewer fires element
 * metadata on click (ElementProperties); the panel takes the
 * expressId and looks up the rich PSet bag — no runtime web-ifc
 * coupling, the pipeline is the source of truth.
 *
 * Layout (flat list, no collapsibles):
 *   - Header: IFC class + expressId + name
 *   - Element: GlobalId, PredefinedType, Material, FireRating, IsExternal, Spatial
 *   - Properties: all Pset_* groups flattened; the Pset name appears as a
 *     small inline label above its first row for orientation.
 *   - Quantities: all Qto_* groups flattened with unit-aware formatting.
 *   - Other: any pset_name that doesn't match Pset_/Qto_ prefixes.
 *   - Empty placeholder when no element is selected.
 */

import { Fragment, useMemo } from "react";
import { findBimElement } from "../data/elements";
import type { ElementProperties } from "../viewer/Viewer3D";
import styles from "./ModelPropertyPanel.module.css";

interface Props {
  /** The currently selected element's runtime metadata from the 3D viewer. */
  data: ElementProperties | null;
}

type PsetDict = Record<string, Record<string, unknown>>;

interface FlatRow {
  key: string;
  value: unknown;
  /** Optional group label printed above the first row of each group. */
  group?: string;
}

function isPsetDict(value: unknown): value is PsetDict {
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value as Record<string, unknown>).every(
    (v) => typeof v === "object" && v !== null,
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "—";
    return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/\.?0+$/, "");
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (obj.properties && typeof obj.properties === "object") {
      const inner = Object.entries(obj.properties as Record<string, unknown>)
        .map(([k, v]) => `${k}=${formatValue(v)}`)
        .join(", ");
      return inner || "—";
    }
    return JSON.stringify(obj);
  }
  return String(value);
}

function formatQuantity(name: string, value: unknown): string {
  if (typeof value === "object" && value !== null) {
    return formatValue(value);
  }
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return formatValue(value);
  const lower = name.toLowerCase();
  if (lower.includes("area")) return `${num.toFixed(3)} m²`;
  if (lower.includes("volume")) return `${num.toFixed(4)} m³`;
  if (
    lower.includes("length") ||
    lower.includes("width") ||
    lower.includes("height") ||
    lower.includes("depth")
  ) {
    return `${num.toFixed(3)} m`;
  }
  return Number.isInteger(num) ? String(num) : num.toFixed(4).replace(/\.?0+$/, "");
}

export default function ModelPropertyPanel({ data }: Props) {
  const bimElement = useMemo(() => {
    if (!data) return null;
    // data.expressId is the fragments localId, NOT the IFC express_id.
    // Pass the GUID so findBimElement can resolve via the byGlobalId map.
    return findBimElement(data.expressId, { guid: data.guid, element_id: data.guid, GlobalId: data.guid });
  }, [data]);

  const psets: PsetDict | undefined = useMemo(() => {
    if (!bimElement?.psets) return undefined;
    return isPsetDict(bimElement.psets) ? bimElement.psets : undefined;
  }, [bimElement]);

  const psetGroups = useMemo(() => {
    if (!psets) return [];
    return Object.entries(psets)
      .filter(([name]) => name.startsWith("Pset_"))
      .sort(([a], [b]) => a.localeCompare(b));
  }, [psets]);

  const qtoGroups = useMemo(() => {
    if (!psets) return [];
    return Object.entries(psets)
      .filter(([name]) => name.startsWith("Qto_"))
      .sort(([a], [b]) => a.localeCompare(b));
  }, [psets]);

  const otherGroups = useMemo(() => {
    if (!psets) return [];
    return Object.entries(psets)
      .filter(([name]) => !name.startsWith("Pset_") && !name.startsWith("Qto_"))
      .sort(([a], [b]) => a.localeCompare(b));
  }, [psets]);

  if (!data) {
    return (
      <div className={styles.panel}>
        <div className={styles.placeholder}>
          <span className={styles.placeholderIcon}>▢</span>
          <span className={styles.placeholderTitle}>No element selected</span>
          <span className={styles.placeholderText}>
            Click an element in the 3D viewer to see its properties.
          </span>
        </div>
      </div>
    );
  }

  // Flatten Pset_* into a single ordered list with per-group labels.
  const propertyRows: FlatRow[] = psetGroups.flatMap(([groupName, props]) =>
    Object.entries(props).map(([propName, propValue], idx) => ({
      key: propName,
      value: propValue,
      group: idx === 0 ? groupName : undefined,
    })),
  );

  // Flatten Qto_* into a single ordered list with per-group labels.
  const quantityRows: FlatRow[] = qtoGroups.flatMap(([groupName, props]) =>
    Object.entries(props).map(([propName, propValue], idx) => ({
      key: propName,
      value: propValue,
      group: idx === 0 ? groupName : undefined,
    })),
  );

  // Flatten Other_* into a single ordered list with per-group labels.
  const otherRows: FlatRow[] = otherGroups.flatMap(([groupName, props]) =>
    Object.entries(props).map(([propName, propValue], idx) => ({
      key: propName,
      value: propValue,
      group: idx === 0 ? groupName : undefined,
    })),
  );

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <div className={styles.headerTop}>
          <code className={styles.ifcClass}>{data.ifcClass}</code>
          <span className={styles.expressId}>#{data.expressId}</span>
        </div>
        <div className={styles.name}>{data.name || "—"}</div>
      </header>

      <div className={styles.body}>
        {bimElement && (
          <section className={styles.section}>
            <div className={styles.sectionLabel}>Element</div>
            <div className={styles.kvList}>
              {bimElement.element_id && (
                <div className={styles.kv}>
                  <span className={styles.kvKey}>GlobalId</span>
                  <code className={styles.kvValue} title={bimElement.element_id}>
                    {bimElement.element_id}
                  </code>
                </div>
              )}
              {bimElement.predefined_type && (
                <div className={styles.kv}>
                  <span className={styles.kvKey}>PredefinedType</span>
                  <span className={styles.kvValue}>{bimElement.predefined_type}</span>
                </div>
              )}
              {bimElement.material_name && (
                <div className={styles.kv}>
                  <span className={styles.kvKey}>Material</span>
                  <span className={styles.kvValue}>{bimElement.material_name}</span>
                </div>
              )}
              {bimElement.fire_rating && (
                <div className={styles.kv}>
                  <span className={styles.kvKey}>FireRating</span>
                  <span className={styles.kvValue}>{bimElement.fire_rating}</span>
                </div>
              )}
              {bimElement.is_external !== null && bimElement.is_external !== undefined && (
                <div className={styles.kv}>
                  <span className={styles.kvKey}>IsExternal</span>
                  <span className={styles.kvValue}>{String(bimElement.is_external)}</span>
                </div>
              )}
              {bimElement.spatial_container && (
                <div className={styles.kv}>
                  <span className={styles.kvKey}>Spatial container</span>
                  <span className={styles.kvValue}>{bimElement.spatial_container}</span>
                </div>
              )}
            </div>
          </section>
        )}

        <section className={styles.section}>
          <div className={styles.sectionLabel}>
            <span>Properties</span>
            <span className={styles.sectionCount}>{propertyRows.length}</span>
          </div>
          {propertyRows.length === 0 ? (
            <div className={styles.empty}>No properties</div>
          ) : (
            <div className={styles.kvList}>
              {propertyRows.map((row, i) => (
                <Fragment key={`${row.group ?? "_"}.${row.key}.${i}`}>
                  {row.group && <div className={styles.groupLabel}>{row.group}</div>}
                  <div
                    className={styles.kv}
                    title={`${row.key}: ${formatValue(row.value)}`}
                  >
                    <span className={styles.kvKey}>{row.key}</span>
                    <span className={styles.kvValue}>{formatValue(row.value)}</span>
                  </div>
                </Fragment>
              ))}
            </div>
          )}
        </section>

        <section className={styles.section}>
          <div className={styles.sectionLabel}>
            <span>Quantities</span>
            <span className={styles.sectionCount}>{quantityRows.length}</span>
          </div>
          {quantityRows.length === 0 ? (
            <div className={styles.empty}>No quantities</div>
          ) : (
            <div className={styles.kvList}>
              {quantityRows.map((row, i) => (
                <Fragment key={`${row.group ?? "_"}.${row.key}.${i}`}>
                  {row.group && <div className={styles.groupLabel}>{row.group}</div>}
                  <div
                    className={styles.kv}
                    title={`${row.key}: ${formatQuantity(row.key, row.value)}`}
                  >
                    <span className={styles.kvKey}>{row.key}</span>
                    <span className={styles.kvValue}>{formatQuantity(row.key, row.value)}</span>
                  </div>
                </Fragment>
              ))}
            </div>
          )}
        </section>

        {otherRows.length > 0 && (
          <section className={styles.section}>
            <div className={styles.sectionLabel}>
              <span>Other</span>
              <span className={styles.sectionCount}>{otherRows.length}</span>
            </div>
            <div className={styles.kvList}>
              {otherRows.map((row, i) => (
                <Fragment key={`${row.group ?? "_"}.${row.key}.${i}`}>
                  {row.group && <div className={styles.groupLabel}>{row.group}</div>}
                  <div
                    className={styles.kv}
                    title={`${row.key}: ${formatValue(row.value)}`}
                  >
                    <span className={styles.kvKey}>{row.key}</span>
                    <span className={styles.kvValue}>{formatValue(row.value)}</span>
                  </div>
                </Fragment>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}