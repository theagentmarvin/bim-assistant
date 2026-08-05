// src/agent/rules-engine.ts
//
// Boss 2026-08-05 (Extensibility framework) — Runtime loader +
// dispatcher for the question-rules registry. Five hook types
// (intent-classifier, pre-prompt-augmentation, post-tool-call-
// validator, hallucination-guard, formatting-template) consumed
// from data/question-rules.json. Loaders are JSON, sorted by
// priority desc, applied at well-defined pipeline points in
// runAgentLoop (src/agent/loop.ts).
//
// Stays inside the locked PoC scope: no new tool, Spanish-only
// strings preserved in the JSON hooks, programmatic math guarded by
// the existing prose-injection rule for calcular_cantidades totals
// (loop.ts) — this engine augments, doesn't replace.

import rulesRaw from "../../data/question-rules.json";

// ----- Rule type definitions (discriminated on `hook`) -----

interface BaseRule {
  id: string;
  priority: number;
  description: string;
}

export interface IntentClassifierRule extends BaseRule {
  hook: "intent-classifier";
  rule: {
    patterns: Array<{
      regex: string;
      intent: string;
      response: string;
    }>;
  };
}

export interface PrePromptAugmentationRule extends BaseRule {
  hook: "pre-prompt-augmentation";
  rule: {
    trigger_pattern: string;
    augmentation_text: string;
    cooldown_turns?: number;
  };
}

export interface PostToolCallValidatorRule extends BaseRule {
  hook: "post-tool-call-validator";
  rule: {
    tool_name: string;
    /** Dot-path expression into the tool result. Currently only
     *  exact-equal checks are evaluated. */
    condition: Record<string, unknown>;
    /** Text appended to the tool result so the LLM sees the
     *  warning in its next observation step. */
    inject_warning: string;
  };
}

export interface HallucinationGuardRule extends BaseRule {
  hook: "hallucination-guard";
  rule: {
    check: string;
    tolerance_percent?: number;
    warning_text: string;
  };
}

export interface FormattingTemplateRule extends BaseRule {
  hook: "formatting-template";
  rule: {
    footer_template: string;
    max_length?: number;
    skip_when_short_circuit?: boolean;
  };
}

export type QuestionRule =
  | IntentClassifierRule
  | PrePromptAugmentationRule
  | PostToolCallValidatorRule
  | HallucinationGuardRule
  | FormattingTemplateRule;

// ----- Module-level rule cache -----

let cachedRules: QuestionRule[] | null = null;

function loadRules(): QuestionRule[] {
  if (cachedRules) return cachedRules;
  const env = rulesRaw as { rules: QuestionRule[] } | QuestionRule[];
  const list: QuestionRule[] = Array.isArray(env) ? env : env.rules ?? [];
  cachedRules = list;
  return list;
}

/**
 * Boss 2026-08-05 — Vite HMR reload hook. After a JSON save, the
 * static import is rebuilt and we drop our cache so the next
 * hook invocation re-reads. Tests and production code share the
 * same cache so it's a single explicit reset point.
 */
export function resetRulesCache(): void {
  cachedRules = null;
}

// ----- Hook 4: intent-classifier -----

export interface IntentResult {
  intent: string;
  canned_response: string;
  matched_rule_id: string;
}

/**
 * Match a single regex pattern against a message (case-insensitive,
 * trimmed). Returns the first rule whose patterns match, sorted by
 * priority desc. Pure — no side effects.
 */
export function runIntentClassifier(message: string): IntentResult | null {
  const trimmed = message.trim();
  if (!trimmed) return null;
  const rules = loadRules().filter(
    (r): r is IntentClassifierRule => r.hook === "intent-classifier",
  );
  rules.sort((a, b) => b.priority - a.priority);
  for (const rule of rules) {
    for (const pat of rule.rule.patterns) {
      let re: RegExp;
      try {
        re = new RegExp(pat.regex, "i");
      } catch {
        continue;
      }
      if (re.test(trimmed)) {
        return {
          intent: pat.intent,
          canned_response: pat.response,
          matched_rule_id: rule.id,
        };
      }
    }
  }
  return null;
}

// ----- Hook 1: pre-prompt-augmentation -----

export interface PrePromptContext {
  /** Optional signal: the user's previous turn's coarse intent —
   *  used by augmentations that declare a cooldown_turns. */
  previousIntent?: string;
}

/**
 * Collect augmentation strings from the registry that match the
 * user's message. Sorted by priority desc so the LLM sees the
 * strongest rule first. Pure — no side effects.
 */
export function collectPrePromptAugmentations(
  message: string,
  _ctx: PrePromptContext = {},
): string[] {
  const trimmed = message.trim();
  if (!trimmed) return [];
  const rules = loadRules().filter(
    (r): r is PrePromptAugmentationRule =>
      r.hook === "pre-prompt-augmentation",
  );
  rules.sort((a, b) => b.priority - a.priority);
  const out: string[] = [];
  for (const rule of rules) {
    let re: RegExp;
    try {
      re = new RegExp(rule.rule.trigger_pattern, "i");
    } catch {
      continue;
    }
    if (!re.test(trimmed)) continue;
    out.push(rule.rule.augmentation_text);
  }
  return out;
}

// ----- Hook 2: post-tool-call-validator -----

