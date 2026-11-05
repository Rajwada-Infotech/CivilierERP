import { useState } from "react";
import { Loader2, X } from "lucide-react";
import { API, apiFetch } from "./config";
import { SheetMark } from "@/components/sheet/Sheet";
import { HEAD, LBL, RULE, KEY_INK, KEY_LINE, ACT } from "./config";
import type { PlannedReturn } from "./irImport";

type Result = { ok: true; docNo: string } | { ok: false; error: string };

// The CSV import's preview: every return the file describes, what is wrong with
// any of them, then one key to create the ones that passed (one at a time, so a
// failure on one doesn't stop the rest).
export function IRImportDialog({
  fileName,
  plan,
  onClose,
  onCreated,
}: {
  fileName: string;
  plan: PlannedReturn[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [results, setResults] = useState<Record<string, Result>>({});
  const [running, setRunning] = useState(false);
  const ready = plan.filter((p) => p.payload);
  const done = Object.keys(results).length > 0 && !running;
  const created = Object.values(results).filter((r) => r.ok).length;

  const createAll = async () => {
    setRunning(true);
    for (const p of ready) {
      try {
        const rec: any = await apiFetch(API, { method: "POST", body: JSON.stringify(p.payload) });
        setResults((prev) => ({ ...prev, [p.key]: { ok: true, docNo: rec?.docNo || rec?.DocNo || "created" } }));
      } catch (err: any) {
        setResults((prev) => ({ ...prev, [p.key]: { ok: false, error: err?.message || "Could not create" } }));
      }
    }
    setRunning(false);
    onCreated();
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" onClick={(e) => e.target === e.currentTarget && !running && onClose()}>
      <div className="sheet-frame bg-card w-full max-w-3xl max-h-[90vh] flex flex-col" style={{ margin: 0 }} role="dialog" aria-modal="true" aria-label="Import issue returns">
        <div className="flex items-start justify-between gap-3 px-5 py-4" style={{ borderBottom: RULE }}>
          <div className="min-w-0">
            <p className={LBL}>Import · {fileName}</p>
            <h2 className="font-heading text-lg font-bold tracking-tight mt-1">
              {plan.length} return{plan.length !== 1 ? "s" : ""} in the file
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              {ready.length} ready to create
              {plan.length - ready.length > 0 && <span className="text-destructive"> · {plan.length - ready.length} with problems, skipped</span>}
              {done && <> · {created} created</>}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={running} className={`${ACT} hover:text-foreground hover:border-foreground`} aria-label="Close">
            <X size={15} />
          </button>
        </div>

        <div className="overflow-y-auto divide-y divide-foreground/15">
          {plan.map((p, i) => {
            const res = results[p.key];
            return (
              <div key={p.key} className="px-5 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-heading text-[0.6875rem] font-semibold tabular-nums text-muted-foreground mr-2">{String(i + 1).padStart(2, "0")}</span>
                    <span className="font-heading text-sm font-bold tracking-tight">{p.label.project}</span>
                    <span className="text-xs text-muted-foreground"> · {p.label.company} · {p.label.issue} · {p.label.date}</span>
                  </div>
                  {res ? (
                    "docNo" in res ? <SheetMark text={`Created ${res.docNo}`} tone="done" /> : <SheetMark text="Failed" tone="stopped" />
                  ) : p.payload ? (
                    <SheetMark text="Ready" tone="waiting" />
                  ) : (
                    <SheetMark text="Skipped" tone="stopped" />
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {p.itemCount} item{p.itemCount !== 1 ? "s" : ""} · line{p.rows.length !== 1 ? "s" : ""} {p.rows.join(", ")}
                </p>
                {p.errors.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5">
                    {p.errors.map((e, j) => (
                      <li key={j} className="text-xs text-destructive">{e}</li>
                    ))}
                  </ul>
                )}
                {res && "error" in res && <p className="text-xs text-destructive mt-1.5">{res.error}</p>}
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3" style={{ borderTop: RULE }}>
          <p className={HEAD}>{done ? `${created} of ${ready.length} created` : "Each return is sent for approval when created; its stock goes back on approval."}</p>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={running} className={`${KEY_LINE} h-9 px-4`}>
              {done ? "Close" : "Cancel"}
            </button>
            {!done && (
              <button type="button" onClick={createAll} disabled={running || ready.length === 0} className={`${KEY_INK} h-9 px-5`}>
                {running ? <Loader2 size={13} className="animate-spin" /> : null}
                {running ? "Creating…" : `Create ${ready.length} return${ready.length !== 1 ? "s" : ""}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
