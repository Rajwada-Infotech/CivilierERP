import React, { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LEGAL_GRADIENT } from "./LegalShell";

// In-app confirm / reason dialog for the Legal module, instead of the browser's prompt() and confirm().
//   const reason = await askLegal({ title: "Skip this step?", input: { label: "Reason", required: true } });
//   → the text, or null when cancelled.   Without `input`: true / null.
// One host is mounted by LegalShell, so every Legal page can ask.

export interface AskOptions {
  title: string;
  message?: React.ReactNode;
  input?: { label: string; placeholder?: string; required?: boolean; minLength?: number; multiline?: boolean };
  confirmText?: string;
  /** "danger" for irreversible / negative actions (cancel, reject). */
  tone?: "default" | "danger";
}
type Pending = AskOptions & { resolve: (v: string | true | null) => void };

const EVENT = "legal:ask";

export function askLegal(opts: AskOptions & { input: NonNullable<AskOptions["input"]> }): Promise<string | null>;
export function askLegal(opts: AskOptions): Promise<true | null>;
export function askLegal(opts: AskOptions): Promise<string | true | null> {
  return new Promise((resolve) => window.dispatchEvent(new CustomEvent<Pending>(EVENT, { detail: { ...opts, resolve } })));
}

export const LegalAskHost: React.FC = () => {
  const [ask, setAsk] = useState<Pending | null>(null);
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);

  useEffect(() => {
    const open = (e: Event) => { setValue(""); setAsk((e as CustomEvent<Pending>).detail); };
    window.addEventListener(EVENT, open);
    return () => window.removeEventListener(EVENT, open);
  }, []);
  useEffect(() => { if (ask?.input) setTimeout(() => ref.current?.focus(), 50); }, [ask]);

  const close = (result: string | true | null) => { ask?.resolve(result); setAsk(null); };
  const min = ask?.input?.minLength ?? (ask?.input?.required ? 1 : 0);
  const ok = !ask?.input || value.trim().length >= min;
  const submit = () => { if (ok) close(ask?.input ? value.trim() : true); };
  const field = "mt-1 w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#a06a3f]";

  return (
    <Dialog open={!!ask} onOpenChange={(o) => !o && close(null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{ask?.title}</DialogTitle>
          {ask?.message && <DialogDescription>{ask.message}</DialogDescription>}
        </DialogHeader>
        {ask?.input && (
          <label className="block text-xs text-muted-foreground">
            {ask.input.label}{ask.input.required ? " *" : ""}
            {ask.input.multiline !== false ? (
              <textarea ref={ref} rows={3} className={field} placeholder={ask.input.placeholder} value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(); }} />
            ) : (
              <input ref={ref} className={field} placeholder={ask.input.placeholder} value={value}
                onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
            )}
            {min > 1 && <span className="mt-1 block text-[0.6875rem]">At least {min} characters.</span>}
          </label>
        )}
        <DialogFooter className="gap-2">
          <button type="button" onClick={() => close(null)} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted">Cancel</button>
          <button type="button" disabled={!ok} onClick={submit}
            className={`rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50 ${ask?.tone === "danger" ? "bg-rose-600 hover:bg-rose-700 text-white" : "text-card"}`}
            style={ask?.tone === "danger" ? undefined : { background: LEGAL_GRADIENT }}>
            {ask?.confirmText ?? "OK"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
