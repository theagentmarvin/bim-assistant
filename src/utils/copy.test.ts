// src/utils/copy.test.ts
//
// Unit tests for the Cuantificación tab clipboard / export helpers.
// Covers the new CSV-export surface added 2026-08-05 (Boss #B1 / #B2)
// plus the existing copy formatters.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildCSV,
  buildTSV,
  escapeCsvCell,
  escapeTsvCell,
  slugifyForFilename,
  timestampForFilename,
  downloadCSV,
  type Row,
} from "./copy";

describe("escapeCsvCell", () => {
  it("returns empty string for null/undefined", () => {
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell(undefined)).toBe("");
  });

  it("does not quote plain strings", () => {
    expect(escapeCsvCell("ventana")).toBe("ventana");
    expect(escapeCsvCell("Hormigón")).toBe("Hormigón");
  });

  it("quotes and escapes inner double quotes (RFC-4180)", () => {
    expect(escapeCsvCell('disco "roto"')).toBe('"disco ""roto"""');
  });

  it("quotes values containing commas", () => {
    expect(escapeCsvCell("a,b,c")).toBe('"a,b,c"');
  });

  it("quotes values containing newlines or carriage returns", () => {
    expect(escapeCsvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(escapeCsvCell("line1\r\nline2")).toBe('"line1\r\nline2"');
  });

  it("stringifies numbers and booleans", () => {
    expect(escapeCsvCell(42)).toBe("42");
    expect(escapeCsvCell(3.14)).toBe("3.14");
    expect(escapeCsvCell(true)).toBe("true");
    expect(escapeCsvCell(false)).toBe("false");
  });

  it("treats empty string as empty", () => {
    expect(escapeCsvCell("")).toBe("");
  });
});

describe("escapeTsvCell", () => {
  it("collapses tabs and newlines to single spaces", () => {
    expect(escapeTsvCell("a\tb")).toBe("a b");
    expect(escapeTsvCell("a\nb")).toBe("a b");
    expect(escapeTsvCell("a\r\nb\tc")).toBe("a b c");
  });

  it("preserves commas (no quoting needed for TSV)", () => {
    expect(escapeTsvCell("a,b,c")).toBe("a,b,c");
  });
});

describe("buildCSV", () => {
  const headers = ["Nombre", "Volumen"];
  const rows: Row[] = [
    { Nombre: "Muro 1", Volumen: 0.407 },
    { Nombre: 'Ventana "Doble"', Volumen: 0.05 },
    { Nombre: "Losa, con coma", Volumen: 1.5 },
  ];

  it("emits a header row + one line per row", () => {
    const out = buildCSV(headers, rows);
    const lines = out.split("\n");
    // 1 header + 3 rows = 4 lines.
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe("Nombre,Volumen");
  });

  it("quotes cells with commas / quotes", () => {
    const out = buildCSV(headers, rows);
    expect(out).toContain('"Ventana ""Doble"""');
    expect(out).toContain('"Losa, con coma"');
  });

  it("renders numbers without quoting", () => {
    const out = buildCSV(headers, rows);
    expect(out).toContain("Muro 1,0.407");
  });

  it("renders empty cells as empty (no literal —)", () => {
    const out = buildCSV(headers, [
      { Nombre: "x", Volumen: null },
      { Nombre: "y", Volumen: undefined },
    ]);
    expect(out.split("\n")[1]).toBe("x,");
    expect(out.split("\n")[2]).toBe("y,");
  });

  it("returns just the header for an empty row list", () => {
    expect(buildCSV(headers, [])).toBe("Nombre,Volumen");
  });
});

describe("buildTSV", () => {
  it("uses tab separators and a single header row", () => {
    const out = buildTSV(["A", "B"], [{ A: "1", B: "2" }]);
    const lines = out.split("\n");
    expect(lines[0]).toBe("A\tB");
    expect(lines[1]).toBe("1\t2");
  });

  it("replaces embedded tabs/newlines so the row stays a single line", () => {
    const out = buildTSV(["A"], [{ A: "a\tb\nc" }]);
    expect(out.split("\n")).toHaveLength(2);
    expect(out.split("\n")[1]).toBe("a b c");
  });
});

