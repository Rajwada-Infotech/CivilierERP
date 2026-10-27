// Confirm and prompt on the sheet, in place of window.confirm / window.prompt (the browser's own boxes: unstyled, and
// blocked outright in some embedded views). A page calls the hook once and renders `node`:
//   const ask = useSheetAsk();
//   if (!(await ask.confirm("Cancel this agreement?", { danger: true }))) return;
//   const why = await ask.prompt("Why is it rejected?");   // null when cancelled; required unless { optional: true }
//   ... {ask.node}
import React, { useCallback, useRef, useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const RULE = "1px solid hsl(var(--foreground))";
const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed h-9 px-4 rounded-none mt-0";
const KEY_INK = `${KEY} bg-foreground text-card border border-foreground hover:bg-foreground/90`;
const KEY_LINE = `${KEY} bg-card border border-foreground text-foreground hover:bg-primary/10`;
const KEY_RED = `${KEY} bg-destructive text-white border border-destructive hover:bg-destructive/90`;

interface AskOptions {
  /** Heading over the question (default "Confirm" / "Reason needed"). */
  title?: string;
  /** Label of the go-ahead key (default "Confirm" / "Submit"). */
  okLabel?: string;
  /** Label of the back-out key (default "Cancel"). */
  cancelLabel?: string;
  /** The action can't be undone or turns something down: the key is red. */
  danger?: boolean;
  /** prompt only: let an empty answer through. */
  optional?: boolean;
  /** prompt only: a starting value / placeholder. */
  initial?: string;
  placeholder?: string;
}

interface Pending extends AskOptions {
  kind: "confirm" | "prompt";
  message: React.ReactNode;
  resolve: (value: boolean | string | null) => void;
}

export function useSheetAsk() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [text, setText] = useState("");
  const settled = useRef(false);

  const open = useCallback((kind: Pending["kind"], message: React.ReactNode, opts: AskOptions = {}) =>
    new Promise<boolean | string | null>((resolve) => {
      settled.current = false;
      setText(opts.initial ?? "");
      setPending({ kind, message, resolve, ...opts });
    }), []);

  const confirm = useCallback((message: React.ReactNode, opts?: AskOptions) => open("confirm", message, opts) as Promise<boolean>, [open]);
  const prompt = useCallback((message: React.ReactNode, opts?: AskOptions) => open("prompt", message, opts) as Promise<string | null>, [open]);

  const finish = (value: boolean | string | null) => {
    if (!pending || settled.current) return;
    settled.current = true;
    pending.resolve(value);
    setPending(null);
  };
  const cancelValue = pending?.kind === "prompt" ? null : false;
  const answer = text.trim();
  const canSubmit = pending?.kind !== "prompt" || pending.optional || !!answer;
  const submit = () => { if (canSubmit) finish(pending?.kind === "prompt" ? answer : true); };

  const node = (
    <AlertDialog open={!!pending} onOpenChange={(o) => { if (!o) finish(cancelValue); }}>
      <AlertDialogContent className="max-w-md p-5 gap-4 rounded-none sm:rounded-none" style={{ border: RULE }}>
        <AlertDialogHeader>
          <AlertDialogTitle className="font-heading text-[0.75rem] font-bold uppercase tracking-[0.14em]">
            {pending?.title ?? (pending?.kind === "prompt" ? "Reason needed" : "Confirm")}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-sm text-foreground whitespace-pre-line">{pending?.message}</AlertDialogDescription>
        </AlertDialogHeader>
        {pending?.kind === "prompt" && (
          <textarea autoFocus rows={3} value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
            placeholder={pending.placeholder ?? (pending.optional ? "Optional" : "Required")}
            className="w-full border border-foreground/40 focus:border-foreground bg-card px-2.5 py-2 text-sm text-foreground outline-none resize-none" />
        )}
        <AlertDialogFooter className="gap-2 pt-3" style={{ borderTop: RULE }}>
          <AlertDialogCancel className={KEY_LINE} onClick={() => finish(cancelValue)}>{pending?.cancelLabel ?? "Cancel"}</AlertDialogCancel>
          <AlertDialogAction className={pending?.danger ? KEY_RED : KEY_INK} disabled={!canSubmit}
            onClick={(e) => { e.preventDefault(); submit(); }}>
            {pending?.okLabel ?? (pending?.kind === "prompt" ? "Submit" : "Confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { confirm, prompt, node };
}
