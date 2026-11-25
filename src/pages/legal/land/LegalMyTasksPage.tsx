import React from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { TaskSquare } from "iconsax-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { LegalShell } from "@/components/legal/LegalShell";
import { getMyTasks, type Activity } from "@/api/legalVerificationApi";
import { STATUS_TONE } from "./LegalVerificationWorkspacePage";

const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const DONE = ["Completed", "Not Applicable"];

/** The signed-in user's verification activities, by when they are due. */
export default function LegalMyTasksPage() {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["legal-my-tasks"], queryFn: getMyTasks });
  const today = new Date().toISOString().slice(0, 10);
  const in7 = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const rows = q.data ?? [];
  const open = rows.filter((r) => !DONE.includes(r.Status));
  const groups: { title: string; tone?: string; items: Activity[] }[] = [
    { title: "Overdue", tone: "text-destructive", items: open.filter((r) => r.DueDate && r.DueDate < today) },
    { title: "Due today", tone: "text-amber-700", items: open.filter((r) => r.DueDate === today) },
    { title: "Next 7 days", items: open.filter((r) => r.DueDate && r.DueDate > today && r.DueDate <= in7) },
    { title: "Later / no due date", items: open.filter((r) => !r.DueDate || r.DueDate > in7) },
    { title: "Returned to me", tone: "text-destructive", items: [] },
    { title: "Completed", items: rows.filter((r) => DONE.includes(r.Status)) },
  ].map((g) => (g.title === "Returned to me" ? { ...g, items: open.filter((r) => r.Status === "Rejected") } : g));
  return (
    <>
      <Breadcrumbs items={[{ label: "Dashboard", path: "/home" }, { label: "Legal", path: "/legal" }, { label: "My tasks" }]} />
      <LegalShell title="My tasks" subtitle="Legal verification activities assigned to you." icon={TaskSquare}>
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {groups.slice(0, 5).map((g) => (
            <div key={g.title} className="border border-border bg-card px-3 py-2"><span className="block text-[0.625rem] uppercase tracking-[0.08em] text-muted-foreground">{g.title}</span><b className={`text-xl tabular-nums ${g.items.length ? g.tone ?? "" : ""}`}>{g.items.length}</b></div>
          ))}
        </div>
        {q.error ? <p className="p-6 text-destructive">{(q.error as Error).message}</p> : q.isLoading ? <p className="p-6 text-muted-foreground">Loading…</p> : !rows.length ? (
          <p className="border border-border p-6 text-sm text-muted-foreground">Nothing is assigned to you.</p>
        ) : groups.filter((g) => g.items.length && g.title !== "Returned to me").map((g) => (
          <section key={g.title} className="mb-4 border border-border bg-card">
            <h2 className={`border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] ${g.tone ?? ""}`}>{g.title} · {g.items.length}</h2>
            {g.items.map((a) => (
              <button key={a.ActivityId} onClick={() => navigate(`/legal/land/verification/${a.VerificationId}`)}
                className="grid w-full grid-cols-1 gap-1 border-b border-border px-3 py-2 text-left last:border-0 hover:bg-primary/5 sm:grid-cols-[2.5fr_1fr_1fr_1fr] sm:items-center">
                <span className="text-sm"><b>{a.ActivityNo}. {a.ActivityName}</b> <span className="text-xs text-muted-foreground">· {a.VerificationNo} · {a.EnquiryNo}</span></span>
                <span className={`text-xs font-semibold ${STATUS_TONE[a.Status] ?? ""}`}>{a.Status}</span>
                <span className="text-xs">{a.Priority}</span>
                <span className="text-xs">{a.DueDate ? `Due ${fmt(a.DueDate)}` : "No due date"}</span>
              </button>
            ))}
          </section>
        ))}
      </LegalShell>
    </>
  );
}
