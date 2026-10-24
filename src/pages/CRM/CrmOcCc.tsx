import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CrmShell } from "@/components/crm/CrmShell";
import { usePageRights } from "@/hooks/usePageRights";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { translateError } from "@/lib/translateError";
import {
  Plus, Pencil, CheckCircle2, Clock, AlertTriangle,
  Building2, Hash, Calendar, Users, ShieldCheck,
  FileText, CircleDot, Circle, Lock, ChevronDown,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DateInput } from "@/components/ui/date-input";
import { StatusBadge } from "@/components/StatusBadge";

const API      = "/api/crm/oc-cc";
const PROJ_API = "/api/unit-master/projects";

const CERT_TYPES = ["OC", "CC", "OC+CC"] as const;
const STATUSES   = ["Applied", "Received"] as const;

const CERT_COLOR: Record<string, string> = {
  OC:     "text-blue-700 bg-blue-50 border-blue-200 dark:text-blue-300 dark:bg-blue-950/40 dark:border-blue-800",
  CC:     "text-violet-700 bg-violet-50 border-violet-200 dark:text-violet-300 dark:bg-violet-950/40 dark:border-violet-800",
  "OC+CC":"text-indigo-700 bg-indigo-50 border-indigo-200 dark:text-indigo-300 dark:bg-indigo-950/40 dark:border-indigo-800",
};

const EMPTY_FORM = {
  ProjectId: "", BlockId: "", CertType: "OC" as string, Status: "Applied" as string,
  ApplicationDate: "", ReceivedDate: "", CertificateNo: "", IssuedBy: "", Remarks: "",
};

// ── Helpers ───────────────────────────────────────────────────────────────────
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
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || "Failed to load OC/CC records");
  return r.json();
}
async function fetchProjects(): Promise<any[]> {
  try { const r = await fetchWithAuth(PROJ_API); return r.ok ? r.json() : []; } catch { return []; }
}
// Reuses the same project-scoped blocks endpoint CrmCompanyProjectBlockFilter.tsx
// already calls elsewhere in the CRM module — no new backend route needed.
async function fetchBlocksForProject(projectId: string): Promise<any[]> {
  if (!projectId) return [];
  try { const r = await fetchWithAuth(`/api/unit-master/blocks?projectId=${projectId}`); return r.ok ? r.json() : []; } catch { return []; }
}

