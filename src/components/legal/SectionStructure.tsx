import React from "react";
import type { ReviewStep } from "@/api/legalFlowApi";

/**
 * A land section drawn as a structure: the section at the top, one branch per kind of entry (e.g. RS record / LR
 * record), and under it every entry as a box with its key values, how complete it is and its files. Entries with a
 * date are ordered oldest first so the branch reads as a timeline.
 */
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}(T|$)/.test(s);
const show = (s: string) => (isDate(s) ? new Date(s.slice(0, 10)).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : s);
const line = "border-foreground/40";

export function SectionStructure({ s }: { s: ReviewStep }) {
  if (!s.records.length) return <p className="text-sm text-muted-foreground">Nothing entered yet — add entries to see the structure.</p>;
  const groups = new Map<string, typeof s.records>();
  s.records.forEach((r) => groups.set(r.title, [...(groups.get(r.title) ?? []), r]));
  const firstDate = (r: (typeof s.records)[number]) => r.fields.find((f) => f.v && isDate(f.v))?.v ?? "9999";
  const totalFiles = s.records.reduce((a, r) => a + r.fields.filter((f) => f.file).length, 0);
  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex min-w-max flex-col items-center">
        <div className="border-2 border-foreground bg-foreground px-4 py-2 text-center text-background">
          <b className="block text-sm">{s.label}</b>
          <span className="text-[0.6875rem] opacity-80">{s.records.length} entr{s.records.length === 1 ? "y" : "ies"} · {s.filled}/{s.total} fields · {totalFiles} file{totalFiles === 1 ? "" : "s"}</span>
        </div>
        <div className={`h-4 border-l ${line}`} />
        <ul className="flex justify-center">
          {[...groups.entries()].map(([title, recs], gi, all) => (
            <li key={title} className="relative flex flex-col items-center px-3">
              {all.length > 1 && <span className={`absolute top-0 border-t ${line} ${gi === 0 ? "left-1/2 right-0" : gi === all.length - 1 ? "left-0 right-1/2" : "left-0 right-0"}`} />}
              {all.length > 1 && <div className={`h-4 border-l ${line}`} />}
              <div className="border border-foreground bg-muted px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.06em]">{title} · {recs.length}</div>
              <div className={`h-3 border-l ${line}`} />
              <ol className={`flex flex-col items-center gap-0`}>
                {[...recs].sort((a, b) => firstDate(a).localeCompare(firstDate(b))).map((r, i) => {
                  const filled = r.fields.filter((f) => f.v != null).length;
                  const missing = r.fields.filter((f) => f.req && f.v == null).length;
                  const files = r.fields.filter((f) => f.file).length;
                  const keys = r.fields.filter((f) => !f.info && f.v != null && !f.file).slice(0, 4);
                  const pct = r.fields.length ? Math.round((filled / r.fields.length) * 100) : 0;
                  return (
                    <li key={r.id} className="flex flex-col items-center">
                      {i > 0 && <div className={`h-3 border-l ${line}`} />}
                      <div className={`w-60 border bg-card px-3 py-2 text-left text-xs ${missing ? "border-2 border-destructive" : "border-foreground/40"}`}>
                        {keys.map((f) => <span key={f.n} className="block truncate"><span className="text-muted-foreground">{f.l}: </span><b>{show(f.v!)}</b></span>)}
                        <span className="mt-1.5 flex h-1.5 bg-muted"><span className={missing ? "bg-destructive" : "bg-emerald-700"} style={{ width: `${pct}%` }} /></span>
                        <span className="mt-1 block text-[0.6875rem] text-muted-foreground">{filled}/{r.fields.length} filled{files ? ` · ${files} file${files === 1 ? "" : "s"}` : ""}{missing ? <b className="text-destructive"> · {missing} required missing</b> : null}</span>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
