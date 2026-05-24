import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Plus,
  Search,
  X,
  FileText,
  Building2,
  User,
  CalendarDays,
  IndianRupee,
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
  StickyNote,
  Home,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
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

// ─── Types ────────────────────────────────────────────────────────────────────

type AgreementStatus = "Draft" | "Issued" | "Signed" | "Cancelled";

interface Agreement {
  Id: number;
  AgreementNo: string;
  ApplicantId: number;
  ApplicantNo: string;
  ApplicantName: string;
  UnitSelectionId: number | null;
  SelectionNo: string | null;
  UnitNo: string | null;
  ProjectId: number | null;
  ProjectName: string | null;
  CompanyId: number | null;
  CompanyName: string | null;
  AgreementDate: string | null;
  AgreementValue: number | null;
  AdvanceAmount: number | null;
  BalanceAmount: number | null;
  RegistrationDate: string | null;
  Status: AgreementStatus;
  Notes: string | null;
  CreatedBy: string;
  CreatedAt: string;
}

interface OptionApplicant {
  Id: number;
  ApplicantNo: string;
  ApplicantName: string;
  ProjectId: number | null;
  CompanyId: number | null;
}

interface OptionUnitSelection {
  Id: number;
  SelectionNo: string;
  UnitNo: string;
  ApplicantId: number;
  ProjectId: number | null;
  CompanyId: number | null;
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
  projects: OptionProject[];
  companies: OptionCompany[];
  statusOptions: AgreementStatus[];
}

interface FormState {
  ApplicantId: string;
  UnitSelectionId: string;
  ProjectId: string;
  CompanyId: string;
  AgreementDate: string;
  AgreementValue: string;
  AdvanceAmount: string;
  RegistrationDate: string;
  Status: AgreementStatus;
  Notes: string;
}

const EMPTY_FORM: FormState = {
  ApplicantId: "",
  UnitSelectionId: "",
  ProjectId: "",
  CompanyId: "",
  AgreementDate: "",
  AgreementValue: "",
  AdvanceAmount: "",
  RegistrationDate: "",
  Status: "Draft",
  Notes: "",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

const STATUS_META: Record<
  AgreementStatus,
  { label: string; icon: React.ReactNode; cls: string }
> = {
  Draft: { label: "Draft", icon: <Clock size={11} />, cls: "ag-badge-draft" },
  Issued: {
    label: "Issued",
    icon: <AlertCircle size={11} />,
    cls: "ag-badge-issued",
  },
  Signed: {
    label: "Signed",
    icon: <CheckCircle2 size={11} />,
    cls: "ag-badge-signed",
  },
  Cancelled: {
    label: "Cancelled",
    icon: <Ban size={11} />,
    cls: "ag-badge-cancelled",
  },
};

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

// ─── API ──────────────────────────────────────────────────────────────────────

async function fetchMeta(): Promise<MetaOptions> {
  const res = await fetchWithAuth("/api/followup-agreements/meta/options");
  if (!res.ok) throw new Error("Failed to load options");
  return res.json();
}

async function fetchAgreements(params: {
  page: number;
  pageSize: number;
  search: string;
  status: string;
}): Promise<{
  data: Agreement[];
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
  const res = await fetchWithAuth(`/api/followup-agreements?${q}`);
  if (!res.ok) throw new Error("Failed to load agreements");
  return res.json();
}

async function createAgreement(payload: Record<string, unknown>) {
  const res = await fetchWithAuth("/api/followup-agreements", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error || "Failed to create agreement",
    );
  }
}