// ── Status stepper ────────────────────────────────────────────────────────────
function OcccStepper({ status }: { status: string }) {
  const steps = ["Applied", "Received"];
  const idx   = steps.indexOf(status);
  return (
    <div className="flex items-center gap-0">
      {steps.map((step, i) => {
        // "Applied" = in-progress; "Received" = terminal (all steps done)
        const done = idx > i || (status === "Received");
        const curr = idx === i && status !== "Received";
        const Icon = done ? CheckCircle2 : curr ? CircleDot : Circle;
        return (
          <React.Fragment key={step}>
            <div className="flex flex-col items-center">
              <div className={`flex items-center justify-center w-6 h-6 rounded-full border-2 ${
                done ? "border-emerald-500 bg-emerald-500 text-white" :
                curr ? "border-sky-400 bg-sky-50 text-sky-600 dark:bg-sky-950/30" :
                "border-border bg-muted/30 text-muted-foreground"
              }`}>
                <Icon size={12} />
              </div>
              <span className={`text-[0.625rem] mt-0.5 font-medium ${
                done ? "text-emerald-600 dark:text-emerald-400" :
                curr ? "text-sky-600 dark:text-sky-400" :
                "text-muted-foreground"
              }`}>{step}</span>
            </div>
            {i < steps.length - 1 && (
              <div className={`h-0.5 w-8 mx-1 rounded ${idx > i ? "bg-emerald-400" : "bg-border"}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ── Form fields shared by Create/Edit dialogs ─────────────────────────────────
function OcccForm({
  form, setForm, projects, showProject,
}: {
  form: typeof EMPTY_FORM;
  setForm: React.Dispatch<React.SetStateAction<typeof EMPTY_FORM>>;
  projects: any[];
  showProject: boolean;
}) {
  const sel = "w-full text-sm border border-border rounded-lg px-3 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-primary/40";
  const inp = "w-full text-sm border border-border rounded-lg px-3 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-primary/40";

  // Scope is derived from whether a BlockId is already set — no separate
  // state needed. Only settable at creation (same as Project itself, gated
  // on showProject) — a cert's scope is immutable after creation, same as
  // its Project: create a new one instead of moving an existing cert
  // between scopes.
  const scope = form.BlockId ? "block" : "project";
  const { data: blocks = [] } = useQuery({
    queryKey: ["oc-cc-blocks-for-project", form.ProjectId],
    queryFn: () => fetchBlocksForProject(form.ProjectId),
    enabled: showProject && !!form.ProjectId,
  });

  return (
    <div className="space-y-4">
      {showProject && (
        <>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Project *</label>
            <select value={form.ProjectId}
              onChange={(e) => setForm((f) => ({ ...f, ProjectId: e.target.value, BlockId: "" }))}
              className={sel}>
              <option value="">Select project</option>
              {projects.map((p: any) => <option key={p.Id} value={String(p.Id)}>{p.Name}</option>)}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Scope</label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setForm((f) => ({ ...f, BlockId: "" }))}
                className={`flex-1 text-sm rounded-lg border px-3 py-2 transition-colors ${
                  scope === "project" ? "border-primary bg-primary/5 text-foreground font-medium" : "border-border text-muted-foreground hover:bg-muted/40"
                }`}>
                Project-wide
              </button>
              <button type="button" onClick={() => setForm((f) => ({ ...f, BlockId: f.BlockId || (blocks[0] ? String(blocks[0].Id) : "") }))}
                disabled={!form.ProjectId}
                className={`flex-1 text-sm rounded-lg border px-3 py-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  scope === "block" ? "border-primary bg-primary/5 text-foreground font-medium" : "border-border text-muted-foreground hover:bg-muted/40"
                }`}>
                Specific Block
              </button>
            </div>
            <p className="text-[0.6875rem] text-muted-foreground mt-1">
              {scope === "project"
                ? "Applies to every booking in the project."
                : "Applies only to bookings in the selected block — for a large project where some blocks are finished before others."}
            </p>
          </div>

          {scope === "block" && (
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Block *</label>
              <select value={form.BlockId} onChange={(e) => setForm((f) => ({ ...f, BlockId: e.target.value }))} className={sel}>
                <option value="">Select block</option>
                {blocks.map((b: any) => <option key={b.Id} value={String(b.Id)}>{b.Name}</option>)}
              </select>
            </div>
          )}
        </>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Certificate Type *</label>
          <select value={form.CertType} onChange={(e) => setForm((f) => ({ ...f, CertType: e.target.value }))} className={sel}>
            {CERT_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Status</label>
          <select value={form.Status} onChange={(e) => setForm((f) => ({ ...f, Status: e.target.value }))} className={sel}>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1 flex items-center gap-1">
            <Calendar size={10} /> Application Date
          </label>
          <DateInput value={form.ApplicationDate}
            onChange={(e) => setForm((f) => ({ ...f, ApplicationDate: e.target.value }))}
            className={inp} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1 flex items-center gap-1">
            <CheckCircle2 size={10} /> Received Date
          </label>
          <DateInput value={form.ReceivedDate}
            onChange={(e) => setForm((f) => ({ ...f, ReceivedDate: e.target.value }))}
            className={inp} />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1 flex items-center gap-1">
          <Hash size={10} /> Certificate Number
        </label>
        <input type="text" value={form.CertificateNo} placeholder="e.g. OC/2024/01234"
          onChange={(e) => setForm((f) => ({ ...f, CertificateNo: e.target.value }))}
          className={`${inp} font-mono`} />
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1 flex items-center gap-1">
          <Building2 size={10} /> Issuing Authority
        </label>
        <input type="text" value={form.IssuedBy} placeholder="e.g. GHMC, MCGM, BDA"
          onChange={(e) => setForm((f) => ({ ...f, IssuedBy: e.target.value }))}
          className={inp} />
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1 flex items-center gap-1">
          <FileText size={10} /> Remarks
        </label>
        <textarea value={form.Remarks} rows={2}
          onChange={(e) => setForm((f) => ({ ...f, Remarks: e.target.value }))}
          className={`${inp} resize-none`} />
      </div>

      {form.Status === "Received" && form.CertificateNo && (
        <div className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-lg px-3 py-2">
          <CheckCircle2 size={13} />
          {scope === "block"
            ? "Certificate recorded — possession gate will clear for bookings in this block."
            : "Certificate recorded — possession gate will clear for all bookings in this project."}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
// ── OC / CC board: one row per project, worked out from its blocks ─────────
// (migration 577). A block has OC/CC by its own certificate or a project-wide
// one received while it existed; the project has it when every active block
// does. Opening a project shows its certificates and every block.
type BoardData = { projects: any[]; blocks: any[] };

function certAge(row: any) {
  const days = daysSince(row.ApplicationDate);
  const received = row.Status === "Received";
  return { days, received, overdue: !received && days != null && days > 45, warning: !received && days != null && days > 20 && days <= 45 };
}

function CertLine({ row, onOpen }: { row: any; onOpen: () => void }) {
  const a = certAge(row);
  return (
    <button onClick={onOpen}
      className="w-full text-left flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-border hover:border-primary/40 hover:bg-muted/30 transition-colors">
      <div className="min-w-0 flex items-center gap-2 flex-wrap">
        <span className={`text-[0.625rem] font-bold px-1.5 py-0.5 rounded border ${CERT_COLOR[row.CertType] ?? CERT_COLOR["OC+CC"]}`}>{row.CertType}</span>
        <span className="text-xs font-semibold">{row.BlockName ? `Block ${row.BlockName}` : "Whole project"}</span>
        {row.CertificateNo && <span className="text-[0.6875rem] font-mono text-muted-foreground">{row.CertificateNo}</span>}
        {row.IssuedBy && <span className="text-[0.6875rem] text-muted-foreground">· {row.IssuedBy}</span>}
      </div>
      <div className="flex items-center gap-2 shrink-0 text-[0.6875rem]">
        {a.received
          ? <span className="text-emerald-700 dark:text-emerald-400">Received {fmtDate(row.ReceivedDate) || ""}</span>
          : <span className={a.overdue ? "text-red-600 font-semibold" : a.warning ? "text-amber-600 font-semibold" : "text-muted-foreground"}>
              Applied {fmtDate(row.ApplicationDate) || ""}{a.days != null ? ` · ${a.days} day${a.days === 1 ? "" : "s"} pending` : ""}
            </span>}
        {/* "Received" has a shared StatusBadge entry; "Applied" doesn't exist in
            StatusBadge's registry yet, so it keeps its original local pill
            (see migration report — status key gap). */}
        {row.Status === "Received" ? (
          <StatusBadge status={row.Status} className="px-1.5 py-0.5" />
        ) : (
          <span className="px-1.5 py-0.5 rounded-full border font-semibold text-sky-700 bg-sky-50 border-sky-200 dark:text-sky-300 dark:bg-sky-950/30 dark:border-sky-800">{row.Status}</span>
        )}
        <Pencil size={11} className="text-muted-foreground" />
      </div>
    </button>
  );
}

function OcccBoard({ board, certs, canCreate, onAdd, onOpenCert }: {
  board: BoardData | undefined; certs: any[]; canCreate: boolean;
  onAdd: (projectId: string, blockId?: string) => void; onOpenCert: (row: any) => void;
}) {
  const [filter, setFilter] = useState<"all" | "open" | "done">("all");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const projects = board?.projects || [];
  const blocksBy = useMemo(() => {
    const m: Record<number, any[]> = {};
    for (const b of board?.blocks || []) (m[b.ProjectId] ||= []).push(b);
    return m;
  }, [board]);
  const certsBy = useMemo(() => {
    const m: Record<number, any[]> = {};
    for (const c of certs) (m[c.ProjectId] ||= []).push(c);
    return m;
  }, [certs]);

  const done = projects.filter((p) => p.Received === 1);
  const notDone = projects.filter((p) => p.Received !== 1);
  const blocksMissing = projects.reduce((n, p) => n + Math.max(0, (p.ActiveBlocks || 0) - (p.CoveredBlocks || 0)), 0);
  const waiting = projects.reduce((n, p) => n + (p.WaitingBookings || 0), 0);

  const shown = projects
    .filter((p) => filter === "all" || (filter === "done" ? p.Received === 1 : p.Received !== 1))
    .filter((p) => !search.trim() || String(p.ProjectName).toLowerCase().includes(search.trim().toLowerCase()))
    // what needs attention first: bookings waiting, then not complete, then complete
    .sort((a, b) => (b.WaitingBookings || 0) - (a.WaitingBookings || 0) || (a.Received - b.Received) || String(a.ProjectName).localeCompare(String(b.ProjectName)));

  const stats = [
    { label: "Projects with OC / CC", value: done.length, cls: "text-emerald-700 dark:text-emerald-400" },
    { label: "Projects not complete", value: notDone.length, cls: "text-amber-700 dark:text-amber-400" },
    { label: "Blocks without OC / CC", value: blocksMissing, cls: "text-foreground" },
    { label: "Bookings waiting on OC / CC", value: waiting, cls: waiting ? "text-red-600 dark:text-red-400" : "text-foreground" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stats.map((m) => (
          <div key={m.label} className="rounded-xl border border-border bg-card px-4 py-3">
            <div className={`text-2xl font-bold font-heading tabular-nums ${m.cls}`}>{m.value}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{m.label}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {([["all", "All", projects.length], ["open", "Not complete", notDone.length], ["done", "Complete", done.length]] as const).map(([k, l, c]) => (
          <button key={k} onClick={() => setFilter(k)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${filter === k ? "btn-module text-white border-primary" : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
            {l}<span className={`text-[0.625rem] px-1.5 py-0.5 rounded-full ${filter === k ? "bg-primary-foreground/20" : "bg-muted"}`}>{c}</span>
          </button>
        ))}
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search project…"
          className="ml-auto w-full sm:w-56 text-sm border border-border rounded-lg px-3 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>

      {!board ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />)}</div>
      ) : shown.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">No projects match.</div>
      ) : (
        <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
          {shown.map((p) => {
            const blocks = blocksBy[p.ProjectId] || [];
            const pc = certsBy[p.ProjectId] || [];
            const projectCert = pc.find((c) => c.BlockId == null);
            const isOpen = open[p.ProjectId] ?? false;
            const ok = p.Received === 1;
            return (
              <div key={p.ProjectId}>
                <div role="button" tabIndex={0} onClick={() => setOpen((o) => ({ ...o, [p.ProjectId]: !isOpen }))}
                  onKeyDown={(e) => { if (e.key === "Enter") setOpen((o) => ({ ...o, [p.ProjectId]: !isOpen })); }}
                  className="px-4 py-3 flex items-center gap-4 flex-wrap cursor-pointer hover:bg-muted/30 transition-colors">
                  <ChevronDown size={15} className={`text-muted-foreground shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                  <div className="min-w-[180px] flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold">{p.ProjectName}</span>
                      <span className={`text-[0.625rem] px-2 py-0.5 rounded-full border font-semibold ${ok
                        ? "text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-950/30 dark:border-emerald-800"
                        : "text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-950/30 dark:border-amber-800"}`}>
                        {ok ? "Has OC / CC" : "Not complete"}
                      </span>
                    </div>
                    <p className="text-[0.6875rem] text-muted-foreground mt-0.5">
                      {projectCert
                        ? `Project certificate ${projectCert.CertType} · ${projectCert.Status === "Received" ? `received ${fmtDate(projectCert.ReceivedDate) || ""}` : `applied ${fmtDate(projectCert.ApplicationDate) || ""}`}`
                        : pc.length ? `${pc.length} block certificate${pc.length === 1 ? "" : "s"}` : "No certificate yet"}
                      {ok && p.ReceivedDate ? ` · complete since ${fmtDate(p.ReceivedDate)}` : ""}
                    </p>
                  </div>
                  {p.ActiveBlocks > 0 && (
                    <div className="w-40 shrink-0">
                      <div className="flex gap-0.5">
                        {blocks.map((b) => <div key={b.BlockId} title={`Block ${b.BlockName}`} className={`flex-1 h-1.5 rounded-full ${b.Covered === 1 ? "bg-emerald-500" : "bg-amber-400"}`} />)}
                      </div>
                      <div className="text-[0.6875rem] text-muted-foreground mt-1 tabular-nums">{p.CoveredBlocks} of {p.ActiveBlocks} blocks</div>
                    </div>
                  )}
                  <div className="w-28 shrink-0 text-[0.6875rem] tabular-nums">
                    <div className="flex items-center gap-1 text-muted-foreground"><Users size={11} /> {p.LiveBookings} live</div>
                    {p.WaitingBookings > 0 && <div className="flex items-center gap-1 text-red-600 font-semibold"><AlertTriangle size={11} /> {p.WaitingBookings} waiting</div>}
                  </div>
                  {canCreate && (
                    <button onClick={(e) => { e.stopPropagation(); onAdd(String(p.ProjectId)); }}
                      className="shrink-0 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-border hover:bg-muted flex items-center gap-1">
                      <Plus size={12} /> Certificate
                    </button>
                  )}
                </div>

                {isOpen && (
                  <div className="px-4 pb-4 pl-11 space-y-3 bg-muted/10">
                    {pc.length > 0 && (
                      <div className="space-y-1.5 pt-1">
                        <p className="text-[0.6875rem] font-semibold text-muted-foreground uppercase tracking-wide">Certificates</p>
                        {pc.map((c) => <CertLine key={c.Id} row={c} onOpen={() => onOpenCert(c)} />)}
                      </div>
                    )}
                    {blocks.length > 0 ? (
                      <div className="space-y-1.5">
                        <p className="text-[0.6875rem] font-semibold text-muted-foreground uppercase tracking-wide">Blocks</p>
                        <div className="rounded-lg border border-border bg-card divide-y divide-border">
                          {blocks.map((b) => {
                            const cov = b.Covered === 1;
                            return (
                              <div key={b.BlockId} className="px-3 py-2 flex items-center gap-3 flex-wrap text-xs">
                                <span className={`w-2 h-2 rounded-full shrink-0 ${cov ? "bg-emerald-500" : "bg-amber-400"}`} />
                                <span className="font-semibold w-28 truncate">Block {b.BlockName}</span>
                                <span className={`flex-1 min-w-[160px] ${cov ? "text-foreground" : "text-amber-700 dark:text-amber-400"}`}>
                                  {cov ? `${b.Source === "block" ? "Own certificate" : "Project certificate"}${b.CertType ? ` (${b.CertType})` : ""}${b.CoveredDate ? ` · ${fmtDate(b.CoveredDate)}` : ""}`
                                    : "Not covered yet"}
                                  {cov && b.CertificateNo && <span className="font-mono text-muted-foreground ml-1.5">{b.CertificateNo}</span>}
                                </span>
                                <span className="w-20 text-muted-foreground tabular-nums flex items-center gap-1"><Users size={11} /> {b.LiveBookings}</span>
                                {!cov && canCreate ? (
                                  <button onClick={() => onAdd(String(p.ProjectId), String(b.BlockId))}
                                    className="text-[0.6875rem] font-semibold text-primary hover:underline flex items-center gap-0.5"><Plus size={11} /> Add OC/CC</button>
                                ) : <span className="w-16" />}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground pt-1">This project has no blocks — its project certificate decides.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const CrmOcCc: React.FC = () => {
  const qc = useQueryClient();
  const { canCreate, canEdit } = usePageRights("crm-oc-cc");

  const [activeTab,  setActiveTab]  = useState("All");
  const [detailRow,  setDetailRow]  = useState<any | null>(null);
  const [editLocked, setEditLocked] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ ...EMPTY_FORM });
  const [saving,     setSaving]     = useState(false);

  const [editForm,   setEditForm]   = useState({ ...EMPTY_FORM });
  const [updating,   setUpdating]   = useState(false);

  const { data: rows = [], isLoading, dataUpdatedAt, isFetching, refetch } =
    useQuery({ queryKey: ["crm-oc-cc"], queryFn: fetchAll, staleTime: 30_000 });
  const { data: projects = [] } =
    useQuery({ queryKey: ["unit-master-projects"], queryFn: fetchProjects, staleTime: 5 * 60_000 });
  const { data: board, refetch: refetchBoard } = useQuery<BoardData>({
    queryKey: ["crm-oc-cc-board"],
    queryFn: async () => {
      const r = await fetchWithAuth(`${API}/board`);
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || "Failed to load");
      return r.json();
    },
    staleTime: 30_000,
  });

  // ── Derived stats ──────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const r = rows as any[];
    return {
      total:    r.length,
      applied:  r.filter((x) => x.Status === "Applied").length,
      received: r.filter((x) => x.Status === "Received").length,
      blocked:  r.reduce((s, x) => s + (x.BookingsAwaitingPossession ?? 0), 0),
    };
  }, [rows]);

  const TABS = [
    { key: "All",      label: "All",      count: stats.total    },
    { key: "Applied",  label: "Applied",  count: stats.applied  },
    { key: "Received", label: "Received", count: stats.received },
  ];

  const filtered = useMemo(() =>
    (rows as any[]).filter((r: any) => activeTab === "All" || r.Status === activeTab),
    [rows, activeTab]
  );

  // ── Open detail ───────────────────────────────────────────────────────────
  const openDetail = (row: any) => {
    setDetailRow(row);
    setEditLocked(true);
    setEditForm({
      ProjectId:       String(row.ProjectId),
      BlockId:         row.BlockId != null ? String(row.BlockId) : "",
      CertType:        row.CertType,
      Status:          row.Status,
      ApplicationDate: row.ApplicationDate ? String(row.ApplicationDate).slice(0, 10) : "",
      ReceivedDate:    row.ReceivedDate    ? String(row.ReceivedDate).slice(0, 10)    : "",
      CertificateNo:   row.CertificateNo  || "",
      IssuedBy:        row.IssuedBy       || "",
      Remarks:         row.Remarks        || "",
    });
  };

  const closeDetail = () => { setDetailRow(null); setEditLocked(true); };

  // ── Create ────────────────────────────────────────────────────────────────
  const handleCreate = async () => {
    if (!createForm.ProjectId) { toast.error("Project is required"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ProjectId:       parseInt(createForm.ProjectId),
          BlockId:         createForm.BlockId ? parseInt(createForm.BlockId) : undefined,
          CertType:        createForm.CertType,
          Status:          createForm.Status,
          ApplicationDate: createForm.ApplicationDate || undefined,
          ReceivedDate:    createForm.ReceivedDate    || undefined,
          CertificateNo:   createForm.CertificateNo   || undefined,
          IssuedBy:        createForm.IssuedBy        || undefined,
          Remarks:         createForm.Remarks         || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("OC/CC application recorded");
      setCreateOpen(false);
      setCreateForm({ ...EMPTY_FORM });
      qc.invalidateQueries({ queryKey: ["crm-oc-cc"] });
      qc.invalidateQueries({ queryKey: ["crm-oc-cc-board"] });
      qc.invalidateQueries({ queryKey: ["crm-pre-possession-gateway"] });
      qc.invalidateQueries({ queryKey: ["crm-pre-possession-eligible"] });
      qc.invalidateQueries({ queryKey: ["crm-possession-notice-eligible"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  // ── Update ────────────────────────────────────────────────────────────────
  const handleUpdate = async () => {
    if (!detailRow) return;
    setUpdating(true);
    try {
      const res = await fetchWithAuth(`${API}/${detailRow.Id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          CertType:        editForm.CertType        || undefined,
          Status:          editForm.Status          || undefined,
          ApplicationDate: editForm.ApplicationDate || undefined,
          ReceivedDate:    editForm.ReceivedDate    || undefined,
          CertificateNo:   editForm.CertificateNo,
          IssuedBy:        editForm.IssuedBy,
          Remarks:         editForm.Remarks,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("OC/CC record updated");
      closeDetail();
      qc.invalidateQueries({ queryKey: ["crm-oc-cc"] });
      qc.invalidateQueries({ queryKey: ["crm-oc-cc-board"] });
      qc.invalidateQueries({ queryKey: ["crm-pre-possession-gateway"] });
      qc.invalidateQueries({ queryKey: ["crm-pre-possession-eligible"] });
      qc.invalidateQueries({ queryKey: ["crm-possession-notice-eligible"] });
      qc.invalidateQueries({ queryKey: ["crm-dashboard"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setUpdating(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <CrmShell
      title="OC / CC — Occupancy & Completion"
      subtitle="Per block or for the whole project — a project has OC/CC once every block does; possession waits on it"
      action={
        <div className="flex items-center gap-2">
          <RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={() => { refetch(); refetchBoard(); }} />
          {canCreate && (
            <button onClick={() => setCreateOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 btn-module text-white text-sm font-medium rounded-lg transition-colors">
              <Plus size={14} /> Add OC/CC
            </button>
          )}
        </div>
      }
    >
      <OcccBoard board={board} certs={rows as any[]} canCreate={canCreate}
        onAdd={(projectId, blockId) => { setCreateForm({ ...EMPTY_FORM, ProjectId: projectId, BlockId: blockId || "" }); setCreateOpen(true); }}
        onOpenCert={openDetail} />

      {/* ── Detail / Edit Dialog ── */}
      <Dialog open={!!detailRow} onOpenChange={(o) => { if (!o) closeDetail(); }}>
        <DialogContent accent="crm" className="max-w-lg max-h-[92vh] overflow-y-auto thin-scroll">
          <DialogHeader>
            <DialogTitle className="font-heading flex items-center justify-between gap-2 pr-6">
              <span className="flex items-center gap-2">
                <ShieldCheck size={16} />
                {detailRow?.ProjectName}
                {detailRow?.BlockName && <span className="text-muted-foreground font-normal text-sm">· Block {detailRow.BlockName}</span>}
              </span>
              {canEdit && editLocked && (
                <button onClick={() => setEditLocked(false)}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border border-border rounded-lg hover:bg-muted transition-colors shrink-0">
                  <Pencil size={11} /> Edit
                </button>
              )}
            </DialogTitle>
          </DialogHeader>

          {detailRow && (
            <div className="space-y-4">
              {/* Status stepper */}
              <div className="px-4 py-3 rounded-xl border border-border bg-card flex items-center justify-between gap-4">
                <OcccStepper status={detailRow.Status} />
                <div className={`flex items-center gap-1 text-[0.625rem] font-semibold px-2 py-1 rounded-full border ${
                  detailRow.Status === "Received"
                    ? "text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-950/30 dark:border-emerald-800"
                    : "text-sky-700 bg-sky-50 border-sky-200 dark:text-sky-300 dark:bg-sky-950/30 dark:border-sky-800"
                }`}>
                  {detailRow.Status === "Received" ? <><ShieldCheck size={10} /> Gate Cleared</> : <><Lock size={10} /> Possession Blocked</>}
                </div>
              </div>

              {/* Booking impact */}
              {((detailRow.BookingsAwaitingPossession ?? 0) > 0 || (detailRow.BookingCount ?? 0) > 0) && (
                <div className={`rounded-xl border px-4 py-3 text-sm ${
                  detailRow.Status === "Received"
                    ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/20"
                    : "border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/20"
                }`}>
                  <div className="flex items-start gap-2">
                    <Users size={14} className="mt-0.5 shrink-0" />
                    <div>
                      <p className="font-medium text-sm">
                        {detailRow.BookingCount ?? 0} active bookings in this project
                      </p>
                      {(detailRow.BookingsAwaitingPossession ?? 0) > 0 && (
                        <p className={`text-xs mt-0.5 ${
                          detailRow.Status === "Received" ? "text-emerald-700 dark:text-emerald-400" : "text-sky-700 dark:text-sky-400"
                        }`}>
                          {detailRow.Status === "Received"
                            ? `${detailRow.BookingsAwaitingPossession} bookings can now proceed to Pre-Possession check`
                            : `${detailRow.BookingsAwaitingPossession} bookings are blocked at Pre-Possession — waiting for this certificate`}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {editLocked ? (
                /* View mode */
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  {[
                    { label: "Certificate Type", value: detailRow.CertType },
                    { label: "Status",           value: detailRow.Status   },
                    { label: "Application Date", value: fmtDate(detailRow.ApplicationDate) },
                    { label: "Received Date",    value: fmtDate(detailRow.ReceivedDate)    },
                    { label: "Certificate No",   value: detailRow.CertificateNo, mono: true, span: 2 },
                    { label: "Issuing Authority",value: detailRow.IssuedBy, span: 2 },
                    { label: "Remarks",          value: detailRow.Remarks,  span: 2 },
                  ].map((f) => (
                    <div key={f.label} className={f.span === 2 ? "col-span-2" : ""}>
                      <p className="text-[0.625rem] text-muted-foreground uppercase tracking-widest font-medium mb-0.5">{f.label}</p>
                      <p className={`text-sm ${f.mono ? "font-mono text-emerald-700 dark:text-emerald-400" : ""}`}>
                        {f.value || <span className="text-muted-foreground">—</span>}
                      </p>
                    </div>
                  ))}
                  {detailRow.CreatedByName && (
                    <div className="col-span-2 pt-2 border-t border-border">
                      <p className="text-[0.625rem] text-muted-foreground">
                        Created by {detailRow.CreatedByName}
                        {detailRow.UpdatedByName ? ` · Updated by ${detailRow.UpdatedByName}` : ""}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                /* Edit mode */
                <OcccForm form={editForm} setForm={setEditForm} projects={[]} showProject={false} />
              )}

              {/* Actions */}
              <div className="flex justify-end gap-2 pt-2 border-t border-border">
                {editLocked ? (
                  <button onClick={closeDetail}
                    className="px-4 py-2 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted transition-colors">
                    Close
                  </button>
                ) : (
                  <>
                    <button onClick={() => setEditLocked(true)}
                      className="px-4 py-2 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted transition-colors">
                      Cancel
                    </button>
                    <button onClick={handleUpdate} disabled={updating}
                      className="px-5 py-2 text-sm btn-module text-white rounded-lg font-medium hover:shadow-lg disabled:opacity-40 transition-colors">
                      {updating ? "Saving..." : "Save Changes"}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Create Dialog ── */}
      <Dialog open={createOpen} onOpenChange={(o) => { if (!o) { setCreateOpen(false); setCreateForm({ ...EMPTY_FORM }); } }}>
        <DialogContent accent="crm" className="max-w-md max-h-[92vh] overflow-y-auto thin-scroll">
          <DialogHeader>
            <DialogTitle className="font-heading flex items-center gap-2">
              <Plus size={16} /> New OC / CC Application
            </DialogTitle>
          </DialogHeader>
          <OcccForm form={createForm} setForm={setCreateForm} projects={projects as any[]} showProject={true} />
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => { setCreateOpen(false); setCreateForm({ ...EMPTY_FORM }); }}
              className="px-4 py-2 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted transition-colors">
              Cancel
            </button>
            <button onClick={handleCreate} disabled={saving || !createForm.ProjectId}
              className="px-5 py-2 text-sm btn-module text-white rounded-lg font-medium hover:shadow-lg disabled:opacity-40 transition-colors">
              {saving ? "Saving..." : "Record Application"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </CrmShell>
  );
};

export default CrmOcCc;
