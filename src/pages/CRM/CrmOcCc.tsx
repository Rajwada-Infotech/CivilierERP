// CRM OC / CC: the Occupancy / Completion Certificate of each project (or block). Possession is gated on it: until a
// certificate is Received, no booking in its scope can go to Pre-Possession. Worked out by block (migration 577): a block
// has OC / CC by its own certificate or by a project-wide one received while it existed, and the project has it when
// every active block does — a block added later puts it back to not complete until that block's certificate arrives.
import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Building2, Download, Lock, PenSquare, Plus, RefreshCw, ShieldCheck, Users } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { useSearchParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  CrmGrid, GridColumnChooser, GridMiniTable, GridRelated, GridSavedViews, GridSearch, GridTabs, GridToneMark,
  exportGrid, useGridPrefs, GRID_BTN, GRID_CARD, GRID_PAGE_SIZES, GRID_SHEET_KEYS, type GridCol,
} from "@/components/crm/CrmDataTable";
import { useCrmListState, type CrmSort } from "@/hooks/useCrmListState";
import { BAND_DOT, BAND_KEY, BAND_KEY_MAIN, CollectionBar, MoneyBand } from "./payments/parts";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DateInput } from "@/components/ui/date-input";
import { SearchableSelect } from "@/components/SearchableSelect";
import { usePageRights } from "@/hooks/usePageRights";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { translateError } from "@/lib/translateError";
import { KEY_INK, KEY_LINE, LBL, RULE, RULE_SOFT } from "./customers/config";

import { useUrlParam } from "@/hooks/useUrlParam";
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

/** A project's blocks as one line: filled when the block has OC / CC. */
function BlockBar({ blocks, onDark }: { blocks: any[]; onDark?: boolean }) {
  const off = onDark ? "bg-white/15" : "bg-slate-200 dark:bg-slate-700";
  return (
    <span className="flex gap-0.5 w-full">
      {blocks.map((b) => <span key={b.BlockId} title={`Block ${b.BlockName}: ${b.Covered === 1 ? "covered" : "not covered yet"}`} className={cn("flex-1 rounded-full", onDark ? "h-2.5" : "h-1.5", b.Covered === 1 ? (onDark ? BAND_DOT.collected : "bg-emerald-500") : off)} />)}
    </span>
  );
}
const pendingDays = (r: any) => (r.Status === "Received" ? null : daysSince(r.ApplicationDate));
const dash = <span className="text-muted-foreground">—</span>;
const projectMark = (p: any) => <GridToneMark text={p.Received === 1 ? "Has OC / CC" : "Not complete"} tone={p.Received === 1 ? "done" : "waiting"} />;

