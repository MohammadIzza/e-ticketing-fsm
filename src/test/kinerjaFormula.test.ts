import { describe, expect, it } from "vitest";
import {
  evaluateFormula,
  extractVariables,
  FormulaError,
} from "../lib/kinerjaFormula";

describe("evaluateFormula", () => {
  it("operasi dasar +-*/", () => {
    expect(evaluateFormula("1 + 2 * 3", {})).toBe(7);
    expect(evaluateFormula("(1 + 2) * 3", {})).toBe(9);
    expect(evaluateFormula("10 - 2 / 4", {})).toBe(9.5);
    expect(evaluateFormula("-5 + 3", {})).toBe(-2);
    expect(evaluateFormula("--5", {})).toBe(5);
  });

  it("variabel di-resolve dari vars", () => {
    expect(evaluateFormula("x * 2", { x: 5 })).toBe(10);
    expect(evaluateFormula("a + b - c", { a: 10, b: 5, c: 3 })).toBe(12);
    expect(evaluateFormula("n_paper * 2", { n_paper: 3 })).toBe(6);
  });

  it("fungsi min/max/round", () => {
    expect(evaluateFormula("min(3, 5)", {})).toBe(3);
    expect(evaluateFormula("max(3, 5, 7)", {})).toBe(7);
    expect(evaluateFormula("round(3.7)", {})).toBe(4);
    expect(evaluateFormula("round(3.14159, 2)", {})).toBe(3.14);
    expect(evaluateFormula("floor(3.9)", {})).toBe(3);
    expect(evaluateFormula("ceil(3.1)", {})).toBe(4);
    expect(evaluateFormula("abs(-7)", {})).toBe(7);
  });

  it("formula kompleks campuran", () => {
    const out = evaluateFormula(
      "round(min(n_paper, 4) * 2 + jam_mengajar / 16, 2)",
      { n_paper: 5, jam_mengajar: 32 },
    );
    expect(out).toBe(10);
  });

  it("pembagian dengan nol → error", () => {
    expect(() => evaluateFormula("1 / 0", {})).toThrow(FormulaError);
    expect(() => evaluateFormula("x / y", { x: 1, y: 0 })).toThrow(
      FormulaError,
    );
  });

  it("variabel tidak diset → error", () => {
    expect(() => evaluateFormula("x + 1", {})).toThrow(FormulaError);
    expect(() => evaluateFormula("a + b", { a: 1 })).toThrow(FormulaError);
  });

  it("syntax error → FormulaError", () => {
    expect(() => evaluateFormula("1 +", {})).toThrow(FormulaError);
    expect(() => evaluateFormula("(1 + 2", {})).toThrow(FormulaError);
    expect(() => evaluateFormula("foo()", {})).toThrow(/tidak dikenal/);
    expect(() => evaluateFormula("round()", {})).toThrow(/butuh 1 atau 2/);
    expect(() => evaluateFormula("min()", {})).toThrow(/butuh.*1 argumen/);
  });

  it("karakter tidak dikenal → error", () => {
    expect(() => evaluateFormula("1 + 2 # 3", {})).toThrow(FormulaError);
    expect(() => evaluateFormula("1 ** 2", {})).toThrow(FormulaError);
  });

  it("formula kosong / terlalu panjang → error", () => {
    expect(() => evaluateFormula("", {})).toThrow(/kosong/);
    expect(() => evaluateFormula("   ", {})).toThrow(/kosong/);
    expect(() => evaluateFormula("1+".repeat(600), {})).toThrow(
      /terlalu panjang/,
    );
  });

  it("tidak rentan injection — keyword JS ditolak", () => {
    expect(() =>
      evaluateFormula("constructor", { constructor: 1 }),
    ).not.toThrow(); // it's just a variable name lookup
    // But "this", "alert", etc as functions tidak ada di whitelist
    expect(() => evaluateFormula("alert(1)", {})).toThrow(/tidak dikenal/);
    // Operator selain whitelist
    expect(() => evaluateFormula("1 == 1", {})).toThrow();
    expect(() => evaluateFormula("a && b", { a: 1, b: 1 })).toThrow();
  });
});

describe("extractVariables", () => {
  it("mengembalikan variabel yang dirujuk, bukan nama fungsi", () => {
    expect(extractVariables("min(a, b) + c * 2")).toEqual(["a", "b", "c"]);
    expect(extractVariables("round(x / 16, 2)")).toEqual(["x"]);
    expect(extractVariables("1 + 2")).toEqual([]);
  });

  it("variabel duplikat di-dedupe", () => {
    expect(extractVariables("a + a + b")).toEqual(["a", "b"]);
  });

  it("urutan alfabet", () => {
    expect(extractVariables("z + a + m")).toEqual(["a", "m", "z"]);
  });
});
