import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  RefreshCw,
  Search,
  X,
  ClipboardCheck,
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
  Zap,
  Droplets,
  PaintBucket,
  Layers,
  FlameKindling,
  FileCheck2,
  ListChecks,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Breadcrumbs } from "@/components/Breadcrumbs";
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

type PPStatus = "Pending" | "In Progress" | "Cleared" | "Failed";

interface PrePossession {
  Id: number;
  ClearanceNo: string;
  ApplicantId: number;
  ApplicantNo: string;
  ApplicantName: string;
  UnitSelectionId: number | null;
  SelectionNo: string | null;
  UnitNo: string | null;
  HandoverId: number | null;
  ProjectId: number | null;
  ProjectName: string | null;
  CompanyId: number | null;
  CompanyName: string | null;
  StructuralClearance: boolean;
  ElectricalClearance: boolean;
  PlumbingClearance: boolean;
  PaintingClearance: boolean;
  FlooringClearance: boolean;
  FireClearance: boolean;
  OccupancyCertIssued: boolean;
  SnagListCleared: boolean;
  ClearanceDate: string | null;
  InspectedBy: string | null;
  Status: PPStatus;
  Notes: string | null;
  CreatedBy: string;
  CreatedAt: string;
}

interface OptionApplicant {
  Id: number;
  ApplicantNo: string | null;
  ApplicantName: string;
}
interface OptionUnitSelection {
  Id: number;
  SelectionNo: string;
  UnitNo: string;
  ApplicantId: number;
  ProjectId: number | null;
  CompanyId: number | null;
}
interface OptionHandover {
  Id: number;
  HandoverNo: string;
  ApplicantId: number;
}
interface OptionProject { Id: number; Name: string; }
interface OptionCompany { Id: number; Name: string; }

interface MetaOptions {
  applicants: OptionApplicant[];
  unitSelections: OptionUnitSelection[];
  handovers: OptionHandover[];
  projects: OptionProject[];
  companies: OptionCompany[];
  statusOptions: PPStatus[];
}

interface FormState {
  ApplicantId: string;
  UnitSelectionId: string;
  HandoverId: string;
  ProjectId: string;
  CompanyId: string;
  StructuralClearance: boolean;
  ElectricalClearance: boolean;
  PlumbingClearance: boolean;
  PaintingClearance: boolean;
  FlooringClearance: boolean;
  FireClearance: boolean;
  OccupancyCertIssued: boolean;
  SnagListCleared: boolean;
  ClearanceDate: string;
  InspectedBy: string;
  Status: PPStatus;
  Notes: string;
}

const EMPTY_FORM: FormState = {
  ApplicantId: "",
  UnitSelectionId: "",
  HandoverId: "",
  ProjectId: "",
  CompanyId: "",
  StructuralClearance: false,
  ElectricalClearance: false,
  PlumbingClearance: false,
  PaintingClearance: false,
  FlooringClearance: false,
  FireClearance: false,
  OccupancyCertIssued: false,
  SnagListCleared: false,
  ClearanceDate: new Date().toISOString().slice(0, 10),
  InspectedBy: "",
  Status: "Pending",
  Notes: "",
};

// ─── Clearance items config ───────────────────────────────────────────────────

const CLEARANCE_ITEMS: Array<{
  field: keyof FormState;
  label: string;
  icon: React.ReactNode;
}> = [
  { field: "StructuralClearance",  label: "Structural Inspection",  icon: <ShieldCheck size={14} /> },
  { field: "ElectricalClearance",  label: "Electrical Systems",     icon: <Zap size={14} /> },
  { field: "PlumbingClearance",    label: "Plumbing & Drainage",    icon: <Droplets size={14} /> },
  { field: "PaintingClearance",    label: "Painting & Finishes",    icon: <PaintBucket size={14} /> },
  { field: "FlooringClearance",    label: "Flooring",               icon: <Layers size={14} /> },
  { field: "FireClearance",        label: "Fire Safety",            icon: <FlameKindling size={14} /> },
  { field: "OccupancyCertIssued",  label: "Occupancy Certificate",  icon: <FileCheck2 size={14} /> },
  { field: "SnagListCleared",      label: "Snag List Cleared",      icon: <ListChecks size={14} /> },
];

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

function countCleared(rec: PrePossession): number {
  return [
    rec.StructuralClearance, rec.ElectricalClearance, rec.PlumbingClearance,
    rec.PaintingClearance, rec.FlooringClearance, rec.FireClearance,
    rec.OccupancyCertIssued, rec.SnagListCleared,
  ].filter(Boolean).length;
}

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_META: Record<PPStatus, { label: string; icon: React.ReactNode; cls: string }> = {
  Pending:     { label: "Pending",     icon: <Clock size={11} />,       cls: "pp-badge-pending" },
  "In Progress":{ label: "In Progress",icon: <AlertCircle size={11} />, cls: "pp-badge-inprogress" },
  Cleared:     { label: "Cleared",     icon: <CheckCircle2 size={11} />,cls: "pp-badge-cleared" },
  Failed:      { label: "Failed",      icon: <Ban size={11} />,         cls: "pp-badge-failed" },
};