describe("slugifyForFilename", () => {
  it("lowercases and replaces non-alphanumeric runs with hyphens", () => {
    expect(slugifyForFilename("Volumen de Muros")).toBe("volumen-de-muros");
  });

  it("strips Spanish diacritics", () => {
    expect(slugifyForFilename("Defensa Metálica")).toBe("defensa-metalica");
    expect(slugifyForFilename("Pino Radiata")).toBe("pino-radiata");
    expect(slugifyForFilename("Ángulo de Acero")).toBe("angulo-de-acero");
  });

  it("collapses leading/trailing hyphens", () => {
    expect(slugifyForFilename("  Muros  ")).toBe("muros");
    expect(slugifyForFilename("---x---")).toBe("x");
  });

  it("falls back to 'tabla' for empty / all-punctuation input", () => {
    expect(slugifyForFilename("")).toBe("tabla");
    expect(slugifyForFilename("///")).toBe("tabla");
  });

  it("keeps a single ASCII letter after diacritic strip (no fallback)", () => {
    // After NFD strip, 'ñ' becomes 'n'. The fallback is for the
    // 'completely empty' case, not the 'single char' case.
    expect(slugifyForFilename("ñ")).toBe("n");
  });
});

describe("timestampForFilename", () => {
  it("formats a Date as YYYY-MM-DD-HHMM", () => {
    const d = new Date(2026, 7, 5, 17, 24); // Aug 5 2026, 17:24 local
    expect(timestampForFilename(d)).toBe("2026-08-05-1724");
  });

  it("zero-pads single-digit months, days, hours, minutes", () => {
    expect(timestampForFilename(new Date(2026, 0, 3, 4, 5))).toBe(
      "2026-01-03-0405",
    );
  });
});

describe("downloadCSV", () => {
  // Minimal DOM mock — keeps the test self-contained without a
  // happy-dom/jsdom dep. We only need the surface downloadCSV
  // touches: createElement for <a>, body.appendChild, body.removeChild.
  let clickMock: ReturnType<typeof vi.fn>;
  let anchor: {
    href: string;
    download: string;
    rel: string;
    style: Record<string, string>;
    click: () => void;
  };
  let createElementMock: ReturnType<typeof vi.fn>;
  let appendChildMock: ReturnType<typeof vi.fn>;
  let removeChildMock: ReturnType<typeof vi.fn>;
  let blobArgs: Array<[BlobPart[], string]>;
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    blobArgs = [];
    createObjectURL = vi.fn(() => "blob:mock-url");
    revokeObjectURL = vi.fn();
    clickMock = vi.fn();
    anchor = {
      href: "",
      download: "",
      rel: "",
      style: {},
      click: clickMock,
    };
    appendChildMock = vi.fn();
    removeChildMock = vi.fn();
    createElementMock = vi.fn((tag: string) => (tag === "a" ? anchor : ({} as never)));
    vi.stubGlobal("document", {
      body: { appendChild: appendChildMock, removeChild: removeChildMock },
      createElement: createElementMock,
    });
    vi.stubGlobal(
      "URL",
      Object.assign(URL, {
        createObjectURL,
        revokeObjectURL,
      }),
    );
    vi.stubGlobal(
      "Blob",
      class MockBlob {
        constructor(parts: BlobPart[], opts?: BlobPropertyBag) {
          blobArgs.push([parts, opts?.type ?? ""]);
        }
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a Blob with UTF-8 BOM + CSV", () => {
    expect(downloadCSV("test.csv", "a,b\n1,2\n")).toBe(true);
    expect(blobArgs).toHaveLength(1);
    const [parts, type] = blobArgs[0];
    expect(type).toBe("text/csv;charset=utf-8");
    expect(parts[0]).toBe("\ufeff");
    expect(parts[1]).toBe("a,b\n1,2\n");
  });

  it("uses the provided filename + sets href/download/rel", () => {
    downloadCSV("mi-tabla.csv", "x,y\n1,2\n");
    expect(anchor.href).toBe("blob:mock-url");
    expect(anchor.download).toBe("mi-tabla.csv");
    expect(anchor.rel).toBe("noopener");
  });

  it("triggers a click on the anchor", () => {
    downloadCSV("x.csv", "a,b\n1,2\n");
    expect(clickMock).toHaveBeenCalledTimes(1);
  });

  it("appends the anchor to the DOM before click + removes after", () => {
    downloadCSV("x.csv", "a,b\n");
    expect(appendChildMock).toHaveBeenCalledWith(anchor);
    expect(removeChildMock).toHaveBeenCalledWith(anchor);
  });

  it("revokes the object URL (deferred via setTimeout)", () => {
    vi.useFakeTimers();
    downloadCSV("x.csv", "a,b\n");
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
    vi.useRealTimers();
  });

  it("returns false and logs when Blob construction throws", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "Blob",
      class ThrowingBlob {
        constructor() {
          throw new Error("nope");
        }
      },
    );
    expect(downloadCSV("x.csv", "a,b\n")).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it("returns false when no document is available (SSR)", () => {
    vi.stubGlobal("document", undefined);
    expect(downloadCSV("x.csv", "a,b\n")).toBe(false);
  });
});
