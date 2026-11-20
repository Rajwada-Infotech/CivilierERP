// HR › Notice Board: write a notice for All employees or chosen departments. Employees see it in the Employee Portal
// (web and app) between its start and end dates; HR sees how many of them have read it.
import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarDays, Check, ChevronRight, Clock, Megaphone, Pencil, Pin, Plus, Search, Trash2, Users, X } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { HrPayrollShell } from "@/components/hrpayroll/HrPayrollShell";
import { HrEmpty, HrError, HrSkeleton, HrStatStrip, HR_FIELD, HR_LBL, HR_RULE } from "@/components/hrpayroll/HrUi";
import { KEY_INK, KEY_LINE, KEY_RED } from "@/components/sheet/sheetParts";
import { BodyPortal } from "@/components/ui/body-portal";
import { deleteNotice, getNoticeDepartments, getNoticeReaders, getNotices, saveNotice, type Notice, type NoticeInput } from "@/api/employeeNoticeApi";

// Button sizes (the sheet keys carry no size): page actions and row actions.
const BTN = "h-10 px-5 text-[0.6875rem]";
const BTN_SM = "h-9 px-3.5";

const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const fmt = (d?: string | null) => (d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
type Status = "Live" | "Scheduled" | "Ended";
const statusOf = (n: Notice): Status => {
  const t = todayIst();
  if (n.PublishFrom > t) return "Scheduled";
  if (n.ExpiresOn && n.ExpiresOn < t) return "Ended";
  return "Live";
};
const STATUS_CLS: Record<Status, string> = {
  Live: "border-emerald-600 text-emerald-700 bg-emerald-500/10",
  Scheduled: "border-sky-600 text-sky-700 bg-sky-500/10",
  Ended: "border-border text-muted-foreground bg-muted/40",
};
const Chip = ({ children, cls = "border-border text-foreground" }: { children: React.ReactNode; cls?: string }) => (
  <span className={`inline-flex items-center gap-1 border px-2 py-0.5 text-[0.6875rem] font-semibold ${cls}`}>{children}</span>
);

/** A numbered form section: the number in a square, the title in capitals. */
function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <p className="flex items-center gap-2.5"><span className="flex h-6 w-6 items-center justify-center border border-foreground text-[0.6875rem] font-bold">{n}</span>
        <span className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em]">{title}</span></p>
      {children}
    </section>
  );
}

