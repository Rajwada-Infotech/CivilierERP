// A small JavaScript tokenizer for the Script Console's editor. It does not parse: it only needs to tell comments, strings,
// numbers, keywords and calls apart well enough to shade them. Anything it cannot place stays plain, and it never throws.

export type TokenKind = "comment" | "string" | "keyword" | "literal" | "number" | "call" | "punct" | "plain";
export interface Token { text: string; kind: TokenKind }

const KEYWORDS = new Set([
  "const", "let", "var", "function", "return", "if", "else", "for", "while", "do", "switch", "case", "default", "break", "continue",
  "try", "catch", "finally", "throw", "new", "delete", "typeof", "instanceof", "in", "of", "async", "await", "class", "extends",
  "super", "import", "export", "yield", "void",
]);
const LITERALS = new Set(["true", "false", "null", "undefined", "NaN", "Infinity", "this"]);

// One alternative per kind, tried in this order at each position.
const TOKEN_RE = new RegExp(
  [
    "(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?(?:\\*\\/|$))", // 1 comment
    "(\"(?:[^\"\\\\\\n]|\\\\.)*\"?|'(?:[^'\\\\\\n]|\\\\.)*'?|`(?:[^`\\\\]|\\\\[\\s\\S])*`?)", // 2 string (an unfinished one runs to the line / text end)
    "(0[xX][0-9a-fA-F_]+|\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?n?)", // 3 number
    "([A-Za-z_$][\\w$]*)", // 4 word
    "([{}()\\[\\];,.:?+\\-*/%=<>!&|^~]+)", // 5 punctuation / operators
    "(\\s+)", // 6 whitespace
    "([\\s\\S])", // 7 anything else
  ].join("|"),
  "g",
);

/** Splits code into shaded pieces; adjacent pieces of the same kind are merged, so a big script stays a few thousand spans. */
export function tokenize(code: string): Token[] {
  const out: Token[] = [];
  const push = (text: string, kind: TokenKind) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ text, kind });
  };
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(code)) !== null) {
    if (m[0] === "") { TOKEN_RE.lastIndex++; continue; }
    if (m[1] !== undefined) push(m[0], "comment");
    else if (m[2] !== undefined) push(m[0], "string");
    else if (m[3] !== undefined) push(m[0], "number");
    else if (m[4] !== undefined) {
      const word = m[4];
      if (KEYWORDS.has(word)) push(word, "keyword");
      else if (LITERALS.has(word)) push(word, "literal");
      else if (/^\s*\(/.test(code.slice(TOKEN_RE.lastIndex, TOKEN_RE.lastIndex + 40))) push(word, "call");
      else push(word, "plain");
    } else if (m[5] !== undefined) push(m[0], "punct");
    else push(m[0], "plain"); // whitespace and strays
  }
  return out;
}
