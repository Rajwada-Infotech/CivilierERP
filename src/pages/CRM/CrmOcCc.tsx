// CRM Occupancy & Completion Certificates of each project (or block). Possession is gated on them: until a certificate
// is issued, no booking in its scope can go to Pre-Possession. Worked out by block (migration 577): a block is certified
// by its own certificate or by a project-wide one issued while it existed, and the project is certified when every
// active block is; a block added later puts it back to pending until that block's certificate is issued.
import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, BadgeCheck, Building2, Clock3, Download, FilePlus2, PenSquare, Plus, RefreshCw, ShieldCheck, Users } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Link, useSearchParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  GridDialog, GridFields, GridFormField, GridFormSection, GridMiniTable, GridRelated, GridSearch, GridSegment, GridToneMark,
  exportGrid, GRID_BTN, GRID_BTN_BRAND, GRID_CARD, GRID_INPUT, GRID_SHEET_KEYS, type GridCol,
} from "@/components/crm/CrmDataTable";
import { BAND_DOT, BAND_KEY, BAND_KEY_MAIN, CollectionBar, MoneyBand, asName } from "./payments/parts";
import { fmtShort } from "./payments/config";
import { fmtRupees } from "@/components/crm/FinancialStatusBar";
import { DateInput } from "@/components/ui/date-input";
import { SearchableSelect } from "@/components/SearchableSelect";
import { usePageRights } from "@/hooks/usePageRights";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { translateError } from "@/lib/translateError";

import { CERTIFICATE_TERMS, CERT_STATUS_LABEL, CERT_TYPE_LABEL } from "@/constants/crmStatuses";
const API = "/api/crm/oc-cc";
const PROJ_API = "/api/unit-master/projects";

const CERT_TYPES = ["OC", "CC", "OC+CC"] as const;
const STATUSES = ["Applied", "Received"] as const;
// Pending past these many days reads as overdue.
const OVERDUE_DAYS = 45;

const EMPTY_FORM = {
  ProjectId: "", BlockId: "", Scope: "project" as "project" | "block", CertType: "OC" as string, Status: "Applied" as string,
  ApplicationDate: "", ReceivedDate: "", CertificateNo: "", IssuedBy: "", Remarks: "",
};
type OcForm = typeof EMPTY_FORM;

