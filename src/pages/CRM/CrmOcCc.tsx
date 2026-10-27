// CRM OC / CC: the Occupancy / Completion Certificate of each project (or block). Possession is gated on it: until a
// certificate is Received, no booking in its scope can go to Pre-Possession. Worked out by block (migration 577): a block
// has OC / CC by its own certificate or by a project-wide one received while it existed, and the project has it when
// every active block does — a block added later puts it back to not complete until that block's certificate arrives.
import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, Lock, PenSquare, Plus, RefreshCw, ShieldCheck, Users } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DateInput } from "@/components/ui/date-input";
import { SearchableSelect } from "@/components/SearchableSelect";
import { usePageRights } from "@/hooks/usePageRights";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { translateError } from "@/lib/translateError";
import { KEY_INK, KEY_LINE, LBL, RULE, RULE_SOFT } from "./customers/config";

const API = "/api/crm/oc-cc";
const PROJ_API = "/api/unit-master/projects";

const CERT_TYPES = ["OC", "CC", "OC+CC"] as const;
const STATUSES = ["Applied", "Received"] as const;
// Pending past these many days reads as late, then overdue.
const LATE_DAYS = 20;
const OVERDUE_DAYS = 45;

const EMPTY_FORM = {
  ProjectId: "", BlockId: "", CertType: "OC" as string, Status: "Applied" as string,
  ApplicationDate: "", ReceivedDate: "", CertificateNo: "", IssuedBy: "", Remarks: "",
};
type OcForm = typeof EMPTY_FORM;

const INP = "w-full h-9 border border-foreground/40 focus:border-foreground bg-card px-2.5 text-sm text-foreground outline-none";