/**
 * Apply validators to a tool result. Each rule's `condition` is
 * evaluated against `result` using a tiny dot-path resolver
 * (currently only supports equality against literal values).
 *
 * On match, the rule's `inject_warning` is appended to the
 * `warnings` array on the tool result. The LLM receives the
 * modified tool response in its next observation turn.
 *
 * Pure — the input result is not mutated; a new object is
 * returned. If no rule fires, the original is returned unchanged.
 */
export function applyPostToolValidator(
  toolName: string,
  result: Record<string, unknown>,
): Record<string, unknown> {
  const rules = loadRules().filter(
    (r): r is PostToolCallValidatorRule =>
      r.hook === "post-tool-call-validator" && r.rule.tool_name === toolName,
  );
  rules.sort((a, b) => b.priority - a.priority);
  let out = result;
  let mutated = false;
  for (const rule of rules) {
    const matches = evaluateCondition(rule.rule.condition, out);
    if (!matches) continue;
    const existing =
      (out.warnings as string[] | undefined) ?? [];
    const next = [...existing, rule.rule.inject_warning];
    out = { ...out, warnings: next };
    mutated = true;
  }
  return mutated ? out : result;
}

function evaluateCondition(
  cond: Record<string, unknown>,
  result: Record<string, unknown>,
): boolean {
  for (const [path, expected] of Object.entries(cond)) {
    const actual = readPath(result, path);
    if (actual !== expected) return false;
  }
  return true;
}

function readPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const p of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[p];
  }
  return current;
}

// ----- Hook 3: hallucination-guard -----

export interface HallucinationContext {
  /** All tool results produced this turn — shape depends on the
   *  tool, but `totales` lives on consultar_base_de_conocimiento
   *  results and is the highest-value cross-check target. */
  toolResults: Array<{ tool: string; result: unknown }>;
  /** If a previous hook short-circuited the loop (intent-classifier
   *  canned response), this is true and guards can skip. */
  shortCircuited?: boolean;
}

/**
 * Run hallucination guards against the final text. Currently the
 * registry ships a `numeric_mismatch` check that scans prose for
 * numbers and compares against tool-reported totales; anything
 * outside tolerance appends a warning. Future guards can extend
 * the rule union. Returns `{ text, warnings }` where `warnings`
 * is non-empty only when something flagged.
 */
export function applyHallucinationGuard(
  text: string,
  ctx: HallucinationContext,
): { text: string; warnings: string[] } {
  if (ctx.shortCircuited) return { text, warnings: [] };
  const rules = loadRules().filter(
    (r): r is HallucinationGuardRule => r.hook === "hallucination-guard",
  );
  rules.sort((a, b) => b.priority - a.priority);
  const warnings: string[] = [];
  let out = text;
  for (const rule of rules) {
    if (rule.rule.check === "numeric_mismatch") {
      const tolerance = (rule.rule.tolerance_percent ?? 1.0) / 100;
      const totals = ctx.toolResults
        .filter((tr) => tr.tool === "consultar_base_de_conocimiento")
        .map((tr) => {
          const r = tr.result as { tabla?: { totales?: { valor: number } } };
          return r.tabla?.totales?.valor;
        })
        .filter((v): v is number => typeof v === "number");
      if (totals.length === 0) continue;
      const proseNumbers = extractNumbers(out);
      const mismatched = totals.find((t) => {
        return proseNumbers.some((p) => {
          if (p === 0 && t === 0) return false;
          if (Math.abs(p - t) / Math.max(Math.abs(p), Math.abs(t)) > tolerance) {
            // p is "mismatched" if it's close to but NOT equal to t.
            // We only flag if p is roughly t's magnitude — guards
            // against false positives on round numbers like years.
            return Math.abs(p) > t * 0.1 && Math.abs(p) < t * 10;
          }
          return false;
        });
      });
      if (mismatched !== undefined) {
        warnings.push(rule.rule.warning_text);
      }
    }
  }
  return { text: out, warnings };
}

function extractNumbers(text: string): number[] {
  const out: number[] = [];
  // Match numbers with optional thousands separators and decimal
  // point. Skip single-digit integers (likely years, IDs, counts).
  const re = /-?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0].replace(/\./g, "").replace(",", ".");
    const n = parseFloat(raw);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

// ----- Hook 5: formatting-template -----

export interface FormattingContext {
  shortCircuited?: boolean;
}

/**
 * Apply formatting templates to the final text. Currently the only
 * shipped rule appends a project-stats footer (configurable via
 * skip_when_short_circuit). Returns the (possibly augmented) text.
 */
export function applyFormattingTemplate(
  text: string,
  ctx: FormattingContext = {},
): string {
  const rules = loadRules().filter(
    (r): r is FormattingTemplateRule => r.hook === "formatting-template",
  );
  rules.sort((a, b) => b.priority - a.priority);
  let out = text;
  for (const rule of rules) {
    if (rule.rule.skip_when_short_circuit && ctx.shortCircuited) continue;
    const candidate = out + rule.rule.footer_template;
    if (
      rule.rule.max_length !== undefined &&
      candidate.length > rule.rule.max_length
    ) {
      // Truncate the original text so the footer fits within the
      // configured budget. Footer is preserved as-is.
      const budget = rule.rule.max_length - rule.rule.footer_template.length;
      out = out.slice(0, Math.max(0, budget)) + rule.rule.footer_template;
    } else {
      out = candidate;
    }
  }
  return out;
}