const NOTE = "flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2.5 text-xs";

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
  if (!r.ok) throw new Error(data?.error || "Could not load the certificates.");
  return Array.isArray(data) ? data : [];
}
async function fetchProjects(): Promise<any[]> {
  try { const r = await fetchWithAuth(PROJ_API); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchBlocksForProject(projectId: string): Promise<any[]> {
  if (!projectId) return [];
  try { const r = await fetchWithAuth(`/api/unit-master/blocks?projectId=${projectId}`); return r.ok ? r.json() : []; } catch { return []; }
}

const possessionText = (issued: boolean) => (issued ? "Cleared for possession" : "Not cleared for possession");
// One form for filing, recording and editing: it asks only for what applies. Project and scope are set only when
// creating (a certificate's scope is fixed after); the status is changed only when editing.
function OcccForm({ form, setForm, projects, showProject }: {
  form: OcForm; setForm: React.Dispatch<React.SetStateAction<OcForm>>; projects: any[]; showProject: boolean;
}) {
  const { data: blocks = [], isLoading: loadingBlocks } = useQuery({
    queryKey: ["oc-cc-blocks-for-project", form.ProjectId],
    queryFn: () => fetchBlocksForProject(form.ProjectId),
    enabled: showProject && !!form.ProjectId,
  });
  const set = (k: keyof OcForm, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const issued = form.Status === "Received";
  const showStatus = !showProject;

  return (
    <>
      {showProject && (
        <GridFormSection title="Project and scope">
          <GridFormField label="Project" required>
            <SearchableSelect value={form.ProjectId} onChange={(v) => setForm((f) => ({ ...f, ProjectId: v, BlockId: "" }))}
              placeholder={projects.length ? "Select project" : "No project you can see"} searchPlaceholder="Search projects…"
              options={projects.map((p: any) => ({ value: String(p.Id), label: p.Name }))} />
          </GridFormField>
          <GridFormField label="Scope of certificate" hint={form.Scope === "project" ? "Applies to every booking in the project." : "Applies only to bookings in the selected block."}>
            <span className="block">
              <GridSegment<"project" | "block"> label="Scope of certificate" value={form.Scope}
                onChange={(v) => setForm((f) => ({ ...f, Scope: v, BlockId: v === "project" ? "" : f.BlockId }))}
                options={[{ key: "project", label: WHOLE_PROJECT }, { key: "block", label: "Single block" }]} />
            </span>
          </GridFormField>
          {form.Scope === "block" && (
            <GridFormField label="Block" required>
              <SearchableSelect value={form.BlockId} onChange={(v) => set("BlockId", v)}
                placeholder={!form.ProjectId ? "Select the project first" : loadingBlocks ? "Loading blocks…" : blocks.length ? "Select block" : "No block in this project"}
                searchPlaceholder="Search blocks…" options={blocks.map((b: any) => ({ value: String(b.Id), label: b.Name }))} />
            </GridFormField>
          )}
        </GridFormSection>
      )}

      <GridFormSection title="Certificate details">
        <GridFormField label="Certificate type" required>
          <select value={form.CertType} onChange={(e) => set("CertType", e.target.value)} className={GRID_INPUT}>
            {CERT_TYPES.map((t) => <option key={t} value={t}>{CERT_TYPE_LABEL[t]}</option>)}
          </select>
        </GridFormField>
        {showStatus && (
          <GridFormField label="Status">
            <select value={form.Status} onChange={(e) => set("Status", e.target.value)} className={GRID_INPUT}>
              {STATUSES.map((v) => <option key={v} value={v}>{CERT_STATUS_LABEL[v]}</option>)}
            </select>
          </GridFormField>
        )}
        <GridFormField label="Application date">
          <DateInput value={form.ApplicationDate} onChange={(e) => set("ApplicationDate", e.target.value)} className={GRID_INPUT} />
        </GridFormField>
        {issued && (
          <>
            <GridFormField label="Date of issue" required>
              <DateInput value={form.ReceivedDate} onChange={(e) => set("ReceivedDate", e.target.value)} className={GRID_INPUT} />
            </GridFormField>
            <GridFormField label="Certificate number" required>
              <input type="text" value={form.CertificateNo} placeholder="As printed on the certificate" onChange={(e) => set("CertificateNo", e.target.value)} className={cn(GRID_INPUT, "tabular-nums")} />
            </GridFormField>
          </>
        )}
        <GridFormField label="Issuing authority" wide={!showStatus}>
          <input type="text" value={form.IssuedBy} placeholder="e.g. Municipal Corporation, Development Authority" onChange={(e) => set("IssuedBy", e.target.value)} className={GRID_INPUT} />
        </GridFormField>
        <GridFormField label="Remarks" wide>
          <textarea value={form.Remarks} rows={2} onChange={(e) => set("Remarks", e.target.value)} className={cn(GRID_INPUT, "h-auto py-2 resize-none")} />
        </GridFormField>
      </GridFormSection>
      {issued && (
        <p className={NOTE}>
          <ShieldCheck size={13} className="mt-0.5 shrink-0" /> Once saved, {form.BlockId ? "the bookings in this block are" : "every booking in this project is"} cleared for the Pre-Possession check.
        </p>
      )}
    </>
  );
}

// Issued opens the possession gate, so it needs the date and the number on record (it could be set with neither).
function checkForm(f: OcForm, recording: boolean): string | null {
  if (recording && !f.ProjectId) return "Select the project.";
  if (recording && f.Scope === "block" && !f.BlockId) return "Select the block.";
  if (f.Status === "Received" && !f.ReceivedDate) return "Enter the date of issue.";
  if (f.Status === "Received" && !f.CertificateNo.trim()) return "Enter the certificate number.";
  if (f.ApplicationDate && f.ReceivedDate && f.ReceivedDate < f.ApplicationDate) return "The date of issue cannot be before the application date.";
  return null;
}

type Board = { projects: any[]; blocks: any[]; held: any[] };
async function fetchBoard(): Promise<Board> {
  const r = await fetchWithAuth(`${API}/board`);
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(data?.error || `Could not load the projects (${r.status}).`);
  return { projects: data?.projects ?? [], blocks: data?.blocks ?? [], held: data?.held ?? [] };
}

/** A project's blocks as one line: filled when the block is certified. */
function BlockBar({ blocks, onDark }: { blocks: any[]; onDark?: boolean }) {
  const off = onDark ? "bg-white/15" : "bg-slate-200 dark:bg-slate-700";
  return (
    <span className="flex gap-0.5 w-full">
      {blocks.map((b) => <span key={b.BlockId} title={`Block ${b.BlockName}: ${b.Covered === 1 ? "certified" : "not certified"}`} className={cn("flex-1 rounded-full", onDark ? "h-2.5" : "h-1.5", b.Covered === 1 ? (onDark ? BAND_DOT.collected : "bg-emerald-500") : off)} />)}
    </span>
  );
}
const WHOLE_PROJECT = "Entire project";
const scopeText = (r: any) => (r.BlockName ? `Block ${r.BlockName}` : WHOLE_PROJECT);
const issueDate = (r: any) => (r.Status === "Received" ? fmtDate(r.ReceivedDate) : null);
const dash = <span className="text-muted-foreground">—</span>;
const certificationText = (p: any) => (p.Received === 1 ? "Certified" : p.CoveredBlocks > 0 ? "Partly certified" : "Not certified");
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

type Money = { count: number; value: number; collected: number; balance: number };
const NO_MONEY: Money = { count: 0, value: 0, collected: 0, balance: 0 };
const addMoney = (m: Money, r: any): Money => ({ count: m.count + 1, value: m.value + Number(r.RequiredAmount || 0), collected: m.collected + Number(r.Collected || 0), balance: m.balance + Number(r.Balance || 0) });
const sumMoney = (rows: any[]) => rows.reduce(addMoney, NO_MONEY);
const moneyCell = (v: number, strong?: boolean) => (v > 0 ? <span className={cn("tabular-nums", strong && "font-semibold")} title={fmtRupees(v)}>{fmtShort(v)}</span> : dash);
const holdCell = (n: number) => (n > 0 ? <span className="tabular-nums font-semibold text-destructive">{n}</span> : dash);
const blocksCell = (p: any, blocks: any[]) => (p.ActiveBlocks > 0 ? (
  <span className="inline-flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
    <span className="flex w-20"><BlockBar blocks={blocks} /></span>
    <span><span className="font-medium text-foreground">{p.CoveredBlocks}</span> of {p.ActiveBlocks}</span>
  </span>
) : <span className="text-xs text-muted-foreground">Project level</span>);
const ageOf = (apps: any[]) => Math.max(0, ...apps.map((a) => daysSince(a.ApplicationDate) ?? 0));

/** One project on its own page: its blocks and every certificate, nothing folded away. */
function ProjectRecord({ project, blocks, certs, held, canCreate, canEdit, onBack, onAdd, onOpenCert, onIssue }: {
  project: any; blocks: any[]; certs: any[]; held: any[]; canCreate: boolean; canEdit: boolean; onBack: () => void; onAdd: (projectId: string, blockId?: string, status?: string) => void; onOpenCert: (r: any) => void; onIssue: (apps: any[]) => void;
}) {
  const uncovered = project.ActiveBlocks - project.CoveredBlocks;
  const money = sumMoney(held);
  const filed = certs.filter((r) => r.Status === "Applied");
  // A block's application: its own, or one filed for the entire project.
  const applicationFor = (b: any) => filed.find((r) => r.BlockId === b.BlockId) ?? filed.find((r) => r.BlockId == null);
  const keyCls = cn(GRID_SHEET_KEYS.KEY_LINE, "h-7 px-2.5");
  return (
    <div className="space-y-4">
      <MoneyBand eyebrow={CERTIFICATE_TERMS.PAGE} title={project.ProjectName} status={<span className="inline-flex items-center h-5 px-2 rounded-full border border-white/30 text-[0.6875rem] font-semibold text-white">{certificationText(project)}</span>}
        sub={project.Received === 1 && project.ReceivedDate ? `Certified since ${fmtDate(project.ReceivedDate)}` : "Certified once every active block holds an issued certificate."}
        actions={<>
          <button type="button" onClick={onBack} className={BAND_KEY}><ArrowLeft size={13} /> All projects</button>
          {canCreate && <button type="button" onClick={() => onAdd(String(project.ProjectId), undefined, "Received")} className={BAND_KEY_MAIN}><Plus size={13} /> Record Certificate</button>}
        </>}
        lead={`${project.CoveredBlocks} of ${project.ActiveBlocks}`} leadNote="blocks certified"
        bar={blocks.length ? <BlockBar blocks={blocks} onDark /> : <span className="block h-2.5 rounded-full bg-white/15" />}
        figures={[
          { label: "Blocks certified", dot: BAND_DOT.collected, value: String(project.CoveredBlocks), note: `of ${project.ActiveBlocks} active` },
          { label: "Not certified", dot: uncovered > 0 ? BAND_DOT.overdue : undefined, value: String(uncovered), note: uncovered > 0 ? "Still need a certificate" : "None", alert: uncovered > 0 },
          { label: "Bookings on hold", dot: project.WaitingBookings > 0 ? BAND_DOT.overdue : undefined, value: String(project.WaitingBookings), note: `of ${project.LiveBookings} active`, alert: project.WaitingBookings > 0 },
          { label: "Balance due on hold", value: fmtShort(money.balance), exact: fmtRupees(money.balance), note: `of ${fmtShort(money.value)} booking value` },
        ]} />
      <GridRelated icon={Building2} title="Blocks" count={blocks.length}>
        <GridMiniTable rows={blocks} rowKey={(b: any) => b.BlockId} empty="No blocks: the certificate for the entire project applies." cols={[
          { header: "Block", cell: (b: any) => <span className="font-medium">{b.BlockName}</span> },
          { header: "Certified by", cell: (b: any) => (b.Covered === 1 ? <span>{CERT_TYPE_LABEL[b.CertType] ?? "Certificate"} <span className="text-muted-foreground">({b.Source === "block" ? "this block" : "entire project"})</span></span> : applicationFor(b) ? <span>{CERT_STATUS_LABEL.Applied} <span className="text-muted-foreground tabular-nums">· {plural(ageOf([applicationFor(b)]), "day")}</span></span> : <span className="text-destructive">Not certified</span>) },
          { header: "Certificate number", cell: (b: any) => <span className="tabular-nums">{b.CertificateNo || "—"}</span> },
          { header: "Date of issue", cell: (b: any) => <span className="tabular-nums">{fmtDate(b.CoveredDate) || "—"}</span> },
          { header: "Active bookings", align: "right", cell: (b: any) => <span className="tabular-nums">{b.LiveBookings}</span> },
          { header: "Actions", cell: (b: any) => {
            if (b.Covered === 1) return null;
            const app = applicationFor(b);
            if (app) return canEdit ? <button type="button" onClick={() => onIssue([app])} className={keyCls}><BadgeCheck size={12} /> Mark as Issued</button> : null;
            return canCreate ? <button type="button" onClick={() => onAdd(String(project.ProjectId), String(b.BlockId))} className={keyCls}><FilePlus2 size={12} /> File Application</button> : null;
          } },
        ]} />
      </GridRelated>
      <GridRelated icon={ShieldCheck} title="Certificates" count={certs.length}>
        <GridMiniTable rows={certs} rowKey={(r: any) => r.Id} empty="No certificate recorded for this project." cols={[
          { header: "Scope", cell: (r: any) => <span className="font-medium">{scopeText(r)}</span> },
          { header: "Certificate", cell: (r: any) => CERT_TYPE_LABEL[r.CertType] ?? r.CertType },
          { header: "Certificate number", cell: (r: any) => <span className="tabular-nums">{r.CertificateNo || "—"}</span> },
          { header: "Issuing authority", cell: (r: any) => <span className="text-muted-foreground">{r.IssuedBy || "—"}</span> },
          { header: "Application date", cell: (r: any) => <span className="tabular-nums">{fmtDate(r.ApplicationDate) || "—"}</span> },
          { header: "Date of issue", cell: (r: any) => <span className="tabular-nums">{issueDate(r) || "—"}</span> },
          { header: "Status", cell: (r: any) => <GridToneMark text={CERT_STATUS_LABEL[r.Status] ?? r.Status} tone={r.Status === "Received" ? "done" : "waiting"} /> },
          { header: "Actions", cell: (r: any) => (
            <span className="inline-flex gap-2">
              {r.Status === "Applied" && canEdit && <button type="button" onClick={() => onIssue([r])} className={keyCls}><BadgeCheck size={12} /> Mark as Issued</button>}
              <button type="button" onClick={() => onOpenCert(r)} className={keyCls}>Open</button>
            </span>
          ) },
        ]} />
      </GridRelated>
      <GridRelated icon={Users} title="Bookings on hold" count={held.length}>
        <GridMiniTable rows={held} rowKey={(r: any) => r.BookingId} empty="No booking is on hold for this project." cols={[
          { header: "Customer", cell: (r: any) => <Link to={`/crm/bookings?view=${r.BookingId}`} className="font-medium capitalize hover:underline">{asName(r.ApplicantName)}</Link> },
          { header: "Booking", cell: (r: any) => <span className="tabular-nums text-muted-foreground">{r.BookingNo}</span> },
          { header: "Unit", cell: (r: any) => [r.BlockName, r.UnitNo].filter(Boolean).join(" / ") || "—" },
          { header: "Agreement", cell: (r: any) => <GridToneMark text={r.AgreementStatus || "Not started"} tone={r.AgreementStatus === "Registered" ? "done" : "waiting"} /> },
          { header: "Booking value", align: "right", cell: (r: any) => moneyCell(Number(r.RequiredAmount)) },
          { header: "Collected", align: "right", cell: (r: any) => moneyCell(Number(r.Collected)) },
          { header: "Balance due", align: "right", cell: (r: any) => moneyCell(Number(r.Balance), true) },
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

  const { data: rows = [], isError: rowsFailed, isFetching, refetch } = useQuery({ queryKey: ["crm-oc-cc"], queryFn: fetchAll, staleTime: 30_000 });
  const { data: projects = [] } = useQuery({ queryKey: ["unit-master-projects"], queryFn: fetchProjects, staleTime: 5 * 60_000 });
  const { data: board, isError: boardFailed } = useQuery({ queryKey: ["crm-oc-cc-board"], queryFn: fetchBoard, staleTime: 30_000 });
  const addFor = (projectId: string, blockId?: string, status = "Applied") => {
    setCreateForm({ ...EMPTY_FORM, ProjectId: projectId, BlockId: blockId ?? "", Scope: blockId ? "block" : "project", Status: status });
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

  const formOf = (row: any): OcForm => ({
    ProjectId: String(row.ProjectId), BlockId: row.BlockId != null ? String(row.BlockId) : "", Scope: row.BlockId != null ? "block" : "project",
    CertType: row.CertType, Status: row.Status,
    ApplicationDate: row.ApplicationDate ? String(row.ApplicationDate).slice(0, 10) : "",
    ReceivedDate: row.ReceivedDate ? String(row.ReceivedDate).slice(0, 10) : "",
    CertificateNo: row.CertificateNo || "", IssuedBy: row.IssuedBy || "", Remarks: row.Remarks || "",
  });
  const openDetail = (row: any) => { setDetailRow(row); setEditLocked(true); setEditForm(formOf(row)); };
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
      toast.success(createForm.Status === "Received" ? `Certificate recorded. Bookings in this ${createForm.BlockId ? "block" : "project"} are cleared for the Pre-Possession check.` : "Application recorded");
      setCreateOpen(false);
      setCreateForm({ ...EMPTY_FORM });
      refresh();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const putCertificate = async (id: number, f: OcForm) => {
    const res = await fetchWithAuth(`${API}/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        CertType: f.CertType || undefined, Status: f.Status || undefined,
        ApplicationDate: f.ApplicationDate || undefined, ReceivedDate: f.ReceivedDate || undefined,
        CertificateNo: f.CertificateNo, IssuedBy: f.IssuedBy, Remarks: f.Remarks,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Could not save the certificate.");
  };
  const handleUpdate = async () => {
    if (!detailRow) return;
    const problem = checkForm(editForm, false);
    if (problem) return void toast.error(problem);
    setUpdating(true);
    try {
      await putCertificate(detailRow.Id, editForm);
      toast.success("Certificate saved");
      closeDetail();
      refresh();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setUpdating(false);
    }
  };

  // Mark as Issued: only what the authority's certificate adds. Several applications on a project: pick which.
  const [issueApps, setIssueApps] = useState<any[] | null>(null);
  const [issueId, setIssueId] = useState<number | null>(null);
  const [issueForm, setIssueForm] = useState<OcForm>({ ...EMPTY_FORM });
  const pickIssue = (r: any) => { setIssueId(r.Id); setIssueForm({ ...formOf(r), Status: "Received", ReceivedDate: "" }); };
  const openIssue = (apps: any[]) => { setIssueApps(apps); pickIssue(apps[0]); };
  const closeIssue = () => setIssueApps(null);
  const setIssue = (k: keyof OcForm, v: string) => setIssueForm((f) => ({ ...f, [k]: v }));
  const handleIssue = async () => {
    if (issueId == null) return;
    const problem = checkForm(issueForm, false);
    if (problem) return void toast.error(problem);
    setUpdating(true);
    try {
      await putCertificate(issueId, issueForm);
      toast.success(`Marked as issued. Bookings in this ${issueForm.BlockId ? "block" : "project"} are cleared for the Pre-Possession check.`);
      closeIssue();
      refresh();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setUpdating(false);
    }
  };

  const [sp, setSp] = useSearchParams();
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState(false);
  const openId = sp.get("open");
  const openProject = (id: number) => setSp((p) => { p.set("open", String(id)); return p; });
  const closeProject = () => setSp((p) => { p.delete("open"); return p; });

  const blocksBy = useMemo(() => {
    const m: Record<number, any[]> = {};
    for (const b of board?.blocks ?? []) (m[b.ProjectId] ||= []).push(b);
    return m;
  }, [board]);
  // Applications still with the authority, per project.
  const appsBy = useMemo(() => {
    const m: Record<number, any[]> = {};
    for (const r of rows as any[]) if (r.Status === "Applied") (m[r.ProjectId] ||= []).push(r);
    return m;
  }, [rows]);
  const allHeld = board?.held ?? [];
  const heldBy = useMemo(() => {
    const m: Record<number, any[]> = {};
    for (const r of allHeld) (m[r.ProjectId] ||= []).push(r);
    return m;
  }, [allHeld]);
  const moneyOf = (p: any) => sumMoney(heldBy[p.ProjectId] ?? []);
  const allProjects = board?.projects ?? [];
  const q = search.trim().toLowerCase();
  // Every project, under what must happen next; within each, the most money held first.
  const groups = useMemo(() => {
    const seen = [...allProjects].filter((p) => !q || String(p.ProjectName).toLowerCase().includes(q))
      .sort((a, b) => sumMoney(heldBy[b.ProjectId] ?? []).balance - sumMoney(heldBy[a.ProjectId] ?? []).balance || (b.WaitingBookings || 0) - (a.WaitingBookings || 0) || String(a.ProjectName).localeCompare(String(b.ProjectName)));
    const certified = seen.filter((p) => p.Received === 1);
    const follow = seen.filter((p) => p.Received !== 1 && appsBy[p.ProjectId]);
    const file = seen.filter((p) => p.Received !== 1 && !appsBy[p.ProjectId]);
    return { file, follow, certified, all: seen };
  }, [allProjects, q, heldBy, appsBy]);
  const certified = allProjects.filter((p) => p.Received === 1).length;
  const heldMoney = sumMoney(allHeld);
  // Over-collected bookings: without this, collected + balance would not add up to the booking value.
  const excess = heldMoney.collected + heldMoney.balance - heldMoney.value;
  const projectExportCols: GridCol<any>[] = [
    { id: "project", label: "Project", csv: (p) => p.ProjectName, cell: () => null },
    { id: "status", label: "Certification", csv: certificationText, cell: () => null },
    { id: "blocks", label: "Blocks certified", csv: (p) => `${p.CoveredBlocks} of ${p.ActiveBlocks}`, cell: () => null },
    { id: "apps", label: "Applications filed", csv: (p) => appsBy[p.ProjectId]?.length ?? 0, cell: () => null },
    { id: "hold", label: "Bookings on hold", csv: (p) => p.WaitingBookings, cell: () => null },
    { id: "value", label: "Booking value on hold", csv: (p) => moneyOf(p).value, cell: () => null },
    { id: "collected", label: "Collected", csv: (p) => moneyOf(p).collected, cell: () => null },
    { id: "balance", label: "Balance due", csv: (p) => moneyOf(p).balance, cell: () => null },
  ];
  const handleExport = () => {
    setExporting(true);
    try { exportGrid(groups.all, projectExportCols, "certificates-by-project"); }
    catch (e: any) { toast.error(translateError(e.message)); }
    finally { setExporting(false); }
  };
  const projectCell = (p: any) => <button type="button" onClick={() => openProject(p.ProjectId)} className="font-semibold text-foreground hover:underline text-left">{p.ProjectName}</button>;
  const keyCls = cn(GRID_SHEET_KEYS.KEY_LINE, "h-7 px-2.5");
  const moneyCols = [
    { header: "Bookings on hold", align: "right" as const, cell: (p: any) => holdCell(p.WaitingBookings) },
    { header: "Booking value", align: "right" as const, cell: (p: any) => moneyCell(moneyOf(p).value) },
    { header: "Balance due", align: "right" as const, cell: (p: any) => moneyCell(moneyOf(p).balance, true) },
  ];
  const groupNote = (projects: any[]) => {
    const balance = projects.reduce((t, p) => t + moneyOf(p).balance, 0);
    return balance > 0 ? <span className="text-xs text-muted-foreground tabular-nums" title={fmtRupees(balance)}><span className="font-semibold text-foreground">{fmtShort(balance)}</span> balance due on hold</span> : undefined;
  };
  const refreshAll = () => { refetch(); qc.invalidateQueries({ queryKey: ["crm-oc-cc-board"] }); };
  const openP = openId ? allProjects.find((p) => String(p.ProjectId) === openId) : null;

  return (
    <div className="space-y-4">
      <Breadcrumbs items={["Dashboard", "CRM", CERTIFICATE_TERMS.PAGE]} />
      {openId ? (
        openP ? <ProjectRecord project={openP} blocks={blocksBy[openP.ProjectId] || []} certs={(rows as any[]).filter((r) => r.ProjectId === openP.ProjectId)} held={heldBy[openP.ProjectId] ?? []} canCreate={canCreate} canEdit={canEdit} onBack={closeProject} onAdd={addFor} onOpenCert={openDetail} onIssue={openIssue} />
          : <div className={cn(GRID_CARD, "px-4 py-10 text-center text-sm text-muted-foreground")}>{board ? "Project not found." : "Loading…"}</div>
      ) : (
      <>
      <MoneyBand eyebrow="CRM · Possession" title={CERTIFICATE_TERMS.PAGE} sub="Bookings in a project or block without an issued certificate cannot proceed to possession."
        actions={<>
          {canCreate && <button type="button" onClick={() => { setCreateForm({ ...EMPTY_FORM, Status: "Received" }); setCreateOpen(true); }} className={BAND_KEY_MAIN}><Plus size={13} /> Record Certificate</button>}
          <button type="button" onClick={refreshAll} disabled={isFetching} className={cn(BAND_KEY, "w-9 !px-0")} title="Refresh" aria-label="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
        </>}
        lead={fmtShort(heldMoney.value)} leadNote={`booking value on hold across ${plural(heldMoney.count, "booking")}`}
        bar={<CollectionBar onDark due={heldMoney.value} collected={heldMoney.collected} finance={0} recorded={0} title={`${fmtRupees(heldMoney.collected)} collected of ${fmtRupees(heldMoney.value)}`} />}
        figures={[
          { label: "Collected", dot: BAND_DOT.collected, value: fmtShort(heldMoney.collected), exact: fmtRupees(heldMoney.collected), note: excess > 0.009 ? `Includes ${fmtShort(excess)} above booking value` : "On bookings on hold" },
          { label: "Balance due", dot: heldMoney.balance > 0 ? BAND_DOT.overdue : undefined, value: fmtShort(heldMoney.balance), exact: fmtRupees(heldMoney.balance), note: "On bookings on hold" },
          { label: "Projects certified", dot: BAND_DOT.notDue, value: `${certified} of ${allProjects.length}`, note: `${plural(stats.received, "certificate")} issued` },
          { label: "Applications filed", dot: BAND_DOT.finance, value: String(stats.applied), note: stats.overdue ? `${stats.overdue} pending over ${OVERDUE_DAYS} days` : `None pending over ${OVERDUE_DAYS} days`, alert: stats.overdue > 0 },
        ]} />
      <div className={cn(GRID_CARD, "px-3 py-2 flex flex-wrap items-center gap-2")}>
        <GridSearch value={search} onChange={setSearch} placeholder="Project" />
        <button type="button" onClick={handleExport} disabled={exporting} className={cn(GRID_BTN, "ml-auto")} title="Export to Excel"><Download size={13} /> <span className="hidden md:inline">Export</span></button>
      </div>
      {boardFailed || rowsFailed ? (
        <div className={cn(GRID_CARD, "px-4 py-10 text-center text-sm")}>
          <p className="text-destructive">Could not load the certificates.</p>
          <button type="button" onClick={refreshAll} className={cn(GRID_BTN, "mt-3")}>Retry</button>
        </div>
      ) : board ? (
        <>
          <GridRelated icon={FilePlus2} title="File application" count={groups.file.length} action={groupNote(groups.file)}>
            <GridMiniTable rows={groups.file} rowKey={(p: any) => p.ProjectId} empty="Every uncertified project has an application filed." cols={[
              { header: "Project", cell: projectCell },
              { header: "Blocks certified", cell: (p: any) => blocksCell(p, blocksBy[p.ProjectId] || []) },
              ...moneyCols,
              { header: "Actions", cell: (p: any) => (canCreate ? <button type="button" onClick={() => addFor(String(p.ProjectId))} className={keyCls}><FilePlus2 size={12} /> File Application</button> : null) },
            ]} />
          </GridRelated>
          <GridRelated icon={Clock3} title="Follow up with authority" count={groups.follow.length} action={groupNote(groups.follow)}>
            <GridMiniTable rows={groups.follow} rowKey={(p: any) => p.ProjectId} empty="No application is pending with an authority." cols={[
              { header: "Project", cell: projectCell },
              { header: "Applications", cell: (p: any) => { const apps = appsBy[p.ProjectId], age = ageOf(apps); return <span className="tabular-nums">{apps.length} filed <span className={cn(age > OVERDUE_DAYS ? "font-semibold text-destructive" : "text-muted-foreground")}>· oldest {plural(age, "day")}</span></span>; } },
              { header: "Blocks certified", cell: (p: any) => blocksCell(p, blocksBy[p.ProjectId] || []) },
              ...moneyCols,
              { header: "Actions", cell: (p: any) => (canEdit ? <button type="button" onClick={() => openIssue(appsBy[p.ProjectId])} className={keyCls}><BadgeCheck size={12} /> Mark as Issued</button> : null) },
            ]} />
          </GridRelated>
          <GridRelated icon={ShieldCheck} title="Certified" count={groups.certified.length}>
            <GridMiniTable rows={groups.certified} rowKey={(p: any) => p.ProjectId} empty="No project is certified yet." cols={[
              { header: "Project", cell: projectCell },
              { header: "Blocks certified", cell: (p: any) => blocksCell(p, blocksBy[p.ProjectId] || []) },
              { header: "Certified since", cell: (p: any) => <span className="tabular-nums">{fmtDate(p.ReceivedDate) || "—"}</span> },
              { header: "Active bookings", align: "right", cell: (p: any) => <span className="tabular-nums">{p.LiveBookings}</span> },
            ]} />
          </GridRelated>
        </>
      ) : <div className={cn(GRID_CARD, "px-4 py-10 text-center text-sm text-muted-foreground")}>Loading…</div>}
      </>
      )}

      {detailRow && (
        <GridDialog onClose={closeDetail} icon={ShieldCheck}
          title={editLocked ? (CERT_TYPE_LABEL[detailRow.CertType] ?? detailRow.CertType) : `Edit ${CERT_TYPE_LABEL[detailRow.CertType] ?? detailRow.CertType}`}
          description={`${detailRow.ProjectName} · ${scopeText(detailRow)}`}
          footer={editLocked ? (
            <>
              {canEdit && <button onClick={() => setEditLocked(false)} className={GRID_BTN}><PenSquare size={13} /> Edit</button>}
              {canEdit && detailRow.Status === "Applied" && <button onClick={() => { const r = detailRow; closeDetail(); openIssue([r]); }} className={GRID_BTN_BRAND}><BadgeCheck size={13} /> Mark as Issued</button>}
            </>
          ) : (
            <>
              <button onClick={() => openDetail(detailRow)} className={GRID_BTN}>Cancel</button>
              <button onClick={handleUpdate} disabled={updating} className={GRID_BTN_BRAND}>{updating ? "Saving…" : "Save Changes"}</button>
            </>
          )}>
          <div className={cn(NOTE, "flex-wrap items-center")}>
            <GridToneMark text={CERT_STATUS_LABEL[detailRow.Status] ?? detailRow.Status} tone={detailRow.Status === "Received" ? "done" : "waiting"} />
            <span className="font-medium">{possessionText(detailRow.Status === "Received")}</span>
            {(detailRow.BookingCount ?? 0) > 0 && (
              <span className="text-muted-foreground tabular-nums">
                {plural(detailRow.BookingCount, "active booking")} {detailRow.BlockName ? "in this block" : "in this project"}.
                {(detailRow.BookingsAwaitingPossession ?? 0) > 0 && (detailRow.Status === "Received"
                  ? ` ${detailRow.BookingsAwaitingPossession} can go on to the Pre-Possession check.`
                  : ` ${detailRow.BookingsAwaitingPossession} on hold at Pre-Possession until this is issued.`)}
              </span>
            )}
          </div>
          {editLocked ? (
            <div className="-mx-4 -my-2">
              <GridFields fields={[
                { label: "Application date", value: fmtDate(detailRow.ApplicationDate) || "—" },
                { label: "Date of issue", value: issueDate(detailRow) || "—" },
                { label: "Certificate number", value: detailRow.CertificateNo || "—" },
                { label: "Issuing authority", value: detailRow.IssuedBy || "—" },
                { label: "Remarks", value: detailRow.Remarks || "—", wide: true },
                { label: "Recorded by", value: detailRow.CreatedByName || "—" },
                { label: "Last changed by", value: detailRow.UpdatedByName || "—" },
              ]} />
            </div>
          ) : (
            <OcccForm form={editForm} setForm={setEditForm} projects={[]} showProject={false} />
          )}
        </GridDialog>
      )}

      {createOpen && (
        <GridDialog onClose={() => { setCreateOpen(false); setCreateForm({ ...EMPTY_FORM }); }}
          icon={createForm.Status === "Received" ? BadgeCheck : FilePlus2}
          title={createForm.Status === "Received" ? "Record Certificate" : "File Application"}
          description={createForm.Status === "Received" ? `Record an ${CERTIFICATE_TERMS.ONE} issued by the competent authority.` : `Record an application filed with the competent authority for an ${CERTIFICATE_TERMS.ONE}.`}
          footer={<>
            <button onClick={() => { setCreateOpen(false); setCreateForm({ ...EMPTY_FORM }); }} className={GRID_BTN}>Cancel</button>
            <button onClick={handleCreate} disabled={saving || !createForm.ProjectId} className={GRID_BTN_BRAND}>{saving ? "Saving…" : createForm.Status === "Received" ? "Record Certificate" : "File Application"}</button>
          </>}>
          <OcccForm form={createForm} setForm={setCreateForm} projects={projects as any[]} showProject />
        </GridDialog>
      )}

      {issueApps && (
        <GridDialog onClose={closeIssue} icon={BadgeCheck} width="max-w-2xl" title="Mark as Issued"
          description={issueApps.length > 1 ? `${issueApps[0].ProjectName}: choose the application the authority has issued.` : `${issueApps[0].ProjectName} · ${scopeText(issueApps[0])} · ${CERT_TYPE_LABEL[issueApps[0].CertType] ?? issueApps[0].CertType}`}
          footer={<>
            <button onClick={closeIssue} className={GRID_BTN}>Cancel</button>
            <button onClick={handleIssue} disabled={updating} className={GRID_BTN_BRAND}>{updating ? "Saving…" : "Mark as Issued"}</button>
          </>}>
          <GridFormSection title="Certificate details">
            {issueApps.length > 1 && (
              <GridFormField label="Application" required wide>
                <select value={issueId ?? ""} onChange={(e) => { const r = issueApps.find((a) => String(a.Id) === e.target.value); if (r) pickIssue(r); }} className={GRID_INPUT}>
                  {issueApps.map((a) => <option key={a.Id} value={a.Id}>{scopeText(a)}: {CERT_TYPE_LABEL[a.CertType] ?? a.CertType}</option>)}
                </select>
              </GridFormField>
            )}
            <GridFormField label="Date of issue" required>
              <DateInput value={issueForm.ReceivedDate} onChange={(e) => setIssue("ReceivedDate", e.target.value)} className={GRID_INPUT} />
            </GridFormField>
            <GridFormField label="Certificate number" required>
              <input type="text" value={issueForm.CertificateNo} placeholder="As printed on the certificate" onChange={(e) => setIssue("CertificateNo", e.target.value)} className={cn(GRID_INPUT, "tabular-nums")} />
            </GridFormField>
            <GridFormField label="Issuing authority" wide>
              <input type="text" value={issueForm.IssuedBy} placeholder="e.g. Municipal Corporation, Development Authority" onChange={(e) => setIssue("IssuedBy", e.target.value)} className={GRID_INPUT} />
            </GridFormField>
          </GridFormSection>
          <p className={NOTE}>
            <ShieldCheck size={13} className="mt-0.5 shrink-0" /> Once saved, {issueForm.BlockId ? "the bookings in this block are" : "every booking in this project is"} cleared for the Pre-Possession check.
          </p>
        </GridDialog>
      )}
    </div>
  );
};

export default CrmOcCc;
