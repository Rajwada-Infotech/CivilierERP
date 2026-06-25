import React, { useMemo, useState } from "react";
import { filterProjectsByCompany } from "@/lib/projectBelongsTo";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  RefreshCw,
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
import { usePageRights } from "@/hooks/usePageRights";
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
  BookingId: number | null;
  BookingNo: string | null;
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

interface OptionBooking {
  Id: number;
  BookingNo: string;
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
  bookings: OptionBooking[];
  projects: OptionProject[];
  companies: OptionCompany[];
  statusOptions: AgreementStatus[];
}

interface FormState {
  ApplicantId: string;
  UnitSelectionId: string;
  BookingId: string;
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
  BookingId: "",
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
  const ref = React.useRef<HTMLDivElement>(null);
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

  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="ag-combo" ref={ref}>
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
  const rights = usePageRights("followup-agreements");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<AgreementStatus | "">("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });

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

  const {
    data: result,
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
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

  const bookingItems: ComboItem[] = useMemo(() => {
    const all = meta?.bookings ?? [];
    const filtered = form.ApplicantId
      ? all.filter((b) => String(b.ApplicantId) === form.ApplicantId)
      : all;
    return filtered.map((b) => ({
      value: String(b.Id),
      label: b.BookingNo,
      sub: b.UnitNo,
    }));
  }, [meta, form.ApplicantId]);

  const projectItems: ComboItem[] = useMemo(
    () =>
      filterProjectsByCompany(meta?.projects ?? [] as any[], form.CompanyId).map(
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

  function set(k: keyof FormState, v: string | AgreementStatus) {
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
        next.BookingId = "";
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
      BookingId: ag.BookingId ? String(ag.BookingId) : "",
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
      BookingId: form.BookingId || null,
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
          font-family: 'DM Sans', 'Segoe UI', sans-serif;
          color: hsl(var(--foreground));
        }

        /* ── Header ── */
        .ag-header {
          padding: 0 0 0 0;
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
          background: linear-gradient(135deg, hsl(var(--primary)), hsl(var(--primary) / 0.8));
          color: hsl(var(--primary-foreground)); border: none; border-radius: 8px;
          padding: 7px 14px; font-size: 13px; font-weight: 600;
          cursor: pointer; transition: all 0.15s;
          font-family: var(--font-heading, inherit); box-shadow: 0 2px 8px hsl(var(--primary) / 0.25);
          white-space: nowrap; height: 32px;
        }
        .ag-add-btn:hover { opacity: 0.9; }

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
        .ag-body { padding: 24px 0; width: 100%; display: flex; flex-direction: column; gap: 20px; }

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
          width: 100%; padding: 8px 32px 8px 12px; border: 1.5px solid hsl(var(--border)); border-radius: 9px;
          font-size: 13.5px; color: hsl(var(--foreground)); background: hsl(var(--card)); outline: none;
          transition: border-color 0.15s; font-family: inherit; cursor: pointer;
          appearance: none; -webkit-appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 10px center;
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

      <Breadcrumbs
        items={[
          { label: "Follow-Up", path: "/followup" },
          { label: "Agreements", path: "/followup/agreement/agreements" },
        ]}
      />
      <div
        className="ag-page relative space-y-8 mt-6"
        onClick={() => setOpenMenuId(null)}
      >
        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-heading font-bold text-foreground">
              Agreements
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {pagination
                ? `${pagination.total} agreement${pagination.total !== 1 ? "s" : ""}`
                : "Manage all agreements"}
            </p>
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
            {rights.canCreate && (
              <Button
                size="sm"
                onClick={openCreate}
                className="gradient-accent gap-1.5 shrink-0 font-semibold text-white text-sm px-5 py-2 h-auto"
              >
                <Plus size={14} /> New Agreement
              </Button>
            )}
          </div>
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

        {/* ── Body ── */}
        <div className="ag-body" style={{ paddingTop: 0, paddingBottom: 0 }}>
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
              {!search && !statusFilter && rights.canCreate && (
                <Button
                  onClick={openCreate}
                  className="gradient-accent gap-1.5 shrink-0 font-semibold text-white text-sm px-5 py-2 h-auto mt-1"
                >
                  <Plus size={14} /> New Agreement
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
                              onClick={(e) => {
                                if (openMenuId === ag.Id) { setOpenMenuId(null); return; }
                                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                const menuH = rights.canDelete ? 82 : 42;
                                const top = window.innerHeight - rect.bottom < menuH + 8
                                  ? rect.top - menuH - 4
                                  : rect.bottom + 4;
                                setMenuPos({ top, right: window.innerWidth - rect.right });
                                setOpenMenuId(ag.Id);
                              }}
                            >
                              <MoreHorizontal size={15} />
                            </button>
                            {openMenuId === ag.Id && (
                              <div className="ag-menu" style={{ position: "fixed", top: menuPos.top, right: menuPos.right, zIndex: 200 }}>
                                {rights.canEdit && (
                                  <button
                                    className="ag-menu-item"
                                    onClick={() => {
                                      openEdit(ag);
                                      setOpenMenuId(null);
                                    }}
                                  >
                                    <Pencil size={13} /> Edit
                                  </button>
                                )}
                                {rights.canDelete && (
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
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDialogOpen(false);
            setEditId(null);
            setForm(EMPTY_FORM);
          }
        }}
      >
        <DialogContent
          style={{ maxWidth: 640, maxHeight: "90vh", overflowY: "auto" }}
        >
          <DialogHeader>
            <DialogTitle>
              {editId ? "Edit Agreement" : "New Agreement"}
            </DialogTitle>
            <DialogDescription>
              {editId
                ? "Update the agreement details below."
                : "Fill in the details to create a new agreement."}
            </DialogDescription>
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

            <div className="space-y-2">
              <Label>Booking</Label>
              <Combobox
                value={form.BookingId}
                onChange={(v) => set("BookingId", v)}
                items={bookingItems}
                placeholder={
                  form.ApplicantId
                    ? "Select booking…"
                    : "Select applicant first"
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
                <div className="relative">
                  <CalendarDays
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground pointer-events-none opacity-70"
                  />
                  <input
                    type="date"
                    value={form.AgreementDate}
                    onChange={(e) => set("AgreementDate", e.target.value)}
                    className="w-full pl-8 pr-3 py-2 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Registration Date</Label>
                <div className="relative">
                  <CalendarDays
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground pointer-events-none opacity-70"
                  />
                  <input
                    type="date"
                    value={form.RegistrationDate}
                    onChange={(e) => set("RegistrationDate", e.target.value)}
                    className="w-full pl-8 pr-3 py-2 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                  />
                </div>
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
            <Button
              variant="outline"
              onClick={() => {
                setDialogOpen(false);
                setEditId(null);
                setForm(EMPTY_FORM);
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={
                !form.ApplicantId || createMut.isPending || updateMut.isPending
              }
              onClick={() => (editId ? updateMut.mutate() : createMut.mutate())}
              className="gradient-accent gap-1.5 shrink-0 font-semibold text-white text-sm px-5 py-2 h-auto"
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