function projectCols(blocksBy: Record<number, any[]>, canCreate: boolean, onAdd: (projectId: string) => void): GridCol<any>[] {
  return [
    { id: "project", label: "Project", locked: true, sortKey: "ProjectName", csv: (p) => p.ProjectName, cell: (p) => (
      <span className="block py-1.5 min-w-0">
        <span className="block font-semibold text-foreground truncate" title={p.ProjectName}>{p.ProjectName}</span>
        <span className="block text-xs text-muted-foreground tabular-nums">{p.Received === 1 && p.ReceivedDate ? `Complete since ${fmtDate(p.ReceivedDate)}` : p.ActiveBlocks > 0 ? "Complete when every active block has OC / CC" : "The project-wide certificate decides"}</span>
      </span>
    ) },
    { id: "blocks", label: "Blocks covered", sortKey: "CoveredBlocks", csv: (p) => `${p.CoveredBlocks} of ${p.ActiveBlocks}`, cell: (p) => (p.ActiveBlocks > 0 ? (
      <span className="block min-w-[13rem] py-1.5">
        <BlockBar blocks={blocksBy[p.ProjectId] || []} />
        <span className="mt-1.5 block text-xs text-muted-foreground tabular-nums"><span className="font-medium text-foreground">{p.CoveredBlocks}</span> of {p.ActiveBlocks} block{p.ActiveBlocks === 1 ? "" : "s"}</span>
      </span>
    ) : <span className="text-xs text-muted-foreground">No blocks</span>) },
    { id: "live", label: "Live bookings", align: "right", sortKey: "LiveBookings", csv: (p) => p.LiveBookings, cell: (p) => <span className="tabular-nums">{p.LiveBookings}</span> },
    { id: "waiting", label: "Waiting on OC / CC", align: "right", sortKey: "WaitingBookings", csv: (p) => p.WaitingBookings, cell: (p) => (p.WaitingBookings > 0 ? <span className="tabular-nums font-semibold text-destructive">{p.WaitingBookings}</span> : dash) },
    { id: "status", label: "Status", sortKey: "Received", csv: (p) => (p.Received === 1 ? "Has OC / CC" : "Not complete"), cell: projectMark },
    { id: "act", label: "Actions", cell: (p) => (canCreate && p.Received !== 1 ? <button type="button" onClick={(e) => { e.stopPropagation(); onAdd(String(p.ProjectId)); }} className={cn(GRID_SHEET_KEYS.KEY_LINE, "h-7 px-2.5")}><Plus size={12} /> Add OC / CC</button> : null) },
  ];
}

const CERT_COLS: GridCol<any>[] = [
  { id: "project", label: "Project", locked: true, sortKey: "ProjectName", csv: (r) => r.ProjectName, cell: (r) => (
    <span className="block py-1.5 min-w-0">
      <span className="block font-semibold text-foreground truncate" title={r.ProjectName}>{r.ProjectName}</span>
      <span className="block text-xs text-muted-foreground truncate">{r.BlockName ? `Block ${r.BlockName}` : "Whole project"}{r.IssuedBy ? ` · ${r.IssuedBy}` : ""}</span>
    </span>
  ) },
  { id: "type", label: "Certificate", sortKey: "CertType", csv: (r) => r.CertType, cell: (r) => (
    <span className="inline-flex flex-col leading-tight">
      <span className="font-medium">{r.CertType}</span>
      <span className="mt-0.5 text-xs text-muted-foreground tabular-nums">{r.CertificateNo || "No number yet"}</span>
    </span>
  ) },
  { id: "applied", label: "Applied on", sortKey: "ApplicationDate", csv: (r) => r.ApplicationDate, cell: (r) => <span className="tabular-nums">{fmtDate(r.ApplicationDate) || "—"}</span> },
  { id: "received", label: "Received", sortKey: "ReceivedDate", csv: (r) => r.ReceivedDate, cell: (r) => {
    if (r.Status === "Received") return <span className="tabular-nums">{fmtDate(r.ReceivedDate) || "—"}</span>;
    const d = pendingDays(r);
    if (d == null) return dash;
    return <span className={cn("tabular-nums", d > OVERDUE_DAYS ? "font-semibold text-destructive" : d > LATE_DAYS ? "font-semibold" : "text-muted-foreground")}>Pending {d} days</span>;
  } },
  { id: "bookings", label: "Bookings", align: "right", sortKey: "BookingCount", csv: (r) => r.BookingCount, cell: (r) => (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className="tabular-nums">{r.BookingCount ?? 0}</span>
      {(r.BookingsAwaitingPossession ?? 0) > 0 && <span className="mt-0.5 text-xs text-muted-foreground tabular-nums">{r.BookingsAwaitingPossession} {r.Status === "Received" ? "ready for possession" : "waiting"}</span>}
    </span>
  ) },
  { id: "status", label: "Status", sortKey: "Status", csv: (r) => r.Status, cell: (r) => (
    <span className="block leading-tight">
      <GridToneMark text={r.Status} tone={r.Status === "Received" ? "done" : "waiting"} />
      <span className="block mt-1 text-xs text-muted-foreground">{r.Status === "Received" ? "Possession open" : "Possession held"}</span>
    </span>
  ) },
  { id: "issued", label: "Issued by", hiddenByDefault: true, csv: (r) => r.IssuedBy, cell: (r) => r.IssuedBy || "—" },
  { id: "remarks", label: "Remarks", hiddenByDefault: true, csv: (r) => r.Remarks, cell: (r) => r.Remarks || "—" },
  { id: "by", label: "Recorded by", hiddenByDefault: true, csv: (r) => r.CreatedByName, cell: (r) => r.CreatedByName || "—" },
];