async function updateAgreement(id: number, payload: Record<string, unknown>) {
  const res = await fetchWithAuth(`/api/followup-agreements/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error || "Failed to update agreement",
    );
  }
}

async function deleteAgreement(id: number) {
  const res = await fetchWithAuth(`/api/followup-agreements/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete agreement");
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
    <div className="ag-combo">
      <button
        type="button"
        className={`ag-combo-trigger${open ? " open" : ""}${!value ? " empty" : ""}${disabled ? " disabled" : ""}`}
        onClick={() => {
          if (!disabled) {
            setOpen((v) => !v);
            setQ("");
          }
        }}
      >
        <span className="ag-combo-left">
          {selected ? (
            <span className="ag-combo-val">{selected.label}</span>
          ) : (
            <span className="ag-combo-placeholder">{placeholder}</span>
          )}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {value && !disabled && (
            <span
              className="ag-combo-clear"
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
            className={`ag-combo-chevron${open ? " open" : ""}`}
          />
        </span>
      </button>
      {open && (
        <div className="ag-combo-drop">
          <div className="ag-combo-search-wrap">
            <Search size={13} />
            <input
              className="ag-combo-search"
              placeholder="Search…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoFocus
            />
          </div>
          <div className="ag-combo-list">
            {filtered.length === 0 ? (
              <div className="ag-combo-empty">No results</div>
            ) : (
              filtered.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={`ag-combo-item${value === item.value ? " selected" : ""}`}
                  onClick={() => {
                    onChange(item.value);
                    setOpen(false);
                    setQ("");
                  }}
                >
                  <span className="ag-combo-item-label">{item.label}</span>
                  {item.sub && (
                    <span className="ag-combo-item-sub">{item.sub}</span>
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

export function AgreementsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  const canDeleteRecords = currentUser?.role !== "engineer";

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<AgreementStatus | "">("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);

  // computed balance
  const balanceAmount = useMemo(() => {
    const val = parseFloat(form.AgreementValue);
    const adv = parseFloat(form.AdvanceAmount);
    if (!isNaN(val) && !isNaN(adv)) return val - adv;
    return null;
  }, [form.AgreementValue, form.AdvanceAmount]);

  // filtered unit selections per applicant
  const { data: meta } = useQuery({
    queryKey: ["ag-meta"],
    queryFn: fetchMeta,
    staleTime: 5 * 60 * 1000,
  });

  const { data: result, isLoading } = useQuery({
    queryKey: ["agreements", page, search, statusFilter],
    queryFn: () =>
      fetchAgreements({
        page,
        pageSize: PAGE_SIZE,
        search,
        status: statusFilter,
      }),
    placeholderData: (prev) => prev,
  });

  const agreements = result?.data ?? [];
  const pagination = result?.pagination;

  const applicantItems: ComboItem[] = useMemo(
    () =>
      (meta?.applicants ?? []).map((a) => ({
        value: String(a.Id),
        label: a.ApplicantName,
        sub: a.ApplicantNo,
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

  const projectItems: ComboItem[] = useMemo(
    () =>
      (meta?.projects ?? []).map((p) => ({
        value: String(p.Id),
        label: p.Name,
      })),
    [meta],
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
      // auto-fill project/company from applicant
      if (k === "ApplicantId") {
        const appl = meta?.applicants.find((a) => String(a.Id) === v);
        if (appl) {
          if (appl.ProjectId) next.ProjectId = String(appl.ProjectId);
          if (appl.CompanyId) next.CompanyId = String(appl.CompanyId);
        }
        next.UnitSelectionId = "";
      }
      // auto-fill project/company from unit selection
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
    setDialogOpen(true);
  }

  function openEdit(ag: Agreement) {
    setEditId(ag.Id);
    setForm({
      ApplicantId: String(ag.ApplicantId),
      UnitSelectionId: ag.UnitSelectionId ? String(ag.UnitSelectionId) : "",
      ProjectId: ag.ProjectId ? String(ag.ProjectId) : "",
      CompanyId: ag.CompanyId ? String(ag.CompanyId) : "",
      AgreementDate: ag.AgreementDate ?? "",
      AgreementValue:
        ag.AgreementValue != null ? String(ag.AgreementValue) : "",
      AdvanceAmount: ag.AdvanceAmount != null ? String(ag.AdvanceAmount) : "",
      RegistrationDate: ag.RegistrationDate ?? "",
      Status: ag.Status,
      Notes: ag.Notes ?? "",
    });
    setDialogOpen(true);
  }

  function buildPayload() {
    return {
      ApplicantId: form.ApplicantId || null,
      UnitSelectionId: form.UnitSelectionId || null,
      ProjectId: form.ProjectId || null,
      CompanyId: form.CompanyId || null,
      AgreementDate: form.AgreementDate || null,
      AgreementValue: form.AgreementValue || null,
      AdvanceAmount: form.AdvanceAmount || null,
      RegistrationDate: form.RegistrationDate || null,
      Status: form.Status,
      Notes: form.Notes || null,
    };
  }

  const invalidate = () => qc.invalidateQueries({ queryKey: ["agreements"] });

  const createMut = useMutation({
    mutationFn: () => createAgreement(buildPayload()),
    onSuccess: () => {
      toast.success("Agreement created");
      invalidate();
      setDialogOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: () => updateAgreement(editId!, buildPayload()),
    onSuccess: () => {
      toast.success("Agreement updated");
      invalidate();
      setDialogOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: () => deleteAgreement(deleteId!),
    onSuccess: () => {
      toast.success("Agreement deleted");
      invalidate();
      setDeleteId(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const STATUS_FILTERS: Array<AgreementStatus | ""> = [
    "",
    "Draft",
    "Issued",
    "Signed",
    "Cancelled",
  ];
  const STATUS_FILTER_LABELS: Record<string, string> = {
    "": "All",
    Draft: "Draft",
    Issued: "Issued",
    Signed: "Signed",
    Cancelled: "Cancelled",
  };

  return (
    <>
      <style>{`
        /* ── Theme bridge: all ag-* classes use CSS vars ── */
        .ag-page {
          min-height: 100vh;
          background: hsl(var(--background));
          font-family: 'DM Sans', 'Segoe UI', sans-serif;
          color: hsl(var(--foreground));
        }

        /* ── Header ── */
        .ag-header {
          background: hsl(var(--card));
          border-bottom: 1px solid hsl(var(--border));
          padding: 20px 28px 0;
          position: sticky;
          top: 0;
          z-index: 20;
        }
        .ag-header-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 16px;
          gap: 16px;
        }
        .ag-back {
          display: flex; align-items: center; gap: 6px;
          font-size: 12px; font-weight: 500; color: hsl(var(--muted-foreground));
          background: none; border: none; cursor: pointer;
          padding: 0; transition: color 0.15s;
          font-family: inherit;
        }
        .ag-back:hover { color: hsl(var(--primary)); }
        .ag-title-row {
          display: flex; align-items: center; gap: 12px;
        }
        .ag-icon {
          width: 40px; height: 40px;
          background: hsl(var(--primary));
          border-radius: 12px;
          display: flex; align-items: center; justify-content: center;
          color: hsl(var(--primary-foreground)); flex-shrink: 0;
          box-shadow: 0 2px 8px rgba(37,99,235,0.25);
        }
        .ag-title { font-size: 20px; font-weight: 700; color: hsl(var(--foreground)); }
        .ag-count {
          background: hsl(var(--primary) / 0.1); color: hsl(var(--primary));
          font-size: 12px; font-weight: 600;
          padding: 2px 8px; border-radius: 20px;
        }
        .ag-add-btn {
          display: flex; align-items: center; gap: 6px;
          background: hsl(var(--primary));
          color: hsl(var(--primary-foreground)); border: none; border-radius: 10px;
          padding: 9px 16px; font-size: 13px; font-weight: 600;
          cursor: pointer; transition: all 0.15s;
          font-family: inherit; box-shadow: 0 2px 8px rgba(37,99,235,0.25);
          white-space: nowrap;
        }
        .ag-add-btn:hover { opacity: 0.9; transform: translateY(-1px); }

        /* ── Filter bar ── */
        .ag-filter-bar {
          display: flex; align-items: center; gap: 12px;
          padding: 14px 0;
          flex-wrap: wrap;
        }
        .ag-search-wrap {
          flex: 1; min-width: 200px; max-width: 380px;
          position: relative;
        }
        .ag-search-wrap svg { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: hsl(var(--muted-foreground)); pointer-events: none; }
        .ag-search {
          width: 100%; padding: 8px 12px 8px 36px;
          border: 1.5px solid hsl(var(--border)); border-radius: 9px;
          font-size: 13.5px; color: hsl(var(--foreground)); background: hsl(var(--card));
          outline: none; transition: border-color 0.15s;
          font-family: inherit; box-sizing: border-box;
        }
        .ag-search:focus { border-color: hsl(var(--primary)); }
        .ag-search-clear { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; color: hsl(var(--muted-foreground)); padding: 2px; display: flex; border-radius: 4px; }
        .ag-search-clear:hover { color: hsl(var(--muted-foreground)); }

        .ag-pills { display: flex; gap: 6px; flex-wrap: wrap; }
        .ag-pill {
          padding: 5px 12px; border-radius: 20px; font-size: 12px; font-weight: 500;
          border: 1.5px solid hsl(var(--border)); background: hsl(var(--card)); color: hsl(var(--muted-foreground));
          cursor: pointer; transition: all 0.12s; font-family: inherit;
          white-space: nowrap;
        }
        .ag-pill:hover { border-color: hsl(var(--primary)); color: hsl(var(--primary)); }
        .ag-pill.active { background: hsl(var(--primary)); border-color: hsl(var(--primary)); color: hsl(var(--primary-foreground)); }
        .ag-pill.active-draft { background: hsl(var(--muted)); border-color: hsl(var(--border)); color: hsl(var(--muted-foreground)); }
        .ag-pill.active-issued { background: hsl(45 96% 64% / 0.15); border-color: hsl(45 96% 50% / 0.4); color: hsl(30 81% 40%); }
        .ag-pill.active-signed { background: hsl(142 76% 36% / 0.12); border-color: hsl(142 76% 36% / 0.4); color: hsl(142 76% 36%); }
        .ag-pill.active-cancelled { background: hsl(0 84% 60% / 0.12); border-color: hsl(0 84% 60% / 0.4); color: hsl(0 84% 40%); }

        /* ── Stats bar ── */
        .ag-stats {
          display: flex;
          border-top: 1px solid hsl(var(--border));
        }
        .ag-stat {
          flex: 1; padding: 12px 0; text-align: center;
          border-right: 1px solid hsl(var(--border));
        }
        .ag-stat:last-child { border-right: none; }
        .ag-stat-val { font-size: 18px; font-weight: 700; color: hsl(var(--foreground)); }
        .ag-stat-label { font-size: 10px; font-weight: 600; color: hsl(var(--muted-foreground)); text-transform: uppercase; letter-spacing: 0.5px; margin-top: 1px; }
        .ag-stat-val.blue { color: hsl(var(--primary)); }
        .ag-stat-val.green { color: hsl(142 72% 38%); }
        .ag-stat-val.amber { color: hsl(38 92% 50%); }

        /* ── Body ── */
        .ag-body { padding: 24px 28px; width: 100%; display: flex; flex-direction: column; }

        /* ── Table ── */
        .ag-table-wrap {
          background: hsl(var(--card));
          border: 1px solid hsl(var(--border));
          border-radius: 14px;
          overflow: hidden;
          box-shadow: 0 1px 4px rgba(0,0,0,0.04);
        }
        .ag-table { width: 100%; border-collapse: collapse; }
        .ag-table thead tr { border-bottom: 1.5px solid hsl(var(--border)); }
        .ag-table th {
          padding: 11px 16px; text-align: left;
          font-size: 11px; font-weight: 600; color: hsl(var(--muted-foreground));
          text-transform: uppercase; letter-spacing: 0.5px;
          background: hsl(var(--muted)); white-space: nowrap;
        }
        .ag-table td {
          padding: 14px 16px; font-size: 13.5px; color: hsl(var(--foreground));
          border-bottom: 1px solid hsl(var(--border)); vertical-align: middle;
        }
        .ag-table tbody tr:last-child td { border-bottom: none; }
        .ag-table tbody tr { transition: background 0.1s; }
        .ag-table tbody tr:hover { background: hsl(var(--background)); }

        .ag-agno {
          font-weight: 700; color: hsl(var(--primary)); font-size: 13px;
          font-family: 'DM Mono', monospace;
        }
        .ag-applicant-cell { display: flex; align-items: center; gap: 9px; }
        .ag-avatar {
          width: 30px; height: 30px; border-radius: 8px;
          font-size: 11px; font-weight: 700; color: hsl(var(--primary-foreground));
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
        }
        .ag-applicant-name { font-weight: 600; color: hsl(var(--foreground)); font-size: 13px; }
        .ag-applicant-no { font-size: 11px; color: hsl(var(--muted-foreground)); }

        .ag-unit { font-size: 13px; color: hsl(var(--foreground)); }
        .ag-unit-sub { font-size: 11px; color: hsl(var(--muted-foreground)); }

        .ag-amount { font-weight: 600; font-size: 13px; color: hsl(var(--foreground)); }
        .ag-amount-sub { font-size: 11px; color: hsl(var(--muted-foreground)); }
        .ag-amount-bal { font-size: 11px; color: hsl(0 84% 50%); font-weight: 600; }

        .ag-date { font-size: 13px; color: hsl(var(--foreground)); }

        /* ── Badge ── */
        .ag-badge {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 3px 9px; border-radius: 20px;
          font-size: 11px; font-weight: 600;
        }
        .ag-badge-draft     { background: hsl(var(--muted)); color: hsl(var(--muted-foreground)); }
        .ag-badge-issued    { background: hsl(45 96% 64% / 0.15); color: hsl(30 81% 40%); }
        .ag-badge-signed    { background: hsl(142 76% 36% / 0.12); color: hsl(142 76% 36%); }
        .ag-badge-cancelled { background: hsl(0 84% 60% / 0.12); color: hsl(0 84% 40%); }

        /* ── Row actions ── */
        .ag-actions { position: relative; }
        .ag-menu-btn {
          width: 30px; height: 30px; border-radius: 7px;
          display: flex; align-items: center; justify-content: center;
          background: none; border: none; cursor: pointer; color: hsl(var(--muted-foreground));
          transition: all 0.1s;
        }
        .ag-menu-btn:hover { background: hsl(var(--muted)); color: hsl(var(--foreground)); }
        .ag-menu {
          position: absolute; right: 0; top: 100%; margin-top: 4px;
          background: hsl(var(--card)); border: 1px solid hsl(var(--border));
          border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,0.10);
          z-index: 50; min-width: 140px; overflow: hidden;
          animation: ag-menu-in 0.1s ease;
        }
        @keyframes ag-menu-in { from { opacity:0; transform: translateY(-4px); } to { opacity:1; transform: translateY(0); } }
        .ag-menu-item {
          display: flex; align-items: center; gap: 9px;
          padding: 9px 14px; font-size: 13px; font-weight: 500;
          cursor: pointer; background: none; border: none; width: 100%;
          text-align: left; font-family: inherit; color: hsl(var(--foreground));
          transition: background 0.1s;
        }
        .ag-menu-item:hover { background: hsl(var(--background)); }
        .ag-menu-item.danger { color: hsl(0 84% 50%); }
        .ag-menu-item.danger:hover { background: hsl(0 84% 60% / 0.08); }

        /* ── Empty ── */
        .ag-empty {
          display: flex; flex-direction: column; align-items: center;
          justify-content: center; padding: 72px 24px; gap: 12px;
          color: hsl(var(--muted-foreground)); text-align: center;
        }
        .ag-empty-icon {
          width: 56px; height: 56px; background: hsl(var(--primary) / 0.1);
          border-radius: 14px; display: flex; align-items: center; justify-content: center;
        }
        .ag-empty h3 { font-size: 15px; font-weight: 600; color: hsl(var(--muted-foreground)); margin: 0; }
        .ag-empty p { font-size: 13px; color: hsl(var(--muted-foreground)); margin: 0; }

        /* ── Pagination ── */
        .ag-pagination {
          display: flex; align-items: center; justify-content: space-between;
          padding: 14px 20px; border-top: 1px solid hsl(var(--border));
          font-size: 13px; color: hsl(var(--muted-foreground));
        }
        .ag-pag-btns { display: flex; gap: 6px; }
        .ag-pag-btn {
          width: 32px; height: 32px; border-radius: 8px;
          display: flex; align-items: center; justify-content: center;
          background: none; border: 1px solid hsl(var(--border)); cursor: pointer;
          color: hsl(var(--foreground)); transition: all 0.12s; font-family: inherit;
        }
        .ag-pag-btn:hover:not(:disabled) { border-color: hsl(var(--primary)); color: hsl(var(--primary)); }
        .ag-pag-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .ag-pag-btn.active { background: hsl(var(--primary)); border-color: hsl(var(--primary)); color: hsl(var(--primary-foreground)); font-weight: 600; font-size: 12px; }

        /* ── Skeleton ── */
        .ag-skel {
          background: linear-gradient(90deg, hsl(var(--muted)) 25%, hsl(var(--border)) 50%, hsl(var(--muted)) 75%);
          background-size: 200% 100%;
          animation: ag-shimmer 1.4s infinite;
          border-radius: 6px;
        }
        @keyframes ag-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

        /* ── Combobox ── */
        .ag-combo { position: relative; width: 100%; }
        .ag-combo-trigger {
          width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px;
          padding: 8px 12px; border: 1.5px solid hsl(var(--border)); border-radius: 9px;
          font-size: 14px; background: hsl(var(--card)); color: hsl(var(--foreground)); cursor: pointer;
          text-align: left; transition: border-color 0.15s; font-family: inherit; min-height: 38px;
        }
        .ag-combo-trigger:focus { outline: none; border-color: hsl(var(--primary)); }
        .ag-combo-trigger.open { border-color: hsl(var(--primary)); border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
        .ag-combo-trigger.empty { color: hsl(var(--muted-foreground)); }
        .ag-combo-trigger.disabled { background: hsl(var(--background)); opacity: 0.6; cursor: not-allowed; }
        .ag-combo-left { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; }
        .ag-combo-val { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 13.5px; }
        .ag-combo-placeholder { font-size: 13.5px; }
        .ag-combo-chevron { color: hsl(var(--muted-foreground)); flex-shrink: 0; transition: transform 0.15s; }
        .ag-combo-chevron.open { transform: rotate(180deg); }
        .ag-combo-clear { background: none; border: none; cursor: pointer; color: hsl(var(--muted-foreground)); padding: 2px; display: flex; flex-shrink: 0; border-radius: 4px; }
        .ag-combo-clear:hover { color: hsl(var(--muted-foreground)); background: hsl(var(--muted)); }
        .ag-combo-drop {
          position: absolute; top: 100%; left: 0; right: 0; background: hsl(var(--card));
          border: 1.5px solid hsl(var(--primary)); border-top: 1px solid hsl(var(--border));
          border-radius: 0 0 9px 9px; box-shadow: 0 8px 24px rgba(0,0,0,0.10);
          z-index: 100; overflow: hidden; max-height: 220px; display: flex; flex-direction: column;
        }
        .ag-combo-search-wrap { position: relative; border-bottom: 1px solid hsl(var(--muted)); flex-shrink: 0; }
        .ag-combo-search-wrap svg { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: hsl(var(--muted-foreground)); pointer-events: none; }
        .ag-combo-search { width: 100%; padding: 8px 12px 8px 34px; border: none; font-size: 13px; color: hsl(var(--foreground)); background: hsl(var(--background)); outline: none; font-family: inherit; box-sizing: border-box; }
        .ag-combo-list { overflow-y: auto; flex: 1; }
        .ag-combo-item { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 12px; cursor: pointer; transition: background 0.1s; border: none; background: none; width: 100%; text-align: left; font-family: inherit; }
        .ag-combo-item:hover { background: hsl(var(--primary) / 0.1); }
        .ag-combo-item.selected { background: hsl(var(--primary) / 0.15); }
        .ag-combo-item-label { font-size: 13px; font-weight: 500; color: hsl(var(--foreground)); flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .ag-combo-item-sub { font-size: 11px; color: hsl(var(--muted-foreground)); flex-shrink: 0; }
        .ag-combo-empty { padding: 16px; text-align: center; font-size: 13px; color: hsl(var(--muted-foreground)); }

        /* ── Form ── */
        .ag-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .ag-form-section { font-size: 10px; font-weight: 700; color: hsl(var(--muted-foreground)); text-transform: uppercase; letter-spacing: 1px; padding-top: 8px; border-top: 1px solid hsl(var(--border)); margin-top: 4px; }
        .ag-balance-box {
          display: flex; align-items: center; justify-content: space-between;
          background: hsl(var(--background)); border: 1.5px solid hsl(var(--border)); border-radius: 9px;
          padding: 9px 12px; font-size: 13.5px;
        }
        .ag-balance-label { color: hsl(var(--muted-foreground)); font-weight: 500; }
        .ag-balance-val { font-weight: 700; color: hsl(var(--foreground)); }
        .ag-balance-val.negative { color: hsl(0 84% 50%); }

        /* ── Status select ── */
        .ag-status-select {
          width: 100%; padding: 8px 12px; border: 1.5px solid hsl(var(--border)); border-radius: 9px;
          font-size: 13.5px; color: hsl(var(--foreground)); background: hsl(var(--card)); outline: none;
          transition: border-color 0.15s; font-family: inherit; cursor: pointer;
          appearance: none; -webkit-appearance: none;
        }
        .ag-status-select:focus { border-color: hsl(var(--primary)); }

        @media (max-width: 768px) {
          .ag-header { padding: 16px 16px 0; }
          .ag-body { padding: 16px; }
          .ag-form-grid { grid-template-columns: 1fr; }
          .ag-stats { flex-wrap: wrap; }
          .ag-stat { min-width: 50%; }
          .ag-table th:nth-child(4), .ag-table td:nth-child(4),
          .ag-table th:nth-child(5), .ag-table td:nth-child(5) { display: none; }
        }
      `}</style>

      <div className="ag-page" onClick={() => setOpenMenuId(null)}>
        {/* ── Header ── */}
        <div className="ag-header">
          <div className="ag-header-top">
            <div>
              <button className="ag-back" onClick={() => navigate(-1)}>
                <ArrowLeft size={13} /> Follow-Up
              </button>
              <div className="ag-title-row" style={{ marginTop: 8 }}>
                <div className="ag-icon">
                  <FileText size={20} />
                </div>
                <span className="ag-title">Agreements</span>
                {pagination && (
                  <span className="ag-count">{pagination.total}</span>
                )}
              </div>
            </div>
            <button className="ag-add-btn" onClick={openCreate}>
              <Plus size={15} /> New Agreement
            </button>
          </div>

          {/* Filter bar */}
          <div className="ag-filter-bar">
            <div className="ag-search-wrap">
              <Search size={14} />
              <input
                className="ag-search"
                placeholder="Search agreements, applicants, units…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
              {search && (
                <button
                  className="ag-search-clear"
                  onClick={() => {
                    setSearch("");
                    setPage(1);
                  }}
                >
                  <X size={13} />
                </button>
              )}
            </div>
            <div className="ag-pills">
              {STATUS_FILTERS.map((s) => {
                const isActive = statusFilter === s;
                let cls = "ag-pill";
                if (isActive) {
                  cls +=
                    s === ""
                      ? " active"
                      : s === "Draft"
                        ? " active-draft"
                        : s === "Issued"
                          ? " active-issued"
                          : s === "Signed"
                            ? " active-signed"
                            : " active-cancelled";
                }
                return (
                  <button
                    key={s}
                    className={cls}
                    onClick={() => {
                      setStatusFilter(s);
                      setPage(1);
                    }}
                  >
                    {STATUS_FILTER_LABELS[s]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Stats */}
          {!isLoading &&
            agreements.length > 0 &&
            (() => {
              const total = agreements.reduce(
                (s, a) => s + (a.AgreementValue ?? 0),
                0,
              );
              const adv = agreements.reduce(
                (s, a) => s + (a.AdvanceAmount ?? 0),
                0,
              );
              const bal = agreements.reduce(
                (s, a) => s + (a.BalanceAmount ?? 0),
                0,
              );
              const signed = agreements.filter(
                (a) => a.Status === "Signed",
              ).length;
              return (
                <div className="ag-stats">
                  <div className="ag-stat">
                    <div className="ag-stat-val blue">{agreements.length}</div>
                    <div className="ag-stat-label">Shown</div>
                  </div>
                  <div className="ag-stat">
                    <div className="ag-stat-val">₹{fmt(total)}</div>
                    <div className="ag-stat-label">Total Value</div>
                  </div>
                  <div className="ag-stat">
                    <div className="ag-stat-val green">₹{fmt(adv)}</div>
                    <div className="ag-stat-label">Advance</div>
                  </div>
                  <div className="ag-stat">
                    <div className="ag-stat-val amber">₹{fmt(bal)}</div>
                    <div className="ag-stat-label">Balance</div>
                  </div>
                  <div className="ag-stat">
                    <div className="ag-stat-val green">{signed}</div>
                    <div className="ag-stat-label">Signed</div>
                  </div>
                </div>
              );
            })()}
        </div>

        {/* ── Body ── */}
        <div className="ag-body">
          {isLoading ? (
            <div className="ag-table-wrap">
              <table className="ag-table">
                <thead>
                  <tr>
                    {[
                      "Agreement No",
                      "Applicant",
                      "Unit",
                      "Project",
                      "Value",
                      "Status",
                      "Date",
                      "",
                    ].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>
                      {[80, 160, 100, 120, 90, 70, 80, 30].map((w, j) => (
                        <td key={j}>
                          <div
                            className="ag-skel"
                            style={{ height: 16, width: w }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : agreements.length === 0 ? (
            <div className="ag-empty">
              <div className="ag-empty-icon">
                <FileText size={24} className="text-primary" />
              </div>
              <h3>
                {search || statusFilter
                  ? "No matching agreements"
                  : "No agreements yet"}
              </h3>
              <p>
                {search || statusFilter
                  ? "Try adjusting your filters"
                  : "Create the first agreement to get started"}
              </p>
              {!search && !statusFilter && (
                <Button size="sm" onClick={openCreate} style={{ marginTop: 4 }}>
                  <Plus size={14} style={{ marginRight: 6 }} /> New Agreement
                </Button>
              )}
            </div>
          ) : (
            <div className="ag-table-wrap">
              <table className="ag-table">
                <thead>
                  <tr>
                    <th>Agreement No</th>
                    <th>Applicant</th>
                    <th>Unit</th>
                    <th>Project</th>
                    <th>Value / Advance / Balance</th>
                    <th>Status</th>
                    <th>Date</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {agreements.map((ag) => {
                    const sm = STATUS_META[ag.Status];
                    return (
                      <tr key={ag.Id}>
                        <td>
                          <span className="ag-agno">
                            {ag.AgreementNo || `#${ag.Id}`}
                          </span>
                        </td>
                        <td>
                          <div className="ag-applicant-cell">
                            <div
                              className="ag-avatar"
                              style={{
                                background: avatarColor(ag.ApplicantName),
                              }}
                            >
                              {initials(ag.ApplicantName)}
                            </div>
                            <div>
                              <div className="ag-applicant-name">
                                {ag.ApplicantName}
                              </div>
                              <div className="ag-applicant-no">
                                {ag.ApplicantNo}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td>
                          {ag.UnitNo ? (
                            <div>
                              <div className="ag-unit">{ag.UnitNo}</div>
                              {ag.SelectionNo && (
                                <div className="ag-unit-sub">
                                  {ag.SelectionNo}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-border">—</span>
                          )}
                        </td>
                        <td>
                          {ag.ProjectName ? (
                            <span className="ag-unit">{ag.ProjectName}</span>
                          ) : (
                            <span className="text-border">—</span>
                          )}
                        </td>
                        <td>
                          <div className="ag-amount">
                            ₹{fmt(ag.AgreementValue)}
                          </div>
                          <div className="ag-amount-sub">
                            Adv: ₹{fmt(ag.AdvanceAmount)}
                          </div>
                          {ag.BalanceAmount != null && ag.BalanceAmount > 0 && (
                            <div className="ag-amount-bal">
                              Bal: ₹{fmt(ag.BalanceAmount)}
                            </div>
                          )}
                        </td>
                        <td>
                          <span className={`ag-badge ${sm.cls}`}>
                            {sm.icon} {sm.label}
                          </span>
                        </td>
                        <td>
                          <span className="ag-date">
                            {fmtDate(ag.AgreementDate)}
                          </span>
                        </td>
                        <td>
                          <div
                            className="ag-actions"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              className="ag-menu-btn"
                              onClick={() =>
                                setOpenMenuId(
                                  openMenuId === ag.Id ? null : ag.Id,
                                )
                              }
                            >
                              <MoreHorizontal size={15} />
                            </button>
                            {openMenuId === ag.Id && (
                              <div className="ag-menu">
                                <button
                                  className="ag-menu-item"
                                  onClick={() => {
                                    openEdit(ag);
                                    setOpenMenuId(null);
                                  }}
                                >
                                  <Pencil size={13} /> Edit
                                </button>
                                {canDeleteRecords && (
                                  <button
                                    className="ag-menu-item danger"
                                    onClick={() => {
                                      setDeleteId(ag.Id);
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
                <div className="ag-pagination">
                  <span>
                    Showing {(pagination.page - 1) * pagination.pageSize + 1}–
                    {Math.min(
                      pagination.page * pagination.pageSize,
                      pagination.total,
                    )}{" "}
                    of {pagination.total}
                  </span>
                  <div className="ag-pag-btns">
                    <button
                      className="ag-pag-btn"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      <ChevronLeft size={14} />
                    </button>
                    {Array.from(
                      { length: pagination.totalPages },
                      (_, i) => i + 1,
                    )
                      .filter(
                        (p) =>
                          p === 1 ||
                          p === pagination.totalPages ||
                          Math.abs(p - page) <= 1,
                      )
                      .reduce<Array<number | "…">>((acc, p, i, arr) => {
                        if (i > 0 && (p as number) - (arr[i - 1] as number) > 1)
                          acc.push("…");
                        acc.push(p);
                        return acc;
                      }, [])
                      .map((p, i) =>
                        p === "…" ? (
                          <span
                            key={`e${i}`}
                            style={{
                              padding: "0 4px",
                              color: "hsl(var(--muted-foreground))",
                              display: "flex",
                              alignItems: "center",
                            }}
                          >
                            …
                          </span>
                        ) : (
                          <button
                            key={p}
                            className={`ag-pag-btn${page === p ? " active" : ""}`}
                            onClick={() => setPage(p as number)}
                          >
                            {p}
                          </button>
                        ),
                      )}
                    <button
                      className="ag-pag-btn"
                      disabled={page >= pagination.totalPages}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Create / Edit Dialog ── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent
          style={{ maxWidth: 640, maxHeight: "90vh", overflowY: "auto" }}
        >
          <DialogHeader>
            <DialogTitle>
              {editId ? "Edit Agreement" : "New Agreement"}
            </DialogTitle>
          </DialogHeader>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 16,
              paddingTop: 4,
            }}
          >
            <div className="ag-form-section">
              <User size={10} style={{ display: "inline", marginRight: 4 }} />
              Applicant & Unit
            </div>

            <div className="space-y-2">
              <Label>
                Applicant <span className="text-destructive">*</span>
              </Label>
              <Combobox
                value={form.ApplicantId}
                onChange={(v) => set("ApplicantId", v)}
                items={applicantItems}
                placeholder="Select applicant…"
              />
            </div>

            <div className="space-y-2">
              <Label>Unit Selection</Label>
              <Combobox
                value={form.UnitSelectionId}
                onChange={(v) => set("UnitSelectionId", v)}
                items={unitItems}
                placeholder={
                  form.ApplicantId ? "Select unit…" : "Select applicant first"
                }
                disabled={!form.ApplicantId}
              />
            </div>

            <div className="ag-form-grid">
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
                <Label>Company</Label>
                <Combobox
                  value={form.CompanyId}
                  onChange={(v) => set("CompanyId", v)}
                  items={companyItems}
                  placeholder="Select company…"
                />
              </div>
            </div>

            <div className="ag-form-section">
              <IndianRupee
                size={10}
                style={{ display: "inline", marginRight: 4 }}
              />
              Financials
            </div>

            <div className="ag-form-grid">
              <div className="space-y-2">
                <Label>Agreement Value</Label>
                <Input
                  type="number"
                  value={form.AgreementValue}
                  onChange={(e) => set("AgreementValue", e.target.value)}
                  placeholder="0.00"
                  className="rounded-[9px]"
                />
              </div>
              <div className="space-y-2">
                <Label>Advance Amount</Label>
                <Input
                  type="number"
                  value={form.AdvanceAmount}
                  onChange={(e) => set("AdvanceAmount", e.target.value)}
                  placeholder="0.00"
                  className="rounded-[9px]"
                />
              </div>
            </div>

            <div className="ag-balance-box">
              <span className="ag-balance-label">Balance Amount</span>
              <span
                className={`ag-balance-val${balanceAmount != null && balanceAmount < 0 ? " negative" : ""}`}
              >
                {balanceAmount != null ? `₹${fmt(balanceAmount)}` : "—"}
              </span>
            </div>

            <div className="ag-form-section">
              <CalendarDays
                size={10}
                style={{ display: "inline", marginRight: 4 }}
              />
              Dates & Status
            </div>

            <div className="ag-form-grid">
              <div className="space-y-2">
                <Label>Agreement Date</Label>
                <Input
                  type="date"
                  value={form.AgreementDate}
                  onChange={(e) => set("AgreementDate", e.target.value)}
                  className="rounded-[9px]"
                />
              </div>
              <div className="space-y-2">
                <Label>Registration Date</Label>
                <Input
                  type="date"
                  value={form.RegistrationDate}
                  onChange={(e) => set("RegistrationDate", e.target.value)}
                  className="rounded-[9px]"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Status</Label>
              <select
                className="ag-status-select"
                value={form.Status}
                onChange={(e) => set("Status", e.target.value)}
              >
                {(
                  meta?.statusOptions ?? [
                    "Draft",
                    "Issued",
                    "Signed",
                    "Cancelled",
                  ]
                ).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label>
                <StickyNote
                  size={12}
                  style={{ display: "inline", marginRight: 4 }}
                />
                Notes
              </Label>
              <Textarea
                value={form.Notes}
                onChange={(e) => set("Notes", e.target.value)}
                placeholder="Any additional notes…"
                rows={3}
                className="rounded-[9px]"
              />
            </div>
          </div>

          <DialogFooter style={{ marginTop: 8 }}>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                !form.ApplicantId || createMut.isPending || updateMut.isPending
              }
              onClick={() => (editId ? updateMut.mutate() : createMut.mutate())}
            >
              {editId
                ? updateMut.isPending
                  ? "Saving…"
                  : "Save Changes"
                : createMut.isPending
                  ? "Creating…"
                  : "Create Agreement"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirm ── */}
      <AlertDialog
        open={deleteId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Agreement?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMut.mutate()}
              className="bg-destructive"
            >
              {deleteMut.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
