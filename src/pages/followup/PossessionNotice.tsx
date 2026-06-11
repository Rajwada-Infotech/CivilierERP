import { useMemo, useState, useRef, useEffect, type ReactNode } from "react";
import { filterProjectsByCompany } from "@/lib/projectBelongsTo";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  RefreshCw,
  Search,
  X,
  Home,
  ChevronDown,
  Pencil,
  Trash2,
  CheckCircle2,
  Clock,
  AlertCircle,
  Ban,
  MoreHorizontal,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Send,
  Bell,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

// ─── Types ────────────────────────────────────────────────────────────────────

type NoticeType = "30-day" | "60-day" | "Final";
type PNStatus   = "Sent" | "Acknowledged" | "Overdue" | "Cancelled";

interface PossessionNotice {
  Id: number;
  NoticeNo: string;
  ApplicantId: number;
  ApplicantNo: string;
  ApplicantName: string;
  UnitSelectionId: number | null;
  SelectionNo: string | null;
  UnitNo: string | null;
  HandoverId: number | null;
  PrePossessionId: number | null;
  ProjectId: number | null;
  ProjectName: string | null;
  CompanyId: number | null;
  CompanyName: string | null;
  NoticeDate: string | null;
  NoticeType: NoticeType;
  ScheduledPossDate: string | null;
  ActualPossDate: string | null;
  SentVia: string | null;
  AcknowledgedDate: string | null;
  AcknowledgedBy: string | null;
  Status: PNStatus;
  Notes: string | null;
  CreatedBy: string;
  CreatedAt: string;
}

interface OptionApplicant { Id: number; ApplicantNo: string | null; ApplicantName: string; }
interface OptionUnitSelection { Id: number; SelectionNo: string; UnitNo: string; ApplicantId: number; ProjectId: number | null; CompanyId: number | null; }
interface OptionHandover { Id: number; HandoverNo: string; ApplicantId: number; }
interface OptionPrePossession { Id: number; ClearanceNo: string; ApplicantId: number; }
interface OptionProject { Id: number; Name: string; }
interface OptionCompany { Id: number; Name: string; }

interface MetaOptions {
  applicants: OptionApplicant[];
  unitSelections: OptionUnitSelection[];
  handovers: OptionHandover[];
  prePossessions: OptionPrePossession[];
  projects: OptionProject[];
  companies: OptionCompany[];
  noticeTypeOptions: NoticeType[];
  statusOptions: PNStatus[];
}

interface FormState {
  ApplicantId: string;
  UnitSelectionId: string;
  HandoverId: string;
  PrePossessionId: string;
  ProjectId: string;
  CompanyId: string;
  NoticeDate: string;
  NoticeType: NoticeType;
  ScheduledPossDate: string;
  ActualPossDate: string;
  SentVia: string;
  AcknowledgedDate: string;
  AcknowledgedBy: string;
  Status: PNStatus;
  Notes: string;
}

const EMPTY_FORM: FormState = {
  ApplicantId: "",
  UnitSelectionId: "",
  HandoverId: "",
  PrePossessionId: "",
  ProjectId: "",
  CompanyId: "",
  NoticeDate: new Date().toISOString().slice(0, 10),
  NoticeType: "30-day",
  ScheduledPossDate: "",
  ActualPossDate: "",
  SentVia: "",
  AcknowledgedDate: "",
  AcknowledgedBy: "",
  Status: "Sent",
  Notes: "",
};