// ── New / edit form ─────────────────────────────────────────────────────────
function NoticeForm({ notice, onClose, onSaved }: { notice: Notice | null; onClose: () => void; onSaved: () => void }) {
  const { data: depts = [] } = useQuery({ queryKey: ["notice-departments"], queryFn: getNoticeDepartments, staleTime: 5 * 60_000 });
  const [f, setF] = useState<NoticeInput>(() => ({
    title: notice?.Title ?? "", body: notice?.Body ?? "", audience: notice?.Audience ?? "All", departmentIds: notice?.DepartmentIds ?? [],
    priority: notice?.Priority ?? "Normal", pinned: notice?.IsPinned ?? false, publishFrom: notice?.PublishFrom ?? todayIst(), expiresOn: notice?.ExpiresOn ?? "",
  }));
  const save = useMutation({ mutationFn: () => saveNotice(notice?.NoticeId ?? null, f), onSuccess: (r) => { toast.success(r.message); onSaved(); }, onError: (e: Error) => toast.error(e.message) });
  const toggle = (id: number) => setF((x) => ({ ...x, departmentIds: x.departmentIds.includes(id) ? x.departmentIds.filter((d) => d !== id) : [...x.departmentIds, id] }));
  const total = depts.reduce((t, d) => t + d.Employees, 0);
  const reach = f.audience === "All" ? total : depts.filter((d) => f.departmentIds.includes(d.Id)).reduce((t, d) => t + d.Employees, 0);
  const ok = f.title.trim() && f.body.trim() && (f.audience === "All" || f.departmentIds.length > 0) && (!f.expiresOn || f.expiresOn >= f.publishFrom);
  const seg = (on: boolean) => `flex-1 h-10 px-4 text-sm font-medium border transition-colors ${on ? "border-foreground bg-foreground text-card" : "border-border bg-card hover:border-foreground"}`;

  return (
    <BodyPortal>
      <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={notice ? "Edit notice" : "New notice"}
        onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
        <form className="w-full max-w-2xl max-h-[calc(100vh-2rem)] flex flex-col bg-card border border-foreground shadow-2xl"
          onSubmit={(e) => { e.preventDefault(); if (ok) save.mutate(); }}>
          <header className="flex items-center justify-between gap-3 px-6 py-4 border-b border-foreground">
            <div>
              <p className={HR_LBL}>Notice Board</p>
              <h2 className="font-heading text-lg font-bold mt-0.5">{notice ? "Edit notice" : "New notice"}</h2>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="h-9 w-9 flex items-center justify-center border border-border hover:border-foreground"><X size={16} /></button>
          </header>

          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-7">
            <Section n={1} title="Message">
              <label className="block"><span className={HR_LBL}>Title <span className="text-destructive">*</span></span>
                <input className={`${HR_FIELD} mt-1.5 h-10`} maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Office closed on Friday" autoFocus /></label>
              <label className="block"><span className={HR_LBL}>Notice <span className="text-destructive">*</span></span>
                <textarea className={`${HR_FIELD} mt-1.5 h-auto py-2.5 leading-relaxed`} rows={6} maxLength={4000} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })}
                  placeholder="Write the full notice. Line breaks are kept." />
                <span className="block text-right text-[0.6875rem] text-muted-foreground mt-1 tabular-nums">{f.body.length} / 4000</span></label>
            </Section>

            <Section n={2} title="Who sees it">
              <div className="flex gap-2">
                <button type="button" className={seg(f.audience === "All")} onClick={() => setF({ ...f, audience: "All" })}>All employees</button>
                <button type="button" className={seg(f.audience === "Departments")} onClick={() => setF({ ...f, audience: "Departments" })}>Selected departments</button>
              </div>
              {f.audience === "Departments" && (
                <div className="flex flex-wrap gap-2">
                  {depts.length === 0 && <p className="text-sm text-muted-foreground">No departments in Department Master.</p>}
                  {depts.map((d) => {
                    const on = f.departmentIds.includes(d.Id);
                    return (
                      <button key={d.Id} type="button" onClick={() => toggle(d.Id)} aria-pressed={on}
                        className={`h-9 px-3.5 inline-flex items-center gap-2 border text-sm transition-colors ${on ? "border-foreground bg-foreground text-card" : "border-border hover:border-foreground"}`}>
                        {d.DepartmentName}<span className={`text-xs tabular-nums ${on ? "text-card/70" : "text-muted-foreground"}`}>{d.Employees}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground"><Users size={14} /> Reaches <b className="text-foreground tabular-nums">{reach}</b> employee{reach === 1 ? "" : "s"}</p>
            </Section>

            <Section n={3} title="When and how">
              <div className="grid sm:grid-cols-2 gap-4">
                <label className="block"><span className={HR_LBL}>Show from</span>
                  <input type="date" className={`${HR_FIELD} mt-1.5 h-10`} value={f.publishFrom} onChange={(e) => setF({ ...f, publishFrom: e.target.value })} /></label>
                <label className="block"><span className={HR_LBL}>Show until <span className="normal-case tracking-normal font-normal">(empty = no end)</span></span>
                  <input type="date" className={`${HR_FIELD} mt-1.5 h-10`} min={f.publishFrom} value={f.expiresOn} onChange={(e) => setF({ ...f, expiresOn: e.target.value })} /></label>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                {([["priority", "Important", "Red mark, shown before other notices"], ["pinned", "Pin to top", "Stays first in the list"]] as const).map(([k, label, hint]) => {
                  const on = k === "priority" ? f.priority === "Important" : f.pinned;
                  return (
                    <label key={k} className={`flex items-start gap-3 border p-3.5 cursor-pointer transition-colors ${on ? "border-foreground bg-muted/40" : "border-border hover:border-foreground"}`}>
                      <input type="checkbox" className="mt-0.5 h-4 w-4" checked={on}
                        onChange={(e) => setF(k === "priority" ? { ...f, priority: e.target.checked ? "Important" : "Normal" } : { ...f, pinned: e.target.checked })} />
                      <span><span className="block text-sm font-semibold">{label}</span><span className="block text-xs text-muted-foreground mt-0.5">{hint}</span></span>
                    </label>
                  );
                })}
              </div>
            </Section>
          </div>

          <footer className="flex flex-wrap items-center justify-end gap-3 px-6 py-4 border-t border-foreground bg-muted/20">
            <button type="button" className={`${KEY_LINE} ${BTN}`} onClick={onClose}>Cancel</button>
            <button type="submit" className={`${KEY_INK} ${BTN}`} disabled={!ok || save.isPending}>{save.isPending ? "Saving…" : notice ? "Save changes" : "Publish notice"}</button>
          </footer>
        </form>
      </div>
    </BodyPortal>
  );
}

// ── Who has read it ──────────────────────────────────────────────────────────
const fmtTime = (d: string) => new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
function ReadersDialog({ n, onClose }: { n: Notice; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({ queryKey: ["notice-readers", n.NoticeId], queryFn: () => getNoticeReaders(n.NoticeId) });
  const [tab, setTab] = useState<"unread" | "read">("unread");
  const [q, setQ] = useState("");
  const read = (data ?? []).filter((r) => r.ReadAt);
  const unread = (data ?? []).filter((r) => !r.ReadAt);
  const term = q.trim().toLowerCase();
  const rows = (tab === "read" ? read : unread).filter((r) => !term || [r.EmployeeName, r.EmployeeCode, r.Department].some((v) => String(v ?? "").toLowerCase().includes(term)));
  return (
    <BodyPortal>
      <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Who has read this notice"
        onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
        <div className="w-full max-w-2xl max-h-[calc(100vh-2rem)] flex flex-col bg-card border border-foreground shadow-2xl">
          <header className="flex items-start justify-between gap-3 px-6 py-4 border-b border-foreground">
            <div className="min-w-0">
              <p className={HR_LBL}>Who has read it</p>
              <h2 className="font-heading text-lg font-bold mt-0.5 truncate">{n.Title}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{n.Audience === "All" ? "All employees" : n.Departments}</p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="h-9 w-9 shrink-0 flex items-center justify-center border border-border hover:border-foreground"><X size={16} /></button>
          </header>
          <div className="px-6 pt-4 pb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-2">
              {([["unread", "Not read yet", unread.length], ["read", "Read", read.length]] as const).map(([k, label, c]) => (
                <button key={k} onClick={() => setTab(k)}
                  className={`h-9 px-4 border text-sm font-medium ${tab === k ? "border-foreground bg-foreground text-card" : "border-border hover:border-foreground"}`}>
                  {label} <span className={`ml-1 tabular-nums ${tab === k ? "text-card/70" : "text-muted-foreground"}`}>{c}</span>
                </button>
              ))}
            </div>
            <label className="relative w-full sm:w-56">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input className={`${HR_FIELD} h-9 pl-9`} placeholder="Search employee…" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
          </div>
          <div className="flex-1 overflow-y-auto px-6 pb-5">
            {error ? <HrError text={(error as Error).message} /> : isLoading ? <HrSkeleton rows={3} /> : !rows.length ? (
              <p className="py-10 text-center text-sm text-muted-foreground">{tab === "unread" ? (unread.length ? "No match." : "Everyone has read it.") : (read.length ? "No match." : "Nobody has opened it yet.")}</p>
            ) : (
              <table className="w-full text-sm">
                <thead><tr className={`${HR_LBL} text-left border-b border-foreground/30`}><th className="py-2 pr-3">Employee</th><th className="py-2 pr-3">Department</th><th className="py-2 text-right">{tab === "read" ? "Read at" : "Status"}</th></tr></thead>
                <tbody className="divide-y divide-foreground/10">
                  {rows.map((r) => (
                    <tr key={r.EmployeeId}>
                      <td className="py-2.5 pr-3"><span className="font-medium">{r.EmployeeName}</span> <span className="text-xs text-muted-foreground">{r.EmployeeCode}</span>
                        {r.Designation && <span className="block text-xs text-muted-foreground">{r.Designation}</span>}</td>
                      <td className="py-2.5 pr-3 text-muted-foreground">{r.Department ?? "—"}</td>
                      <td className="py-2.5 text-right whitespace-nowrap">{r.ReadAt
                        ? <span className="inline-flex items-center gap-1 text-emerald-700"><Check size={13} /> {fmtTime(r.ReadAt)}</span>
                        : <span className="inline-flex items-center gap-1 text-amber-700"><Clock size={13} /> Not read</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </BodyPortal>
  );
}

// ── One notice in the list ──────────────────────────────────────────────────
function NoticeCard({ n, canEdit, canDelete, onEdit, onDelete, onReaders }: { n: Notice; canEdit: boolean; canDelete: boolean; onEdit: () => void; onDelete: () => void; onReaders: () => void }) {
  const st = statusOf(n);
  const pct = n.AudienceCount ? Math.round((n.ReadCount / n.AudienceCount) * 100) : 0;
  const [more, setMore] = useState(false);
  const long = n.Body.length > 280;
  return (
    <article className={`bg-card ${n.Priority === "Important" ? "border-l-[5px] border-l-destructive" : ""}`} style={{ border: HR_RULE }}>
      <div className="px-5 pt-4 pb-3 space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <Chip cls={STATUS_CLS[st]}>{st}</Chip>
          {n.Priority === "Important" && <Chip cls="border-destructive text-destructive bg-destructive/5">Important</Chip>}
          {n.IsPinned && <Chip><Pin size={11} /> Pinned</Chip>}
          <Chip><Users size={11} /> {n.Audience === "All" ? "All employees" : n.Departments}</Chip>
        </div>
        <h3 className="font-heading text-base font-bold leading-snug">{n.Title}</h3>
        <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">{long && !more ? `${n.Body.slice(0, 280)}…` : n.Body}</p>
        {long && <button className="text-xs font-semibold underline underline-offset-2" onClick={() => setMore((m) => !m)}>{more ? "Show less" : "Read more"}</button>}
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-t border-foreground/15 bg-muted/20">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><CalendarDays size={13} /> {fmt(n.PublishFrom)}{n.ExpiresOn ? ` – ${fmt(n.ExpiresOn)}` : " onwards"}</span>
          <span>by {n.CreatedByName ?? "HR"}</span>
          <button type="button" onClick={onReaders} className="inline-flex items-center gap-2 h-8 px-2.5 -mx-2.5 border border-transparent hover:border-foreground/30 hover:bg-card" title="See who has read it and who hasn't">
            <span className="h-1.5 w-24 bg-foreground/10 overflow-hidden"><span className="block h-full bg-foreground" style={{ width: `${pct}%` }} /></span>
            <span className="tabular-nums text-foreground font-medium underline underline-offset-2 decoration-foreground/30">Read {n.ReadCount} / {n.AudienceCount}</span>
            <ChevronRight size={13} className="text-foreground" />
          </button>
        </div>
        {(canEdit || canDelete) && (
          <div className="flex items-center gap-2">
            {canEdit && <button className={`${KEY_LINE} ${BTN_SM}`} onClick={onEdit}><Pencil size={13} /> Edit</button>}
            {canDelete && <button className={`${KEY_RED} ${BTN_SM}`} onClick={onDelete}><Trash2 size={13} /> Remove</button>}
          </div>
        )}
      </footer>
    </article>
  );
}

// ── Remove confirmation ─────────────────────────────────────────────────────
function ConfirmRemove({ n, busy, onCancel, onConfirm }: { n: Notice; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <BodyPortal>
      <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Remove notice">
        <div className="w-full max-w-md bg-card border border-foreground shadow-2xl">
          <div className="px-6 py-5 space-y-2">
            <h2 className="font-heading text-base font-bold">Remove this notice?</h2>
            <p className="text-sm text-muted-foreground">“{n.Title}” will no longer be shown to employees.</p>
          </div>
          <div className="flex justify-end gap-3 px-6 py-4 border-t border-foreground/15">
            <button className={`${KEY_LINE} ${BTN}`} onClick={onCancel}>Cancel</button>
            <button className={`${KEY_RED} ${BTN}`} disabled={busy} onClick={onConfirm}><Trash2 size={14} /> Remove</button>
          </div>
        </div>
      </div>
    </BodyPortal>
  );
}

export default function NoticeBoardPage() {
  const rights = usePageRights("employee-notice");
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ["employee-notices"], queryFn: getNotices });
  const [editing, setEditing] = useState<Notice | null | "new">(null);
  const [removing, setRemoving] = useState<Notice | null>(null);
  const [readersOf, setReadersOf] = useState<Notice | null>(null);
  const [tab, setTab] = useState<"All" | Status>("All");
  const [q, setQ] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["employee-notices"] });
  const remove = useMutation({
    mutationFn: (id: number) => deleteNotice(id),
    onSuccess: (r) => { toast.success(r.message); setRemoving(null); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const all = data ?? [];
  const count = (s: Status) => all.filter((n) => statusOf(n) === s).length;
  const term = q.trim().toLowerCase();
  const list = useMemo(() => all.filter((n) => (tab === "All" || statusOf(n) === tab)
    && (!term || [n.Title, n.Body, n.Departments].some((v) => String(v ?? "").toLowerCase().includes(term)))), [all, tab, term]);
  const newBtn = rights.canCreate ? <button className={`${KEY_INK} ${BTN}`} onClick={() => setEditing("new")}><Plus size={15} /> New notice</button> : undefined;

  return (
    <>
      <Breadcrumbs items={[{ label: "Dashboard", path: "/home" }, { label: "HR & Payroll", path: "/hr-payroll" }, { label: "Notice Board" }]} />
      <HrPayrollShell title="Notice Board" subtitle="Notices for all employees or chosen departments, shown in the Employee Portal web and app" icon={Megaphone} action={newBtn}>
        <div className="space-y-5">
          <HrStatStrip items={[
            { label: "Live now", value: count("Live"), tone: "rgb(5 150 105)" },
            { label: "Scheduled", value: count("Scheduled") },
            { label: "Ended", value: count("Ended") },
            { label: "Important", value: all.filter((n) => n.Priority === "Important" && statusOf(n) !== "Ended").length },
          ]} />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2" role="tablist">
              {(["All", "Live", "Scheduled", "Ended"] as const).map((t) => (
                <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                  className={`h-9 px-4 border text-sm font-medium transition-colors ${tab === t ? "border-foreground bg-foreground text-card" : "border-border bg-card hover:border-foreground"}`}>
                  {t} <span className={`ml-1 tabular-nums ${tab === t ? "text-card/70" : "text-muted-foreground"}`}>{t === "All" ? all.length : count(t)}</span>
                </button>
              ))}
            </div>
            <label className="relative w-full sm:w-72">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input className={`${HR_FIELD} h-9 pl-9`} placeholder="Search notices…" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
          </div>

          {error ? <HrError text={(error as Error).message} /> : isLoading ? <HrSkeleton rows={3} /> : !all.length ? (
            <div className="bg-card" style={{ border: HR_RULE }}>
              <HrEmpty icon={Megaphone} title="No notices yet" text="Write a notice for all employees or for chosen departments. It appears in the Employee Portal and the app." action={<div className="mt-3">{newBtn}</div>} />
            </div>
          ) : !list.length ? (
            <p className="bg-card px-5 py-8 text-center text-sm text-muted-foreground" style={{ border: HR_RULE }}>No notices match.</p>
          ) : (
            <div className="space-y-4">
              {list.map((n) => <NoticeCard key={n.NoticeId} n={n} canEdit={rights.canEdit} canDelete={rights.canDelete} onEdit={() => setEditing(n)} onDelete={() => setRemoving(n)} onReaders={() => setReadersOf(n)} />)}
            </div>
          )}
        </div>
      </HrPayrollShell>
      {editing && <NoticeForm notice={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
      {readersOf && <ReadersDialog n={readersOf} onClose={() => setReadersOf(null)} />}
      {removing && <ConfirmRemove n={removing} busy={remove.isPending} onCancel={() => setRemoving(null)} onConfirm={() => remove.mutate(removing.NoticeId)} />}
    </>
  );
}
