// src/agent/regression.test.ts
//
// Boss 2026-08-05 (pilot feedback loop) — regression harness for
// prompt edits. If `JARVIS_SYSTEM_PROMPT` ever loses one of the
// substring tripwires below, the test fails. Cheap (<1s), pure
// (no network, no IndexedDB, no Gemini stub), and catches the
// most common prompt-edit failure mode: accidentally dropping a
// substring while reflowing the prose.
//
// Tripwire expansion policy: as Boss flags new failure modes
// during the pilot, add the missing-substring case here in the
// same commit that fixes the prompt. Cheap insurance against
// regressions on the next prompt pass.

import { describe, it, expect } from "vitest";
import { JARVIS_SYSTEM_PROMPT } from "./prompts";
import { TOOL_SCHEMAS } from "./schema";

describe("JARVIS_SYSTEM_PROMPT tripwires", () => {
  it("retains the Salfa BIM Agent 01 identity", () => {
    expect(JARVIS_SYSTEM_PROMPT).toContain("Eres Salfa BIM Agent 01");
  });

  it("retains the Spanish-only language rule", () => {
    expect(JARVIS_SYSTEM_PROMPT).toContain("Responde SIEMPRE en español");
  });

  it("retains the three-tool surface declaration", () => {
    expect(JARVIS_SYSTEM_PROMPT).toContain("consultar_base_de_conocimiento");
    expect(JARVIS_SYSTEM_PROMPT).toContain("resaltar_elementos");
    expect(JARVIS_SYSTEM_PROMPT).toContain("abrir_seccion_pdf");
  });

  it("retains the clase_ifc-required rule (Boss #14905)", () => {
    expect(JARVIS_SYSTEM_PROMPT).toContain("clase_ifc");
  });

  it("retains the top-level-only property constraint", () => {
    // The wording has evolved — "top-level" is the load-bearing
    // contract from AGENTS.md §5g (`filterEvaluator` is top-level
    // only). Match on case-insensitive substring.
    expect(JARVIS_SYSTEM_PROMPT.toLowerCase()).toContain("top-level");
  });

  it("retains the no-hallucination rule", () => {
    expect(JARVIS_SYSTEM_PROMPT.toLowerCase()).toContain("no inventes");
  });
});

describe("tool schema surface (locked at 3)", () => {
  it("ships exactly 3 tools and they are the locked Spanish names", () => {
    expect(TOOL_SCHEMAS).toHaveLength(3);
    const names = [...TOOL_SCHEMAS.map((s) => s.name)].sort();
    expect(names).toEqual([
      "abrir_seccion_pdf",
      "consultar_base_de_conocimiento",
      "resaltar_elementos",
    ]);
  });
});