const SENT_VIA_OPTIONS = ["Email", "WhatsApp", "Courier", "Hand Delivery"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

function avatarColor(name: string): string {
  const colors = ["#2563eb","#7c3aed","#0891b2","#059669","#d97706","#dc2626","#db2777","#65a30d"];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return colors[Math.abs(h) % colors.length];
}

function initials(name: string): string {
  return name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

/** Calculate days remaining to ScheduledPossDate (negative = overdue) */
function daysRemaining(scheduledDate: string | null): number | null {
  if (!scheduledDate) return null;
  const diff = new Date(scheduledDate).getTime() - new Date().setHours(0, 0, 0, 0);
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_META: Record<PNStatus, { label: string; icon: ReactNode; cls: string }> = {
  Sent:         { label: "Sent",         icon: <Send size={11} />,         cls: "pn-badge-sent" },
  Acknowledged: { label: "Acknowledged", icon: <CheckCircle2 size={11} />, cls: "pn-badge-acknowledged" },
  Overdue:      { label: "Overdue",      icon: <AlertCircle size={11} />,  cls: "pn-badge-overdue" },
  Cancelled:    { label: "Cancelled",    icon: <Ban size={11} />,          cls: "pn-badge-cancelled" },
};

const NOTICE_TYPE_META: Record<NoticeType, string> = {
  "30-day": "pn-type-30",
  "60-day": "pn-type-60",
  "Final":  "pn-type-final",
};

// ─── API ──────────────────────────────────────────────────────────────────────

async function fetchMeta(): Promise<MetaOptions> {
  const res = await fetchWithAuth("/api/followup-possession-notice/meta/options");
  if (!res.ok) throw new Error("Failed to load options");
  return res.json();
}

async function fetchPNs(params: { page: number; pageSize: number; search: string; status: string; noticeType: string }) {
  const q = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
    ...(params.search ? { search: params.search } : {}),
    ...(params.status ? { status: params.status } : {}),
    ...(params.noticeType ? { noticeType: params.noticeType } : {}),
  });
  const res = await fetchWithAuth(`/api/followup-possession-notice?${q}`);
  if (!res.ok) throw new Error("Failed to load Possession Notices");
  return res.json() as Promise<{ data: PossessionNotice[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } }>;
}

async function createPN(payload: Record<string, unknown>) {
  const res = await fetchWithAuth("/api/followup-possession-notice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || "Failed to create Possession Notice");
  }
}

async function updatePN(id: number, payload: Record<string, unknown>) {
  const res = await fetchWithAuth(`/api/followup-possession-notice/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || "Failed to update Possession Notice");
  }
}

async function deletePN(id: number) {
  const res = await fetchWithAuth(`/api/followup-possession-notice/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete Possession Notice");
}

// ─── Combobox ─────────────────────────────────────────────────────────────────

interface ComboItem { value: string; label: string; sub?: string; }

function Combobox({ value, onChange, items, placeholder, disabled }: {
  value: string; onChange: (v: string) => void;
  items: ComboItem[]; placeholder: string; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const selected = items.find((i) => i.value === value);
  const filtered = useMemo(() => {
    if (!q) return items;
    const lq = q.toLowerCase();
    return items.filter((i) => i.label.toLowerCase().includes(lq) || (i.sub ?? "").toLowerCase().includes(lq));
  }, [items, q]);

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  return (
    <div className="pn-combo" ref={ref}>
      <button
        type="button"
        className={`pn-combo-trigger${open ? " open" : ""}${!value ? " empty" : ""}${disabled ? " disabled" : ""}`}
        onClick={() => { if (!disabled) { setOpen((v) => !v); setQ(""); } }}
      >
        <span className="pn-combo-left">
          {selected ? <span className="pn-combo-val">{selected.label}</span> : <span className="pn-combo-placeholder">{placeholder}</span>}
        </span>
        <span style={{ display:"flex", alignItems:"center", gap:4 }}>
          {value && !disabled && (
            <span className="pn-combo-clear" onClick={(e) => { e.stopPropagation(); onChange(""); setOpen(false); }}><X size={12} /></span>
          )}
          <ChevronDown size={13} className={`pn-combo-chevron${open ? " open" : ""}`} />
        </span>
      </button>
      {open && (
        <div className="pn-combo-drop">
          <div className="pn-combo-search-wrap">
            <Search size={13} />
            <input className="pn-combo-search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          </div>
          <div className="pn-combo-list">
            {filtered.length === 0
              ? <div className="pn-combo-empty">No results</div>
              : filtered.map((item) => (
                <button key={item.value} type="button"
                  className={`pn-combo-item${value === item.value ? " selected" : ""}`}
                  onClick={() => { onChange(item.value); setOpen(false); setQ(""); }}
                >
                  <span className="pn-combo-item-label">{item.label}</span>
                  {item.sub && <span className="pn-combo-item-sub">{item.sub}</span>}
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Days Remaining Badge ─────────────────────────────────────────────────────

function DaysRemainingBadge({ record }: { record: PossessionNotice }) {
  if (record.Status === "Acknowledged" || record.Status === "Cancelled") return null;
  const days = daysRemaining(record.ScheduledPossDate);
  if (days === null) return <span className="pn-date-sub">No date set</span>;
  if (days < 0)  return <span className="pn-days-badge overdue">{Math.abs(days)}d overdue</span>;
  if (days === 0) return <span className="pn-days-badge today">Today</span>;
  if (days <= 7)  return <span className="pn-days-badge urgent">{days}d left</span>;
  return <span className="pn-days-badge normal">{days}d remaining</span>;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function PossessionNoticePage() {
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  const canDeleteRecords = currentUser?.role !== "engineer";

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<PNStatus | "">("");
  const [typeFilter, setTypeFilter] = useState<NoticeType | "">("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);

  const { data: meta } = useQuery({
    queryKey: ["pn-meta"],
    queryFn: fetchMeta,
    staleTime: 5 * 60 * 1000,
  });

  const { data: result, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["possession-notices", page, search, statusFilter, typeFilter],
    queryFn: () => fetchPNs({ page, pageSize: PAGE_SIZE, search, status: statusFilter, noticeType: typeFilter }),
    placeholderData: (prev) => prev,
  });

  const records = result?.data ?? [];
  const pagination = result?.pagination;

  const stats = useMemo(() => ({
    total:         pagination?.total ?? 0,
    sent:          records.filter((r) => r.Status === "Sent").length,
    acknowledged:  records.filter((r) => r.Status === "Acknowledged").length,
    overdue:       records.filter((r) => {
      if (r.Status === "Acknowledged" || r.Status === "Cancelled") return false;
      const days = daysRemaining(r.ScheduledPossDate);
      return days !== null && days < 0;
    }).length,
  }), [records, pagination]);

  // Combobox items
  const applicantItems: ComboItem[] = useMemo(() =>
    (meta?.applicants ?? []).map((a) => ({ value: String(a.Id), label: a.ApplicantName, sub: a.ApplicantNo ?? undefined })), [meta]);

  const unitItems: ComboItem[] = useMemo(() => {
    const all = meta?.unitSelections ?? [];
    const filtered = form.ApplicantId ? all.filter((u) => String(u.ApplicantId) === form.ApplicantId) : all;
    return filtered.map((u) => ({ value: String(u.Id), label: u.UnitNo, sub: u.SelectionNo }));
  }, [meta, form.ApplicantId]);

  const handoverItems: ComboItem[] = useMemo(() => {
    const all = meta?.handovers ?? [];
    const filtered = form.ApplicantId ? all.filter((h) => String(h.ApplicantId) === form.ApplicantId) : all;
    return filtered.map((h) => ({ value: String(h.Id), label: h.HandoverNo }));
  }, [meta, form.ApplicantId]);

  const prePossessionItems: ComboItem[] = useMemo(() => {
    const all = meta?.prePossessions ?? [];
    const filtered = form.ApplicantId ? all.filter((p) => String(p.ApplicantId) === form.ApplicantId) : all;
    return filtered.map((p) => ({ value: String(p.Id), label: p.ClearanceNo }));
  }, [meta, form.ApplicantId]);

  const projectItems: ComboItem[] = useMemo(() =>
    filterProjectsByCompany((meta?.projects ?? []) as any[], form.CompanyId).map((p: any) => ({ value: String(p.Id), label: p.Name })), [meta]);

  const companyItems: ComboItem[] = useMemo(() =>
    (meta?.companies ?? []).map((c) => ({ value: String(c.Id), label: c.Name })), [meta]);

  function set(k: keyof FormState, v: string) {
    setForm((f) => {
      const next = { ...f, [k]: v };
      if (k === "ApplicantId") { next.UnitSelectionId = ""; next.HandoverId = ""; next.PrePossessionId = ""; }
      if (k === "UnitSelectionId") {
        const us = meta?.unitSelections.find((u) => String(u.Id) === v);
        if (us) {
          if (us.ProjectId) next.ProjectId = String(us.ProjectId);
          if (us.CompanyId) next.CompanyId = String(us.CompanyId);
        }
      }
      return next;
    });
  }

  function openCreate() { setEditId(null); setForm(EMPTY_FORM); setDialogOpen(true); }

  function openEdit(r: PossessionNotice) {
    setEditId(r.Id);
    setForm({
      ApplicantId: String(r.ApplicantId),
      UnitSelectionId: r.UnitSelectionId ? String(r.UnitSelectionId) : "",
      HandoverId: r.HandoverId ? String(r.HandoverId) : "",
      PrePossessionId: r.PrePossessionId ? String(r.PrePossessionId) : "",
      ProjectId: r.ProjectId ? String(r.ProjectId) : "",
      CompanyId: r.CompanyId ? String(r.CompanyId) : "",
      NoticeDate: r.NoticeDate ?? "",
      NoticeType: r.NoticeType,
      ScheduledPossDate: r.ScheduledPossDate ?? "",
      ActualPossDate: r.ActualPossDate ?? "",
      SentVia: r.SentVia ?? "",
      AcknowledgedDate: r.AcknowledgedDate ?? "",
      AcknowledgedBy: r.AcknowledgedBy ?? "",
      Status: r.Status,
      Notes: r.Notes ?? "",
    });
    setDialogOpen(true);
  }

  function buildPayload() {
    return {
      ApplicantId: form.ApplicantId || null,
      UnitSelectionId: form.UnitSelectionId || null,
      HandoverId: form.HandoverId || null,
      PrePossessionId: form.PrePossessionId || null,
      ProjectId: form.ProjectId || null,
      CompanyId: form.CompanyId || null,
      NoticeDate: form.NoticeDate || null,
      NoticeType: form.NoticeType,
      ScheduledPossDate: form.ScheduledPossDate || null,
      ActualPossDate: form.ActualPossDate || null,
      SentVia: form.SentVia || null,
      AcknowledgedDate: form.AcknowledgedDate || null,
      AcknowledgedBy: form.AcknowledgedBy || null,
      Status: form.Status,
      Notes: form.Notes || null,
    };
  }

  const invalidate = () => qc.invalidateQueries({ queryKey: ["possession-notices"] });

  const createMut = useMutation({
    mutationFn: () => createPN(buildPayload()),
    onSuccess: () => { toast.success("Possession Notice created"); invalidate(); setDialogOpen(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: () => updatePN(editId!, buildPayload()),
    onSuccess: () => { toast.success("Possession Notice updated"); invalidate(); setDialogOpen(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: () => deletePN(deleteId!),
    onSuccess: () => { toast.success("Possession Notice deleted"); invalidate(); setDeleteId(null); },
    onError: (e: Error) => toast.error(e.message),
  });

  const STATUS_FILTERS: Array<PNStatus | ""> = ["", "Sent", "Acknowledged", "Overdue", "Cancelled"];
  const STATUS_LABELS: Record<string, string> = { "":"All", Sent:"Sent", Acknowledged:"Acknowledged", Overdue:"Overdue", Cancelled:"Cancelled" };
  const TYPE_FILTERS: Array<NoticeType | ""> = ["", "30-day", "60-day", "Final"];
  const TYPE_LABELS: Record<string, string> = { "":"All Types", "30-day":"30-day", "60-day":"60-day", "Final":"Final" };

  const pageNums = useMemo(() => {
    if (!pagination) return [];
    const total = pagination.totalPages;
    const cur = pagination.page;
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    if (cur <= 4) return [1, 2, 3, 4, 5, "…", total];
    if (cur >= total - 3) return [1, "…", total - 4, total - 3, total - 2, total - 1, total];
    return [1, "…", cur - 1, cur, cur + 1, "…", total];
  }, [pagination]);

  const isSaving = createMut.isPending || updateMut.isPending;

  return (
    <>
      <style>{`
        .pn-page { font-family:'DM Sans','Segoe UI',sans-serif; color:hsl(var(--foreground)); }

        .pn-title-row { display:flex; align-items:center; gap:12px; }
        .pn-icon { width:40px; height:40px; background:hsl(var(--primary)); border-radius:12px; display:flex; align-items:center; justify-content:center; color:hsl(var(--primary-foreground)); flex-shrink:0; box-shadow:0 2px 8px hsl(var(--primary)/0.25); }
        .pn-title { font-size:20px; font-weight:700; color:hsl(var(--foreground)); }
        .pn-count { background:hsl(var(--primary)/0.1); color:hsl(var(--primary)); font-size:12px; font-weight:600; padding:2px 8px; border-radius:20px; }

        .pn-filter-bar { display:flex; align-items:center; gap:12px; padding:14px 0; flex-wrap:wrap; }
        .pn-search-wrap { flex:1; min-width:200px; max-width:380px; position:relative; }
        .pn-search-wrap svg { position:absolute; left:12px; top:50%; transform:translateY(-50%); color:hsl(var(--muted-foreground)); pointer-events:none; }
        .pn-search { width:100%; padding:8px 12px 8px 36px; border:1.5px solid hsl(var(--border)); border-radius:9px; font-size:13.5px; color:hsl(var(--foreground)); background:hsl(var(--card)); outline:none; transition:border-color 0.15s; font-family:inherit; box-sizing:border-box; }
        .pn-search:focus { border-color:hsl(var(--primary)); }
        .pn-search-clear { position:absolute; right:10px; top:50%; transform:translateY(-50%); background:none; border:none; cursor:pointer; color:hsl(var(--muted-foreground)); padding:2px; display:flex; border-radius:4px; }

        .pn-pills { display:flex; gap:6px; flex-wrap:wrap; }
        .pn-pill { padding:5px 12px; border-radius:20px; font-size:12px; font-weight:500; border:1.5px solid hsl(var(--border)); background:hsl(var(--card)); color:hsl(var(--muted-foreground)); cursor:pointer; transition:all 0.12s; font-family:inherit; white-space:nowrap; }
        .pn-pill:hover { border-color:hsl(var(--primary)); color:hsl(var(--primary)); }
        .pn-pill.active           { background:hsl(var(--primary)); border-color:hsl(var(--primary)); color:hsl(var(--primary-foreground)); }
        .pn-pill.active-sent       { background:hsl(var(--primary)/0.1); border-color:hsl(var(--primary)/0.4); color:hsl(var(--primary)); }
        .pn-pill.active-ack        { background:hsl(142 76% 36%/0.12); border-color:hsl(142 76% 36%/0.4); color:hsl(142 76% 36%); }
        .pn-pill.active-overdue    { background:hsl(0 84% 60%/0.12); border-color:hsl(0 84% 60%/0.4); color:hsl(0 84% 40%); }
        .pn-pill.active-cancelled  { background:hsl(var(--muted)); border-color:hsl(var(--border)); color:hsl(var(--muted-foreground)); }
        .pn-pill.active-30         { background:hsl(38 92% 50%/0.12); border-color:hsl(38 92% 50%/0.4); color:hsl(38 80% 40%); }
        .pn-pill.active-60         { background:hsl(var(--primary)/0.1); border-color:hsl(var(--primary)/0.4); color:hsl(var(--primary)); }
        .pn-pill.active-final      { background:hsl(0 84% 60%/0.12); border-color:hsl(0 84% 60%/0.4); color:hsl(0 84% 40%); }

        .pn-filter-sep { width:1px; height:24px; background:hsl(var(--border)); }

        .pn-stats { display:flex; border-top:1px solid hsl(var(--border)); }
        .pn-stat { flex:1; padding:12px 0; text-align:center; border-right:1px solid hsl(var(--border)); }
        .pn-stat:last-child { border-right:none; }
        .pn-stat-val { font-size:18px; font-weight:700; color:hsl(var(--foreground)); }
        .pn-stat-label { font-size:10px; font-weight:600; color:hsl(var(--muted-foreground)); text-transform:uppercase; letter-spacing:0.5px; margin-top:1px; }
        .pn-stat-val.blue  { color:hsl(var(--primary)); }
        .pn-stat-val.green { color:hsl(142 72% 38%); }
        .pn-stat-val.red   { color:hsl(0 84% 50%); }

        .pn-table-wrap { background:hsl(var(--card)); border:1px solid hsl(var(--border)); border-radius:14px; overflow:hidden; box-shadow:0 1px 4px rgba(0,0,0,0.04); }
        .pn-table { width:100%; border-collapse:collapse; }
        .pn-table thead tr { border-bottom:1.5px solid hsl(var(--border)); }
        .pn-table th { padding:11px 16px; text-align:left; font-size:11px; font-weight:600; color:hsl(var(--muted-foreground)); text-transform:uppercase; letter-spacing:0.5px; background:hsl(var(--muted)); white-space:nowrap; }
        .pn-table td { padding:14px 16px; font-size:13.5px; color:hsl(var(--foreground)); border-bottom:1px solid hsl(var(--border)); vertical-align:middle; }
        .pn-table tbody tr:last-child td { border-bottom:none; }
        .pn-table tbody tr { transition:background 0.1s; }
        .pn-table tbody tr:hover { background:hsl(var(--background)); }

        .pn-noticeno { font-weight:700; color:hsl(var(--primary)); font-size:13px; font-family:'DM Mono',monospace; }
        .pn-applicant-cell { display:flex; align-items:center; gap:9px; }
        .pn-avatar { width:30px; height:30px; border-radius:8px; font-size:11px; font-weight:700; color:hsl(var(--primary-foreground)); display:flex; align-items:center; justify-content:center; flex-shrink:0; }
        .pn-applicant-name { font-weight:600; color:hsl(var(--foreground)); font-size:13px; }
        .pn-applicant-no   { font-size:11px; color:hsl(var(--muted-foreground)); }
        .pn-unit     { font-size:13px; color:hsl(var(--foreground)); }
        .pn-unit-sub { font-size:11px; color:hsl(var(--muted-foreground)); }
        .pn-date     { font-size:13px; color:hsl(var(--foreground)); }
        .pn-date-sub { font-size:11px; color:hsl(var(--muted-foreground)); }

        /* Notice type badge */
        .pn-type { display:inline-flex; align-items:center; padding:2px 8px; border-radius:6px; font-size:11px; font-weight:700; }
        .pn-type-30    { background:hsl(38 92% 50%/0.12); color:hsl(38 80% 40%); }
        .pn-type-60    { background:hsl(var(--primary)/0.1); color:hsl(var(--primary)); }
        .pn-type-final { background:hsl(0 84% 60%/0.12); color:hsl(0 84% 40%); }

        /* Status badge */
        .pn-badge { display:inline-flex; align-items:center; gap:4px; padding:3px 9px; border-radius:20px; font-size:11px; font-weight:600; }
        .pn-badge-sent         { background:hsl(var(--primary)/0.1);   color:hsl(var(--primary)); }
        .pn-badge-acknowledged { background:hsl(142 76% 36%/0.12);     color:hsl(142 76% 36%); }
        .pn-badge-overdue      { background:hsl(0 84% 60%/0.12);       color:hsl(0 84% 40%); }
        .pn-badge-cancelled    { background:hsl(var(--muted));          color:hsl(var(--muted-foreground)); }

        /* Days remaining badges */
        .pn-days-badge { display:inline-block; padding:2px 7px; border-radius:6px; font-size:11px; font-weight:600; }
        .pn-days-badge.overdue { background:hsl(0 84% 60%/0.12); color:hsl(0 84% 40%); }
        .pn-days-badge.today   { background:hsl(38 92% 50%/0.12); color:hsl(38 80% 40%); }
        .pn-days-badge.urgent  { background:hsl(38 92% 50%/0.12); color:hsl(38 80% 40%); }
        .pn-days-badge.normal  { background:hsl(142 76% 36%/0.1); color:hsl(142 72% 38%); }

        /* Row actions */
        .pn-actions { position:relative; }
        .pn-menu-btn { width:30px; height:30px; border-radius:7px; display:flex; align-items:center; justify-content:center; background:none; border:none; cursor:pointer; color:hsl(var(--muted-foreground)); transition:all 0.1s; }
        .pn-menu-btn:hover { background:hsl(var(--muted)); color:hsl(var(--foreground)); }
        .pn-menu { position:absolute; right:0; top:100%; margin-top:4px; background:hsl(var(--card)); border:1px solid hsl(var(--border)); border-radius:10px; box-shadow:0 8px 24px rgba(0,0,0,0.10); z-index:50; min-width:140px; overflow:hidden; animation:pn-menu-in 0.1s ease; }
        @keyframes pn-menu-in { from{opacity:0;transform:translateY(-4px)} to{opacity:1;transform:translateY(0)} }
        .pn-menu-item { display:flex; align-items:center; gap:9px; padding:9px 14px; font-size:13px; font-weight:500; cursor:pointer; background:none; border:none; width:100%; text-align:left; font-family:inherit; color:hsl(var(--foreground)); transition:background 0.1s; }
        .pn-menu-item:hover { background:hsl(var(--background)); }
        .pn-menu-item.danger { color:hsl(0 84% 50%); }
        .pn-menu-item.danger:hover { background:hsl(0 84% 60%/0.08); }

        /* Empty */
        .pn-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; padding:72px 24px; gap:12px; color:hsl(var(--muted-foreground)); text-align:center; }
        .pn-empty-icon { width:56px; height:56px; background:hsl(var(--primary)/0.1); border-radius:14px; display:flex; align-items:center; justify-content:center; }
        .pn-empty h3 { font-size:15px; font-weight:600; color:hsl(var(--muted-foreground)); margin:0; }
        .pn-empty p  { font-size:13px; color:hsl(var(--muted-foreground)); margin:0; }

        /* Pagination */
        .pn-pagination { display:flex; align-items:center; justify-content:space-between; padding:14px 20px; border-top:1px solid hsl(var(--border)); font-size:13px; color:hsl(var(--muted-foreground)); }
        .pn-pag-btns { display:flex; gap:6px; }
        .pn-pag-btn { width:32px; height:32px; border-radius:8px; display:flex; align-items:center; justify-content:center; background:none; border:1px solid hsl(var(--border)); cursor:pointer; color:hsl(var(--foreground)); transition:all 0.12s; font-family:inherit; font-size:12px; }
        .pn-pag-btn:hover:not(:disabled) { border-color:hsl(var(--primary)); color:hsl(var(--primary)); }
        .pn-pag-btn:disabled { opacity:0.4; cursor:not-allowed; }
        .pn-pag-btn.active { background:hsl(var(--primary)); border-color:hsl(var(--primary)); color:hsl(var(--primary-foreground)); font-weight:600; }

        /* Skeleton */
        .pn-skel { background:linear-gradient(90deg,hsl(var(--muted)) 25%,hsl(var(--border)) 50%,hsl(var(--muted)) 75%); background-size:200% 100%; animation:pn-shimmer 1.4s infinite; border-radius:6px; }
        @keyframes pn-shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }

        /* Combobox */
        .pn-combo { position:relative; width:100%; }
        .pn-combo-trigger { display:flex; align-items:center; justify-content:space-between; width:100%; padding:8px 10px 8px 12px; border:1.5px solid hsl(var(--border)); border-radius:9px; background:hsl(var(--card)); cursor:pointer; transition:border-color 0.15s; font-family:inherit; font-size:13.5px; }
        .pn-combo-trigger:hover:not(.disabled) { border-color:hsl(var(--primary)/0.6); }
        .pn-combo-trigger.open { border-color:hsl(var(--primary)); }
        .pn-combo-trigger.disabled { opacity:0.5; cursor:not-allowed; }
        .pn-combo-left { display:flex; align-items:center; gap:8px; overflow:hidden; }
        .pn-combo-val { font-size:13.5px; color:hsl(var(--foreground)); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .pn-combo-placeholder { font-size:13.5px; color:hsl(var(--muted-foreground)); }
        .pn-combo-chevron { color:hsl(var(--muted-foreground)); transition:transform 0.15s; }
        .pn-combo-chevron.open { transform:rotate(180deg); }
        .pn-combo-clear { display:flex; padding:2px; border-radius:4px; color:hsl(var(--muted-foreground)); }
        .pn-combo-clear:hover { color:hsl(var(--foreground)); background:hsl(var(--muted)); }
        .pn-combo-drop { position:absolute; top:calc(100% + 4px); left:0; right:0; background:hsl(var(--card)); border:1px solid hsl(var(--border)); border-radius:10px; box-shadow:0 8px 24px rgba(0,0,0,0.1); z-index:100; overflow:hidden; }
        .pn-combo-search-wrap { display:flex; align-items:center; gap:8px; padding:8px 12px; border-bottom:1px solid hsl(var(--border)); color:hsl(var(--muted-foreground)); }
        .pn-combo-search { flex:1; border:none; outline:none; font-size:13px; background:transparent; color:hsl(var(--foreground)); font-family:inherit; }
        .pn-combo-list { max-height:200px; overflow-y:auto; }
        .pn-combo-empty { padding:12px 16px; font-size:13px; color:hsl(var(--muted-foreground)); }
        .pn-combo-item { display:flex; align-items:center; justify-content:space-between; width:100%; padding:9px 14px; background:none; border:none; cursor:pointer; font-family:inherit; text-align:left; transition:background 0.1s; }
        .pn-combo-item:hover { background:hsl(var(--muted)/0.5); }
        .pn-combo-item.selected { background:hsl(var(--primary)/0.08); }
        .pn-combo-item-label { font-size:13.5px; color:hsl(var(--foreground)); }
        .pn-combo-item-sub   { font-size:11px; color:hsl(var(--muted-foreground)); }

        .pn-form-section { font-size:11px; font-weight:700; color:hsl(var(--muted-foreground)); text-transform:uppercase; letter-spacing:0.6px; padding:8px 0 4px; border-top:1px solid hsl(var(--border)); margin-top:4px; }
        .pn-form-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
        .pn-status-select { width:100%; padding:8px 32px 8px 12px; border:1.5px solid hsl(var(--border)); border-radius:9px; font-size:13.5px; color:hsl(var(--foreground)); background:hsl(var(--card)); outline:none; font-family:inherit; cursor:pointer; appearance:none; -webkit-appearance:none; background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E"); background-repeat:no-repeat; background-position:right 10px center; }
        .pn-status-select:focus { border-color:hsl(var(--primary)); }

        @media(max-width:768px){
          .pn-form-grid { grid-template-columns:1fr; }
          .pn-stats { flex-wrap:wrap; }
          .pn-stat { min-width:50%; }
          .pn-table th:nth-child(5),.pn-table td:nth-child(5),
          .pn-table th:nth-child(6),.pn-table td:nth-child(6) { display:none; }
        }
      `}</style>

      <Breadcrumbs items={[
        { label: "Follow-Up", path: "/followup" },
        { label: "Closure",   path: "/followup/closure/possession-notice" },
        { label: "Possession Notice", path: "/followup/closure/possession-notice" },
      ]} />

      <div className="pn-page relative space-y-8 mt-6" onClick={() => setOpenMenuId(null)}>

        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-4">
          <div className="pn-title-row">
            <div className="pn-icon"><Bell size={20} /></div>
            <span className="pn-title">Possession Notices</span>
            <span className="pn-count">{pagination?.total ?? 0}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => refetch()} disabled={isFetching}
              className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50">
              <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /> Refresh
            </button>
            <Button size="sm" onClick={openCreate}
              className="gradient-accent gap-1.5 shrink-0 font-semibold text-white text-sm px-5 py-2 h-auto">
              <Plus size={14} /> New Notice
            </Button>
          </div>
        </div>

        {/* Filter + search */}
        <div className="pn-filter-bar">
          <div className="pn-search-wrap">
            <Search size={14} />
            <input className="pn-search" placeholder="Search by applicant, notice no, unit…"
              value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
            {search && <button className="pn-search-clear" onClick={() => { setSearch(""); setPage(1); }}><X size={13} /></button>}
          </div>
          <div className="pn-pills">
            {STATUS_FILTERS.map((s) => {
              const isActive = statusFilter === s;
              const cls = isActive
                ? s === "" ? "pn-pill active"
                  : s === "Sent" ? "pn-pill active-sent"
                  : s === "Acknowledged" ? "pn-pill active-ack"
                  : s === "Overdue" ? "pn-pill active-overdue"
                  : "pn-pill active-cancelled"
                : "pn-pill";
              return (
                <button key={s} className={cls} onClick={() => { setStatusFilter(s as PNStatus | ""); setPage(1); }}>
                  {STATUS_LABELS[s]}
                </button>
              );
            })}
          </div>
          <div className="pn-filter-sep" />
          <div className="pn-pills">
            {TYPE_FILTERS.map((t) => {
              const isActive = typeFilter === t;
              const cls = isActive
                ? t === "" ? "pn-pill active"
                  : t === "30-day" ? "pn-pill active-30"
                  : t === "60-day" ? "pn-pill active-60"
                  : "pn-pill active-final"
                : "pn-pill";
              return (
                <button key={t} className={cls} onClick={() => { setTypeFilter(t as NoticeType | ""); setPage(1); }}>
                  {TYPE_LABELS[t]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Stats bar */}
        <div className="pn-stats">
          {[
            { label: "Total",         val: pagination?.total ?? 0, cls: "blue"  },
            { label: "Sent",          val: stats.sent,             cls: ""      },
            { label: "Acknowledged",  val: stats.acknowledged,     cls: "green" },
            { label: "Overdue",       val: stats.overdue,          cls: "red"   },
          ].map(({ label, val, cls }) => (
            <div key={label} className="pn-stat">
              <div className={`pn-stat-val ${cls}`}>{val}</div>
              <div className="pn-stat-label">{label}</div>
            </div>
          ))}
        </div>

        {/* Table */}
        <div className="pn-table-wrap">
          {isLoading ? (
            <table className="pn-table">
              <thead><tr>{["Notice No","Applicant","Unit","Type","Possession Date","Status",""].map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>{[80,160,100,60,120,80,40].map((w, j) => (
                    <td key={j}><div className="pn-skel" style={{ height:14, width:w }} /></td>
                  ))}</tr>
                ))}
              </tbody>
            </table>
          ) : records.length === 0 ? (
            <div className="pn-empty">
              <div className="pn-empty-icon"><Bell size={26} style={{ color:"hsl(var(--primary))" }} /></div>
              <h3>{search || statusFilter || typeFilter ? "No matching notices" : "No Possession Notices yet"}</h3>
              <p>{search || statusFilter || typeFilter ? "Try adjusting your search or filters" : "Create your first possession notice above"}</p>
            </div>
          ) : (
            <>
              <table className="pn-table">
                <thead>
                  <tr>
                    <th>Notice No</th>
                    <th>Applicant</th>
                    <th>Unit / Project</th>
                    <th>Type</th>
                    <th>Possession Date</th>
                    <th>Sent Via</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((rec) => {
                    const sm = STATUS_META[rec.Status] ?? STATUS_META["Sent"];
                    const typeCls = NOTICE_TYPE_META[rec.NoticeType] ?? "pn-type-30";
                    return (
                      <tr key={rec.Id}>
                        <td><span className="pn-noticeno">{rec.NoticeNo}</span></td>
                        <td>
                          <div className="pn-applicant-cell">
                            <div className="pn-avatar" style={{ background: avatarColor(rec.ApplicantName) }}>
                              {initials(rec.ApplicantName)}
                            </div>
                            <div>
                              <div className="pn-applicant-name">{rec.ApplicantName}</div>
                              <div className="pn-applicant-no">{rec.ApplicantNo}</div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="pn-unit">{rec.UnitNo ?? "—"}</div>
                          {rec.ProjectName && <div className="pn-unit-sub">{rec.ProjectName}</div>}
                        </td>
                        <td><span className={`pn-type ${typeCls}`}>{rec.NoticeType}</span></td>
                        <td>
                          <div className="pn-date">{fmtDate(rec.ScheduledPossDate)}</div>
                          <DaysRemainingBadge record={rec} />
                        </td>
                        <td>
                          <div className="pn-date">{rec.SentVia ?? "—"}</div>
                          {rec.AcknowledgedDate && <div className="pn-date-sub">Ack: {fmtDate(rec.AcknowledgedDate)}</div>}
                        </td>
                        <td>
                          <span className={`pn-badge ${sm.cls}`}>{sm.icon}{sm.label}</span>
                        </td>
                        <td>
                          <div className="pn-actions" onClick={(e) => e.stopPropagation()}>
                            <button className="pn-menu-btn" onClick={() => setOpenMenuId(openMenuId === rec.Id ? null : rec.Id)}>
                              <MoreHorizontal size={16} />
                            </button>
                            {openMenuId === rec.Id && (
                              <div className="pn-menu">
                                <button className="pn-menu-item" onClick={() => { openEdit(rec); setOpenMenuId(null); }}>
                                  <Pencil size={14} /> Edit
                                </button>
                                {canDeleteRecords && (
                                  <button className="pn-menu-item danger" onClick={() => { setDeleteId(rec.Id); setOpenMenuId(null); }}>
                                    <Trash2 size={14} /> Delete
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {pagination && pagination.totalPages > 1 && (
                <div className="pn-pagination">
                  <span>Showing {records.length} of {pagination.total}</span>
                  <div className="pn-pag-btns">
                    <button className="pn-pag-btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft size={14} /></button>
                    {pageNums.map((n, i) =>
                      n === "…"
                        ? <span key={`e-${i}`} style={{ display:"flex",alignItems:"center",padding:"0 4px",color:"hsl(var(--muted-foreground))",fontSize:13 }}>…</span>
                        : <button key={n} className={`pn-pag-btn${page === n ? " active" : ""}`} onClick={() => setPage(n as number)}>{n}</button>
                    )}
                    <button className="pn-pag-btn" disabled={page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)}><ChevronRight size={14} /></button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Create / Edit Dialog ── */}
      <Dialog open={dialogOpen} onOpenChange={(v) => { if (!v) setDialogOpen(false); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold">
              <div style={{ width:28,height:28,background:"hsl(var(--primary))",borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center" }}>
                <Bell size={15} style={{ color:"hsl(var(--primary-foreground))" }} />
              </div>
              {editId ? "Edit Possession Notice" : "New Possession Notice"}
            </DialogTitle>
            <DialogDescription>
              {editId ? "Update the notice details below." : "Fill in the details to create a new possession notice."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            {/* Applicant */}
            <div className="space-y-2">
              <Label>Applicant <span className="text-destructive">*</span></Label>
              <Combobox value={form.ApplicantId} onChange={(v) => set("ApplicantId", v)} items={applicantItems} placeholder="Select applicant…" />
            </div>

            {/* Unit + Handover */}
            <div className="pn-form-grid">
              <div className="space-y-2">
                <Label>Unit Selection</Label>
                <Combobox value={form.UnitSelectionId} onChange={(v) => set("UnitSelectionId", v)} items={unitItems} placeholder="Select unit…" disabled={!form.ApplicantId} />
              </div>
              <div className="space-y-2">
                <Label>Linked Handover</Label>
                <Combobox value={form.HandoverId} onChange={(v) => set("HandoverId", v)} items={handoverItems} placeholder="Select handover…" disabled={!form.ApplicantId} />
              </div>
            </div>

            {/* Pre-Possession + Project */}
            <div className="pn-form-grid">
              <div className="space-y-2">
                <Label>Pre-Possession Clearance</Label>
                <Combobox value={form.PrePossessionId} onChange={(v) => set("PrePossessionId", v)} items={prePossessionItems} placeholder="Select clearance…" disabled={!form.ApplicantId} />
              </div>
              <div className="space-y-2">
                <Label>Project</Label>
                <Combobox value={form.ProjectId} onChange={(v) => set("ProjectId", v)} items={projectItems} placeholder="Select project…" />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Company</Label>
              <Combobox value={form.CompanyId} onChange={(v) => { set("CompanyId", v); set("ProjectId", ""); }} items={companyItems} placeholder="Select company…" />
            </div>

            <div className="pn-form-section">Notice Details</div>

            {/* Notice Type + Notice Date */}
            <div className="pn-form-grid">
              <div className="space-y-2">
                <Label>Notice Type</Label>
                <select className="pn-status-select" value={form.NoticeType} onChange={(e) => set("NoticeType", e.target.value as NoticeType)}>
                  {(meta?.noticeTypeOptions ?? (["30-day","60-day","Final"] as NoticeType[])).map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Notice Date</Label>
                <div className="relative">
                  <CalendarDays size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground pointer-events-none opacity-70" />
                  <input type="date" value={form.NoticeDate} onChange={(e) => set("NoticeDate", e.target.value)} className="w-full pl-8 pr-3 py-2 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer" />
                </div>
              </div>
            </div>

            {/* Scheduled + Actual Possession Date */}
            <div className="pn-form-grid">
              <div className="space-y-2">
                <Label>Scheduled Possession Date</Label>
                <div className="relative">
                  <CalendarDays size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground pointer-events-none opacity-70" />
                  <input type="date" value={form.ScheduledPossDate} onChange={(e) => set("ScheduledPossDate", e.target.value)} className="w-full pl-8 pr-3 py-2 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Actual Possession Date</Label>
                <div className="relative">
                  <CalendarDays size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground pointer-events-none opacity-70" />
                  <input type="date" value={form.ActualPossDate} onChange={(e) => set("ActualPossDate", e.target.value)} className="w-full pl-8 pr-3 py-2 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer" />
                </div>
              </div>
            </div>

            {/* Sent Via */}
            <div className="space-y-2">
              <Label>Sent Via</Label>
              <select className="pn-status-select" value={form.SentVia} onChange={(e) => set("SentVia", e.target.value)}>
                <option value="">— Select —</option>
                {SENT_VIA_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            <div className="pn-form-section">Acknowledgement</div>

            <div className="pn-form-grid">
              <div className="space-y-2">
                <Label>Acknowledged Date</Label>
                <div className="relative">
                  <CalendarDays size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground pointer-events-none opacity-70" />
                  <input type="date" value={form.AcknowledgedDate} onChange={(e) => set("AcknowledgedDate", e.target.value)} className="w-full pl-8 pr-3 py-2 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Acknowledged By</Label>
                <Input value={form.AcknowledgedBy} onChange={(e) => set("AcknowledgedBy", e.target.value)} placeholder="Person who acknowledged…" />
              </div>
            </div>

            <div className="pn-form-section">Status & Notes</div>

            <div className="space-y-2">
              <Label>Status</Label>
              <select className="pn-status-select" value={form.Status} onChange={(e) => set("Status", e.target.value as PNStatus)}>
                {(meta?.statusOptions ?? (["Sent","Acknowledged","Overdue","Cancelled"] as PNStatus[])).map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea value={form.Notes} onChange={(e) => set("Notes", e.target.value)} placeholder="Additional remarks…" rows={2} />
            </div>
          </div>

          <DialogFooter>
            <button type="button" onClick={() => setDialogOpen(false)} className="px-4 py-2 rounded-lg border border-border bg-background text-foreground text-sm font-medium hover:bg-muted transition-colors">Cancel</button>
            <Button
              disabled={!form.ApplicantId || isSaving}
              onClick={() => (editId ? updateMut.mutate() : createMut.mutate())}
              className="gradient-accent gap-1.5 font-semibold text-white text-sm px-5 py-2 h-auto"
            >
              {isSaving ? "Saving…" : editId ? "Update Notice" : "Create Notice"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirm ── */}
      <AlertDialog open={!!deleteId} onOpenChange={(v) => { if (!v) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this Possession Notice?</AlertDialogTitle>
            <AlertDialogDescription>This record will be permanently removed. This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteMut.mutate()}
              disabled={deleteMut.isPending}
            >
              {deleteMut.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default PossessionNoticePage;