// ─── API ──────────────────────────────────────────────────────────────────────

async function fetchMeta(): Promise<MetaOptions> {
  const res = await fetchWithAuth("/api/followup-pre-possession/meta/options");
  if (!res.ok) throw new Error("Failed to load options");
  return res.json();
}

async function fetchPPs(params: { page: number; pageSize: number; search: string; status: string }) {
  const q = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
    ...(params.search ? { search: params.search } : {}),
    ...(params.status ? { status: params.status } : {}),
  });
  const res = await fetchWithAuth(`/api/followup-pre-possession?${q}`);
  if (!res.ok) throw new Error("Failed to load Pre-Possession records");
  return res.json() as Promise<{ data: PrePossession[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } }>;
}

async function createPP(payload: Record<string, unknown>) {
  const res = await fetchWithAuth("/api/followup-pre-possession", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || "Failed to create");
  }
}

async function updatePP(id: number, payload: Record<string, unknown>) {
  const res = await fetchWithAuth(`/api/followup-pre-possession/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || "Failed to update");
  }
}

async function deletePP(id: number) {
  const res = await fetchWithAuth(`/api/followup-pre-possession/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete");
}

// ─── Combobox ─────────────────────────────────────────────────────────────────

interface ComboItem { value: string; label: string; sub?: string; }

function Combobox({ value, onChange, items, placeholder, disabled }: {
  value: string; onChange: (v: string) => void;
  items: ComboItem[]; placeholder: string; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const selected = items.find((i) => i.value === value);
  const filtered = useMemo(() => {
    if (!q) return items;
    const lq = q.toLowerCase();
    return items.filter((i) => i.label.toLowerCase().includes(lq) || (i.sub ?? "").toLowerCase().includes(lq));
  }, [items, q]);

  return (
    <div className="pp-combo">
      <button
        type="button"
        className={`pp-combo-trigger${open ? " open" : ""}${!value ? " empty" : ""}${disabled ? " disabled" : ""}`}
        onClick={() => { if (!disabled) { setOpen((v) => !v); setQ(""); } }}
      >
        <span className="pp-combo-left">
          {selected
            ? <span className="pp-combo-val">{selected.label}</span>
            : <span className="pp-combo-placeholder">{placeholder}</span>}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {value && !disabled && (
            <span className="pp-combo-clear" onClick={(e) => { e.stopPropagation(); onChange(""); setOpen(false); }}>
              <X size={12} />
            </span>
          )}
          <ChevronDown size={13} className={`pp-combo-chevron${open ? " open" : ""}`} />
        </span>
      </button>
      {open && (
        <div className="pp-combo-drop">
          <div className="pp-combo-search-wrap">
            <Search size={13} />
            <input className="pp-combo-search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          </div>
          <div className="pp-combo-list">
            {filtered.length === 0
              ? <div className="pp-combo-empty">No results</div>
              : filtered.map((item) => (
                  <button key={item.value} type="button"
                    className={`pp-combo-item${value === item.value ? " selected" : ""}`}
                    onClick={() => { onChange(item.value); setOpen(false); setQ(""); }}
                  >
                    <span className="pp-combo-item-label">{item.label}</span>
                    {item.sub && <span className="pp-combo-item-sub">{item.sub}</span>}
                  </button>
                ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ChecklistToggle ──────────────────────────────────────────────────────────

function ChecklistToggle({ checked, onChange, icon, label }: {
  checked: boolean; onChange: (v: boolean) => void;
  icon: React.ReactNode; label: string;
}) {
  return (
    <button type="button" className={`pp-checklist-item${checked ? " checked" : ""}`} onClick={() => onChange(!checked)}>
      <span className="pp-checklist-icon">{icon}</span>
      <span className="pp-checklist-label">{label}</span>
      {checked && <CheckCircle2 size={14} className="pp-checklist-tick" />}
    </button>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function PrePossessionClearancePage() {
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  const canDeleteRecords = currentUser?.role !== "engineer";

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<PPStatus | "">("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);

  const { data: meta } = useQuery({
    queryKey: ["pp-meta"],
    queryFn: fetchMeta,
    staleTime: 5 * 60 * 1000,
  });

  const { data: result, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["pre-possessions", page, search, statusFilter],
    queryFn: () => fetchPPs({ page, pageSize: PAGE_SIZE, search, status: statusFilter }),
    placeholderData: (prev) => prev,
  });

  const records = result?.data ?? [];
  const pagination = result?.pagination;

  const stats = useMemo(() => ({
    total: pagination?.total ?? 0,
    pending: records.filter((r) => r.Status === "Pending").length,
    cleared: records.filter((r) => r.Status === "Cleared").length,
    failed:  records.filter((r) => r.Status === "Failed").length,
  }), [records, pagination]);

  // Combobox items
  const applicantItems: ComboItem[] = useMemo(() =>
    (meta?.applicants ?? []).map((a) => ({ value: String(a.Id), label: a.ApplicantName, sub: a.ApplicantNo ?? undefined })),
    [meta]);

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

  const projectItems: ComboItem[] = useMemo(() =>
    (meta?.projects ?? []).map((p) => ({ value: String(p.Id), label: p.Name })), [meta]);

  const companyItems: ComboItem[] = useMemo(() =>
    (meta?.companies ?? []).map((c) => ({ value: String(c.Id), label: c.Name })), [meta]);

  function set(k: keyof FormState, v: string | boolean) {
    setForm((f) => {
      const next = { ...f, [k]: v } as FormState;
      if (k === "ApplicantId") { next.UnitSelectionId = ""; next.HandoverId = ""; }
      if (k === "UnitSelectionId" && typeof v === "string") {
        const us = meta?.unitSelections.find((u) => String(u.Id) === v);
        if (us) {
          if (us.ProjectId) next.ProjectId = String(us.ProjectId);
          if (us.CompanyId) next.CompanyId = String(us.CompanyId);
        }
      }
      return next;
    });
  }

  // Auto-suggest "Cleared" when all 8 are ticked
  const allCleared = CLEARANCE_ITEMS.every((c) => form[c.field] === true);

  function openCreate() { setEditId(null); setForm(EMPTY_FORM); setDialogOpen(true); }

  function openEdit(r: PrePossession) {
    setEditId(r.Id);
    setForm({
      ApplicantId: String(r.ApplicantId),
      UnitSelectionId: r.UnitSelectionId ? String(r.UnitSelectionId) : "",
      HandoverId: r.HandoverId ? String(r.HandoverId) : "",
      ProjectId: r.ProjectId ? String(r.ProjectId) : "",
      CompanyId: r.CompanyId ? String(r.CompanyId) : "",
      StructuralClearance: Boolean(r.StructuralClearance),
      ElectricalClearance: Boolean(r.ElectricalClearance),
      PlumbingClearance: Boolean(r.PlumbingClearance),
      PaintingClearance: Boolean(r.PaintingClearance),
      FlooringClearance: Boolean(r.FlooringClearance),
      FireClearance: Boolean(r.FireClearance),
      OccupancyCertIssued: Boolean(r.OccupancyCertIssued),
      SnagListCleared: Boolean(r.SnagListCleared),
      ClearanceDate: r.ClearanceDate ?? "",
      InspectedBy: r.InspectedBy ?? "",
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
      ProjectId: form.ProjectId || null,
      CompanyId: form.CompanyId || null,
      StructuralClearance: form.StructuralClearance,
      ElectricalClearance: form.ElectricalClearance,
      PlumbingClearance: form.PlumbingClearance,
      PaintingClearance: form.PaintingClearance,
      FlooringClearance: form.FlooringClearance,
      FireClearance: form.FireClearance,
      OccupancyCertIssued: form.OccupancyCertIssued,
      SnagListCleared: form.SnagListCleared,
      ClearanceDate: form.ClearanceDate || null,
      InspectedBy: form.InspectedBy || null,
      Status: allCleared ? "Cleared" : form.Status,
      Notes: form.Notes || null,
    };
  }

  const invalidate = () => qc.invalidateQueries({ queryKey: ["pre-possessions"] });

  const createMut = useMutation({
    mutationFn: () => createPP(buildPayload()),
    onSuccess: () => { toast.success("Pre-Possession record created"); invalidate(); setDialogOpen(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: () => updatePP(editId!, buildPayload()),
    onSuccess: () => { toast.success("Record updated"); invalidate(); setDialogOpen(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: () => deletePP(deleteId!),
    onSuccess: () => { toast.success("Record deleted"); invalidate(); setDeleteId(null); },
    onError: (e: Error) => toast.error(e.message),
  });

  const STATUS_FILTERS: Array<PPStatus | ""> = ["", "Pending", "In Progress", "Cleared", "Failed"];
  const STATUS_LABELS: Record<string, string> = { "": "All", Pending: "Pending", "In Progress": "In Progress", Cleared: "Cleared", Failed: "Failed" };

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
        .pp-page { font-family: 'DM Sans','Segoe UI',sans-serif; color: hsl(var(--foreground)); }

        .pp-title-row { display:flex; align-items:center; gap:12px; }
        .pp-icon {
          width:40px; height:40px; background:hsl(var(--primary)); border-radius:12px;
          display:flex; align-items:center; justify-content:center;
          color:hsl(var(--primary-foreground)); flex-shrink:0;
          box-shadow:0 2px 8px hsl(var(--primary)/0.25);
        }
        .pp-title { font-size:20px; font-weight:700; color:hsl(var(--foreground)); }
        .pp-count { background:hsl(var(--primary)/0.1); color:hsl(var(--primary)); font-size:12px; font-weight:600; padding:2px 8px; border-radius:20px; }

        .pp-filter-bar { display:flex; align-items:center; gap:12px; padding:14px 0; flex-wrap:wrap; }
        .pp-search-wrap { flex:1; min-width:200px; max-width:400px; position:relative; }
        .pp-search-wrap svg { position:absolute; left:12px; top:50%; transform:translateY(-50%); color:hsl(var(--muted-foreground)); pointer-events:none; }
        .pp-search { width:100%; padding:8px 12px 8px 36px; border:1.5px solid hsl(var(--border)); border-radius:9px; font-size:13.5px; color:hsl(var(--foreground)); background:hsl(var(--card)); outline:none; transition:border-color 0.15s; font-family:inherit; box-sizing:border-box; }
        .pp-search:focus { border-color:hsl(var(--primary)); }
        .pp-search-clear { position:absolute; right:10px; top:50%; transform:translateY(-50%); background:none; border:none; cursor:pointer; color:hsl(var(--muted-foreground)); padding:2px; display:flex; border-radius:4px; }

        .pp-pills { display:flex; gap:6px; flex-wrap:wrap; }
        .pp-pill { padding:5px 12px; border-radius:20px; font-size:12px; font-weight:500; border:1.5px solid hsl(var(--border)); background:hsl(var(--card)); color:hsl(var(--muted-foreground)); cursor:pointer; transition:all 0.12s; font-family:inherit; white-space:nowrap; }
        .pp-pill:hover { border-color:hsl(var(--primary)); color:hsl(var(--primary)); }
        .pp-pill.active           { background:hsl(var(--primary)); border-color:hsl(var(--primary)); color:hsl(var(--primary-foreground)); }
        .pp-pill.active-pending   { background:hsl(var(--muted)); border-color:hsl(var(--border)); color:hsl(var(--muted-foreground)); }
        .pp-pill.active-inprogress{ background:hsl(38 92% 50%/0.12); border-color:hsl(38 92% 50%/0.4); color:hsl(38 80% 40%); }
        .pp-pill.active-cleared   { background:hsl(142 76% 36%/0.12); border-color:hsl(142 76% 36%/0.4); color:hsl(142 76% 36%); }
        .pp-pill.active-failed    { background:hsl(0 84% 60%/0.12); border-color:hsl(0 84% 60%/0.4); color:hsl(0 84% 40%); }

        .pp-stats { display:flex; border-top:1px solid hsl(var(--border)); }
        .pp-stat { flex:1; padding:12px 0; text-align:center; border-right:1px solid hsl(var(--border)); }
        .pp-stat:last-child { border-right:none; }
        .pp-stat-val { font-size:18px; font-weight:700; color:hsl(var(--foreground)); }
        .pp-stat-label { font-size:10px; font-weight:600; color:hsl(var(--muted-foreground)); text-transform:uppercase; letter-spacing:0.5px; margin-top:1px; }
        .pp-stat-val.blue  { color:hsl(var(--primary)); }
        .pp-stat-val.green { color:hsl(142 72% 38%); }
        .pp-stat-val.red   { color:hsl(0 84% 50%); }

        .pp-table-wrap { background:hsl(var(--card)); border:1px solid hsl(var(--border)); border-radius:14px; overflow:hidden; box-shadow:0 1px 4px rgba(0,0,0,0.04); }
        .pp-table { width:100%; border-collapse:collapse; }
        .pp-table thead tr { border-bottom:1.5px solid hsl(var(--border)); }
        .pp-table th { padding:11px 16px; text-align:left; font-size:11px; font-weight:600; color:hsl(var(--muted-foreground)); text-transform:uppercase; letter-spacing:0.5px; background:hsl(var(--muted)); white-space:nowrap; }
        .pp-table td { padding:14px 16px; font-size:13.5px; color:hsl(var(--foreground)); border-bottom:1px solid hsl(var(--border)); vertical-align:middle; }
        .pp-table tbody tr:last-child td { border-bottom:none; }
        .pp-table tbody tr { transition:background 0.1s; }
        .pp-table tbody tr:hover { background:hsl(var(--background)); }

        .pp-clrno { font-weight:700; color:hsl(var(--primary)); font-size:13px; font-family:'DM Mono',monospace; }
        .pp-applicant-cell { display:flex; align-items:center; gap:9px; }
        .pp-avatar { width:30px; height:30px; border-radius:8px; font-size:11px; font-weight:700; color:hsl(var(--primary-foreground)); display:flex; align-items:center; justify-content:center; flex-shrink:0; }
        .pp-applicant-name { font-weight:600; color:hsl(var(--foreground)); font-size:13px; }
        .pp-applicant-no   { font-size:11px; color:hsl(var(--muted-foreground)); }
        .pp-unit     { font-size:13px; color:hsl(var(--foreground)); }
        .pp-unit-sub { font-size:11px; color:hsl(var(--muted-foreground)); }

        /* Progress bar in table */
        .pp-progress-wrap { display:flex; align-items:center; gap:8px; }
        .pp-progress-bar { flex:1; height:6px; background:hsl(var(--muted)); border-radius:99px; overflow:hidden; min-width:60px; }
        .pp-progress-fill { height:100%; border-radius:99px; background:hsl(142 72% 38%); transition:width 0.3s; }
        .pp-progress-label { font-size:11px; font-weight:600; color:hsl(var(--muted-foreground)); white-space:nowrap; }

        /* Status badge */
        .pp-badge { display:inline-flex; align-items:center; gap:4px; padding:3px 9px; border-radius:20px; font-size:11px; font-weight:600; }
        .pp-badge-pending    { background:hsl(var(--muted));           color:hsl(var(--muted-foreground)); }
        .pp-badge-inprogress { background:hsl(38 92% 50%/0.12);        color:hsl(38 80% 40%); }
        .pp-badge-cleared    { background:hsl(142 76% 36%/0.12);       color:hsl(142 76% 36%); }
        .pp-badge-failed     { background:hsl(0 84% 60%/0.12);         color:hsl(0 84% 40%); }

        /* Row actions */
        .pp-actions { position:relative; }
        .pp-menu-btn { width:30px; height:30px; border-radius:7px; display:flex; align-items:center; justify-content:center; background:none; border:none; cursor:pointer; color:hsl(var(--muted-foreground)); transition:all 0.1s; }
        .pp-menu-btn:hover { background:hsl(var(--muted)); color:hsl(var(--foreground)); }
        .pp-menu { position:absolute; right:0; top:100%; margin-top:4px; background:hsl(var(--card)); border:1px solid hsl(var(--border)); border-radius:10px; box-shadow:0 8px 24px rgba(0,0,0,0.10); z-index:50; min-width:140px; overflow:hidden; animation:pp-menu-in 0.1s ease; }
        @keyframes pp-menu-in { from{opacity:0;transform:translateY(-4px)} to{opacity:1;transform:translateY(0)} }
        .pp-menu-item { display:flex; align-items:center; gap:9px; padding:9px 14px; font-size:13px; font-weight:500; cursor:pointer; background:none; border:none; width:100%; text-align:left; font-family:inherit; color:hsl(var(--foreground)); transition:background 0.1s; }
        .pp-menu-item:hover { background:hsl(var(--background)); }
        .pp-menu-item.danger { color:hsl(0 84% 50%); }
        .pp-menu-item.danger:hover { background:hsl(0 84% 60%/0.08); }

        /* Empty */
        .pp-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; padding:72px 24px; gap:12px; color:hsl(var(--muted-foreground)); text-align:center; }
        .pp-empty-icon { width:56px; height:56px; background:hsl(var(--primary)/0.1); border-radius:14px; display:flex; align-items:center; justify-content:center; }
        .pp-empty h3 { font-size:15px; font-weight:600; color:hsl(var(--muted-foreground)); margin:0; }
        .pp-empty p  { font-size:13px; color:hsl(var(--muted-foreground)); margin:0; }

        /* Pagination */
        .pp-pagination { display:flex; align-items:center; justify-content:space-between; padding:14px 20px; border-top:1px solid hsl(var(--border)); font-size:13px; color:hsl(var(--muted-foreground)); }
        .pp-pag-btns { display:flex; gap:6px; }
        .pp-pag-btn { width:32px; height:32px; border-radius:8px; display:flex; align-items:center; justify-content:center; background:none; border:1px solid hsl(var(--border)); cursor:pointer; color:hsl(var(--foreground)); transition:all 0.12s; font-family:inherit; font-size:12px; }
        .pp-pag-btn:hover:not(:disabled) { border-color:hsl(var(--primary)); color:hsl(var(--primary)); }
        .pp-pag-btn:disabled { opacity:0.4; cursor:not-allowed; }
        .pp-pag-btn.active { background:hsl(var(--primary)); border-color:hsl(var(--primary)); color:hsl(var(--primary-foreground)); font-weight:600; }

        /* Skeleton */
        .pp-skel { background:linear-gradient(90deg,hsl(var(--muted)) 25%,hsl(var(--border)) 50%,hsl(var(--muted)) 75%); background-size:200% 100%; animation:pp-shimmer 1.4s infinite; border-radius:6px; }
        @keyframes pp-shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }

        /* Combobox */
        .pp-combo { position:relative; width:100%; }
        .pp-combo-trigger { display:flex; align-items:center; justify-content:space-between; width:100%; padding:8px 10px 8px 12px; border:1.5px solid hsl(var(--border)); border-radius:9px; background:hsl(var(--card)); cursor:pointer; transition:border-color 0.15s; font-family:inherit; font-size:13.5px; }
        .pp-combo-trigger:hover:not(.disabled) { border-color:hsl(var(--primary)/0.6); }
        .pp-combo-trigger.open { border-color:hsl(var(--primary)); }
        .pp-combo-trigger.disabled { opacity:0.5; cursor:not-allowed; }
        .pp-combo-left { display:flex; align-items:center; gap:8px; overflow:hidden; }
        .pp-combo-val { font-size:13.5px; color:hsl(var(--foreground)); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .pp-combo-placeholder { font-size:13.5px; color:hsl(var(--muted-foreground)); }
        .pp-combo-chevron { color:hsl(var(--muted-foreground)); transition:transform 0.15s; }
        .pp-combo-chevron.open { transform:rotate(180deg); }
        .pp-combo-clear { display:flex; padding:2px; border-radius:4px; color:hsl(var(--muted-foreground)); }
        .pp-combo-clear:hover { color:hsl(var(--foreground)); background:hsl(var(--muted)); }
        .pp-combo-drop { position:absolute; top:calc(100% + 4px); left:0; right:0; background:hsl(var(--card)); border:1px solid hsl(var(--border)); border-radius:10px; box-shadow:0 8px 24px rgba(0,0,0,0.1); z-index:100; overflow:hidden; }
        .pp-combo-search-wrap { display:flex; align-items:center; gap:8px; padding:8px 12px; border-bottom:1px solid hsl(var(--border)); color:hsl(var(--muted-foreground)); }
        .pp-combo-search { flex:1; border:none; outline:none; font-size:13px; background:transparent; color:hsl(var(--foreground)); font-family:inherit; }
        .pp-combo-list { max-height:200px; overflow-y:auto; }
        .pp-combo-empty { padding:12px 16px; font-size:13px; color:hsl(var(--muted-foreground)); }
        .pp-combo-item { display:flex; align-items:center; justify-content:space-between; width:100%; padding:9px 14px; background:none; border:none; cursor:pointer; font-family:inherit; text-align:left; transition:background 0.1s; }
        .pp-combo-item:hover { background:hsl(var(--muted)/0.5); }
        .pp-combo-item.selected { background:hsl(var(--primary)/0.08); }
        .pp-combo-item-label { font-size:13.5px; color:hsl(var(--foreground)); }
        .pp-combo-item-sub   { font-size:11px; color:hsl(var(--muted-foreground)); }

        /* Checklist toggles */
        .pp-checklist-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:8px; }
        .pp-checklist-item { display:flex; align-items:center; gap:10px; padding:10px 14px; border-radius:10px; border:1.5px solid hsl(var(--border)); background:hsl(var(--card)); cursor:pointer; transition:all 0.15s; font-family:inherit; text-align:left; }
        .pp-checklist-item:hover { border-color:hsl(var(--primary)/0.5); background:hsl(var(--primary)/0.04); }
        .pp-checklist-item.checked { border-color:hsl(142 76% 36%/0.5); background:hsl(142 76% 36%/0.07); }
        .pp-checklist-icon { color:hsl(var(--muted-foreground)); flex-shrink:0; }
        .pp-checklist-item.checked .pp-checklist-icon { color:hsl(142 72% 38%); }
        .pp-checklist-label { font-size:12.5px; font-weight:500; color:hsl(var(--foreground)); flex:1; }
        .pp-checklist-tick  { color:hsl(142 72% 38%); flex-shrink:0; }

        /* Form */
        .pp-form-section { font-size:11px; font-weight:700; color:hsl(var(--muted-foreground)); text-transform:uppercase; letter-spacing:0.6px; padding:8px 0 4px; border-top:1px solid hsl(var(--border)); margin-top:4px; }
        .pp-form-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; }

        /* Auto-cleared hint */
        .pp-all-cleared-hint { display:flex; align-items:center; gap:6px; padding:8px 12px; border-radius:8px; background:hsl(142 76% 36%/0.1); color:hsl(142 72% 38%); font-size:12px; font-weight:600; }

        @media(max-width:768px){
          .pp-form-grid { grid-template-columns:1fr; }
          .pp-checklist-grid { grid-template-columns:1fr; }
          .pp-stats { flex-wrap:wrap; }
          .pp-stat { min-width:50%; }
          .pp-table th:nth-child(4),.pp-table td:nth-child(4),
          .pp-table th:nth-child(5),.pp-table td:nth-child(5) { display:none; }
        }
      `}</style>

      <Breadcrumbs items={[
        { label: "Follow-Up",  path: "/followup" },
        { label: "Closure",    path: "/followup/closure/pre-possession" },
        { label: "Pre-Possession Clearance", path: "/followup/closure/pre-possession" },
      ]} />

      <div className="pp-page relative space-y-8 mt-6" onClick={() => setOpenMenuId(null)}>

        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-4">
          <div className="pp-title-row">
            <div className="pp-icon"><ClipboardCheck size={20} /></div>
            <span className="pp-title">Pre-Possession Clearance</span>
            <span className="pp-count">{pagination?.total ?? 0}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => refetch()} disabled={isFetching}
              className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50">
              <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /> Refresh
            </button>
            <Button size="sm" onClick={openCreate}
              className="gradient-accent gap-1.5 shrink-0 font-semibold text-white text-sm px-5 py-2 h-auto">
              <Plus size={14} /> New Clearance
            </Button>
          </div>
        </div>

        {/* Filter + search */}
        <div className="pp-filter-bar">
          <div className="pp-search-wrap">
            <Search size={14} />
            <input className="pp-search" placeholder="Search by applicant, clearance no, unit…"
              value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
            {search && (
              <button className="pp-search-clear" onClick={() => { setSearch(""); setPage(1); }}><X size={13} /></button>
            )}
          </div>
          <div className="pp-pills">
            {STATUS_FILTERS.map((s) => {
              const isActive = statusFilter === s;
              const pillClass = isActive
                ? s === "" ? "pp-pill active"
                  : s === "Pending" ? "pp-pill active-pending"
                  : s === "In Progress" ? "pp-pill active-inprogress"
                  : s === "Cleared" ? "pp-pill active-cleared"
                  : "pp-pill active-failed"
                : "pp-pill";
              return (
                <button key={s} className={pillClass} onClick={() => { setStatusFilter(s as PPStatus | ""); setPage(1); }}>
                  {STATUS_LABELS[s]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Stats bar */}
        <div className="pp-stats">
          {[
            { label: "Total",   val: pagination?.total ?? 0, cls: "blue"  },
            { label: "Pending", val: stats.pending,          cls: ""      },
            { label: "Cleared", val: stats.cleared,          cls: "green" },
            { label: "Failed",  val: stats.failed,           cls: "red"   },
          ].map(({ label, val, cls }) => (
            <div key={label} className="pp-stat">
              <div className={`pp-stat-val ${cls}`}>{val}</div>
              <div className="pp-stat-label">{label}</div>
            </div>
          ))}
        </div>

        {/* Table */}
        <div className="pp-table-wrap">
          {isLoading ? (
            <table className="pp-table">
              <thead><tr>{["Clearance No","Applicant","Unit","Clearance","Status",""].map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>{[80,160,100,140,80,40].map((w, j) => (
                    <td key={j}><div className="pp-skel" style={{ height:14, width:w }} /></td>
                  ))}</tr>
                ))}
              </tbody>
            </table>
          ) : records.length === 0 ? (
            <div className="pp-empty">
              <div className="pp-empty-icon"><ClipboardCheck size={26} style={{ color:"hsl(var(--primary))" }} /></div>
              <h3>{search || statusFilter ? "No matching records" : "No Pre-Possession records yet"}</h3>
              <p>{search || statusFilter ? "Try adjusting your search" : "Create your first clearance record above"}</p>
            </div>
          ) : (
            <>
              <table className="pp-table">
                <thead>
                  <tr>
                    <th>Clearance No</th>
                    <th>Applicant</th>
                    <th>Unit / Project</th>
                    <th>Clearance Progress</th>
                    <th>Date</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((rec) => {
                    const cleared = countCleared(rec);
                    const sm = STATUS_META[rec.Status] ?? STATUS_META["Pending"];
                    return (
                      <tr key={rec.Id}>
                        <td><span className="pp-clrno">{rec.ClearanceNo}</span></td>
                        <td>
                          <div className="pp-applicant-cell">
                            <div className="pp-avatar" style={{ background: avatarColor(rec.ApplicantName) }}>
                              {initials(rec.ApplicantName)}
                            </div>
                            <div>
                              <div className="pp-applicant-name">{rec.ApplicantName}</div>
                              <div className="pp-applicant-no">{rec.ApplicantNo}</div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="pp-unit">{rec.UnitNo ?? "—"}</div>
                          {rec.ProjectName && <div className="pp-unit-sub">{rec.ProjectName}</div>}
                        </td>
                        <td>
                          <div className="pp-progress-wrap">
                            <div className="pp-progress-bar">
                              <div className="pp-progress-fill" style={{ width: `${(cleared / 8) * 100}%` }} />
                            </div>
                            <span className="pp-progress-label">{cleared}/8</span>
                          </div>
                        </td>
                        <td>{fmtDate(rec.ClearanceDate)}</td>
                        <td>
                          <span className={`pp-badge ${sm.cls}`}>{sm.icon}{sm.label}</span>
                        </td>
                        <td>
                          <div className="pp-actions" onClick={(e) => e.stopPropagation()}>
                            <button className="pp-menu-btn" onClick={() => setOpenMenuId(openMenuId === rec.Id ? null : rec.Id)}>
                              <MoreHorizontal size={16} />
                            </button>
                            {openMenuId === rec.Id && (
                              <div className="pp-menu">
                                <button className="pp-menu-item" onClick={() => { openEdit(rec); setOpenMenuId(null); }}>
                                  <Pencil size={14} /> Edit
                                </button>
                                {canDeleteRecords && (
                                  <button className="pp-menu-item danger" onClick={() => { setDeleteId(rec.Id); setOpenMenuId(null); }}>
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
                <div className="pp-pagination">
                  <span>Showing {records.length} of {pagination.total}</span>
                  <div className="pp-pag-btns">
                    <button className="pp-pag-btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft size={14} /></button>
                    {pageNums.map((n, i) =>
                      n === "…"
                        ? <span key={`e-${i}`} style={{ display:"flex",alignItems:"center",padding:"0 4px",color:"hsl(var(--muted-foreground))",fontSize:13 }}>…</span>
                        : <button key={n} className={`pp-pag-btn${page === n ? " active" : ""}`} onClick={() => setPage(n as number)}>{n}</button>
                    )}
                    <button className="pp-pag-btn" disabled={page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)}><ChevronRight size={14} /></button>
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
                <ClipboardCheck size={15} style={{ color:"hsl(var(--primary-foreground))" }} />
              </div>
              {editId ? "Edit Clearance" : "New Pre-Possession Clearance"}
            </DialogTitle>
            <DialogDescription>
              {editId ? "Update the clearance details below." : "Fill in the details to create a new clearance record."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            {/* Applicant */}
            <div className="space-y-2">
              <Label>Applicant <span className="text-destructive">*</span></Label>
              <Combobox value={form.ApplicantId} onChange={(v) => set("ApplicantId", v)} items={applicantItems} placeholder="Select applicant…" />
            </div>

            {/* Unit + Handover */}
            <div className="pp-form-grid">
              <div className="space-y-2">
                <Label>Unit Selection</Label>
                <Combobox value={form.UnitSelectionId} onChange={(v) => set("UnitSelectionId", v)} items={unitItems} placeholder="Select unit…" disabled={!form.ApplicantId} />
              </div>
              <div className="space-y-2">
                <Label>Linked Handover</Label>
                <Combobox value={form.HandoverId} onChange={(v) => set("HandoverId", v)} items={handoverItems} placeholder="Select handover…" disabled={!form.ApplicantId} />
              </div>
            </div>

            {/* Project + Company */}
            <div className="pp-form-grid">
              <div className="space-y-2">
                <Label>Project</Label>
                <Combobox value={form.ProjectId} onChange={(v) => set("ProjectId", v)} items={projectItems} placeholder="Select project…" />
              </div>
              <div className="space-y-2">
                <Label>Company</Label>
                <Combobox value={form.CompanyId} onChange={(v) => set("CompanyId", v)} items={companyItems} placeholder="Select company…" />
              </div>
            </div>

            <div className="pp-form-section">Clearance Checklist</div>

            {allCleared && (
              <div className="pp-all-cleared-hint">
                <CheckCircle2 size={15} /> All items cleared — status will be set to <strong>Cleared</strong>
              </div>
            )}

            <div className="pp-checklist-grid">
              {CLEARANCE_ITEMS.map((item) => (
                <ChecklistToggle
                  key={item.field}
                  checked={form[item.field] as boolean}
                  onChange={(v) => set(item.field, v)}
                  icon={item.icon}
                  label={item.label}
                />
              ))}
            </div>

            <div className="pp-form-section">Inspection Details</div>

            <div className="pp-form-grid">
              <div className="space-y-2">
                <Label>Clearance Date</Label>
                <div className="relative">
                  <CalendarDays size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <Input type="date" value={form.ClearanceDate} onChange={(e) => set("ClearanceDate", e.target.value)} className="pl-8" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Inspected By</Label>
                <Input value={form.InspectedBy} onChange={(e) => set("InspectedBy", e.target.value)} placeholder="Inspector name…" />
              </div>
            </div>

            <div className="pp-form-section">Status & Notes</div>

            <div className="space-y-2">
              <Label>Status</Label>
              <select
                className="w-full px-3 py-2 rounded-[9px] text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                value={allCleared ? "Cleared" : form.Status}
                onChange={(e) => set("Status", e.target.value)}
                disabled={allCleared}
              >
                {(meta?.statusOptions ?? (["Pending","In Progress","Cleared","Failed"] as PPStatus[])).map((s) => (
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
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button
              disabled={!form.ApplicantId || isSaving}
              onClick={() => (editId ? updateMut.mutate() : createMut.mutate())}
              className="gradient-accent gap-1.5 font-semibold text-white text-sm px-5 py-2 h-auto"
            >
              {isSaving ? "Saving…" : editId ? "Update Clearance" : "Create Clearance"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirm ── */}
      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this record?</AlertDialogTitle>
            <AlertDialogDescription>This Pre-Possession Clearance record will be permanently removed. This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteMut.mutate()} style={{ background:"hsl(0 84% 50%)",color:"white" }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default PrePossessionClearancePage;