import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Calculator as CalcIcon, ClipboardPaste, Copy, Delete, X } from "lucide-react";
import { toast } from "sonner";
import { BodyPortal } from "@/components/ui/body-portal";
import { useCalculatorShortcut } from "@/hooks/useGlobalShortcuts";
import {
  evaluateExpression,
  expressionFromPaste,
  formatIndian,
  plainNumber,
} from "@/lib/calcExpression";
import { cn } from "@/lib/utils";

// A small always-available calculator. Hold Space and press C anywhere (outside
// a text field) to open or close it. Built for working with figures that
// already exist elsewhere: paste an amount (or a whole column of them, which is
// added up), calculate, and copy the result back as a plain number.

const HISTORY_KEY = "civilier.calculator.history";
const HISTORY_MAX = 8;

type HistoryItem = { expr: string; result: number };

function loadHistory(): HistoryItem[] {
  try {
    const raw = sessionStorage.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.slice(0, HISTORY_MAX) : [];
  } catch {
    return [];
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API blocked (http, permissions) — fall back to a hidden textarea.
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

const KEYS: Array<Array<{ label: string; insert?: string; action?: "clear" | "back" | "equals" }>> = [
  [{ label: "(", insert: "(" }, { label: ")", insert: ")" }, { label: "%", insert: "%" }, { label: "÷", insert: "/" }],
  [{ label: "7", insert: "7" }, { label: "8", insert: "8" }, { label: "9", insert: "9" }, { label: "×", insert: "*" }],
  [{ label: "4", insert: "4" }, { label: "5", insert: "5" }, { label: "6", insert: "6" }, { label: "−", insert: "-" }],
  [{ label: "1", insert: "1" }, { label: "2", insert: "2" }, { label: "3", insert: "3" }, { label: "+", insert: "+" }],
  [{ label: "C", action: "clear" }, { label: "0", insert: "0" }, { label: ".", insert: "." }, { label: "=", action: "equals" }],
];

export function CalculatorHost() {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((o) => !o), []);
  useCalculatorShortcut(toggle);
  return open ? <CalculatorPanel onClose={() => setOpen(false)} /> : null;
}

function CalculatorPanel({ onClose }: { onClose: () => void }) {
  const [expr, setExpr] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>(loadHistory);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusTo = useRef<Element | null>(null);

  const result = useMemo(() => evaluateExpression(expr), [expr]);
  const hasExpr = expr.trim().length > 0;

  // Focus the box on open, hand focus back to wherever it was on close.
  useEffect(() => {
    returnFocusTo.current = document.activeElement;
    inputRef.current?.focus();
    return () => {
      const el = returnFocusTo.current as HTMLElement | null;
      if (el && typeof el.focus === "function" && document.contains(el)) el.focus();
    };
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch {
      /* private mode / storage blocked — history just won't survive a reload */
    }
  }, [history]);

  const insertAtCaret = (text: string) => {
    const el = inputRef.current;
    if (!el) return setExpr((v) => v + text);
    const start = el.selectionStart ?? expr.length;
    const end = el.selectionEnd ?? expr.length;
    const next = expr.slice(0, start) + text + expr.slice(end);
    setExpr(next);
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + text.length;
      el.setSelectionRange(caret, caret);
    });
  };

  const commit = () => {
    if (!result.ok) return;
    setHistory((h) => [{ expr: expr.trim(), result: result.value }, ...h].slice(0, HISTORY_MAX));
    // Keep going from the answer, like a normal calculator.
    setExpr(plainNumber(result.value));
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const copyResult = async (n?: number) => {
    const value = n ?? (result.ok ? result.value : null);
    if (value == null) return toast.error("Nothing to copy yet.");
    (await copyText(plainNumber(value))) ? toast.success(`Copied ${plainNumber(value)}`) : toast.error("Couldn't copy — select and copy it manually.");
  };

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) return toast.info("The clipboard is empty.");
      insertAtCaret(expressionFromPaste(text));
    } catch {
      toast.error("The browser blocked clipboard access — press Ctrl+V in the box instead.");
    }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (!text) return;
    e.preventDefault();
    insertAtCaret(expressionFromPaste(text));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Enter") {
      e.preventDefault();
      commit();
    }
  };

  // Drag by the header; stays inside the window.
  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const dx = e.clientX - rect.left;
    const dy = e.clientY - rect.top;
    const move = (ev: PointerEvent) => {
      const x = Math.min(Math.max(0, ev.clientX - dx), window.innerWidth - rect.width);
      const y = Math.min(Math.max(0, ev.clientY - dy), window.innerHeight - 48);
      setPos({ x, y });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <BodyPortal>
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Calculator"
        style={pos ? { left: pos.x, top: pos.y } : undefined}
        className={cn(
          "fixed z-[2000] w-[19.5rem] rounded-2xl border border-border bg-card text-foreground shadow-2xl",
          !pos && "right-5 bottom-5",
        )}
      >
        <div
          onPointerDown={startDrag}
          className="flex items-center justify-between gap-2 px-3.5 py-2.5 border-b border-border cursor-move select-none"
        >
          <span className="flex items-center gap-2 text-sm font-heading font-semibold">
            <CalcIcon size={14} className="text-primary" /> Calculator
          </span>
          <span className="flex items-center gap-2">
            <kbd className="text-[0.625rem] text-muted-foreground border border-border rounded px-1.5 py-0.5">Space + C</kbd>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close calculator"
              className="w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X size={14} />
            </button>
          </span>
        </div>

        <div className="p-3.5 space-y-3">
          <div>
            <input
              ref={inputRef}
              value={expr}
              onChange={(e) => setExpr(e.target.value)}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              placeholder="Type or paste figures…"
              spellCheck={false}
              autoComplete="off"
              inputMode="decimal"
              className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            />
            <div className="mt-2 min-h-[2.75rem] flex items-end justify-between gap-2">
              <div className="min-w-0">
                {result.ok ? (
                  <p className="text-2xl font-mono font-semibold tabular-nums truncate" title={plainNumber(result.value)}>
                    {formatIndian(result.value)}
                  </p>
                ) : hasExpr && result.error ? (
                  <p className="text-xs text-muted-foreground">{result.error}</p>
                ) : (
                  <p className="text-2xl font-mono font-semibold text-muted-foreground/40">0</p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={pasteFromClipboard}
                  title="Paste from clipboard"
                  className="h-8 px-2 rounded-lg border border-border text-xs inline-flex items-center gap-1 hover:bg-muted"
                >
                  <ClipboardPaste size={12} /> Paste
                </button>
                <button
                  type="button"
                  onClick={() => copyResult()}
                  disabled={!result.ok}
                  title="Copy the result as a plain number"
                  className="h-8 px-2 rounded-lg border border-border text-xs inline-flex items-center gap-1 hover:bg-muted disabled:opacity-40"
                >
                  <Copy size={12} /> Copy
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-1.5">
            {KEYS.flat().map((k) => (
              <button
                key={k.label}
                type="button"
                onClick={() => {
                  if (k.action === "clear") setExpr("");
                  else if (k.action === "equals") commit();
                  else if (k.insert) insertAtCaret(k.insert);
                }}
                className={cn(
                  "h-9 rounded-lg text-sm font-medium border border-border hover:bg-muted active:scale-95 transition",
                  k.action === "equals" && "bg-primary text-primary-foreground border-primary hover:bg-primary/90",
                  "÷×−+%()".includes(k.label) && "text-primary",
                )}
              >
                {k.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setExpr((v) => v.slice(0, -1));
                inputRef.current?.focus();
              }}
              title="Backspace"
              className="col-span-4 h-8 rounded-lg text-xs border border-border text-muted-foreground hover:bg-muted inline-flex items-center justify-center gap-1"
            >
              <Delete size={12} /> Backspace
            </button>
          </div>

          {history.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[0.625rem] uppercase tracking-wider text-muted-foreground">Recent</span>
                <button type="button" onClick={() => setHistory([])} className="text-[0.625rem] text-muted-foreground hover:text-foreground">
                  Clear
                </button>
              </div>
              <ul className="max-h-28 overflow-y-auto divide-y divide-border/60 rounded-lg border border-border">
                {history.map((h, i) => (
                  <li key={`${h.expr}-${i}`} className="flex items-center gap-2 px-2.5 py-1.5 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setExpr(h.expr);
                        inputRef.current?.focus();
                      }}
                      className="min-w-0 flex-1 text-left truncate font-mono text-muted-foreground hover:text-foreground"
                      title="Use this expression again"
                    >
                      {h.expr} = <span className="text-foreground font-semibold">{formatIndian(h.result)}</span>
                    </button>
                    <button type="button" onClick={() => copyResult(h.result)} title="Copy result" className="text-muted-foreground hover:text-foreground">
                      <Copy size={11} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </BodyPortal>
  );
}
