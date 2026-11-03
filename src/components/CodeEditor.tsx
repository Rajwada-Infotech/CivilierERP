import React, { useMemo, useRef } from "react";
import { tokenize, type TokenKind } from "@/lib/highlightJs";

// A code box with syntax shading in shades of one ink only (no colours): keywords the darkest and bold, calls firm, plain
// words and numbers mid, strings and punctuation lighter, comments faintest and italic. Dark themes use the same
// foreground colour, so the shades run light-to-dim there.
//
// A <textarea> cannot colour its own text, so the coloured copy lives in a <pre> right behind it, with identical font,
// padding and line height; the textarea's own text is transparent (its caret and selection stay) and its scroll position
// is copied to the copy.

// Set here (not as classes) so the Admin module's global ".font-mono { white-space: nowrap }" and the like cannot change
// the textarea's and the copy's metrics differently.
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';
const METRICS: React.CSSProperties = {
  fontFamily: MONO, fontSize: "0.75rem", lineHeight: 1.7, letterSpacing: "normal", wordSpacing: "normal",
  tabSize: 2, whiteSpace: "pre", padding: "0.75rem 1rem", margin: 0, border: 0,
};

const SHADE: Record<TokenKind, React.CSSProperties> = {
  keyword: { color: "hsl(var(--foreground))", fontWeight: 700 },
  call: { color: "hsl(var(--foreground) / 0.92)", fontWeight: 600 },
  literal: { color: "hsl(var(--foreground) / 0.86)", fontWeight: 700 },
  number: { color: "hsl(var(--foreground) / 0.8)", fontWeight: 600 },
  plain: { color: "hsl(var(--foreground) / 0.76)" },
  string: { color: "hsl(var(--foreground) / 0.58)" },
  punct: { color: "hsl(var(--foreground) / 0.48)" },
  comment: { color: "hsl(var(--foreground) / 0.38)", fontStyle: "italic" },
};

// A very large paste is left unshaded: the shading would re-run on every keystroke.
const SHADE_LIMIT = 120_000;

export function CodeEditor({ value, onChange, label, minHeight = 300 }: { value: string; onChange: (v: string) => void; label: string; minHeight?: number }) {
  const copyRef = useRef<HTMLDivElement>(null);
  const tokens = useMemo(() => (value.length <= SHADE_LIMIT ? tokenize(value) : null), [value]);
  const shaded = tokens !== null;

  const follow = (el: HTMLTextAreaElement) => {
    if (copyRef.current) copyRef.current.style.transform = `translate(${-el.scrollLeft}px, ${-el.scrollTop}px)`;
  };

  return (
    <div className="relative bg-card" style={{ minHeight }}>
      {shaded && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          <div ref={copyRef} style={{ ...METRICS, minWidth: "100%", boxSizing: "border-box", willChange: "transform" }}>
            {tokens.map((t, i) => <span key={i} style={SHADE[t.kind]}>{t.text}</span>)}
            {/* a final newline must still make room for its (empty) line, as in the textarea */}
            {"\n"}
          </div>
        </div>
      )}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => follow(e.currentTarget)}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-label={label}
        className="relative block w-full resize-y bg-transparent outline-none"
        style={{
          ...METRICS, minHeight, boxSizing: "border-box",
          color: shaded ? "transparent" : "hsl(var(--foreground))",
          caretColor: "hsl(var(--foreground))",
          WebkitTextFillColor: shaded ? "transparent" : undefined,
        }}
      />
    </div>
  );
}
