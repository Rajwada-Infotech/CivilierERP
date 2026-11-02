// CRM My Work: everything waiting on the signed-in person, queue by queue in
// the order of the sale. The server decides which queues a person sees (Menu
// Rights / Approval Setup, routes/crmMyWork.js); every row opens the page that
// already does that step, so nothing here changes a record.
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell } from "@/components/sheet/Sheet";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { RULE, RULE_SOFT, KEY_INK } from "./customers/config";

interface WorkRow {
  Id: number;
  Ref: string;
  Name: string | null;
  Project: string | null;
  Unit: string | null;
  Since: string | null;
  Remark?: string | null;
  Link: string;
}
interface WorkQueue {
  key: string;
  title: string;
  note: string;
  action: string;
  listLink: string;
  sinceIs: "waiting" | "overdue";
  count: number;
  rows: WorkRow[];
}

async function fetchMyWork(): Promise<{ queues: WorkQueue[] }> {
  const r = await fetchWithAuth("/api/crm/my-work");
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || "Could not load your work");
  return r.json();
}

const DAY_MS = 86_400_000;
const daysSince = (v: string | null) => {
  if (!v) return null;
  const t = new Date(String(v).slice(0, 10)).getTime();
  return Number.isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / DAY_MS)) : null;
};
const ageText = (days: number | null, sinceIs: WorkQueue["sinceIs"]) => {
  if (days == null) return "";
  if (sinceIs === "overdue") return days === 0 ? "due today" : `${days} day${days === 1 ? "" : "s"} overdue`;
  return days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"}`;
};
// A row waiting this long is shown as late.
const LATE_AFTER_DAYS = 3;

const CrmMyWork: React.FC = () => {
  const navigate = useNavigate();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["crm-my-work"],
    queryFn: fetchMyWork,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  const queues = data?.queues ?? [];
  const open = queues.filter((q) => q.count > 0);
  const total = open.reduce((n, q) => n + q.count, 0);

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "My Work"]} />
      <SheetShell
        eyebrow="CivilierERP · CRM"
        title="My Work"
        subtitle="What is waiting on you, in the order of the sale. Open a row to do the step on its own page."
      >
        {isLoading ? (
          <p className="p-8 text-center text-sm text-muted-foreground">Loading…</p>
        ) : isError ? (
          <p className="p-8 text-center text-sm text-destructive">{(error as Error)?.message}</p>
        ) : queues.length === 0 ? (
          <div className="bg-card p-8 text-center text-sm text-muted-foreground" style={{ border: RULE }}>
            No CRM queue is assigned to you. Ask an admin to grant the pages you work on in Menu Rights, or name you in Approval Setup.
          </div>
        ) : (
          <div className="space-y-5">
            {/* Summary: one figure per queue, jumping to it. */}
            <div className="bg-card" style={{ border: RULE }}>
              <div className="flex flex-wrap">
                <div className="px-4 py-3.5 min-w-[9rem]" style={{ borderRight: RULE_SOFT }}>
                  <p className="label">Waiting on you</p>
                  <p className="figure tabular-nums" style={{ fontSize: "clamp(20px, 2.2vw, 28px)", marginTop: 6 }}>{total}</p>
                </div>
                {queues.map((q) => (
                  <a key={q.key} href={`#${q.key}`}
                    className={`px-4 py-3.5 min-w-[9rem] hover:bg-primary/5 ${q.count ? "" : "opacity-50"}`}
                    style={{ borderRight: RULE_SOFT }}>
                    <p className="label">{q.title}</p>
                    <p className="figure tabular-nums" style={{ fontSize: "clamp(16px, 1.8vw, 22px)", marginTop: 6 }}>{q.count}</p>
                  </a>
                ))}
              </div>
            </div>

            {open.length === 0 && (
              <div className="bg-card p-8 flex items-center justify-center gap-2 text-sm text-muted-foreground" style={{ border: RULE }}>
                <CheckCircle2 size={16} /> Nothing is waiting on you right now.
              </div>
            )}

            {open.map((q) => (
              <section key={q.key} id={q.key} className="bg-card scroll-mt-20" style={{ border: RULE }}>
                <header className="px-5 py-3 flex flex-wrap items-baseline gap-x-3 gap-y-1" style={{ borderBottom: RULE }}>
                  <h2 className="font-heading text-sm font-semibold text-foreground">{q.title}</h2>
                  <span className="text-xs tabular-nums text-muted-foreground">{q.count}</span>
                  <span className="text-xs text-muted-foreground flex-1 min-w-0">{q.note}</span>
                  <button onClick={() => navigate(q.listLink)} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                    {q.count > q.rows.length ? `All ${q.count}` : "Open list"} <ArrowRight size={11} />
                  </button>
                </header>
                <ul>
                  {q.rows.map((r) => {
                    const days = daysSince(r.Since);
                    const late = days != null && (q.sinceIs === "overdue" ? days > 0 : days >= LATE_AFTER_DAYS);
                    return (
                      <li key={r.Id} style={{ borderBottom: RULE_SOFT }}>
                        <button onClick={() => navigate(r.Link)}
                          className="w-full text-left px-5 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 hover:bg-primary/5 transition-colors">
                          <span className="font-heading text-xs tabular-nums text-muted-foreground w-28 shrink-0">{r.Ref}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium text-foreground truncate">{r.Name || "—"}</span>
                            <span className="block text-xs text-muted-foreground truncate">
                              {[r.Project, r.Unit].filter(Boolean).join(" · ") || "—"}
                              {r.Remark && <span className="text-destructive"> · {r.Remark}</span>}
                            </span>
                          </span>
                          <span className={`text-xs tabular-nums shrink-0 ${late ? "text-destructive font-semibold" : "text-muted-foreground"}`}>
                            {ageText(days, q.sinceIs)}
                          </span>
                          <span className={`${KEY_INK} h-7 px-2.5 shrink-0`}>{q.action} <ArrowRight size={11} /></span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </SheetShell>
    </>
  );
};

export default CrmMyWork;
