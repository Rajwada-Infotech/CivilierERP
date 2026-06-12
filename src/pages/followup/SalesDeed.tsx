import { useMemo, useState } from "react";
import { filterProjectsByCompany } from "@/lib/projectBelongsTo";
import { useNavigate } from "react-router-dom";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  RefreshCw,
  Search,
  X,
  FileSignature,
  CalendarDays,
  ChevronDown,
  Pencil,
  Trash2,
  CheckCircle2,
  Clock,
  AlertCircle,
  Ban,
  BookOpen,
  MoreHorizontal,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
import { SignaturePicker } from "@/components/SignaturePicker";
import { AuditLogDrawer } from "@/components/AuditLogDrawer";

// ─── Types ────────────────────────────────────────────────────────────────────

type DeedStatus = "Draft" | "Executed" | "Registered" | "Overdue" | "Cancelled";

interface SalesDeed {
  Id: number;
  DeedNo: string;
  ApplicantId: number;
  ApplicantNo: string;
  ApplicantName: string;
  UnitSelectionId: number | null;
  SelectionNo: string | null;
  UnitNo: string | null;
  AgreementId: number | null;
  AgreementNo: string | null;
  ProjectId: number | null;
  ProjectName: string | null;
  CompanyId: number | null;
  CompanyName: string | null;
  DeedValue: number | null;
  StampDuty: number | null;
  RegistrationFee: number | null;
  SubRegistrarOffice: string | null;
  RegistrationNo: string | null;
  BookNo: string | null;
  PartNo: string | null;
  DeedDate: string | null;
  RegistrationDate: string | null;
  PossessionDate: string | null;
  ExecutedBy: string | null;
  WitnessNames: string | null;
  Status: DeedStatus;
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

interface OptionAgreement {
  Id: number;
  AgreementNo: string;
  ApplicantId: number;
  UnitSelectionId: number | null;
}

interface OptionProject {
  Id: number;
  Name: string;
}
interface OptionCompany {
  Id: number;
  Name: string;
}

interface MetaOptions {
  applicants: OptionApplicant[];
  unitSelections: OptionUnitSelection[];
  agreements: OptionAgreement[];
  projects: OptionProject[];
  companies: OptionCompany[];
  statusOptions: DeedStatus[];
}

interface FormState {
  ApplicantId: string;
  UnitSelectionId: string;
  AgreementId: string;
  ProjectId: string;
  CompanyId: string;
  DeedValue: string;
  StampDuty: string;
  RegistrationFee: string;
  SubRegistrarOffice: string;
  RegistrationNo: string;
  BookNo: string;
  PartNo: string;
  DeedDate: string;
  RegistrationDate: string;
  PossessionDate: string;
  ExecutedBy: string;
  WitnessNames: string;
  Status: DeedStatus;
  Notes: string;
}

const EMPTY_FORM: FormState = {
  ApplicantId: "",
  UnitSelectionId: "",
  AgreementId: "",
  ProjectId: "",
  CompanyId: "",
  DeedValue: "",
  StampDuty: "",
  RegistrationFee: "",
  SubRegistrarOffice: "",
  RegistrationNo: "",
  BookNo: "",
  PartNo: "",
  DeedDate: new Date().toISOString().slice(0, 10),
  RegistrationDate: "",
  PossessionDate: "",
  ExecutedBy: "",
  WitnessNames: "",
  Status: "Draft",
  Notes: "",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

function fmtCurrency(val: number | null | undefined): string {
  if (val == null) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(val);
}

function avatarColor(name: string): string {
  const colors = [
    "#2563eb",
    "#7c3aed",
    "#0891b2",
    "#059669",
    "#d97706",
    "#dc2626",
    "#db2777",
    "#65a30d",
  ];
  let h = 0;
  for (let i = 0; i < name.length; i++)
    h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return colors[Math.abs(h) % colors.length];
}

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_META: Record<
  DeedStatus,
  { label: string; icon: React.ReactNode; cls: string }
> = {
  Draft: {
    label: "Draft",
    icon: <Clock size={11} />,
    cls: "sd-badge-draft",
  },
  Executed: {
    label: "Executed",
    icon: <CheckCircle2 size={11} />,
    cls: "sd-badge-executed",
  },
  Registered: {
    label: "Registered",
    icon: <BookOpen size={11} />,
    cls: "sd-badge-registered",
  },
  Overdue: {
    label: "Overdue",
    icon: <AlertCircle size={11} />,
    cls: "sd-badge-overdue",
  },
  Cancelled: {
    label: "Cancelled",
    icon: <Ban size={11} />,
    cls: "sd-badge-cancelled",
  },
};

// ─── API ──────────────────────────────────────────────────────────────────────

async function fetchMeta(): Promise<MetaOptions> {
  const res = await fetchWithAuth("/api/followup-sales-deed/meta/options");
  if (!res.ok) throw new Error("Failed to load options");
  return res.json();
}

async function fetchDeeds(params: {
  page: number;
  pageSize: number;
  search: string;
  status: string;
}): Promise<{
  data: SalesDeed[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}> {
  const q = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
    ...(params.search ? { search: params.search } : {}),
    ...(params.status ? { status: params.status } : {}),
  });
  const res = await fetchWithAuth(`/api/followup-sales-deed?${q}`);
  if (!res.ok) throw new Error("Failed to load Sales Deeds");
  return res.json();
}

async function createDeed(payload: Record<string, unknown>) {
  const res = await fetchWithAuth("/api/followup-sales-deed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error || "Failed to create Sales Deed",
    );
  }
}