type Tab = "projects" | "open" | "complete" | "certs" | "Applied" | "Received";
const PROJECT_TABS: Tab[] = ["projects", "open", "complete"];
const TAB_LABEL: Record<Tab, string> = { projects: "All projects", open: "Not complete", complete: "Complete", certs: "All certificates", Applied: "Applied", Received: "Received" };
const DEFAULT_SORT: CrmSort = { key: "", dir: "asc" };
const norm = (v: unknown) => (typeof v === "number" ? v : String(v ?? "").toLowerCase());
function sortRows<T extends Record<string, any>>(rows: T[], key: string, dir: "asc" | "desc"): T[] {
  if (!key) return rows;
  return [...rows].sort((a, b) => { const x = norm(a[key]), y = norm(b[key]); const c = x < y ? -1 : x > y ? 1 : 0; return dir === "asc" ? c : -c; });
}

/** One project on its own page: its blocks and every certificate, nothing folded away. */
function ProjectRecord({ project, blocks, certs, canCreate, onBack, onAdd, onOpenCert }: {
  project: any; blocks: any[]; certs: any[]; canCreate: boolean; onBack: () => void; onAdd: (projectId: string, blockId?: string) => void; onOpenCert: (r: any) => void;
}) {
  const uncovered = project.ActiveBlocks - project.CoveredBlocks;
  return (
    <div className="space-y-4">
      <MoneyBand eyebrow="OC / CC" title={project.ProjectName} status={<span className="inline-flex items-center h-5 px-2 rounded-full border border-white/30 text-[0.6875rem] font-semibold text-white">{project.Received === 1 ? "Has OC / CC" : "Not complete"}</span>}
        sub={project.Received === 1 && project.ReceivedDate ? `Complete since ${fmtDate(project.ReceivedDate)}` : "Complete when every active block has OC / CC"}
        actions={<>
          <button type="button" onClick={onBack} className={BAND_KEY}><ArrowLeft size={13} /> All projects</button>
          {canCreate && <button type="button" onClick={() => onAdd(String(project.ProjectId))} className={BAND_KEY_MAIN}><Plus size={13} /> Record OC / CC</button>}
        </>}
        lead={`${project.CoveredBlocks} of ${project.ActiveBlocks}`} leadNote="blocks covered"
        bar={blocks.length ? <BlockBar blocks={blocks} onDark /> : <span className="block h-2.5 rounded-full bg-white/15" />}
        figures={[
          { label: "Blocks covered", dot: BAND_DOT.collected, value: String(project.CoveredBlocks), note: `of ${project.ActiveBlocks} active` },
          { label: "Not covered", dot: uncovered > 0 ? BAND_DOT.overdue : undefined, value: String(uncovered), note: uncovered > 0 ? "Still need a certificate" : "None", alert: uncovered > 0 },
          { label: "Live bookings", value: String(project.LiveBookings), note: "In this project" },
          { label: "Waiting on OC / CC", dot: project.WaitingBookings > 0 ? BAND_DOT.overdue : undefined, value: String(project.WaitingBookings), note: "Held from possession", alert: project.WaitingBookings > 0 },
        ]} />
      <GridRelated icon={Building2} title="Blocks" count={blocks.length}>
        <GridMiniTable rows={blocks} rowKey={(b: any) => b.BlockId} empty="No blocks: the project-wide certificate decides." cols={[
          { header: "Block", cell: (b: any) => <span className="font-medium">{b.BlockName}</span> },
          { header: "Covered by", cell: (b: any) => (b.Covered === 1 ? <span>{b.Source === "block" ? "Own certificate" : "Project certificate"}{b.CertType ? ` (${b.CertType})` : ""}</span> : <span className="text-destructive">Not covered yet</span>) },
          { header: "Certificate no", cell: (b: any) => <span className="tabular-nums">{b.CertificateNo || "—"}</span> },
          { header: "Received", cell: (b: any) => <span className="tabular-nums">{fmtDate(b.CoveredDate) || "—"}</span> },
          { header: "Live bookings", align: "right", cell: (b: any) => <span className="tabular-nums">{b.LiveBookings}</span> },
          { header: "Actions", cell: (b: any) => (b.Covered !== 1 && canCreate ? <button type="button" onClick={() => onAdd(String(project.ProjectId), String(b.BlockId))} className={cn(GRID_SHEET_KEYS.KEY_LINE, "h-7 px-2.5")}><Plus size={12} /> Add OC / CC</button> : null) },
        ]} />
      </GridRelated>
      <GridRelated icon={ShieldCheck} title="Certificates" count={certs.length}>
        <GridMiniTable rows={certs} rowKey={(r: any) => r.Id} empty="No certificate recorded for this project." cols={[
          { header: "Covers", cell: (r: any) => <span className="font-medium">{r.BlockName ? `Block ${r.BlockName}` : "Whole project"}</span> },
          { header: "Certificate", cell: (r: any) => r.CertType },
          { header: "Certificate no", cell: (r: any) => <span className="tabular-nums">{r.CertificateNo || "—"}</span> },
          { header: "Issued by", cell: (r: any) => <span className="text-muted-foreground">{r.IssuedBy || "—"}</span> },
          { header: "Applied on", cell: (r: any) => <span className="tabular-nums">{fmtDate(r.ApplicationDate) || "—"}</span> },
          { header: "Received on", cell: (r: any) => <span className="tabular-nums">{fmtDate(r.ReceivedDate) || "—"}</span> },
          { header: "Status", cell: (r: any) => <GridToneMark text={r.Status} tone={r.Status === "Received" ? "done" : "waiting"} /> },
          { header: "Actions", cell: (r: any) => <button type="button" onClick={() => onOpenCert(r)} className={cn(GRID_SHEET_KEYS.KEY_LINE, "h-7 px-2.5")}>Open</button> },
        ]} />
      </GridRelated>
    </div>
  );
}