function fmtDate(d: any) {
  if (!d) return null;
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
function daysSince(d: any) {
  if (!d) return null;
  return Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
}

async function fetchAll(): Promise<any[]> {
  const r = await fetchWithAuth(API);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || "Could not load the OC / CC records.");
  return Array.isArray(data) ? data : [];
}
async function fetchProjects(): Promise<any[]> {
  try { const r = await fetchWithAuth(PROJ_API); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchBlocksForProject(projectId: string): Promise<any[]> {
  if (!projectId) return [];
  try { const r = await fetchWithAuth(`/api/unit-master/blocks?projectId=${projectId}`); return r.ok ? r.json() : []; } catch { return []; }
}

/** The two steps: Applied (in hand), then Received (the gate clears). */
const Steps: React.FC<{ status: string }> = ({ status }) => {
  const received = status === "Received";
  const box = (on: boolean, cur: boolean) => `w-5 h-5 flex items-center justify-center font-heading text-[0.5625rem] font-bold ${on ? "bg-foreground text-card border border-foreground" : cur ? "bg-card border-2 border-foreground" : "bg-card border border-foreground/25 text-muted-foreground"}`;
  return (
    <div className="flex items-center gap-2">
      <span className={box(true, false)}>1</span>
      <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em]">Applied</span>
      <span className={`w-6 h-px ${received ? "bg-foreground" : "bg-foreground/25"}`} />
      <span className={box(received, !received)}>2</span>
      <span className={`font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] ${received ? "" : "text-muted-foreground"}`}>Received</span>
    </div>
  );
};

const Gate: React.FC<{ received: boolean }> = ({ received }) => (
  <span className={`inline-flex items-center gap-1.5 font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] ${received ? "text-foreground" : "text-muted-foreground"}`}>
    {received ? <ShieldCheck size={11} /> : <Lock size={11} />} {received ? "Possession open" : "Possession held"}
  </span>
);

function OcccCard({ row, onClick }: { row: any; onClick: () => void }) {
  const isReceived = row.Status === "Received";
  const appDays = daysSince(row.ApplicationDate);
  const overdue = !isReceived && appDays != null && appDays > OVERDUE_DAYS;
  const late = !isReceived && appDays != null && appDays > LATE_DAYS && !overdue;
  const waiting = row.BookingsAwaitingPossession ?? 0;
  return (
    // A column laid out from the top with the footer pinned to the bottom: a button centres its content, so a card
    // without a certificate number floated in the middle of its row.
    <button onClick={onClick} className="text-left bg-card hover:bg-primary/5 transition-colors flex flex-col h-full"
      style={{ border: RULE, borderLeft: `3px solid ${overdue ? "hsl(var(--destructive))" : isReceived ? "hsl(var(--foreground))" : "hsl(var(--foreground) / 0.3)"}` }}>
      <div className="px-4 py-3 flex items-start justify-between gap-3" style={{ borderBottom: RULE_SOFT }}>
        <div className="min-w-0">
          <p className="font-heading text-[0.75rem] font-bold uppercase tracking-[0.1em] text-foreground truncate">{row.ProjectName}</p>
          <p className="text-[0.6875rem] text-muted-foreground mt-0.5 truncate">{row.BlockName ? `Block ${row.BlockName}` : "Whole project"}{row.IssuedBy ? ` · ${row.IssuedBy}` : ""}</p>
        </div>
        <span className="shrink-0 font-heading text-[0.625rem] font-bold uppercase tracking-[0.1em] px-1.5 py-0.5" style={{ border: RULE }}>{row.CertType}</span>
      </div>
      <div className="px-4 py-3 space-y-3 flex-1">
        <Steps status={row.Status} />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className={LBL}>Applied on</p>
            <p className="text-sm font-medium mt-0.5 tabular-nums">{fmtDate(row.ApplicationDate) || "—"}</p>
          </div>
          {isReceived ? (
            <div>
              <p className={LBL}>Received on</p>
              <p className="text-sm font-medium mt-0.5 tabular-nums">{fmtDate(row.ReceivedDate) || "—"}</p>
            </div>
          ) : (
            <div>
              <p className={LBL}>Pending for</p>
              <p className={`font-heading text-sm font-bold mt-0.5 tabular-nums ${overdue ? "text-destructive" : ""}`}>
                {appDays != null ? `${appDays} days` : "—"}{overdue ? " · overdue" : late ? " · late" : ""}
              </p>
            </div>
          )}
          <div className="col-span-2">
            <p className={LBL}>Certificate no</p>
            <p className={`font-heading text-sm font-bold tabular-nums mt-0.5 ${row.CertificateNo ? "" : "text-muted-foreground"}`}>{row.CertificateNo || "—"}</p>
          </div>
        </div>
      </div>
      <div className="px-4 py-2.5 flex items-center justify-between gap-2 flex-wrap" style={{ borderTop: RULE_SOFT }}>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
          <Users size={11} /> {row.BookingCount ?? 0} booking{(row.BookingCount ?? 0) === 1 ? "" : "s"}{waiting > 0 ? ` · ${waiting} ${isReceived ? "ready for possession" : "waiting on this"}` : ""}
        </span>
        <Gate received={isReceived} />
      </div>
    </button>
  );
}

// The form both dialogs use. Project and scope are set only when recording: a certificate's scope is fixed after.
function OcccForm({ form, setForm, projects, showProject }: {
  form: OcForm; setForm: React.Dispatch<React.SetStateAction<OcForm>>; projects: any[]; showProject: boolean;
}) {
  // The scope is its own choice (it was read off BlockId, so "Specific block" did nothing until the blocks had loaded).
  const [scope, setScope] = useState<"project" | "block">(form.BlockId ? "block" : "project");
  const { data: blocks = [], isLoading: loadingBlocks } = useQuery({
    queryKey: ["oc-cc-blocks-for-project", form.ProjectId],
    queryFn: () => fetchBlocksForProject(form.ProjectId),
    enabled: showProject && !!form.ProjectId,
  });
  const set = (k: keyof OcForm, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const label = (t: string, req?: boolean) => <span className={`block ${LBL}`}>{t}{req && <span className="text-destructive"> *</span>}</span>;

  return (
    <div className="space-y-4">
      {showProject && (
        <>
          <label className="block space-y-1">
            {label("Project", true)}
            <SearchableSelect value={form.ProjectId} onChange={(v) => setForm((f) => ({ ...f, ProjectId: v, BlockId: "" }))}
              placeholder={projects.length ? "Select project" : "No project you can see"} searchPlaceholder="Search projects…"
              options={projects.map((p: any) => ({ value: String(p.Id), label: p.Name }))} />
          </label>
          <div className="space-y-1">
            {label("Covers")}
            <div className="grid grid-cols-2">
              {(["project", "block"] as const).map((s) => (
                <button key={s} type="button" disabled={s === "block" && !form.ProjectId}
                  onClick={() => { setScope(s); if (s === "project") set("BlockId", ""); }}
                  className={`${scope === s ? KEY_INK : KEY_LINE} h-9`}>
                  {s === "project" ? "Whole project" : "One block"}
                </button>
              ))}
            </div>
            <span className="block text-[0.6875rem] text-muted-foreground">
              {scope === "project" ? "Every booking in the project." : "Only bookings in that block: for a project finishing block by block."}
            </span>
          </div>
          {scope === "block" && (
            <label className="block space-y-1">
              {label("Block", true)}
              <SearchableSelect value={form.BlockId} onChange={(v) => set("BlockId", v)}
                placeholder={loadingBlocks ? "Loading blocks…" : blocks.length ? "Select block" : "No block in this project"}
                searchPlaceholder="Search blocks…" options={blocks.map((b: any) => ({ value: String(b.Id), label: b.Name }))} />
            </label>
          )}
        </>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block space-y-1">
          {label("Certificate", true)}
          <select value={form.CertType} onChange={(e) => set("CertType", e.target.value)} className={INP}>
            {CERT_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label className="block space-y-1">
          {label("Status")}
          <select value={form.Status} onChange={(e) => set("Status", e.target.value)} className={INP}>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label className="block space-y-1">
          {label("Applied on")}
          <DateInput value={form.ApplicationDate} onChange={(e) => set("ApplicationDate", e.target.value)} className={INP} />
        </label>
        <label className="block space-y-1">
          {label("Received on", form.Status === "Received")}
          <DateInput value={form.ReceivedDate} onChange={(e) => set("ReceivedDate", e.target.value)} className={INP} />
        </label>
      </div>
      <label className="block space-y-1">
        {label("Certificate no", form.Status === "Received")}
        <input type="text" value={form.CertificateNo} placeholder="e.g. OC/2024/01234" onChange={(e) => set("CertificateNo", e.target.value)} className={`${INP} tabular-nums`} />
      </label>
      <label className="block space-y-1">
        {label("Issued by")}
        <input type="text" value={form.IssuedBy} placeholder="e.g. GHMC, MCGM, BDA" onChange={(e) => set("IssuedBy", e.target.value)} className={INP} />
      </label>
      <label className="block space-y-1">
        {label("Remarks")}
        <textarea value={form.Remarks} rows={2} onChange={(e) => set("Remarks", e.target.value)} className={`${INP} h-auto py-2 resize-none`} />
      </label>
      {form.Status === "Received" && (
        <p className="flex items-center gap-2 text-xs px-3 py-2" style={{ border: RULE_SOFT }}>
          <ShieldCheck size={13} /> Once saved, possession opens for {scope === "block" ? "the bookings in this block" : "every booking in this project"}.
        </p>
      )}
    </div>
  );
}

// Received opens the possession gate, so it needs the date and the number on record (it could be set with neither).
function checkForm(f: OcForm, recording: boolean): string | null {
  if (recording && !f.ProjectId) return "Select the project.";
  if (f.Status === "Received" && !f.ReceivedDate) return "Enter the date it was received.";
  if (f.Status === "Received" && !f.CertificateNo.trim()) return "Enter the certificate number.";
  if (f.ApplicationDate && f.ReceivedDate && f.ReceivedDate < f.ApplicationDate) return "It can't be received before it was applied for.";
  return null;
}

type Board = { projects: any[]; blocks: any[] };
async function fetchBoard(): Promise<Board> {
  const r = await fetchWithAuth(`${API}/board`);
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(data?.error || `Could not load the projects (${r.status}).`);
  return { projects: data?.projects ?? [], blocks: data?.blocks ?? [] };
}

/** Each project as its blocks make it: complete or not, which blocks are covered and how, and who is waiting. */
function ProjectBoard({ board, canCreate, onAdd }: { board: Board; canCreate: boolean; onAdd: (projectId: string, blockId?: string) => void }) {
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const blocksBy = useMemo(() => {
    const m: Record<number, any[]> = {};
    for (const b of board.blocks) (m[b.ProjectId] ||= []).push(b);
    return m;
  }, [board]);
  // What needs attention first: bookings waiting, then not complete, then complete.
  const shown = [...board.projects].sort((a, b) =>
    (b.WaitingBookings || 0) - (a.WaitingBookings || 0) || (a.Received - b.Received) || String(a.ProjectName).localeCompare(String(b.ProjectName)));
  if (!shown.length) return null;
  return (
    <div className="bg-card" style={{ border: RULE }}>
      <div className="px-4 py-2.5 flex flex-wrap items-baseline justify-between gap-2" style={{ borderBottom: RULE }}>
        <span className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground">Projects</span>
        <span className="text-[0.6875rem] text-muted-foreground">Complete when every active block has OC / CC</span>
      </div>
      {shown.map((p) => {
        const blocks = blocksBy[p.ProjectId] || [];
        const isOpen = open[p.ProjectId] ?? false;
        const toggle = () => setOpen((o) => ({ ...o, [p.ProjectId]: !isOpen }));
        return (
          <div key={p.ProjectId} style={{ borderBottom: RULE_SOFT }}>
            <div role="button" tabIndex={0} onClick={toggle} onKeyDown={(e) => { if (e.key === "Enter") toggle(); }}
              className="px-4 py-3 flex items-center gap-4 flex-wrap cursor-pointer hover:bg-primary/5 transition-colors">
              <ChevronDown size={14} className={`text-muted-foreground shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
              <div className="min-w-[180px] flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold">{p.ProjectName}</span>
                  <SheetMark text={p.Received === 1 ? "Has OC / CC" : "Not complete"} tone={p.Received === 1 ? "done" : "waiting"} />
                </div>
                {p.Received === 1 && p.ReceivedDate && <p className="text-[0.6875rem] text-muted-foreground mt-0.5 tabular-nums">Complete since {fmtDate(p.ReceivedDate)}</p>}
              </div>
              {p.ActiveBlocks > 0 && (
                <div className="w-40 shrink-0">
                  <div className="flex gap-0.5">
                    {blocks.map((b) => <div key={b.BlockId} title={`Block ${b.BlockName}`} className="flex-1 h-1.5"
                      style={{ background: b.Covered === 1 ? "hsl(var(--foreground))" : "transparent", border: RULE_SOFT }} />)}
                  </div>
                  <div className="text-[0.6875rem] text-muted-foreground mt-1 tabular-nums">{p.CoveredBlocks} of {p.ActiveBlocks} blocks</div>
                </div>
              )}
              <div className="w-28 shrink-0 text-[0.6875rem] tabular-nums">
                <div className="flex items-center gap-1 text-muted-foreground"><Users size={11} /> {p.LiveBookings} live</div>
                {p.WaitingBookings > 0 && <div className="font-semibold text-destructive">{p.WaitingBookings} waiting</div>}
              </div>
            </div>
            {isOpen && (
              <div className="px-4 pb-3 pl-11">
                {blocks.length ? blocks.map((b) => {
                  const cov = b.Covered === 1;
                  return (
                    <div key={b.BlockId} className="py-2 flex items-center gap-3 flex-wrap text-xs" style={{ borderTop: RULE_SOFT }}>
                      <span className="font-semibold w-28 truncate">Block {b.BlockName}</span>
                      <span className={`flex-1 min-w-[160px] ${cov ? "" : "text-destructive"}`}>
                        {cov ? `${b.Source === "block" ? "Own certificate" : "Project certificate"}${b.CertType ? ` (${b.CertType})` : ""}${b.CoveredDate ? ` · ${fmtDate(b.CoveredDate)}` : ""}` : "Not covered yet"}
                        {cov && b.CertificateNo && <span className="font-heading tabular-nums text-muted-foreground ml-1.5">{b.CertificateNo}</span>}
                      </span>
                      <span className="w-16 text-muted-foreground tabular-nums flex items-center gap-1"><Users size={11} /> {b.LiveBookings}</span>
                      {!cov && canCreate
                        ? <button onClick={() => onAdd(String(p.ProjectId), String(b.BlockId))} className={`${KEY_LINE} h-7 px-2`}><Plus size={11} /> Add OC / CC</button>
                        : <span className="w-24" />}
                    </div>
                  );
                }) : <p className="text-xs text-muted-foreground py-2" style={{ borderTop: RULE_SOFT }}>No blocks: the project-wide certificate decides.</p>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const CrmOcCc: React.FC = () => {
  const qc = useQueryClient();
  const { canCreate, canEdit } = usePageRights("crm-oc-cc");
  const [activeTab, setActiveTab] = useState<"All" | "Applied" | "Received">("All");
  const [detailRow, setDetailRow] = useState<any | null>(null);
  const [editLocked, setEditLocked] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<OcForm>({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState<OcForm>({ ...EMPTY_FORM });
  const [updating, setUpdating] = useState(false);

  const { data: rows = [], isLoading, isError, error, isFetching, refetch } = useQuery({ queryKey: ["crm-oc-cc"], queryFn: fetchAll, staleTime: 30_000 });
  const { data: projects = [] } = useQuery({ queryKey: ["unit-master-projects"], queryFn: fetchProjects, staleTime: 5 * 60_000 });
  const { data: board } = useQuery({ queryKey: ["crm-oc-cc-board"], queryFn: fetchBoard, staleTime: 30_000 });
  // "Add OC / CC" on an uncovered block: the Record dialog for that block.
  const addFor = (projectId: string, blockId?: string) => {
    setCreateForm({ ...EMPTY_FORM, ProjectId: projectId, BlockId: blockId ?? "" });
    setCreateOpen(true);
  };

  const stats = useMemo(() => {
    const r = rows as any[];
    const applied = r.filter((x) => x.Status === "Applied");
    return {
      total: r.length,
      projects: new Set(r.map((x) => x.ProjectId)).size,
      applied: applied.length,
      overdue: applied.filter((x) => (daysSince(x.ApplicationDate) ?? 0) > OVERDUE_DAYS).length,
      received: r.length - applied.length,
      waiting: applied.reduce((s, x) => s + (x.BookingsAwaitingPossession ?? 0), 0),
    };
  }, [rows]);
  const filtered = useMemo(() => (rows as any[]).filter((r: any) => activeTab === "All" || r.Status === activeTab), [rows, activeTab]);

  const refresh = () => ["crm-oc-cc", "crm-oc-cc-board", "crm-pre-possession-gateway", "crm-pre-possession-eligible", "crm-possession-notice-eligible", "crm-dashboard", "crm-legal-milestones"]
    .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const openDetail = (row: any) => {
    setDetailRow(row);
    setEditLocked(true);
    setEditForm({
      ProjectId: String(row.ProjectId), BlockId: row.BlockId != null ? String(row.BlockId) : "",
      CertType: row.CertType, Status: row.Status,
      ApplicationDate: row.ApplicationDate ? String(row.ApplicationDate).slice(0, 10) : "",
      ReceivedDate: row.ReceivedDate ? String(row.ReceivedDate).slice(0, 10) : "",
      CertificateNo: row.CertificateNo || "", IssuedBy: row.IssuedBy || "", Remarks: row.Remarks || "",
    });
  };
  const closeDetail = () => { setDetailRow(null); setEditLocked(true); };

  const handleCreate = async () => {
    const problem = checkForm(createForm, true);
    if (problem) return void toast.error(problem);
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ProjectId: parseInt(createForm.ProjectId), BlockId: createForm.BlockId ? parseInt(createForm.BlockId) : undefined,
          CertType: createForm.CertType, Status: createForm.Status,
          ApplicationDate: createForm.ApplicationDate || undefined, ReceivedDate: createForm.ReceivedDate || undefined,
          CertificateNo: createForm.CertificateNo || undefined, IssuedBy: createForm.IssuedBy || undefined, Remarks: createForm.Remarks || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not record the certificate.");
      toast.success(createForm.Status === "Received" ? `Certificate recorded; possession is open${createForm.BlockId ? " for that block" : ""}` : "Application recorded");
      setCreateOpen(false);
      setCreateForm({ ...EMPTY_FORM });
      refresh();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!detailRow) return;
    const problem = checkForm(editForm, false);
    if (problem) return void toast.error(problem);
    setUpdating(true);
    try {
      const res = await fetchWithAuth(`${API}/${detailRow.Id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          CertType: editForm.CertType || undefined, Status: editForm.Status || undefined,
          ApplicationDate: editForm.ApplicationDate || undefined, ReceivedDate: editForm.ReceivedDate || undefined,
          CertificateNo: editForm.CertificateNo, IssuedBy: editForm.IssuedBy, Remarks: editForm.Remarks,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save the certificate.");
      toast.success("Certificate saved");
      closeDetail();
      refresh();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setUpdating(false);
    }
  };

  const figures: { label: string; value: number; note: string; go: typeof activeTab }[] = [
    { label: "Certificates", value: stats.total, note: `${stats.projects} project${stats.projects === 1 ? "" : "s"}`, go: "All" },
    { label: "Applied", value: stats.applied, note: stats.overdue ? `${stats.overdue} pending over ${OVERDUE_DAYS} days` : "None overdue", go: "Applied" },
    { label: "Received", value: stats.received, note: "Possession open", go: "Received" },
    { label: "Bookings waiting", value: stats.waiting, note: "Held at Pre-Possession", go: "Applied" },
  ];

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "OC / CC"]} />
      <SheetShell
        eyebrow="CivilierERP · CRM · Possession"
        title="OC / CC"
        subtitle="The Occupancy / Completion Certificate of each project or block. Until it is received, no booking in its scope can go on to possession."
        action={
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button onClick={() => { refetch(); qc.invalidateQueries({ queryKey: ["crm-oc-cc-board"] }); }} disabled={isFetching} className={`${KEY_LINE} h-9 w-9`} title="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
            {canCreate && <button onClick={() => setCreateOpen(true)} className={`${KEY_INK} h-9 px-4`}><Plus size={13} /> Record OC / CC</button>}
          </div>
        }
      >
        <div className="space-y-5">
          <div className="bg-card" style={{ border: RULE }}>
            <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
              {figures.map((x) => (
                <div key={x.label}>
                  <button onClick={() => setActiveTab(x.go)} className="label link">{x.label}</button>
                  <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{isLoading ? "…" : x.value}</p>
                  <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
                </div>
              ))}
            </div>
          </div>

          {board && <ProjectBoard board={board} canCreate={canCreate} onAdd={addFor} />}

          <div className="flex items-stretch bg-card overflow-x-auto" style={{ border: RULE }}>
            {([["All", stats.total], ["Applied", stats.applied], ["Received", stats.received]] as const).map(([k, n]) => (
              <button key={k} onClick={() => setActiveTab(k)}
                className={`inline-flex items-center gap-2 px-4 h-11 font-heading text-[0.6875rem] font-semibold uppercase tracking-[0.1em] shrink-0 transition-colors ${activeTab === k ? "bg-foreground text-card" : "text-muted-foreground hover:text-foreground hover:bg-primary/5"}`}
                style={{ borderRight: RULE_SOFT }}>
                {k} <span className="tabular-nums">{n}</span>
              </button>
            ))}
          </div>

          {isError ? (
            <p className="py-12 text-center text-sm text-destructive">{(error as Error)?.message}</p>
          ) : isLoading ? (
            <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground space-y-3 bg-card" style={{ border: RULE_SOFT }}>
              <p>{activeTab === "All" ? "No OC / CC recorded yet." : `No ${activeTab.toLowerCase()} certificate.`}</p>
              {canCreate && activeTab === "All" && <button onClick={() => setCreateOpen(true)} className={`${KEY_LINE} h-9 px-4`}><Plus size={13} /> Record the first</button>}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {filtered.map((row: any) => <OcccCard key={row.Id} row={row} onClick={() => openDetail(row)} />)}
            </div>
          )}
        </div>
      </SheetShell>

      <Dialog open={!!detailRow} onOpenChange={(o) => { if (!o) closeDetail(); }}>
        <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto thin-scroll p-5 gap-4 rounded-none" style={{ border: RULE }}>
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-3 pr-6">
              <span className="min-w-0">
                <span className={`block ${LBL}`}>{editLocked ? detailRow?.CertType : `Editing ${detailRow?.CertType}`}</span>
                <span className="font-heading text-lg font-bold text-foreground flex items-center gap-2 truncate">
                  <ShieldCheck size={16} /> {detailRow?.ProjectName}
                </span>
                <span className="block text-xs text-muted-foreground font-normal mt-0.5">{detailRow?.BlockName ? `Block ${detailRow.BlockName}` : "Whole project"}</span>
              </span>
              {canEdit && editLocked && <button onClick={() => setEditLocked(false)} className={`${KEY_INK} h-9 px-4 shrink-0`}><PenSquare size={13} /> Edit</button>}
            </DialogTitle>
          </DialogHeader>
          {detailRow && (
            <>
              <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap bg-card" style={{ border: RULE }}>
                <Steps status={detailRow.Status} />
                <Gate received={detailRow.Status === "Received"} />
              </div>
              {(detailRow.BookingCount ?? 0) > 0 && (
                <p className="flex items-start gap-2 text-xs px-3 py-2 tabular-nums" style={{ border: RULE_SOFT }}>
                  <Users size={13} className="mt-0.5 shrink-0" />
                  <span>
                    {detailRow.BookingCount} active booking{detailRow.BookingCount === 1 ? "" : "s"} {detailRow.BlockName ? "in this block" : "in this project"}.
                    {(detailRow.BookingsAwaitingPossession ?? 0) > 0 && (detailRow.Status === "Received"
                      ? ` ${detailRow.BookingsAwaitingPossession} can go on to the Pre-Possession check.`
                      : ` ${detailRow.BookingsAwaitingPossession} are held at Pre-Possession until this is received.`)}
                  </span>
                </p>
              )}
              {editLocked ? (
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-px" style={{ background: "hsl(var(--foreground) / 0.12)", border: RULE_SOFT }}>
                  {[
                    ["Certificate", detailRow.CertType], ["Status", <SheetMark key="s" text={detailRow.Status} tone={detailRow.Status === "Received" ? "done" : "waiting"} />],
                    ["Applied on", fmtDate(detailRow.ApplicationDate)], ["Received on", fmtDate(detailRow.ReceivedDate)],
                    ["Certificate no", detailRow.CertificateNo], ["Issued by", detailRow.IssuedBy],
                  ].map(([k, v]) => (
                    <div key={k as string} className="bg-card px-3 py-2 min-w-0">
                      <dt className={LBL}>{k as string}</dt>
                      <dd className="text-sm font-medium mt-0.5 tabular-nums break-words">{v || "—"}</dd>
                    </div>
                  ))}
                  {detailRow.Remarks && (
                    <div className="bg-card px-3 py-2 sm:col-span-2"><dt className={LBL}>Remarks</dt><dd className="text-sm mt-0.5">{detailRow.Remarks}</dd></div>
                  )}
                </dl>
              ) : (
                <OcccForm form={editForm} setForm={setEditForm} projects={[]} showProject={false} />
              )}
              {detailRow.CreatedByName && (
                <p className="text-[0.6875rem] text-muted-foreground">Recorded by {detailRow.CreatedByName}{detailRow.UpdatedByName ? ` · last changed by ${detailRow.UpdatedByName}` : ""}</p>
              )}
              <div className="flex justify-end gap-2 pt-3" style={{ borderTop: RULE }}>
                {editLocked ? (
                  <button onClick={closeDetail} className={`${KEY_LINE} h-9 px-4`}>Close</button>
                ) : (
                  <>
                    <button onClick={() => { openDetail(detailRow); }} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
                    <button onClick={handleUpdate} disabled={updating} className={`${KEY_INK} h-9 px-4`}>{updating ? "Saving…" : "Save"}</button>
                  </>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={(o) => { if (!o) { setCreateOpen(false); setCreateForm({ ...EMPTY_FORM }); } }}>
        <DialogContent className="max-w-md max-h-[92vh] overflow-y-auto thin-scroll p-5 gap-4 rounded-none" style={{ border: RULE }}>
          <DialogHeader>
            <DialogTitle className="font-heading text-[0.75rem] font-bold uppercase tracking-[0.14em] flex items-center gap-2"><Plus size={14} /> Record OC / CC</DialogTitle>
          </DialogHeader>
          <OcccForm form={createForm} setForm={setCreateForm} projects={projects as any[]} showProject />
          <div className="flex justify-end gap-2 pt-3" style={{ borderTop: RULE }}>
            <button onClick={() => { setCreateOpen(false); setCreateForm({ ...EMPTY_FORM }); }} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
            <button onClick={handleCreate} disabled={saving || !createForm.ProjectId} className={`${KEY_INK} h-9 px-4`}>{saving ? "Saving…" : "Record"}</button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default CrmOcCc;