async function updateDeed(id: number, payload: Record<string, unknown>) {
  const res = await fetchWithAuth(`/api/followup-sales-deed/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error || "Failed to update Sales Deed",
    );
  }
}

async function deleteDeed(id: number) {
  const res = await fetchWithAuth(`/api/followup-sales-deed/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete Sales Deed");
}

// ─── Combobox ─────────────────────────────────────────────────────────────────

interface ComboItem {
  value: string;
  label: string;
  sub?: string;
}

function Combobox({
  value,
  onChange,
  items,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  items: ComboItem[];
  placeholder: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const selected = items.find((i) => i.value === value);
  const filtered = useMemo(() => {
    if (!q) return items;
    const lq = q.toLowerCase();
    return items.filter(
      (i) =>
        i.label.toLowerCase().includes(lq) ||
        (i.sub ?? "").toLowerCase().includes(lq),
    );
  }, [items, q]);

  return (
    <div className="sd-combo">
      <button
        type="button"
        className={`sd-combo-trigger${open ? " open" : ""}${!value ? " empty" : ""}${disabled ? " disabled" : ""}`}
        onClick={() => {
          if (!disabled) {
            setOpen((v) => !v);
            setQ("");
          }
        }}
      >
        <span className="sd-combo-left">
          {selected ? (
            <span className="sd-combo-val">{selected.label}</span>
          ) : (
            <span className="sd-combo-placeholder">{placeholder}</span>
          )}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {value && !disabled && (
            <span
              className="sd-combo-clear"
              onClick={(e) => {
                e.stopPropagation();
                onChange("");
                setOpen(false);
              }}
            >
              <X size={12} />
            </span>
          )}
          <ChevronDown
            size={13}
            className={`sd-combo-chevron${open ? " open" : ""}`}
          />
        </span>
      </button>
      {open && (
        <div className="sd-combo-drop">
          <div className="sd-combo-search-wrap">
            <Search size={13} />
            <input
              className="sd-combo-search"
              placeholder="Search…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoFocus
            />
          </div>
          <div className="sd-combo-list">
            {filtered.length === 0 ? (
              <div className="sd-combo-empty">No results</div>
            ) : (
              filtered.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={`sd-combo-item${value === item.value ? " selected" : ""}`}
                  onClick={() => {
                    onChange(item.value);
                    setOpen(false);
                    setQ("");
                  }}
                >
                  <span className="sd-combo-item-label">{item.label}</span>
                  {item.sub && (
                    <span className="sd-combo-item-sub">{item.sub}</span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function SalesDeedPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  const canDeleteRecords = currentUser?.role !== "engineer";

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<DeedStatus | "">("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [signatureId, setSignatureId] = useState<number | null>(null);
  const [auditTarget, setAuditTarget] = useState<{
    id: number;
    no: string;
  } | null>(null);

  const { data: meta } = useQuery({
    queryKey: ["sales-deed-meta"],
    queryFn: fetchMeta,
    staleTime: 5 * 60 * 1000,
  });

  const {
    data: result,
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ["sales-deeds", page, search, statusFilter],
    queryFn: () =>
      fetchDeeds({ page, pageSize: PAGE_SIZE, search, status: statusFilter }),
    placeholderData: (prev) => prev,
  });

  const deeds = result?.data ?? [];
  const pagination = result?.pagination;

  // ── KPI counts ──
  const stats = useMemo(
    () => ({
      total: pagination?.total ?? 0,
      draft: deeds.filter((d) => d.Status === "Draft").length,
      executed: deeds.filter((d) => d.Status === "Executed").length,
      registered: deeds.filter((d) => d.Status === "Registered").length,
      overdue: deeds.filter((d) => d.Status === "Overdue").length,
    }),
    [deeds, pagination],
  );

  // ── Combobox items ──
  const applicantItems: ComboItem[] = useMemo(
    () =>
      (meta?.applicants ?? []).map((a) => ({
        value: String(a.Id),
        label: a.ApplicantName,
        sub: a.ApplicantNo ?? undefined,
      })),
    [meta],
  );

  const unitItems: ComboItem[] = useMemo(() => {
    const all = meta?.unitSelections ?? [];
    const filtered = form.ApplicantId
      ? all.filter((u) => String(u.ApplicantId) === form.ApplicantId)
      : all;
    return filtered.map((u) => ({
      value: String(u.Id),
      label: u.UnitNo,
      sub: u.SelectionNo,
    }));
  }, [meta, form.ApplicantId]);

  const agreementItems: ComboItem[] = useMemo(() => {
    const all = meta?.agreements ?? [];
    const filtered = form.ApplicantId
      ? all.filter((a) => String(a.ApplicantId) === form.ApplicantId)
      : all;
    return filtered.map((a) => ({ value: String(a.Id), label: a.AgreementNo }));
  }, [meta, form.ApplicantId]);

  const projectItems: ComboItem[] = useMemo(
    () =>
      filterProjectsByCompany(meta?.projects ?? [], form.CompanyId).map(
        (p) => ({
          value: String(p.Id),
          label: p.Name,
        }),
      ),
    [meta, form.CompanyId],
  );

  const companyItems: ComboItem[] = useMemo(
    () =>
      (meta?.companies ?? []).map((c) => ({
        value: String(c.Id),
        label: c.Name,
      })),
    [meta],
  );

  function set(k: keyof FormState, v: string) {
    setForm((f) => {
      const next = { ...f, [k]: v };
      if (k === "ApplicantId") {
        next.UnitSelectionId = "";
        next.AgreementId = "";
      }
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

  function openCreate() {
    setEditId(null);
    setForm(EMPTY_FORM);
    setSignatureId(null);
    setDialogOpen(true);
  }

  function openEdit(deed: SalesDeed) {
    setEditId(deed.Id);
    setForm({
      ApplicantId: String(deed.ApplicantId),
      UnitSelectionId: deed.UnitSelectionId ? String(deed.UnitSelectionId) : "",
      AgreementId: deed.AgreementId ? String(deed.AgreementId) : "",
      ProjectId: deed.ProjectId ? String(deed.ProjectId) : "",
      CompanyId: deed.CompanyId ? String(deed.CompanyId) : "",
      DeedValue: deed.DeedValue != null ? String(deed.DeedValue) : "",
      StampDuty: deed.StampDuty != null ? String(deed.StampDuty) : "",
      RegistrationFee:
        deed.RegistrationFee != null ? String(deed.RegistrationFee) : "",
      SubRegistrarOffice: deed.SubRegistrarOffice ?? "",
      RegistrationNo: deed.RegistrationNo ?? "",
      BookNo: deed.BookNo ?? "",
      PartNo: deed.PartNo ?? "",
      DeedDate: deed.DeedDate ?? "",
      RegistrationDate: deed.RegistrationDate ?? "",
      PossessionDate: deed.PossessionDate ?? "",
      ExecutedBy: deed.ExecutedBy ?? "",
      WitnessNames: deed.WitnessNames ?? "",
      Status: deed.Status,
      Notes: deed.Notes ?? "",
    });
    setSignatureId((deed as any).SignatureId ?? null);
    setDialogOpen(true);
  }

  function buildPayload() {
    return {
      ApplicantId: form.ApplicantId || null,
      UnitSelectionId: form.UnitSelectionId || null,
      AgreementId: form.AgreementId || null,
      ProjectId: form.ProjectId || null,
      CompanyId: form.CompanyId || null,
      DeedValue: form.DeedValue !== "" ? Number(form.DeedValue) : null,
      StampDuty: form.StampDuty !== "" ? Number(form.StampDuty) : null,
      RegistrationFee:
        form.RegistrationFee !== "" ? Number(form.RegistrationFee) : null,
      SubRegistrarOffice: form.SubRegistrarOffice || null,
      RegistrationNo: form.RegistrationNo || null,
      BookNo: form.BookNo || null,
      PartNo: form.PartNo || null,
      DeedDate: form.DeedDate || null,
      RegistrationDate: form.RegistrationDate || null,
      PossessionDate: form.PossessionDate || null,
      ExecutedBy: form.ExecutedBy || null,
      WitnessNames: form.WitnessNames || null,
      Status: form.Status,
      Notes: form.Notes || null,
      SignatureId: signatureId,
    };
  }

  const invalidate = () => qc.invalidateQueries({ queryKey: ["sales-deeds"] });

  const createMut = useMutation({
    mutationFn: () => createDeed(buildPayload()),
    onSuccess: () => {
      toast.success("Sales Deed created");
      invalidate();
      setDialogOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: () => updateDeed(editId!, buildPayload()),
    onSuccess: () => {
      toast.success("Sales Deed updated");
      invalidate();
      setDialogOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: () => deleteDeed(deleteId!),
    onSuccess: () => {
      toast.success("Sales Deed deleted");
      invalidate();
      setDeleteId(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const STATUS_FILTERS: Array<DeedStatus | ""> = [
    "",
    "Draft",
    "Executed",
    "Registered",
    "Overdue",
    "Cancelled",
  ];
  const STATUS_LABELS: Record<string, string> = {
    "": "All",
    Draft: "Draft",
    Executed: "Executed",
    Registered: "Registered",
    Overdue: "Overdue",
    Cancelled: "Cancelled",
  };

  const pageNums = useMemo(() => {
    if (!pagination) return [];
    const total = pagination.totalPages;
    const cur = pagination.page;
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    if (cur <= 4) return [1, 2, 3, 4, 5, "…", total];
    if (cur >= total - 3)
      return [1, "…", total - 4, total - 3, total - 2, total - 1, total];
    return [1, "…", cur - 1, cur, cur + 1, "…", total];
  }, [pagination]);

  return (
    <>
      <style>{`
        /* ── All sd-* classes use CSS vars — theme-safe ── */
        .sd-page {
          font-family: 'DM Sans', 'Segoe UI', sans-serif;
          color: hsl(var(--foreground));
        }

        /* ── Header ── */
        .sd-header {
          background: hsl(var(--card));
          border-bottom: 1px solid hsl(var(--border));
          padding: 20px 28px 0;
          position: sticky; top: 0; z-index: 20;
        }
        .sd-header-top {
          display: flex; align-items: flex-start;
          justify-content: space-between; margin-bottom: 16px; gap: 16px;
        }
        .sd-title-row { display: flex; align-items: center; gap: 12px; }
        .sd-icon {
          width: 40px; height: 40px;
          background: hsl(var(--primary));
          border-radius: 12px;
          display: flex; align-items: center; justify-content: center;
          color: hsl(var(--primary-foreground)); flex-shrink: 0;
          box-shadow: 0 2px 8px hsl(var(--primary) / 0.25);
        }
        .sd-title { font-size: 20px; font-weight: 700; color: hsl(var(--foreground)); }
        .sd-count {
          background: hsl(var(--primary) / 0.1); color: hsl(var(--primary));
          font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 20px;
        }
        .sd-add-btn {
          display: flex; align-items: center; gap: 6px;
          background: hsl(var(--primary)); color: hsl(var(--primary-foreground));
          border: none; border-radius: 10px; padding: 9px 16px;
          font-size: 13px; font-weight: 600; cursor: pointer;
          transition: all 0.15s; font-family: inherit;
          box-shadow: 0 2px 8px hsl(var(--primary) / 0.25); white-space: nowrap;
        }
        .sd-add-btn:hover { opacity: 0.9; transform: translateY(-1px); }

        /* ── Filter bar ── */
        .sd-filter-bar {
          display: flex; align-items: center; gap: 12px;
          padding: 14px 0; flex-wrap: wrap;
        }
        .sd-search-wrap { flex: 1; min-width: 200px; max-width: 400px; position: relative; }
        .sd-search-wrap svg { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: hsl(var(--muted-foreground)); pointer-events: none; }
        .sd-search {
          width: 100%; padding: 8px 12px 8px 36px;
          border: 1.5px solid hsl(var(--border)); border-radius: 9px;
          font-size: 13.5px; color: hsl(var(--foreground)); background: hsl(var(--card));
          outline: none; transition: border-color 0.15s; font-family: inherit; box-sizing: border-box;
        }
        .sd-search:focus { border-color: hsl(var(--primary)); }
        .sd-search-clear { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; color: hsl(var(--muted-foreground)); padding: 2px; display: flex; border-radius: 4px; }

        .sd-pills { display: flex; gap: 6px; flex-wrap: wrap; }
        .sd-pill {
          padding: 5px 12px; border-radius: 20px; font-size: 12px; font-weight: 500;
          border: 1.5px solid hsl(var(--border)); background: hsl(var(--card)); color: hsl(var(--muted-foreground));
          cursor: pointer; transition: all 0.12s; font-family: inherit; white-space: nowrap;
        }
        .sd-pill:hover { border-color: hsl(var(--primary)); color: hsl(var(--primary)); }
        .sd-pill.active           { background: hsl(var(--primary)); border-color: hsl(var(--primary)); color: hsl(var(--primary-foreground)); }
        .sd-pill.active-draft     { background: hsl(var(--muted)); border-color: hsl(var(--border)); color: hsl(var(--muted-foreground)); }
        .sd-pill.active-executed  { background: hsl(142 76% 36% / 0.12); border-color: hsl(142 76% 36% / 0.4); color: hsl(142 76% 36%); }
        .sd-pill.active-registered{ background: hsl(var(--primary) / 0.1); border-color: hsl(var(--primary) / 0.4); color: hsl(var(--primary)); }
        .sd-pill.active-overdue   { background: hsl(0 84% 60% / 0.12); border-color: hsl(0 84% 60% / 0.4); color: hsl(0 84% 40%); }
        .sd-pill.active-cancelled { background: hsl(0 84% 60% / 0.12); border-color: hsl(0 84% 60% / 0.4); color: hsl(0 84% 40%); }

        /* ── Stats bar ── */
        .sd-stats { display: flex; border-top: 1px solid hsl(var(--border)); }
        .sd-stat { flex: 1; padding: 12px 0; text-align: center; border-right: 1px solid hsl(var(--border)); }
        .sd-stat:last-child { border-right: none; }
        .sd-stat-val { font-size: 18px; font-weight: 700; color: hsl(var(--foreground)); }
        .sd-stat-label { font-size: 10px; font-weight: 600; color: hsl(var(--muted-foreground)); text-transform: uppercase; letter-spacing: 0.5px; margin-top: 1px; }
        .sd-stat-val.blue   { color: hsl(var(--primary)); }
        .sd-stat-val.green  { color: hsl(142 72% 38%); }
.sd-stat-val.amber  { color: hsl(38 92% 50%); }
        .sd-stat-val.red    { color: hsl(0 84% 45%); }

        /* ── Body ── */
        .sd-body { padding: 24px 28px; width: 100%; display: flex; flex-direction: column; }

        /* ── Table ── */
        .sd-table-wrap {
          background: hsl(var(--card)); border: 1px solid hsl(var(--border));
          border-radius: 14px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.04);
        }
        .sd-table { width: 100%; border-collapse: collapse; }
        .sd-table thead tr { border-bottom: 1.5px solid hsl(var(--border)); }
        .sd-table th {
          padding: 11px 16px; text-align: left;
          font-size: 11px; font-weight: 600; color: hsl(var(--muted-foreground));
          text-transform: uppercase; letter-spacing: 0.5px;
          background: hsl(var(--muted)); white-space: nowrap;
        }
        .sd-table td {
          padding: 14px 16px; font-size: 13.5px; color: hsl(var(--foreground));
          border-bottom: 1px solid hsl(var(--border)); vertical-align: middle;
        }
        .sd-table tbody tr:last-child td { border-bottom: none; }
        .sd-table tbody tr { transition: background 0.1s; }
        .sd-table tbody tr:hover { background: hsl(var(--background)); }

        .sd-deedno { font-weight: 700; color: hsl(var(--primary)); font-size: 13px; font-family: 'DM Mono', monospace; }
        .sd-applicant-cell { display: flex; align-items: center; gap: 9px; }
        .sd-avatar {
          width: 30px; height: 30px; border-radius: 8px;
          font-size: 11px; font-weight: 700; color: hsl(var(--primary-foreground));
          display: flex; align-items: center; justify-content: center; flex-shrink: 0;
        }
        .sd-applicant-name { font-weight: 600; color: hsl(var(--foreground)); font-size: 13px; }
        .sd-applicant-no   { font-size: 11px; color: hsl(var(--muted-foreground)); }

        .sd-unit     { font-size: 13px; color: hsl(var(--foreground)); }
        .sd-unit-sub { font-size: 11px; color: hsl(var(--muted-foreground)); }

        .sd-date     { font-size: 13px; color: hsl(var(--foreground)); }
        .sd-date-sub { font-size: 11px; color: hsl(var(--muted-foreground)); }

        .sd-amount     { font-size: 13px; font-weight: 600; color: hsl(var(--foreground)); font-family: 'DM Mono', monospace; }
        .sd-amount-sub { font-size: 11px; color: hsl(var(--muted-foreground)); }

        .sd-regoffice { font-size: 12px; color: hsl(var(--muted-foreground)); }

        /* ── Status badge ── */
        .sd-badge {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 3px 9px; border-radius: 20px; font-size: 11px; font-weight: 600;
        }
        .sd-badge-draft      { background: hsl(var(--muted));           color: hsl(var(--muted-foreground)); }
        .sd-badge-executed   { background: hsl(142 76% 36% / 0.12);    color: hsl(142 76% 36%); }
        .sd-badge-registered { background: hsl(var(--primary) / 0.1);  color: hsl(var(--primary)); }
        .sd-badge-overdue    { background: hsl(0 84% 60% / 0.12);      color: hsl(0 84% 40%); }
        .sd-badge-cancelled  { background: hsl(0 84% 60% / 0.12);      color: hsl(0 84% 40%); }

        /* ── Row actions ── */
        .sd-actions { position: relative; }
        .sd-menu-btn {
          width: 30px; height: 30px; border-radius: 7px;
          display: flex; align-items: center; justify-content: center;
          background: none; border: none; cursor: pointer; color: hsl(var(--muted-foreground));
          transition: all 0.1s;
        }
        .sd-menu-btn:hover { background: hsl(var(--muted)); color: hsl(var(--foreground)); }
        .sd-menu {
          position: absolute; right: 0; top: 100%; margin-top: 4px;
          background: hsl(var(--card)); border: 1px solid hsl(var(--border));
          border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,0.10);
          z-index: 50; min-width: 140px; overflow: hidden;
          animation: sd-menu-in 0.1s ease;
        }
        @keyframes sd-menu-in { from { opacity:0; transform: translateY(-4px); } to { opacity:1; transform: translateY(0); } }
        .sd-menu-item {
          display: flex; align-items: center; gap: 9px; padding: 9px 14px;
          font-size: 13px; font-weight: 500; cursor: pointer;
          background: none; border: none; width: 100%; text-align: left;
          font-family: inherit; color: hsl(var(--foreground)); transition: background 0.1s;
        }
        .sd-menu-item:hover { background: hsl(var(--background)); }
        .sd-menu-item.danger { color: hsl(0 84% 50%); }
        .sd-menu-item.danger:hover { background: hsl(0 84% 60% / 0.08); }

        /* ── Empty ── */
        .sd-empty {
          display: flex; flex-direction: column; align-items: center;
          justify-content: center; padding: 72px 24px; gap: 12px;
          color: hsl(var(--muted-foreground)); text-align: center;
        }
        .sd-empty-icon {
          width: 56px; height: 56px; background: hsl(var(--primary) / 0.1);
          border-radius: 14px; display: flex; align-items: center; justify-content: center;
        }
        .sd-empty h3 { font-size: 15px; font-weight: 600; color: hsl(var(--muted-foreground)); margin: 0; }
        .sd-empty p  { font-size: 13px; color: hsl(var(--muted-foreground)); margin: 0; }

        /* ── Pagination ── */
        .sd-pagination {
          display: flex; align-items: center; justify-content: space-between;
          padding: 14px 20px; border-top: 1px solid hsl(var(--border));
          font-size: 13px; color: hsl(var(--muted-foreground));
        }
        .sd-pag-btns { display: flex; gap: 6px; }
        .sd-pag-btn {
          width: 32px; height: 32px; border-radius: 8px;
          display: flex; align-items: center; justify-content: center;
          background: none; border: 1px solid hsl(var(--border)); cursor: pointer;
          color: hsl(var(--foreground)); transition: all 0.12s; font-family: inherit; font-size: 12px;
        }
        .sd-pag-btn:hover:not(:disabled) { border-color: hsl(var(--primary)); color: hsl(var(--primary)); }
        .sd-pag-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .sd-pag-btn.active { background: hsl(var(--primary)); border-color: hsl(var(--primary)); color: hsl(var(--primary-foreground)); font-weight: 600; }

        /* ── Skeleton ── */
        .sd-skel {
          background: linear-gradient(90deg, hsl(var(--muted)) 25%, hsl(var(--border)) 50%, hsl(var(--muted)) 75%);
          background-size: 200% 100%; animation: sd-shimmer 1.4s infinite; border-radius: 6px;
        }
        @keyframes sd-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

        /* ── Combobox ── */
        .sd-combo { position: relative; width: 100%; }
        .sd-combo-trigger {
          width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px;
          padding: 8px 12px; border: 1.5px solid hsl(var(--border)); border-radius: 9px;
          font-size: 14px; background: hsl(var(--card)); color: hsl(var(--foreground));
          cursor: pointer; text-align: left; transition: border-color 0.15s;
          font-family: inherit; min-height: 38px;
        }
        .sd-combo-trigger:focus { outline: none; border-color: hsl(var(--primary)); }
        .sd-combo-trigger.open { border-color: hsl(var(--primary)); border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
        .sd-combo-trigger.empty { color: hsl(var(--muted-foreground)); }
        .sd-combo-trigger.disabled { background: hsl(var(--background)); opacity: 0.6; cursor: not-allowed; }
        .sd-combo-left { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; }
        .sd-combo-val { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 13.5px; }
        .sd-combo-placeholder { font-size: 13.5px; }
        .sd-combo-chevron { color: hsl(var(--muted-foreground)); flex-shrink: 0; transition: transform 0.15s; }
        .sd-combo-chevron.open { transform: rotate(180deg); }
        .sd-combo-clear { background: none; border: none; cursor: pointer; color: hsl(var(--muted-foreground)); padding: 2px; display: flex; flex-shrink: 0; border-radius: 4px; }
        .sd-combo-clear:hover { background: hsl(var(--muted)); }
        .sd-combo-drop {
          position: absolute; top: 100%; left: 0; right: 0; background: hsl(var(--card));
          border: 1.5px solid hsl(var(--primary)); border-top: 1px solid hsl(var(--border));
          border-radius: 0 0 9px 9px; box-shadow: 0 8px 24px rgba(0,0,0,0.10);
          z-index: 100; overflow: hidden; max-height: 220px; display: flex; flex-direction: column;
        }
        .sd-combo-search-wrap { position: relative; border-bottom: 1px solid hsl(var(--muted)); flex-shrink: 0; }
        .sd-combo-search-wrap svg { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: hsl(var(--muted-foreground)); pointer-events: none; }
        .sd-combo-search { width: 100%; padding: 8px 12px 8px 34px; border: none; font-size: 13px; color: hsl(var(--foreground)); background: hsl(var(--background)); outline: none; font-family: inherit; box-sizing: border-box; }
        .sd-combo-list { overflow-y: auto; flex: 1; }
        .sd-combo-item { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 12px; cursor: pointer; transition: background 0.1s; border: none; background: none; width: 100%; text-align: left; font-family: inherit; }
        .sd-combo-item:hover { background: hsl(var(--primary) / 0.1); }
        .sd-combo-item.selected { background: hsl(var(--primary) / 0.15); }
        .sd-combo-item-label { font-size: 13px; font-weight: 500; color: hsl(var(--foreground)); flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .sd-combo-item-sub { font-size: 11px; color: hsl(var(--muted-foreground)); flex-shrink: 0; }
        .sd-combo-empty { padding: 16px; text-align: center; font-size: 13px; color: hsl(var(--muted-foreground)); }

        /* ── Form ── */
        .sd-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .sd-form-grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
        .sd-form-section {
          font-size: 10px; font-weight: 700; color: hsl(var(--muted-foreground));
          text-transform: uppercase; letter-spacing: 1px;
          padding-top: 8px; border-top: 1px solid hsl(var(--border)); margin-top: 4px;
        }
        .sd-status-select {
          width: 100%; padding: 8px 12px; border: 1.5px solid hsl(var(--border)); border-radius: 9px;
          font-size: 13.5px; color: hsl(var(--foreground)); background: hsl(var(--card));
          outline: none; transition: border-color 0.15s; font-family: inherit;
          cursor: pointer; appearance: none; -webkit-appearance: none;
        }
        .sd-status-select:focus { border-color: hsl(var(--primary)); }

        @media (max-width: 768px) {
          .sd-header { padding: 16px 16px 0; }
          .sd-body { padding: 16px; }
          .sd-form-grid, .sd-form-grid-3 { grid-template-columns: 1fr; }
          .sd-stats { flex-wrap: wrap; }
          .sd-stat { min-width: 50%; }
          .sd-table th:nth-child(4), .sd-table td:nth-child(4),
          .sd-table th:nth-child(5), .sd-table td:nth-child(5) { display: none; }
        }
      `}</style>

      <Breadcrumbs
        items={[
          { label: "Follow-Up", path: "/followup" },
          { label: "Closure", path: "/followup/closure/sales-deed" },
          { label: "Sales Deed", path: "/followup/closure/sales-deed" },
        ]}
      />
      <div
        className="sd-page relative space-y-8 mt-6"
        onClick={() => setOpenMenuId(null)}
      >
        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-4">
          <div className="sd-title-row">
            <div className="sd-icon">
              <FileSignature size={20} />
            </div>
            <span className="sd-title">Sales Deeds</span>
            <span className="sd-count">{pagination?.total ?? 0}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
            >
              <RefreshCw
                size={13}
                className={isFetching ? "animate-spin" : ""}
              />
              Refresh
            </button>
            <Button
              size="sm"
              onClick={openCreate}
              className="gradient-accent gap-1.5 shrink-0 font-semibold text-white text-sm px-5 py-2 h-auto"
            >
              <Plus size={14} /> New Deed
            </Button>
          </div>
        </div>

        {/* Filter + search */}
        <div className="sd-filter-bar">
          <div className="sd-search-wrap">
            <Search size={14} />
            <input
              className="sd-search"
              placeholder="Search by applicant, deed no, unit, reg. no…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
            {search && (
              <button
                className="sd-search-clear"
                onClick={() => {
                  setSearch("");
                  setPage(1);
                }}
              >
                <X size={13} />
              </button>
            )}
          </div>
          <div className="sd-pills">
            {STATUS_FILTERS.map((s) => {
              const isActive = statusFilter === s;
              const pillClass = isActive
                ? s === ""
                  ? "sd-pill active"
                  : s === "Draft"
                    ? "sd-pill active-draft"
                    : s === "Executed"
                      ? "sd-pill active-executed"
                      : s === "Registered"
                        ? "sd-pill active-registered"
                        : s === "Overdue"
                          ? "sd-pill active-overdue"
                          : "sd-pill active-cancelled"
                : "sd-pill";
              return (
                <button
                  key={s}
                  className={pillClass}
                  onClick={() => {
                    setStatusFilter(s);
                    setPage(1);
                  }}
                >
                  {STATUS_LABELS[s]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Stats bar */}
        <div className="sd-stats">
          {[
            { label: "Total", val: pagination?.total ?? 0, cls: "blue" },
            { label: "Draft", val: stats.draft, cls: "" },
            { label: "Executed", val: stats.executed, cls: "green" },
            { label: "Registered", val: stats.registered, cls: "amber" },
            { label: "Overdue", val: stats.overdue, cls: "red" },
          ].map(({ label, val, cls }) => (
            <div key={label} className="sd-stat">
              <div className={`sd-stat-val ${cls}`}>{val}</div>
              <div className="sd-stat-label">{label}</div>
            </div>
          ))}
        </div>

        {/* ── Body ── */}
        <div className="sd-body" style={{ paddingTop: 0, paddingBottom: 0 }}>
          <div className="sd-table-wrap">
            {isLoading ? (
              <table className="sd-table">
                <thead>
                  <tr>
                    {[
                      "Deed No",
                      "Buyer",
                      "Unit / Project",
                      "Deed Value",
                      "Dates",
                      "Status",
                      "",
                    ].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>
                      {[80, 160, 120, 100, 110, 80, 40].map((w, j) => (
                        <td key={j}>
                          <div
                            className="sd-skel"
                            style={{ height: 14, width: w }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : deeds.length === 0 ? (
              <div className="sd-empty">
                <div className="sd-empty-icon">
                  <FileSignature
                    size={26}
                    style={{ color: "hsl(var(--primary))" }}
                  />
                </div>
                <h3>
                  {search || statusFilter
                    ? "No matching Sales Deeds"
                    : "No Sales Deeds yet"}
                </h3>
                <p>
                  {search || statusFilter
                    ? "Try clearing your filters"
                    : "Create the first Sales Deed to start tracking property registrations"}
                </p>
                {!search && !statusFilter && (
                  <Button
                    onClick={openCreate}
                    className="gradient-accent gap-1.5 shrink-0 font-semibold text-white text-sm px-5 py-2 h-auto mt-2"
                  >
                    <Plus size={14} /> New Deed
                  </Button>
                )}
              </div>
            ) : (
              <>
                <table className="sd-table">
                  <thead>
                    <tr>
                      <th>Deed No</th>
                      <th>Buyer</th>
                      <th>Unit / Project</th>
                      <th>Deed Value</th>
                      <th>Dates</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {deeds.map((deed) => {
                      const sm = STATUS_META[deed.Status];
                      const color = avatarColor(deed.ApplicantName);
                      return (
                        <tr key={deed.Id}>
                          {/* Deed No */}
                          <td>
                            <div className="sd-deedno">{deed.DeedNo}</div>
                            {deed.RegistrationNo && (
                              <div className="sd-unit-sub">
                                Reg: {deed.RegistrationNo}
                              </div>
                            )}
                            {deed.AgreementNo && (
                              <div className="sd-unit-sub">
                                Agr: {deed.AgreementNo}
                              </div>
                            )}
                          </td>

                          {/* Buyer / Applicant */}
                          <td>
                            <div className="sd-applicant-cell">
                              <div
                                className="sd-avatar"
                                style={{ background: color }}
                              >
                                {initials(deed.ApplicantName)}
                              </div>
                              <div>
                                <div className="sd-applicant-name">
                                  {deed.ApplicantName}
                                </div>
                                <div className="sd-applicant-no">
                                  {deed.ApplicantNo}
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* Unit / Project */}
                          <td>
                            {deed.UnitNo ? (
                              <div className="sd-unit">{deed.UnitNo}</div>
                            ) : (
                              <div
                                className="sd-unit"
                                style={{
                                  color: "hsl(var(--muted-foreground))",
                                }}
                              >
                                —
                              </div>
                            )}
                            {deed.ProjectName && (
                              <div className="sd-unit-sub">
                                {deed.ProjectName}
                              </div>
                            )}
                            {deed.SubRegistrarOffice && (
                              <div className="sd-regoffice">
                                SRO: {deed.SubRegistrarOffice}
                              </div>
                            )}
                          </td>

                          {/* Deed Value */}
                          <td>
                            <div className="sd-amount">
                              {fmtCurrency(deed.DeedValue)}
                            </div>
                            {deed.StampDuty != null && (
                              <div className="sd-amount-sub">
                                Stamp: {fmtCurrency(deed.StampDuty)}
                              </div>
                            )}
                            {deed.RegistrationFee != null && (
                              <div className="sd-amount-sub">
                                Reg fee: {fmtCurrency(deed.RegistrationFee)}
                              </div>
                            )}
                          </td>

                          {/* Dates */}
                          <td>
                            <div className="sd-date">
                              {fmtDate(deed.DeedDate)}
                            </div>
                            {deed.RegistrationDate && (
                              <div className="sd-date-sub">
                                Reg: {fmtDate(deed.RegistrationDate)}
                              </div>
                            )}
                            {deed.PossessionDate && (
                              <div className="sd-date-sub">
                                Possession: {fmtDate(deed.PossessionDate)}
                              </div>
                            )}
                          </td>

                          {/* Status */}
                          <td>
                            <span className={`sd-badge ${sm.cls}`}>
                              {sm.icon} {sm.label}
                            </span>
                          </td>

                          {/* Actions */}
                          <td>
                            <div
                              className="sd-actions"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                className="sd-menu-btn"
                                onClick={() =>
                                  setOpenMenuId(
                                    openMenuId === deed.Id ? null : deed.Id,
                                  )
                                }
                              >
                                <MoreHorizontal size={16} />
                              </button>
                              {openMenuId === deed.Id && (
                                <div className="sd-menu">
                                  <button
                                    className="sd-menu-item"
                                    onClick={() => {
                                      openEdit(deed);
                                      setOpenMenuId(null);
                                    }}
                                  >
                                    <Pencil size={13} /> Edit
                                  </button>
                                  <button
                                    className="sd-menu-item"
                                    onClick={() => {
                                      setAuditTarget({
                                        id: deed.Id,
                                        no: deed.DeedNo,
                                      });
                                      setOpenMenuId(null);
                                    }}
                                  >
                                    <Clock size={13} /> History
                                  </button>
                                  {canDeleteRecords && (
                                    <button
                                      className="sd-menu-item danger"
                                      onClick={() => {
                                        setDeleteId(deed.Id);
                                        setOpenMenuId(null);
                                      }}
                                    >
                                      <Trash2 size={13} /> Delete
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

                {/* Pagination */}
                {pagination && pagination.totalPages > 1 && (
                  <div className="sd-pagination">
                    <span>
                      {(pagination.page - 1) * pagination.pageSize + 1}–
                      {Math.min(
                        pagination.page * pagination.pageSize,
                        pagination.total,
                      )}{" "}
                      of {pagination.total}
                    </span>
                    <div className="sd-pag-btns">
                      <button
                        className="sd-pag-btn"
                        disabled={page <= 1}
                        onClick={() => setPage((p) => p - 1)}
                      >
                        <ChevronLeft size={14} />
                      </button>
                      {pageNums.map((n, i) =>
                        n === "…" ? (
                          <span
                            key={`ellipsis-${i}`}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              padding: "0 4px",
                              color: "hsl(var(--muted-foreground))",
                              fontSize: 13,
                            }}
                          >
                            …
                          </span>
                        ) : (
                          <button
                            key={n}
                            className={`sd-pag-btn${page === n ? " active" : ""}`}
                            onClick={() => setPage(n as number)}
                          >
                            {n}
                          </button>
                        ),
                      )}
                      <button
                        className="sd-pag-btn"
                        disabled={page >= pagination.totalPages}
                        onClick={() => setPage((p) => p + 1)}
                      >
                        <ChevronRight size={14} />
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Create / Edit Dialog ── */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(v) => {
          if (!v) setDialogOpen(false);
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold">
              <div
                style={{
                  width: 28,
                  height: 28,
                  background: "hsl(var(--primary))",
                  borderRadius: 7,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <FileSignature
                  size={15}
                  style={{ color: "hsl(var(--primary-foreground))" }}
                />
              </div>
              {editId ? "Edit Sales Deed" : "New Sales Deed"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-1">
            {/* Applicant */}
            <div className="space-y-2">
              <Label>
                Buyer (Applicant) <span className="text-destructive">*</span>
              </Label>
              <Combobox
                value={form.ApplicantId}
                onChange={(v) => set("ApplicantId", v)}
                items={applicantItems}
                placeholder="Select buyer…"
              />
            </div>

            {/* Unit Selection + Agreement */}
            <div className="sd-form-grid">
              <div className="space-y-2">
                <Label>Unit Selection</Label>
                <Combobox
                  value={form.UnitSelectionId}
                  onChange={(v) => set("UnitSelectionId", v)}
                  items={unitItems}
                  placeholder="Select unit…"
                  disabled={!form.ApplicantId}
                />
              </div>
              <div className="space-y-2">
                <Label>Linked Agreement</Label>
                <Combobox
                  value={form.AgreementId}
                  onChange={(v) => set("AgreementId", v)}
                  items={agreementItems}
                  placeholder="Select agreement…"
                  disabled={!form.ApplicantId}
                />
              </div>
            </div>

            {/* Project + Company */}
            <div className="sd-form-grid">
              <div className="space-y-2">
                <Label>Project</Label>
                <Combobox
                  value={form.ProjectId}
                  onChange={(v) => set("ProjectId", v)}
                  items={projectItems}
                  placeholder="Select project…"
                />
              </div>
              <div className="space-y-2">
                <Label>Company (Seller)</Label>
                <Combobox
                  value={form.CompanyId}
                  onChange={(v) => set("CompanyId", v)}
                  items={companyItems}
                  placeholder="Select company…"
                />
              </div>
            </div>

            <div className="sd-form-section">Financials</div>

            {/* Deed Value, Stamp Duty, Reg Fee */}
            <div className="sd-form-grid-3">
              <div className="space-y-2">
                <Label>Deed Value (₹)</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.DeedValue}
                  onChange={(e) => set("DeedValue", e.target.value)}
                  placeholder="e.g. 5000000"
                />
              </div>
              <div className="space-y-2">
                <Label>Stamp Duty (₹)</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.StampDuty}
                  onChange={(e) => set("StampDuty", e.target.value)}
                  placeholder="e.g. 300000"
                />
              </div>
              <div className="space-y-2">
                <Label>Registration Fee (₹)</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.RegistrationFee}
                  onChange={(e) => set("RegistrationFee", e.target.value)}
                  placeholder="e.g. 30000"
                />
              </div>
            </div>

            <div className="sd-form-section">Registration Details</div>

            {/* SRO + Reg No */}
            <div className="sd-form-grid">
              <div className="space-y-2">
                <Label>Sub-Registrar Office</Label>
                <Input
                  value={form.SubRegistrarOffice}
                  onChange={(e) => set("SubRegistrarOffice", e.target.value)}
                  placeholder="SRO name / location…"
                />
              </div>
              <div className="space-y-2">
                <Label>Registration No.</Label>
                <Input
                  value={form.RegistrationNo}
                  onChange={(e) => set("RegistrationNo", e.target.value)}
                  placeholder="Official reg. number…"
                />
              </div>
            </div>

            {/* Book No + Part No */}
            <div className="sd-form-grid">
              <div className="space-y-2">
                <Label>Book No.</Label>
                <Input
                  value={form.BookNo}
                  onChange={(e) => set("BookNo", e.target.value)}
                  placeholder="Book / volume…"
                />
              </div>
              <div className="space-y-2">
                <Label>Part / Serial No.</Label>
                <Input
                  value={form.PartNo}
                  onChange={(e) => set("PartNo", e.target.value)}
                  placeholder="Part no. within book…"
                />
              </div>
            </div>

            <div className="sd-form-section">Key Dates</div>

            {/* Dates */}
            <div className="sd-form-grid-3">
              <div className="space-y-2">
                <Label>Deed Date</Label>
                <div className="relative">
                  <CalendarDays
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                  />
                  <input
                    type="date"
                    value={form.DeedDate}
                    onChange={(e) => set("DeedDate", e.target.value)}
                    className="w-full pl-8 pr-3 py-2 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Registration Date</Label>
                <div className="relative">
                  <CalendarDays
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                  />
                  <input
                    type="date"
                    value={form.RegistrationDate}
                    onChange={(e) => set("RegistrationDate", e.target.value)}
                    className="w-full pl-8 pr-3 py-2 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Possession Date</Label>
                <div className="relative">
                  <CalendarDays
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                  />
                  <input
                    type="date"
                    value={form.PossessionDate}
                    onChange={(e) => set("PossessionDate", e.target.value)}
                    className="w-full pl-8 pr-3 py-2 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                  />
                </div>
              </div>
            </div>

            <div className="sd-form-section">Parties &amp; Status</div>

            {/* Executed By + Witnesses */}
            <div className="sd-form-grid">
              <div className="space-y-2">
                <Label>Executed By</Label>
                <Input
                  value={form.ExecutedBy}
                  onChange={(e) => set("ExecutedBy", e.target.value)}
                  placeholder="Seller signatory / authority…"
                />
              </div>
              <div className="space-y-2">
                <Label>Witnesses</Label>
                <Input
                  value={form.WitnessNames}
                  onChange={(e) => set("WitnessNames", e.target.value)}
                  placeholder="Witness 1, Witness 2…"
                />
              </div>
            </div>

            {/* Status */}
            <div className="space-y-2">
              <Label>Status</Label>
              <select
                className="sd-status-select"
                value={form.Status}
                onChange={(e) => set("Status", e.target.value as DeedStatus)}
              >
                {(
                  meta?.statusOptions ??
                  ([
                    "Draft",
                    "Executed",
                    "Registered",
                    "Overdue",
                    "Cancelled",
                  ] as DeedStatus[])
                ).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={form.Notes}
                onChange={(e) => set("Notes", e.target.value)}
                placeholder="Additional remarks…"
                rows={2}
              />
            </div>

            {/* Signature stamp */}
            <div className="space-y-2">
              <Label>Signature Stamp (optional)</Label>
              <SignaturePicker value={signatureId} onChange={setSignatureId} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                !form.ApplicantId || createMut.isPending || updateMut.isPending
              }
              onClick={() => (editId ? updateMut.mutate() : createMut.mutate())}
              className="gradient-accent gap-1.5 shrink-0 font-semibold text-white text-sm px-5 py-2 h-auto"
            >
              {createMut.isPending || updateMut.isPending
                ? "Saving…"
                : editId
                  ? "Update Deed"
                  : "Create Deed"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirm ── */}
      <AlertDialog
        open={!!deleteId}
        onOpenChange={(v) => {
          if (!v) setDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this Sales Deed?</AlertDialogTitle>
            <AlertDialogDescription>
              This Sales Deed record will be permanently removed. This action
              cannot be undone.
            </AlertDialogDescription>
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

      <AuditLogDrawer
        open={!!auditTarget}
        onClose={() => setAuditTarget(null)}
        module="SalesDeed"
        recordId={auditTarget?.id ?? null}
        recordNo={auditTarget?.no}
      />
    </>
  );
}

export default SalesDeedPage;
