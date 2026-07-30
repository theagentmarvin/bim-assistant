// filterEvaluator.ts
//
// Evaluates a Navisworks-style filter expression (AND/OR combinators
// over property rules) against a single fragment item. Used by
// Viewer3D to highlight only elements matching the full filter, not
// just the IFC class.
//
// Filter shape (from types.ts):
//   Filter:     { c: "AND"|"OR"; g: FilterGroup[] }
//   FilterGroup:{ c: "AND"|"OR"; r: FilterRule[] }
//   FilterRule: { p: string; op: string; v: string }

import type { Filter } from "../types";

export type FragmentItem = {
  ifc_class?: string;
  name?: string;
  [key: string]: unknown;
};

/** Evaluate a single rule against one item. */
function evalRule(
  rule: { p: string; op: string; v: string },
  item: FragmentItem,
): boolean {
  const raw = item[rule.p];

  switch (rule.op) {
    case "is_empty":
      return raw === undefined || raw === null || String(raw).trim() === "";
    case "is_not_empty":
      return raw !== undefined && raw !== null && String(raw).trim() !== "";
    case "equals": {
      if (raw === undefined || raw === null) return String(rule.v) === "";
      return String(raw).toLowerCase().trim() === rule.v.toLowerCase().trim();
    }
    case "not_equals": {
      if (raw === undefined || raw === null) return String(rule.v) !== "";
      return String(raw).toLowerCase().trim() !== rule.v.toLowerCase().trim();
    }
    case "contains": {
      if (raw === undefined || raw === null) return false;
      return String(raw)
        .toLowerCase()
        .includes(rule.v.toLowerCase().trim());
    }
    case ">": {
      const n = Number(raw);
      const t = Number(rule.v);
      return !Number.isNaN(n) && !Number.isNaN(t) && n > t;
    }
    case "<": {
      const n = Number(raw);
      const t = Number(rule.v);
      return !Number.isNaN(n) && !Number.isNaN(t) && n < t;
    }
    case ">=": {
      const n = Number(raw);
      const t = Number(rule.v);
      return !Number.isNaN(n) && !Number.isNaN(t) && n >= t;
    }
    case "≤":
    case "<=": {
      const n = Number(raw);
      const t = Number(rule.v);
      return !Number.isNaN(n) && !Number.isNaN(t) && n <= t;
    }
    case "in":
    case "not_in": {
      const choices = String(rule.v)
        .toLowerCase()
        .split(",")
        .map((c) => c.trim())
        .filter((c) => c !== "");
      const candidates: string[] =
        raw === undefined || raw === null
          ? []
          : Array.isArray(raw)
            ? raw.map((v: unknown) => String(v).toLowerCase().trim())
            : [String(raw).toLowerCase().trim()];
      const matched = candidates.some((v) => choices.includes(v));
      return rule.op === "in" ? matched : !matched;
    }
    case "does_not_contain": {
      if (raw === undefined || raw === null) return false;
      return !String(raw)
        .toLowerCase()
        .includes(rule.v.toLowerCase().trim());
    }
    default:
      // Unknown operator — be conservative: if it's a string op
      // default to "equals".
      if (raw === undefined || raw === null) return String(rule.v) === "";
      return String(raw).toLowerCase().trim() === rule.v.toLowerCase().trim();
  }
}

/** Evaluate a filter against one item. */
export function evaluateFilter(filter: Filter, item: FragmentItem): boolean {
  if (!filter || filter.g.length === 0) return false;

  const groupResults = filter.g.map((group) => {
    if (group.r.length === 0) return filter.c === "AND"; // empty AND = true, empty OR = false
    const ruleResults = group.r.map((rule) => evalRule(rule, item));
    return group.c === "AND"
      ? ruleResults.every(Boolean)
      : ruleResults.some(Boolean);
  });

  return filter.c === "AND"
    ? groupResults.every(Boolean)
    : groupResults.some(Boolean);
}