const CrmOcCc: React.FC = () => {
  const qc = useQueryClient();
  const { canCreate, canEdit } = usePageRights("crm-oc-cc");
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
  const [sp, setSp] = useSearchParams();
  const [tab, setTabRaw] = useUrlParam<Tab>("tab", "projects", Object.keys(TAB_LABEL) as Tab[]);
  const [pageSize, setPageSize] = useState<number>(GRID_PAGE_SIZES[0]);
  const list = useCrmListState({ pageSize, defaultSort: DEFAULT_SORT });
  const setTab = (t: Tab) => { setTabRaw(t); list.setPage(1); };
  const [exporting, setExporting] = useState(false);
  const openId = sp.get("open");
  const openProject = (id: number) => setSp((p) => { p.set("open", String(id)); return p; });
  const closeProject = () => setSp((p) => { p.delete("open"); return p; });

  const blocksBy = useMemo(() => {
    const m: Record<number, any[]> = {};
    for (const b of board?.blocks ?? []) (m[b.ProjectId] ||= []).push(b);
    return m;
  }, [board]);
  const pCols = projectCols(blocksBy, canCreate, addFor);
  const [pPrefs, setPPrefs] = useGridPrefs("crm-oc-cc-project-cols-v1", pCols);
  const [cPrefs, setCPrefs] = useGridPrefs("crm-oc-cc-cert-cols-v1", CERT_COLS);

  const allProjects = board?.projects ?? [];
  const q = list.query.search.toLowerCase();
  const onProjects = PROJECT_TABS.includes(tab);
  // What needs attention first unless someone picks a sort: bookings waiting, then not complete.
  const projectRows = useMemo(() => {
    const base = [...allProjects].filter((p) => (tab === "open" ? p.Received !== 1 : tab === "complete" ? p.Received === 1 : true)).filter((p) => !q || String(p.ProjectName).toLowerCase().includes(q))
      .sort((a, b) => (b.WaitingBookings || 0) - (a.WaitingBookings || 0) || (a.Received - b.Received) || String(a.ProjectName).localeCompare(String(b.ProjectName)));
    return sortRows(base, list.sort.key, list.sort.dir);
  }, [allProjects, tab, q, list.sort]);
  const certRows = useMemo(() => {
    const base = (rows as any[]).filter((r) => (tab === "Applied" || tab === "Received" ? r.Status === tab : true))
      .filter((r) => !q || [r.ProjectName, r.BlockName, r.CertificateNo, r.IssuedBy].some((x) => String(x ?? "").toLowerCase().includes(q)));
    return sortRows(base, list.sort.key, list.sort.dir);
  }, [rows, tab, q, list.sort]);
  const shown = onProjects ? projectRows : certRows;
  const pageRows = shown.slice((list.page - 1) * pageSize, list.page * pageSize);
  const complete = allProjects.filter((p) => p.Received === 1).length;
  const waiting = allProjects.reduce((s, p) => s + (p.WaitingBookings || 0), 0);
  const counts: Record<Tab, number> = { projects: allProjects.length, open: allProjects.length - complete, complete, certs: stats.total, Applied: stats.applied, Received: stats.received };
  const handleExport = () => {
    setExporting(true);
    try { if (onProjects) exportGrid(projectRows, pCols, `oc-cc-projects-${tab}`); else exportGrid(certRows, CERT_COLS, `oc-cc-certificates-${tab}`); }
    catch (e: any) { toast.error(translateError(e.message)); }
    finally { setExporting(false); }
  };
  const refreshAll = () => { refetch(); qc.invalidateQueries({ queryKey: ["crm-oc-cc-board"] }); };
  const openP = openId ? allProjects.find((p) => String(p.ProjectId) === openId) : null;

  return (
    <div className="space-y-4">
      <Breadcrumbs items={["Dashboard", "CRM", "OC / CC"]} />
      {openId ? (
        openP ? <ProjectRecord project={openP} blocks={blocksBy[openP.ProjectId] || []} certs={(rows as any[]).filter((r) => r.ProjectId === openP.ProjectId)} canCreate={canCreate} onBack={closeProject} onAdd={addFor} onOpenCert={openDetail} />
          : <div className={cn(GRID_CARD, "px-4 py-10 text-center text-sm text-muted-foreground")}>{board ? "Project not found." : "Loading…"}</div>
      ) : (
      <>
      <MoneyBand eyebrow="CRM · Possession" title="OC / CC" sub="Until a certificate is received, no booking in its project or block can go on to possession."
        actions={<>
          {canCreate && <button type="button" onClick={() => setCreateOpen(true)} className={BAND_KEY_MAIN}><Plus size={13} /> Record OC / CC</button>}
          <button type="button" onClick={refreshAll} disabled={isFetching} className={cn(BAND_KEY, "w-9 !px-0")} title="Refresh" aria-label="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
        </>}
        lead={`${complete} of ${allProjects.length}`} leadNote="projects have OC / CC"
        bar={<CollectionBar onDark due={allProjects.length} collected={complete} finance={0} recorded={0} />}
        figures={[
          { label: "Received", dot: BAND_DOT.collected, value: String(stats.received), note: "Possession open" },
          { label: "Applied", dot: BAND_DOT.finance, value: String(stats.applied), note: stats.overdue ? `${stats.overdue} pending over ${OVERDUE_DAYS} days` : "None overdue", alert: stats.overdue > 0 },
          { label: "Bookings waiting", dot: waiting > 0 ? BAND_DOT.overdue : undefined, value: String(waiting), note: "No OC / CC for their block", alert: waiting > 0 },
          { label: "Certificates", value: String(stats.total), note: `${stats.projects} project${stats.projects === 1 ? "" : "s"}` },
        ]} />
      <div className={cn(GRID_CARD, "rounded-xl overflow-hidden")}>
        <GridTabs<Tab> label="OC / CC" active={tab} onChange={setTab} tabs={(Object.keys(TAB_LABEL) as Tab[]).map((key) => ({ key, label: TAB_LABEL[key], count: isLoading && !board ? null : counts[key] }))} />
        <div className="px-3 py-2 flex flex-wrap items-center gap-2 border-b border-border">
          <GridSearch value={list.searchInput} onChange={list.setSearchInput} placeholder={onProjects ? "Project" : "Project, block, certificate no or issuer"} />
          {list.hasFilters && <button type="button" onClick={list.reset} className={GRID_BTN}>Clear filters</button>}
          <div className="ml-auto flex items-center gap-2">
            <GridSavedViews storageKey="crm-oc-cc-views"
              current={{ status: tab, search: list.searchInput.trim(), cpb: list.cpb, sort: list.sort, pageSize }}
              onApply={(v) => {
                setPageSize(GRID_PAGE_SIZES.includes(v.pageSize as typeof GRID_PAGE_SIZES[number]) ? v.pageSize : GRID_PAGE_SIZES[0]);
                list.apply({ ...v, status: "All" });
                setTabRaw(Object.hasOwn(TAB_LABEL, v.status) ? (v.status as Tab) : "projects");
              }} />
            {onProjects ? <GridColumnChooser cols={pCols} prefs={pPrefs} onChange={setPPrefs} /> : <GridColumnChooser cols={CERT_COLS} prefs={cPrefs} onChange={setCPrefs} />}
            <button type="button" onClick={handleExport} disabled={exporting} className={GRID_BTN} title="Export to Excel"><Download size={13} /> <span className="hidden md:inline">Export</span></button>
          </div>
        </div>
        {onProjects ? (
          <CrmGrid cols={pCols} prefs={pPrefs} onPrefs={setPPrefs} rows={pageRows} rowKey={(p) => p.ProjectId} noRowNumbers
            loading={!board} fetching={isFetching} error={null} onRetry={refreshAll} sort={list.sort} onSort={list.toggleSort} onRowClick={(p) => openProject(p.ProjectId)}
            empty="No project matches." page={list.page} pageSize={pageSize} total={shown.length} onPage={list.setPage} onPageSize={(n) => { setPageSize(n); list.setPage(1); }} />
        ) : (
          <CrmGrid cols={CERT_COLS} prefs={cPrefs} onPrefs={setCPrefs} rows={pageRows} rowKey={(r) => r.Id} noRowNumbers
            loading={isLoading} fetching={isFetching} error={isError ? translateError((error as Error)?.message) : null} onRetry={() => refetch()} sort={list.sort} onSort={list.toggleSort} onRowClick={(r) => openDetail(r)}
            empty={tab === "certs" ? "No OC / CC recorded yet." : `No ${tab.toLowerCase()} certificate.`} page={list.page} pageSize={pageSize} total={shown.length} onPage={list.setPage} onPageSize={(n) => { setPageSize(n); list.setPage(1); }} />
        )}
      </div>
      </>
      )}

      {detailRow && (
      <Dialog open onOpenChange={(o) => { if (!o) closeDetail(); }}>
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
                    ["Certificate", detailRow.CertType], ["Status", <GridToneMark key="s" text={detailRow.Status} tone={detailRow.Status === "Received" ? "done" : "waiting"} />],
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
      )}

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
    </div>
  );
};

export default CrmOcCc;
