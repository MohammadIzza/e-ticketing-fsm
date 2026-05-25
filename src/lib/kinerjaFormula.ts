/**
 * Safe formula evaluator untuk Kinerja Pegawai.
 *
 * Tujuan: evaluasi rumus SKS yang ditulis superadmin (cth.
 * `round(min(n_paper, 4) * 2 + jam_mengajar / 16, 2)`) **TANPA**
 * memakai `eval()` / `new Function()`. Implementasi tokenizer +
 * recursive-descent parser kecil yang hanya mengenali subset operasi
 * matematika dasar — apapun di luar whitelist akan ditolak dengan
 * `FormulaError`.
 *
 * Whitelisted:
 *   - Angka literal (integer / float, tanpa tanda eksponen `e` agar
 *     nggak bisa nyelundupkan trick).
 *   - Operator binary: `+ - * /`
 *   - Unary minus: `-x`
 *   - Tanda kurung: `( )`
 *   - Variabel: identifier `[a-zA-Z_][a-zA-Z0-9_]*` — diresolve dari
 *     argumen `vars` (kalau tidak ada, error).
 *   - Fungsi: `min(...)`, `max(...)`, `round(x[, decimals])`,
 *     `floor(x)`, `ceil(x)`, `abs(x)`. Semua dengan validasi arity.
 *
 * Pure & deterministic. Test di
 * `src/test/kinerjaFormula.test.ts`.
 */

export class FormulaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormulaError";
  }
}

type Token =
  | { kind: "num"; value: number }
  | { kind: "id"; name: string }
  | { kind: "op"; value: "+" | "-" | "*" | "/" | "(" | ")" | "," };

/* ------------------------------------------------------------------------- */
/* Tokenizer                                                                  */
/* ------------------------------------------------------------------------- */

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = input.length;
  while (i < len) {
    const c = input[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i += 1;
      continue;
    }
    if (
      c === "+" ||
      c === "-" ||
      c === "*" ||
      c === "/" ||
      c === "(" ||
      c === ")" ||
      c === ","
    ) {
      tokens.push({ kind: "op", value: c });
      i += 1;
      continue;
    }
    if (c >= "0" && c <= "9") {
      let j = i + 1;
      let dotSeen = false;
      while (j < len) {
        const cj = input[j];
        if (cj >= "0" && cj <= "9") {
          j += 1;
        } else if (cj === "." && !dotSeen) {
          dotSeen = true;
          j += 1;
        } else {
          break;
        }
      }
      const v = Number(input.slice(i, j));
      if (!Number.isFinite(v)) {
        throw new FormulaError(`Angka tidak valid: ${input.slice(i, j)}`);
      }
      tokens.push({ kind: "num", value: v });
      i = j;
      continue;
    }
    if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_") {
      let j = i + 1;
      while (j < len) {
        const cj = input[j];
        if (
          (cj >= "a" && cj <= "z") ||
          (cj >= "A" && cj <= "Z") ||
          (cj >= "0" && cj <= "9") ||
          cj === "_"
        ) {
          j += 1;
        } else break;
      }
      tokens.push({ kind: "id", name: input.slice(i, j) });
      i = j;
      continue;
    }
    throw new FormulaError(`Karakter tidak dikenal: '${c}'`);
  }
  return tokens;
}

/* ------------------------------------------------------------------------- */
/* Parser (Pratt / recursive descent)                                         */
/*                                                                            */
/* Grammar:                                                                   */
/*   expr      := term (('+' | '-') term)*                                    */
/*   term      := factor (('*' | '/') factor)*                                */
/*   factor    := '-' factor | atom                                           */
/*   atom      := number | call | '(' expr ')' | identifier                   */
/*   call      := identifier '(' (expr (',' expr)*)? ')'                      */
/* ------------------------------------------------------------------------- */

const BUILTIN_FUNCS: Record<string, (args: number[]) => number> = {
  min: (args) => {
    if (args.length === 0) throw new FormulaError("min() butuh ≥ 1 argumen");
    return Math.min(...args);
  },
  max: (args) => {
    if (args.length === 0) throw new FormulaError("max() butuh ≥ 1 argumen");
    return Math.max(...args);
  },
  round: (args) => {
    if (args.length < 1 || args.length > 2) {
      throw new FormulaError("round() butuh 1 atau 2 argumen");
    }
    const n = args[1] ?? 0;
    if (!Number.isInteger(n) || n < 0 || n > 10) {
      throw new FormulaError("round() argumen ke-2 harus integer 0..10");
    }
    const factor = Math.pow(10, n);
    return Math.round(args[0] * factor) / factor;
  },
  floor: (args) => {
    if (args.length !== 1) throw new FormulaError("floor() butuh 1 argumen");
    return Math.floor(args[0]);
  },
  ceil: (args) => {
    if (args.length !== 1) throw new FormulaError("ceil() butuh 1 argumen");
    return Math.ceil(args[0]);
  },
  abs: (args) => {
    if (args.length !== 1) throw new FormulaError("abs() butuh 1 argumen");
    return Math.abs(args[0]);
  },
};

