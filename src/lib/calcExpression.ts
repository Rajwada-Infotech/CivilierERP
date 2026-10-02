// Pure maths behind the quick calculator (Space + C). No eval: a small
// recursive-descent parser over + - * / ^ ( ) and %, so whatever is pasted
// from a spreadsheet, bank statement or invoice can never run as code.

// Both members carry both fields (the other as undefined) so callers can read
// `.value` / `.error` directly — this project's tsconfig isn't strict, which
// disables narrowing on `ok`.
export type CalcResult =
  | { ok: true; value: number; error?: undefined }
  | { ok: false; error: string; value?: undefined };

// Currency symbols and thousands separators come along with copied figures
// (₹1,23,456.50 / $ 1,234.00 / 1 23 456). Strip what isn't maths, and map the
// look-alike operators spreadsheets and phones produce.
export function sanitizeExpression(raw: string): string {
  return raw
    .replace(/[₹$€£¥]|rs\.?|inr/gi, "")
    .replace(/[×xX✕]/g, (m) => (m === "x" || m === "X" ? "*" : "*"))
    .replace(/[÷]/g, "/")
    .replace(/[−–—]/g, "-")
    // thousands separators: "1,23,456.50" -> "123456.50" (a comma directly between digits)
    .replace(/(\d),(?=\d)/g, "$1")
    // Indian "lakh/crore" words are not supported; drop stray non-maths characters
    .replace(/[^0-9+\-*/^().%\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Pasting a column of figures (an Excel selection, one amount per line) is
// almost always "add these up" — turn it into 1200 + 800 + 450.
export function expressionFromPaste(text: string): string {
  const parts = text
    .split(/[\r\n\t]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length > 1) {
    const cleaned = parts.map(sanitizeExpression);
    const allPlainNumbers = cleaned.every((c) => /^-?\d+(\.\d+)?$/.test(c));
    if (allPlainNumbers) return cleaned.join(" + ").replace(/\+ -/g, "- ");
  }
  return sanitizeExpression(text);
}

type Tok = { t: "num"; v: number } | { t: "op"; v: string };

function tokenize(src: string): Tok[] | string {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " ") {
      i++;
    } else if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const text = src.slice(i, j);
      if ((text.match(/\./g) || []).length > 1 || text === ".") return "Invalid number";
      out.push({ t: "num", v: parseFloat(text) });
      i = j;
    } else if ("+-*/^()%".includes(c)) {
      out.push({ t: "op", v: c });
      i++;
    } else {
      return `Unexpected "${c}"`;
    }
  }
  return out;
}

class Parser {
  private p = 0;
  constructor(private toks: Tok[]) {}

  private peek(): Tok | undefined {
    return this.toks[this.p];
  }
  private isOp(v: string): boolean {
    const t = this.peek();
    return !!t && t.t === "op" && t.v === v;
  }

  parse(): number {
    const v = this.additive();
    if (this.p < this.toks.length) throw new Error("Unexpected input");
    return v;
  }

  // a + b%  means "a plus b percent of a" (200 + 10% = 220), like a pocket calculator.
  private additive(): number {
    let left = this.multiplicative().value;
    while (this.isOp("+") || this.isOp("-")) {
      const op = (this.toks[this.p++] as { v: string }).v;
      const right = this.multiplicative();
      const amount = right.percent ? left * right.value : right.value;
      left = op === "+" ? left + amount : left - amount;
    }
    return left;
  }

  private multiplicative(): { value: number; percent: boolean } {
    let { value, percent } = this.power();
    let multiplied = false;
    while (this.isOp("*") || this.isOp("/")) {
      const op = (this.toks[this.p++] as { v: string }).v;
      const r = this.power();
      if (op === "/" && r.value === 0) throw new Error("Division by zero");
      value = op === "*" ? value * r.value : value / r.value;
      multiplied = true;
    }
    return { value, percent: percent && !multiplied };
  }

  private power(): { value: number; percent: boolean } {
    const base = this.unary();
    if (this.isOp("^")) {
      this.p++;
      const exp = this.power(); // right-associative
      return { value: Math.pow(base.value, exp.value), percent: false };
    }
    return base;
  }

  private unary(): { value: number; percent: boolean } {
    if (this.isOp("-")) {
      this.p++;
      const u = this.unary();
      return { value: -u.value, percent: u.percent };
    }
    if (this.isOp("+")) {
      this.p++;
      return this.unary();
    }
    return this.postfix();
  }

  private postfix(): { value: number; percent: boolean } {
    let value = this.primary();
    let percent = false;
    while (this.isOp("%")) {
      this.p++;
      value = value / 100;
      percent = true;
    }
    return { value, percent };
  }

  private primary(): number {
    const t = this.peek();
    if (!t) throw new Error("Incomplete expression");
    if (t.t === "num") {
      this.p++;
      return t.v;
    }
    if (t.v === "(") {
      this.p++;
      const v = this.additive();
      if (!this.isOp(")")) throw new Error("Missing )");
      this.p++;
      return v;
    }
    throw new Error("Unexpected input");
  }
}

// 0.1 + 0.2 must read 0.3, not 0.30000000000000004.
const tidy = (n: number) => Math.round((n + Number.EPSILON) * 1e10) / 1e10;

export function evaluateExpression(input: string): CalcResult {
  const src = sanitizeExpression(input);
  if (!src) return { ok: false, error: "" };
  const toks = tokenize(src);
  if (typeof toks === "string") return { ok: false, error: toks };
  try {
    const value = new Parser(toks).parse();
    if (!Number.isFinite(value)) return { ok: false, error: "Result is too large" };
    return { ok: true, value: tidy(value) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Invalid expression" };
  }
}

// Indian digit grouping (12,34,567.50), up to 6 decimals, no trailing zeros.
export function formatIndian(n: number): string {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 6 });
}

// What goes on the clipboard: a plain number other fields can take as-is
// (no separators), so it pastes cleanly into an amount box.
export function plainNumber(n: number): string {
  return String(tidy(n));
}
