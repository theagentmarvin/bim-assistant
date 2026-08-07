// src/utils/exportChat.test.ts
//
// Boss 2026-08-05 (pilot feedback loop) — formatter tripwires.
// Verifies the session-export markdown matches the shape
// documented in exportChat.ts so testers can rely on the
// `📝 Resumen para reportar` footer landing at the right place.
//
// Pure — no DOM, no IndexedDB, no browser APIs. The download
// path (`downloadMarkdown`, `exportSession`) is excluded from
// the test surface because it touches `document.createElement`
// and `URL.createObjectURL`, which aren't worth a jsdom config
// for the PoC.

import { describe, it, expect } from "vitest";
import { formatSessionMarkdown } from "./exportChat";
import type { TurnRecord } from "../data/storage";

const SAMPLE_TURN: TurnRecord = {
  turn_id: "t-1",
  session_id: "s-1",
  turn_index: 0,
  created_at: "2026-08-05T20:05:12.000Z",
  duration_ms: 4200,
  messages: [
    { id: "m-1", role: "user", text: "muéstrame los muros exteriores" },
    {
      id: "m-2",
      role: "tool",
      toolName: "resaltar_elementos",
      toolArgs: { clase_ifc: "IfcWall", filtro: { is_external: true } },
      toolResult: { ok: true, summary: "22 elementos resaltados de 291" },
    },
    {
      id: "m-3",
      role: "agent",
      text:
        "Encontré 22 muros exteriores en el modelo. Los resalté en el " +
        "visor 3D en color naranja." +
        "\n\n— BIM Agent · SZA_BDE3_ARQ_C1 · IFC 2x3 · 291 elementos",
    },
  ],
};

const SAMPLE_META = {
  exportedAt: new Date("2026-08-05T20:17:00.000Z"),
  tester: null,
  totalTurns: 1,
  totalMessages: 3,
};

describe("formatSessionMarkdown", () => {
  it("strips the formatting-template footer from agent messages", () => {
    const md = formatSessionMarkdown([SAMPLE_TURN], SAMPLE_META);
    expect(md).toContain("Encontré 22 muros exteriores");
    expect(md).not.toContain("SZA_BDE3_ARQ_C1");
    expect(md).not.toContain("291 elementos");
  });

  it("renders tool bubbles with args and result summary", () => {
    const md = formatSessionMarkdown([SAMPLE_TURN], SAMPLE_META);
    expect(md).toContain("🔧 resaltar_elementos");
    expect(md).toContain("clase_ifc=IfcWall");
    expect(md).toContain("22 elementos resaltados");
  });

  it("renders user messages verbatim", () => {
    const md = formatSessionMarkdown([SAMPLE_TURN], SAMPLE_META);
    expect(md).toContain("muéstrame los muros exteriores");
  });

  it("labels each role in its own header", () => {
    const md = formatSessionMarkdown([SAMPLE_TURN], SAMPLE_META);
    expect(md).toContain("👤 Usuario");
    expect(md).toContain("🤖 Agente");
  });

  it("includes the report template footer at the bottom", () => {
    const md = formatSessionMarkdown([SAMPLE_TURN], SAMPLE_META);
    expect(md).toContain("📝 Resumen para reportar");
    expect(md).toContain("Qué funcionó bien");
    expect(md).toContain("Qué salió mal");
    expect(md).toContain("Sugerencias");
  });

  it("returns an empty-session placeholder when no turns", () => {
    const md = formatSessionMarkdown([], {
      ...SAMPLE_META,
      totalTurns: 0,
      totalMessages: 0,
    });
    expect(md).toContain("Sesión vacía");
  });

  it("sorts turns by turn_index regardless of input order", () => {
    const t2: TurnRecord = { ...SAMPLE_TURN, turn_id: "t-2", turn_index: 1 };
    const t0: TurnRecord = { ...SAMPLE_TURN, turn_id: "t-0", turn_index: 0 };
    const md = formatSessionMarkdown([t2, t0], {
      ...SAMPLE_META,
      totalTurns: 2,
      totalMessages: 6,
    });
    // Turno 1 (turn_index 0) must appear before Turno 2.
    expect(md.indexOf("Turno 1")).toBeGreaterThan(-1);
    expect(md.indexOf("Turno 2")).toBeGreaterThan(-1);
    expect(md.indexOf("Turno 1")).toBeLessThan(md.indexOf("Turno 2"));
  });

  it("renders error messages with the warning label", () => {
    const errorTurn: TurnRecord = {
      ...SAMPLE_TURN,
      turn_id: "t-err",
      messages: [
        { id: "m-1", role: "user", text: "do thing" },
        { id: "m-2", role: "error", error: "Gemini devolvió 429" },
      ],
    };
    const md = formatSessionMarkdown([errorTurn], {
      ...SAMPLE_META,
      totalTurns: 1,
      totalMessages: 2,
    });
    expect(md).toContain("⚠ Error");
    expect(md).toContain("Gemini devolvió 429");
  });
});