class Parser {
  pos = 0;
  constructor(
    private tokens: Token[],
    private vars: Record<string, number>,
  ) {}

  private peek(): Token | null {
    return this.tokens[this.pos] ?? null;
  }
  private eat(): Token | null {
    return this.tokens[this.pos++] ?? null;
  }
  private expectOp(v: string): void {
    const t = this.peek();
    if (!t || t.kind !== "op" || t.value !== v) {
      throw new FormulaError(`Diharapkan '${v}'`);
    }
    this.pos += 1;
  }

  parseExpr(): number {
    let left = this.parseTerm();
    while (true) {
      const t = this.peek();
      if (!t || t.kind !== "op") break;
      if (t.value !== "+" && t.value !== "-") break;
      this.pos += 1;
      const right = this.parseTerm();
      left = t.value === "+" ? left + right : left - right;
    }
    return left;
  }

  parseTerm(): number {
    let left = this.parseFactor();
    while (true) {
      const t = this.peek();
      if (!t || t.kind !== "op") break;
      if (t.value !== "*" && t.value !== "/") break;
      this.pos += 1;
      const right = this.parseFactor();
      if (t.value === "*") {
        left = left * right;
      } else {
        if (right === 0) throw new FormulaError("Pembagian dengan nol");
        left = left / right;
      }
    }
    return left;
  }

  parseFactor(): number {
    const t = this.peek();
    if (t && t.kind === "op" && t.value === "-") {
      this.pos += 1;
      return -this.parseFactor();
    }
    return this.parseAtom();
  }

  parseAtom(): number {
    const t = this.eat();
    if (!t) throw new FormulaError("Akhir ekspresi tidak terduga");
    if (t.kind === "num") return t.value;
    if (t.kind === "op" && t.value === "(") {
      const v = this.parseExpr();
      this.expectOp(")");
      return v;
    }
    if (t.kind === "id") {
      const next = this.peek();
      if (next && next.kind === "op" && next.value === "(") {
        // Function call
        this.pos += 1;
        const args: number[] = [];
        const peeked = this.peek();
        if (!peeked || peeked.kind !== "op" || peeked.value !== ")") {
          args.push(this.parseExpr());
          while (true) {
            const sep = this.peek();
            if (!sep || sep.kind !== "op" || sep.value !== ",") break;
            this.pos += 1;
            args.push(this.parseExpr());
          }
        }
        this.expectOp(")");
        const fn = BUILTIN_FUNCS[t.name];
        if (!fn) throw new FormulaError(`Fungsi tidak dikenal: ${t.name}`);
        const v = fn(args);
        if (!Number.isFinite(v)) {
          throw new FormulaError(`Hasil ${t.name}() tidak finite`);
        }
        return v;
      }
      // Variable lookup
      if (!(t.name in this.vars)) {
        throw new FormulaError(`Variabel tidak ditemukan: ${t.name}`);
      }
      const v = this.vars[t.name];
      if (typeof v !== "number" || !Number.isFinite(v)) {
        throw new FormulaError(`Variabel ${t.name} bukan angka valid`);
      }
      return v;
    }
    throw new FormulaError("Token tidak terduga");
  }
}

/* ------------------------------------------------------------------------- */
/* Public API                                                                 */
/* ------------------------------------------------------------------------- */

/**
 * Evaluate ekspresi formula dengan mapping variabel.
 *
 * @throws FormulaError untuk syntax error / variabel hilang / pembagian
 *   nol / hasil non-finite. Caller (UI di PR-E/F) tinggal `try/catch`
 *   dan tampilkan pesan ke user.
 */
export function evaluateFormula(
  formula: string,
  vars: Record<string, number>,
): number {
  if (!formula.trim()) {
    throw new FormulaError("Formula kosong");
  }
  if (formula.length > 1000) {
    throw new FormulaError("Formula terlalu panjang (>1000 karakter)");
  }
  const tokens = tokenize(formula);
  if (tokens.length === 0) throw new FormulaError("Formula kosong");
  const parser = new Parser(tokens, vars);
  const value = parser.parseExpr();
  if (parser.pos !== tokens.length) {
    throw new FormulaError("Token tersisa setelah parsing");
  }
  if (!Number.isFinite(value)) {
    throw new FormulaError("Hasil bukan angka finite");
  }
  return value;
}

/**
 * Identifikasi variabel yang dipakai dalam formula. Berguna untuk UI
 * (PR-E) untuk validate bahwa formula hanya mereferensi indicator yang
 * sudah didefinisikan, dan untuk preview perhitungan dengan default
 * value indicator.
 */
export function extractVariables(formula: string): string[] {
  const tokens = tokenize(formula);
  const seen = new Set<string>();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind !== "id") continue;
    // Skip kalau langsung diikuti '(' (= fungsi).
    const next = tokens[i + 1];
    if (next && next.kind === "op" && next.value === "(") continue;
    if (!(t.name in BUILTIN_FUNCS)) seen.add(t.name);
  }
  return Array.from(seen).sort();
}
