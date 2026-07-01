import { useMemo, useRef, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  RefreshCw,
  Search,
  X,
  ShieldCheck,
  Building2,
  CalendarDays,
  IndianRupee,
  ChevronDown,
  Pencil,
  Trash2,
  CheckCircle2,
  Clock,
  AlertCircle,
  Ban,
  Send,
  MoreHorizontal,
  ChevronLeft,
  ChevronRight,
  StickyNote,
  Home,
  FileCheck,
} from "lucide-react";
import { toast } from "sonner";
import { usePageRights } from "@/hooks/usePageRights";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FollowupShell } from "@/components/followup/FollowupShell";
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

type NOCStatus = "Pending" | "Approved" | "Issued" | "Rejected";

interface NOC {
  Id: number;
  NOCNo: string;
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
  NOCDate: string | null;
  ApprovalDate: string | null;
  IssuedDate: string | null;
  ApprovedBy: string | null;
  Reason: string | null;
  Status: NOCStatus;
  Notes: string | null;
  CreatedBy: string;
  CreatedAt: string;
  // Bank NOC / Loan tracking
  BankName: string | null;
  LoanAccountNo: string | null;
  LoanSanctionStatus: "Pending" | "Sanctioned" | "Rejected" | null;
  LoanSanctionDate: string | null;
  LoanDisbursementStatus:
    | "Pending"
    | "PartiallyDisbursed"
    | "FullyDisbursed"
    | null;
  LoanDisbursementDate: string | null;
  LoanAmount: number | null;
  BankNOCStatus: "NotApplicable" | "Pending" | "Applied" | "Received" | null;
  BankNOCDate: string | null;
  BankNOCNotes: string | null;
}

interface OptionApplicant {
  Id: number;
  ApplicantNo: string | null; // LHeadCode from AccountHeadMaster
  ApplicantName: string; // ISNULL(DisplayName, LHeadName)
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
  statusOptions: NOCStatus[];
}

interface FormState {
  ApplicantId: string;
  UnitSelectionId: string;
  AgreementId: string;
  ProjectId: string;
  CompanyId: string;
  NOCDate: string;
  ApprovalDate: string;
  IssuedDate: string;
  ApprovedBy: string;
  Reason: string;
  Status: NOCStatus;
  Notes: string;
  // Bank NOC / Loan tracking
  BankName: string;
  LoanAccountNo: string;
  LoanSanctionStatus: string;
  LoanSanctionDate: string;
  LoanDisbursementStatus: string;
  LoanDisbursementDate: string;
  LoanAmount: string;
  BankNOCStatus: string;
  BankNOCDate: string;
  BankNOCNotes: string;
}

const EMPTY_FORM: FormState = {
  ApplicantId: "",
  UnitSelectionId: "",
  AgreementId: "",
  ProjectId: "",
  CompanyId: "",
  NOCDate: new Date().toISOString().slice(0, 10),
  ApprovalDate: "",
  IssuedDate: "",
  ApprovedBy: "",
  Reason: "",
  Status: "Pending",
  Notes: "",
  BankName: "",
  LoanAccountNo: "",
  LoanSanctionStatus: "",
  LoanSanctionDate: "",
  LoanDisbursementStatus: "",
  LoanDisbursementDate: "",
  LoanAmount: "",
  BankNOCStatus: "",
  BankNOCDate: "",
  BankNOCNotes: "",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
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
  NOCStatus,
  { label: string; icon: React.ReactNode; cls: string }
> = {
  Pending: {
    label: "Pending",
    icon: <Clock size={11} />,
    cls: "noc-badge-pending",
  },
  Approved: {
    label: "Approved",
    icon: <CheckCircle2 size={11} />,
    cls: "noc-badge-approved",
  },
  Issued: {
    label: "Issued",
    icon: <Send size={11} />,
    cls: "noc-badge-issued",
  },
  Rejected: {
    label: "Rejected",
    icon: <Ban size={11} />,
    cls: "noc-badge-rejected",
  },
};

// ─── API ──────────────────────────────────────────────────────────────────────

async function fetchMeta(): Promise<MetaOptions> {
  const res = await fetchWithAuth("/api/followup-noc/meta/options");
  if (!res.ok) throw new Error("Failed to load options");
  return res.json();
}

async function fetchNOCs(params: {
  page: number;
  pageSize: number;
  search: string;
  status: string;
}): Promise<{
  data: NOC[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}> {
  // POST /search keeps sensitive filter params (status, search) in the request
  // body instead of the URL, preventing them from appearing in server logs,
  // browser history, or Referer headers. Fixes CodeQL js/sensitive-get-query.
  const res = await fetchWithAuth("/api/followup-noc/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      page: params.page,
      pageSize: params.pageSize,
      ...(params.search ? { search: params.search } : {}),
      ...(params.status ? { status: params.status } : {}),
    }),
  });
  if (!res.ok) throw new Error("Failed to load NOCs");
  return res.json();
}

async function createNOC(payload: Record<string, unknown>) {
  const res = await fetchWithAuth("/api/followup-noc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error || "Failed to create NOC",
    );
  }
}

async function updateNOC(id: number, payload: Record<string, unknown>) {
  const res = await fetchWithAuth(`/api/followup-noc/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error || "Failed to update NOC",
    );
  }
}

async function deleteNOC(id: number) {
  const res = await fetchWithAuth(`/api/followup-noc/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete NOC");
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
  const ref = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  return (
    <div className="noc-combo" ref={ref}>
      <button
        type="button"
        className={`noc-combo-trigger${open ? " open" : ""}${!value ? " empty" : ""}${disabled ? " disabled" : ""}`}
        onClick={() => {
          if (!disabled) {
            setOpen((v) => !v);
            setQ("");
          }
        }}
      >
        <span className="noc-combo-left">
          {selected ? (
            <span className="noc-combo-val">{selected.label}</span>
          ) : (
            <span className="noc-combo-placeholder">{placeholder}</span>
          )}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {value && !disabled && (
            <span
              className="noc-combo-clear"
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
            className={`noc-combo-chevron${open ? " open" : ""}`}
          />
        </span>
      </button>
      {open && (
        <div className="noc-combo-drop">
          <div className="noc-combo-search-wrap">
            <Search size={13} />
            <input
              className="noc-combo-search"
              placeholder="Search…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoFocus
            />
          </div>
          <div className="noc-combo-list">
            {filtered.length === 0 ? (
              <div className="noc-combo-empty">No results</div>
            ) : (
              filtered.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={`noc-combo-item${value === item.value ? " selected" : ""}`}
                  onClick={() => {
                    onChange(item.value);
                    setOpen(false);
                    setQ("");
                  }}
                >
                  <span className="noc-combo-item-label">{item.label}</span>
                  {item.sub && (
                    <span className="noc-combo-item-sub">{item.sub}</span>
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

export function NOCPage() {
  const qc = useQueryClient();
  const rights = usePageRights("followup-noc");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<NOCStatus | "">("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);

  const { data: meta } = useQuery({
    queryKey: ["noc-meta"],
    queryFn: fetchMeta,
    staleTime: 5 * 60 * 1000,
  });

  const {
    data: result,
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ["nocs", page, search, statusFilter],
    queryFn: () =>
      fetchNOCs({ page, pageSize: PAGE_SIZE, search, status: statusFilter }),
    placeholderData: (prev) => prev,
  });

  const nocs = result?.data ?? [];
  const pagination = result?.pagination;

  // ── KPI counts ──
  const stats = useMemo(
    () => ({
      total: pagination?.total ?? 0,
      pending: nocs.filter((n) => n.Status === "Pending").length,
      approved: nocs.filter((n) => n.Status === "Approved").length,
      issued: nocs.filter((n) => n.Status === "Issued").length,
      isPageScoped: (pagination?.totalPages ?? 1) > 1,
    }),
    [nocs, pagination],
  );

  // ── Combobox items ──
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

  const agreementItems: ComboItem[] = useMemo(() => {
    const all = meta?.agreements ?? [];
    const filtered = form.ApplicantId
      ? all.filter((a) => String(a.ApplicantId) === form.ApplicantId)
      : all;
    return filtered.map((a) => ({ value: String(a.Id), label: a.AgreementNo }));
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
      if (k === "ApplicantId") {
        // Clear dependent fields when applicant changes
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
    setDialogOpen(true);
  }

  function openEdit(noc: NOC) {
    setEditId(noc.Id);
    setForm({
      ApplicantId: String(noc.ApplicantId),
      UnitSelectionId: noc.UnitSelectionId ? String(noc.UnitSelectionId) : "",
      AgreementId: noc.AgreementId ? String(noc.AgreementId) : "",
      ProjectId: noc.ProjectId ? String(noc.ProjectId) : "",
      CompanyId: noc.CompanyId ? String(noc.CompanyId) : "",
      NOCDate: noc.NOCDate ?? "",
      ApprovalDate: noc.ApprovalDate ?? "",
      IssuedDate: noc.IssuedDate ?? "",
      ApprovedBy: noc.ApprovedBy ?? "",
      Reason: noc.Reason ?? "",
      Status: noc.Status,
      Notes: noc.Notes ?? "",
      BankName: noc.BankName ?? "",
      LoanAccountNo: noc.LoanAccountNo ?? "",
      LoanSanctionStatus: noc.LoanSanctionStatus ?? "",
      LoanSanctionDate: noc.LoanSanctionDate ?? "",
      LoanDisbursementStatus: noc.LoanDisbursementStatus ?? "",
      LoanDisbursementDate: noc.LoanDisbursementDate ?? "",
      LoanAmount: noc.LoanAmount != null ? String(noc.LoanAmount) : "",
      BankNOCStatus: noc.BankNOCStatus ?? "",
      BankNOCDate: noc.BankNOCDate ?? "",
      BankNOCNotes: noc.BankNOCNotes ?? "",
    });
    setDialogOpen(true);
  }

  function buildPayload() {
    return {
      ApplicantId: form.ApplicantId || null,
      UnitSelectionId: form.UnitSelectionId || null,
      AgreementId: form.AgreementId || null,
      ProjectId: form.ProjectId || null,
      CompanyId: form.CompanyId || null,
      NOCDate: form.NOCDate || null,
      ApprovalDate: form.ApprovalDate || null,
      IssuedDate: form.IssuedDate || null,
      ApprovedBy: form.ApprovedBy || null,
      Reason: form.Reason || null,
      Status: form.Status,
      Notes: form.Notes || null,
      BankName: form.BankName || null,
      LoanAccountNo: form.LoanAccountNo || null,
      LoanSanctionStatus: form.LoanSanctionStatus || null,
      LoanSanctionDate: form.LoanSanctionDate || null,
      LoanDisbursementStatus: form.LoanDisbursementStatus || null,
      LoanDisbursementDate: form.LoanDisbursementDate || null,
      LoanAmount: form.LoanAmount ? parseFloat(form.LoanAmount) : null,
      BankNOCStatus: form.BankNOCStatus || null,
      BankNOCDate: form.BankNOCDate || null,
      BankNOCNotes: form.BankNOCNotes || null,
    };
  }

  const invalidate = () => qc.invalidateQueries({ queryKey: ["nocs"] });

  const createMut = useMutation({
    mutationFn: () => createNOC(buildPayload()),
    onSuccess: () => {
      toast.success("NOC created");
      invalidate();
      setDialogOpen(false);
      setEditId(null);
      setForm(EMPTY_FORM);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: () => updateNOC(editId!, buildPayload()),
    onSuccess: () => {
      toast.success("NOC updated");
      invalidate();
      setDialogOpen(false);
      setEditId(null);
      setForm(EMPTY_FORM);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: () => deleteNOC(deleteId!),
    onSuccess: () => {
      toast.success("NOC deleted");
      invalidate();
      setDeleteId(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const STATUS_FILTERS: Array<NOCStatus | ""> = [
    "",
    "Pending",
    "Approved",
    "Issued",
    "Rejected",
  ];
  const STATUS_LABELS: Record<string, string> = {
    "": "All",
    Pending: "Pending",
    Approved: "Approved",
    Issued: "Issued",
    Rejected: "Rejected",
  };

  // page nums
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
        /* ── All noc-* classes use CSS vars — theme-safe ── */
        .noc-page {
          font-family: 'DM Sans', 'Segoe UI', sans-serif;
          color: hsl(var(--foreground));
        }

        /* ── Header ── */
        .noc-header {
          padding: 0;
        }
        .noc-header-top {
          display: flex; align-items: flex-start;
          justify-content: space-between; margin-bottom: 16px; gap: 16px;
        }
        .noc-title-row { display: flex; align-items: center; gap: 12px; }
        .noc-icon {
          width: 40px; height: 40px;
          background: hsl(var(--primary));
          border-radius: 12px;
          display: flex; align-items: center; justify-content: center;
          color: hsl(var(--primary-foreground)); flex-shrink: 0;
          box-shadow: 0 2px 8px hsl(var(--primary) / 0.25);
        }
        .noc-title { font-size: 20px; font-weight: 700; color: hsl(var(--foreground)); }
        .noc-count {
          background: hsl(var(--primary) / 0.1); color: hsl(var(--primary));
          font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 20px;
        }
        .noc-add-btn {
          display: flex; align-items: center; gap: 6px;
          background: linear-gradient(135deg, hsl(var(--primary)), hsl(var(--primary) / 0.8));
          color: hsl(var(--primary-foreground));
          border: none; border-radius: 8px; padding: 7px 14px;
          font-size: 13px; font-weight: 600; cursor: pointer;
          transition: all 0.15s; font-family: var(--font-heading, inherit);
          box-shadow: 0 2px 8px hsl(var(--primary) / 0.25); white-space: nowrap; height: 32px;
        }
        .noc-add-btn:hover { opacity: 0.9; }

        /* ── Filter bar ── */
        .noc-filter-bar {
          display: flex; align-items: center; gap: 12px;
          padding: 14px 0; flex-wrap: wrap;
        }
        .noc-search-wrap { flex: 1; min-width: 200px; max-width: 380px; position: relative; }
        .noc-search-wrap svg { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: hsl(var(--muted-foreground)); pointer-events: none; }
        .noc-search {
          width: 100%; padding: 8px 12px 8px 36px;
          border: 1.5px solid hsl(var(--border)); border-radius: 9px;
          font-size: 13.5px; color: hsl(var(--foreground)); background: hsl(var(--card));
          outline: none; transition: border-color 0.15s; font-family: inherit; box-sizing: border-box;
        }
        .noc-search:focus { border-color: hsl(var(--primary)); }
        .noc-search-clear { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; color: hsl(var(--muted-foreground)); padding: 2px; display: flex; border-radius: 4px; }

        .noc-pills { display: flex; gap: 6px; flex-wrap: wrap; }
        .noc-pill {
          padding: 5px 12px; border-radius: 20px; font-size: 12px; font-weight: 500;
          border: 1.5px solid hsl(var(--border)); background: hsl(var(--card)); color: hsl(var(--muted-foreground));
          cursor: pointer; transition: all 0.12s; font-family: inherit; white-space: nowrap;
        }
        .noc-pill:hover { border-color: hsl(var(--primary)); color: hsl(var(--primary)); }
        .noc-pill.active         { background: hsl(var(--primary)); border-color: hsl(var(--primary)); color: hsl(var(--primary-foreground)); }
        .noc-pill.active-pending  { background: hsl(var(--muted)); border-color: hsl(var(--border)); color: hsl(var(--muted-foreground)); }
        .noc-pill.active-approved { background: hsl(142 76% 36% / 0.12); border-color: hsl(142 76% 36% / 0.4); color: hsl(142 76% 36%); }
        .noc-pill.active-issued   { background: hsl(var(--primary) / 0.1); border-color: hsl(var(--primary) / 0.4); color: hsl(var(--primary)); }
        .noc-pill.active-rejected { background: hsl(0 84% 60% / 0.12); border-color: hsl(0 84% 60% / 0.4); color: hsl(0 84% 40%); }

        /* ── Stats bar ── */
        .noc-stats { display: flex; border-top: 1px solid hsl(var(--border)); }
        .noc-stat { flex: 1; padding: 12px 0; text-align: center; border-right: 1px solid hsl(var(--border)); }
        .noc-stat:last-child { border-right: none; }
        .noc-stat-val { font-size: 18px; font-weight: 700; color: hsl(var(--foreground)); }
        .noc-stat-label { font-size: 10px; font-weight: 600; color: hsl(var(--muted-foreground)); text-transform: uppercase; letter-spacing: 0.5px; margin-top: 1px; }
        .noc-stat-val.blue   { color: hsl(var(--primary)); }
        .noc-stat-val.green  { color: hsl(142 72% 38%); }
        .noc-stat-val.amber  { color: hsl(38 92% 50%); }

        /* ── Body ── */
        .noc-body { padding: 24px 0; width: 100%; display: flex; flex-direction: column; gap: 20px; }

        /* ── Table ── */
        .noc-table-wrap {
          background: hsl(var(--card)); border: 1px solid hsl(var(--border));
          border-radius: 14px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.04);
        }
        .noc-table { width: 100%; border-collapse: collapse; }
        .noc-table thead tr { border-bottom: 1.5px solid hsl(var(--border)); }
        .noc-table th {
          padding: 11px 16px; text-align: left;
          font-size: 11px; font-weight: 600; color: hsl(var(--muted-foreground));
          text-transform: uppercase; letter-spacing: 0.5px;
          background: hsl(var(--muted)); white-space: nowrap;
        }
        .noc-table td {
          padding: 14px 16px; font-size: 13.5px; color: hsl(var(--foreground));
          border-bottom: 1px solid hsl(var(--border)); vertical-align: middle;
        }
        .noc-table tbody tr:last-child td { border-bottom: none; }
        .noc-table tbody tr { transition: background 0.1s; }
        .noc-table tbody tr:hover { background: hsl(var(--background)); }

        .noc-nocno { font-weight: 700; color: hsl(var(--primary)); font-size: 13px; font-family: 'DM Mono', monospace; }
        .noc-applicant-cell { display: flex; align-items: center; gap: 9px; }
        .noc-avatar {
          width: 30px; height: 30px; border-radius: 8px;
          font-size: 11px; font-weight: 700; color: hsl(var(--primary-foreground));
          display: flex; align-items: center; justify-content: center; flex-shrink: 0;
        }
        .noc-applicant-name { font-weight: 600; color: hsl(var(--foreground)); font-size: 13px; }
        .noc-applicant-no   { font-size: 11px; color: hsl(var(--muted-foreground)); }

        .noc-unit     { font-size: 13px; color: hsl(var(--foreground)); }
        .noc-unit-sub { font-size: 11px; color: hsl(var(--muted-foreground)); }

        .noc-date { font-size: 13px; color: hsl(var(--foreground)); }
        .noc-date-sub { font-size: 11px; color: hsl(var(--muted-foreground)); }

        .noc-approved-by { font-size: 12px; color: hsl(var(--muted-foreground)); font-style: italic; }

        /* ── Status badge ── */
        .noc-badge {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 3px 9px; border-radius: 20px; font-size: 11px; font-weight: 600;
        }
        .noc-badge-pending  { background: hsl(var(--muted));            color: hsl(var(--muted-foreground)); }
        .noc-badge-approved { background: hsl(142 76% 36% / 0.12);     color: hsl(142 76% 36%); }
        .noc-badge-issued   { background: hsl(var(--primary) / 0.1);   color: hsl(var(--primary)); }
        .noc-badge-rejected { background: hsl(0 84% 60% / 0.12);       color: hsl(0 84% 40%); }

        /* ── Row actions ── */
        .noc-actions { position: relative; }
        .noc-menu-btn {
          width: 30px; height: 30px; border-radius: 7px;
          display: flex; align-items: center; justify-content: center;
          background: none; border: none; cursor: pointer; color: hsl(var(--muted-foreground));
          transition: all 0.1s;
        }
        .noc-menu-btn:hover { background: hsl(var(--muted)); color: hsl(var(--foreground)); }
        .noc-menu {
          position: absolute; right: 0; top: 100%; margin-top: 4px;
          background: hsl(var(--card)); border: 1px solid hsl(var(--border));
          border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,0.10);
          z-index: 50; min-width: 140px; overflow: hidden;
          animation: noc-menu-in 0.1s ease;
        }
        @keyframes noc-menu-in { from { opacity:0; transform: translateY(-4px); } to { opacity:1; transform: translateY(0); } }
        .noc-menu-item {
          display: flex; align-items: center; gap: 9px; padding: 9px 14px;
          font-size: 13px; font-weight: 500; cursor: pointer;
          background: none; border: none; width: 100%; text-align: left;
          font-family: inherit; color: hsl(var(--foreground)); transition: background 0.1s;
        }
        .noc-menu-item:hover { background: hsl(var(--background)); }
        .noc-menu-item.danger { color: hsl(0 84% 50%); }
        .noc-menu-item.danger:hover { background: hsl(0 84% 60% / 0.08); }

        /* ── Empty ── */
        .noc-empty {
          display: flex; flex-direction: column; align-items: center;
          justify-content: center; padding: 72px 24px; gap: 12px;
          color: hsl(var(--muted-foreground)); text-align: center;
        }
        .noc-empty-icon {
          width: 56px; height: 56px; background: hsl(var(--primary) / 0.1);
          border-radius: 14px; display: flex; align-items: center; justify-content: center;
        }
        .noc-empty h3 { font-size: 15px; font-weight: 600; color: hsl(var(--muted-foreground)); margin: 0; }
        .noc-empty p  { font-size: 13px; color: hsl(var(--muted-foreground)); margin: 0; }

        /* ── Pagination ── */
        .noc-pagination {
          display: flex; align-items: center; justify-content: space-between;
          padding: 14px 20px; border-top: 1px solid hsl(var(--border));
          font-size: 13px; color: hsl(var(--muted-foreground));
        }
        .noc-pag-btns { display: flex; gap: 6px; }
        .noc-pag-btn {
          width: 32px; height: 32px; border-radius: 8px;
          display: flex; align-items: center; justify-content: center;
          background: none; border: 1px solid hsl(var(--border)); cursor: pointer;
          color: hsl(var(--foreground)); transition: all 0.12s; font-family: inherit; font-size: 12px;
        }
        .noc-pag-btn:hover:not(:disabled) { border-color: hsl(var(--primary)); color: hsl(var(--primary)); }
        .noc-pag-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .noc-pag-btn.active { background: hsl(var(--primary)); border-color: hsl(var(--primary)); color: hsl(var(--primary-foreground)); font-weight: 600; }

        /* ── Skeleton ── */
        .noc-skel {
          background: linear-gradient(90deg, hsl(var(--muted)) 25%, hsl(var(--border)) 50%, hsl(var(--muted)) 75%);
          background-size: 200% 100%; animation: noc-shimmer 1.4s infinite; border-radius: 6px;
        }
        @keyframes noc-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

        /* ── Combobox ── */
        .noc-combo { position: relative; width: 100%; }
        .noc-combo-trigger {
          width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px;
          padding: 8px 12px; border: 1.5px solid hsl(var(--border)); border-radius: 9px;
          font-size: 14px; background: hsl(var(--card)); color: hsl(var(--foreground));
          cursor: pointer; text-align: left; transition: border-color 0.15s;
          font-family: inherit; min-height: 38px;
        }
        .noc-combo-trigger:focus { outline: none; border-color: hsl(var(--primary)); }
        .noc-combo-trigger.open { border-color: hsl(var(--primary)); border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
        .noc-combo-trigger.empty { color: hsl(var(--muted-foreground)); }
        .noc-combo-trigger.disabled { background: hsl(var(--background)); opacity: 0.6; cursor: not-allowed; }
        .noc-combo-left { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; }
        .noc-combo-val { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 13.5px; }
        .noc-combo-placeholder { font-size: 13.5px; }
        .noc-combo-chevron { color: hsl(var(--muted-foreground)); flex-shrink: 0; transition: transform 0.15s; }
        .noc-combo-chevron.open { transform: rotate(180deg); }
        .noc-combo-clear { background: none; border: none; cursor: pointer; color: hsl(var(--muted-foreground)); padding: 2px; display: flex; flex-shrink: 0; border-radius: 4px; }
        .noc-combo-clear:hover { background: hsl(var(--muted)); }
        .noc-combo-drop {
          position: absolute; top: 100%; left: 0; right: 0; background: hsl(var(--card));
          border: 1.5px solid hsl(var(--primary)); border-top: 1px solid hsl(var(--border));
          border-radius: 0 0 9px 9px; box-shadow: 0 8px 24px rgba(0,0,0,0.10);
          z-index: 100; overflow: hidden; max-height: 220px; display: flex; flex-direction: column;
        }
        .noc-combo-search-wrap { position: relative; border-bottom: 1px solid hsl(var(--muted)); flex-shrink: 0; }
        .noc-combo-search-wrap svg { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: hsl(var(--muted-foreground)); pointer-events: none; }
        .noc-combo-search { width: 100%; padding: 8px 12px 8px 34px; border: none; font-size: 13px; color: hsl(var(--foreground)); background: hsl(var(--background)); outline: none; font-family: inherit; box-sizing: border-box; }
        .noc-combo-list { overflow-y: auto; flex: 1; }
        .noc-combo-item { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 12px; cursor: pointer; transition: background 0.1s; border: none; background: none; width: 100%; text-align: left; font-family: inherit; }
        .noc-combo-item:hover { background: hsl(var(--primary) / 0.1); }
        .noc-combo-item.selected { background: hsl(var(--primary) / 0.15); }
        .noc-combo-item-label { font-size: 13px; font-weight: 500; color: hsl(var(--foreground)); flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .noc-combo-item-sub { font-size: 11px; color: hsl(var(--muted-foreground)); flex-shrink: 0; }
        .noc-combo-empty { padding: 16px; text-align: center; font-size: 13px; color: hsl(var(--muted-foreground)); }

        /* ── Form ── */
        .noc-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .noc-form-section {
          font-size: 10px; font-weight: 700; color: hsl(var(--muted-foreground));
          text-transform: uppercase; letter-spacing: 1px;
          padding-top: 8px; border-top: 1px solid hsl(var(--border)); margin-top: 4px;
        }
        .noc-status-select {
          width: 100%; padding: 8px 12px; border: 1.5px solid hsl(var(--border)); border-radius: 9px;
          font-size: 13.5px; color: hsl(var(--foreground)); background: hsl(var(--card));
          outline: none; transition: border-color 0.15s; font-family: inherit;
          cursor: pointer; appearance: none; -webkit-appearance: none;
        }
        .noc-status-select:focus { border-color: hsl(var(--primary)); }

        @media (max-width: 768px) {
          .noc-header { padding: 16px 16px 0; }
          .noc-body { padding: 16px; }
          .noc-form-grid { grid-template-columns: 1fr; }
          .noc-stats { flex-wrap: wrap; }
          .noc-stat { min-width: 50%; }
          .noc-table th:nth-child(4), .noc-table td:nth-child(4),
          .noc-table th:nth-child(5), .noc-table td:nth-child(5) { display: none; }
        }
      `}</style>

      <Breadcrumbs
        items={[
          { label: "Follow-Up", path: "/followup" },
          { label: "Closure", path: "/followup/closure/noc" },
          { label: "NOC", path: "/followup/closure/noc" },
        ]}
      />
      <FollowupShell title="No Objection Certificates">
      <div
        className="noc-page relative space-y-8 mt-6"
        onClick={() => setOpenMenuId(null)}
      >
        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-4">
          <div className="noc-title-row">
            <div className="noc-icon">
              <ShieldCheck size={20} />
            </div>
            <span className="noc-title">No Objection Certificates</span>
            <span className="noc-count">{pagination?.total ?? 0}</span>
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
              <Plus size={14} /> New NOC
            </Button>
          </div>
        </div>

        {/* Filter + search */}
        <div className="noc-filter-bar">
          <div className="noc-search-wrap">
            <Search size={14} />
            <input
              className="noc-search"
              placeholder="Search by applicant, NOC no, unit…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
            {search && (
              <button
                className="noc-search-clear"
                onClick={() => {
                  setSearch("");
                  setPage(1);
                }}
              >
                <X size={13} />
              </button>
            )}
          </div>
          <div className="noc-pills">
            {STATUS_FILTERS.map((s) => {
              const isActive = statusFilter === s;
              const pillClass = isActive
                ? s === ""
                  ? "noc-pill active"
                  : s === "Pending"
                    ? "noc-pill active-pending"
                    : s === "Approved"
                      ? "noc-pill active-approved"
                      : s === "Issued"
                        ? "noc-pill active-issued"
                        : "noc-pill active-rejected"
                : "noc-pill";
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
        <div className="noc-stats">
          {[
            { label: "Total", val: pagination?.total ?? 0, cls: "blue" },
            { label: stats.isPageScoped ? "Pending (Page)" : "Pending", val: stats.pending, cls: "" },
            { label: stats.isPageScoped ? "Approved (Page)" : "Approved", val: stats.approved, cls: "green" },
            { label: stats.isPageScoped ? "Issued (Page)" : "Issued", val: stats.issued, cls: "amber" },
          ].map(({ label, val, cls }) => (
            <div key={label} className="noc-stat">
              <div className={`noc-stat-val ${cls}`}>{val}</div>
              <div className="noc-stat-label">{label}</div>
            </div>
          ))}
        </div>

        {/* ── Body ── */}
        <div className="noc-body" style={{ paddingTop: 0, paddingBottom: 0 }}>
          <div className="noc-table-wrap">
            {isLoading ? (
              <table className="noc-table">
                <thead>
                  <tr>
                    {[
                      "NOC No",
                      "Applicant",
                      "Unit",
                      "Dates",
                      "Approved By",
                      "Bank / Loan",
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
                      {[80, 160, 100, 110, 110, 100, 80, 40].map((w, j) => (
                        <td key={j}>
                          <div
                            className="noc-skel"
                            style={{ height: 14, width: w }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : nocs.length === 0 ? (
              <div className="noc-empty">
                <div className="noc-empty-icon">
                  <ShieldCheck
                    size={26}
                    style={{ color: "hsl(var(--primary))" }}
                  />
                </div>
                <h3>
                  {search || statusFilter ? "No matching NOCs" : "No NOCs yet"}
                </h3>
                <p>
                  {search || statusFilter
                    ? "Try clearing your filters"
                    : "Create the first NOC to start tracking certificate approvals"}
                </p>
                {!search && !statusFilter && (
                  <Button
                    onClick={openCreate}
                    className="gradient-accent gap-1.5 font-semibold text-white text-sm px-5 py-2 h-auto mt-2"
                  >
                    <Plus size={14} /> New NOC
                  </Button>
                )}
              </div>
            ) : (
              <>
                <table className="noc-table">
                  <thead>
                    <tr>
                      <th>NOC No</th>
                      <th>Applicant</th>
                      <th>Unit / Project</th>
                      <th>NOC Date</th>
                      <th>Approved By</th>
                      <th>Bank / Loan</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {nocs.map((noc) => {
                      const sm = STATUS_META[noc.Status];
                      const color = avatarColor(noc.ApplicantName);
                      return (
                        <tr key={noc.Id}>
                          {/* NOC No */}
                          <td>
                            <div className="noc-nocno">{noc.NOCNo}</div>
                            {noc.AgreementNo && (
                              <div className="noc-unit-sub">
                                Agr: {noc.AgreementNo}
                              </div>
                            )}
                          </td>

                          {/* Applicant */}
                          <td>
                            <div className="noc-applicant-cell">
                              <div
                                className="noc-avatar"
                                style={{ background: color }}
                              >
                                {initials(noc.ApplicantName)}
                              </div>
                              <div>
                                <div className="noc-applicant-name">
                                  {noc.ApplicantName}
                                </div>
                                <div className="noc-applicant-no">
                                  {noc.ApplicantNo}
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* Unit / Project */}
                          <td>
                            {noc.UnitNo ? (
                              <div className="noc-unit">{noc.UnitNo}</div>
                            ) : (
                              <div
                                className="noc-unit"
                                style={{
                                  color: "hsl(var(--muted-foreground))",
                                }}
                              >
                                —
                              </div>
                            )}
                            {noc.ProjectName && (
                              <div className="noc-unit-sub">
                                {noc.ProjectName}
                              </div>
                            )}
                          </td>

                          {/* Dates */}
                          <td>
                            <div className="noc-date">
                              {fmtDate(noc.NOCDate)}
                            </div>
                            {noc.ApprovalDate && (
                              <div className="noc-date-sub">
                                Appr: {fmtDate(noc.ApprovalDate)}
                              </div>
                            )}
                            {noc.IssuedDate && (
                              <div className="noc-date-sub">
                                Issued: {fmtDate(noc.IssuedDate)}
                              </div>
                            )}
                          </td>

                          {/* Approved By */}
                          <td>
                            {noc.ApprovedBy ? (
                              <div className="noc-approved-by">
                                {noc.ApprovedBy}
                              </div>
                            ) : (
                              <div
                                style={{
                                  color: "hsl(var(--muted-foreground))",
                                  fontSize: 13,
                                }}
                              >
                                —
                              </div>
                            )}
                          </td>

                          {/* Bank / Loan */}
                          <td>
                            {noc.BankName ? (
                              <div>
                                <div
                                  style={{
                                    fontSize: 12,
                                    fontWeight: 600,
                                    color: "hsl(var(--foreground))",
                                  }}
                                >
                                  {noc.BankName}
                                </div>
                                {noc.BankNOCStatus && (
                                  <div
                                    style={{
                                      fontSize: 11,
                                      color:
                                        noc.BankNOCStatus === "Received"
                                          ? "hsl(142 72% 38%)"
                                          : noc.BankNOCStatus === "Applied"
                                            ? "hsl(var(--primary))"
                                            : "hsl(var(--muted-foreground))",
                                    }}
                                  >
                                    NOC:{" "}
                                    {noc.BankNOCStatus === "NotApplicable"
                                      ? "N/A"
                                      : noc.BankNOCStatus}
                                  </div>
                                )}
                                {noc.LoanSanctionStatus && (
                                  <div
                                    style={{
                                      fontSize: 11,
                                      color:
                                        noc.LoanSanctionStatus === "Sanctioned"
                                          ? "hsl(142 72% 38%)"
                                          : noc.LoanSanctionStatus ===
                                              "Rejected"
                                            ? "hsl(0 84% 50%)"
                                            : "hsl(var(--muted-foreground))",
                                    }}
                                  >
                                    Loan: {noc.LoanSanctionStatus}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div
                                style={{
                                  color: "hsl(var(--muted-foreground))",
                                  fontSize: 13,
                                }}
                              >
                                —
                              </div>
                            )}
                          </td>

                          {/* Status */}
                          <td>
                            <span className={`noc-badge ${sm.cls}`}>
                              {sm.icon} {sm.label}
                            </span>
                          </td>

                          {/* Actions */}
                          <td>
                            <div
                              className="noc-actions"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                className="noc-menu-btn"
                                onClick={() =>
                                  setOpenMenuId(
                                    openMenuId === noc.Id ? null : noc.Id,
                                  )
                                }
                              >
                                <MoreHorizontal size={16} />
                              </button>
                              {openMenuId === noc.Id && (
                                <div className="noc-menu">
                                  {rights.canEdit && (<button
                                    className="noc-menu-item"
                                    onClick={() => {
                                      openEdit(noc);
                                      setOpenMenuId(null);
                                    }}
                                  >
                                    <Pencil size={13} /> Edit
                                  </button>)}
                                  {rights.canDelete && (
                                    <button
                                      className="noc-menu-item danger"
                                      onClick={() => {
                                        setDeleteId(noc.Id);
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
                  <div className="noc-pagination">
                    <span>
                      {(pagination.page - 1) * pagination.pageSize + 1}–
                      {Math.min(
                        pagination.page * pagination.pageSize,
                        pagination.total,
                      )}{" "}
                      of {pagination.total}
                    </span>
                    <div className="noc-pag-btns">
                      <button
                        className="noc-pag-btn"
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
                            className={`noc-pag-btn${page === n ? " active" : ""}`}
                            onClick={() => setPage(n as number)}
                          >
                            {n}
                          </button>
                        ),
                      )}
                      <button
                        className="noc-pag-btn"
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
      </FollowupShell>

      {/* ── Create / Edit Dialog ── */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(v) => {
          if (!v) { setDialogOpen(false); setEditId(null); setForm(EMPTY_FORM); }
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
                <ShieldCheck
                  size={15}
                  style={{ color: "hsl(var(--primary-foreground))" }}
                />
              </div>
              {editId ? "Edit NOC" : "New NOC"}
            </DialogTitle>
            <DialogDescription>
              {editId
                ? "Update the NOC details below."
                : "Fill in the details to create a new NOC."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            {/* Applicant */}
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

            {/* Unit Selection + Agreement */}
            <div className="noc-form-grid">
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
            <div className="noc-form-grid">
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

            <div className="noc-form-section">Approval Workflow</div>

            {/* Dates */}
            <div className="noc-form-grid">
              <div className="space-y-2">
                <Label>NOC Date</Label>
                <Input
                  type="date"
                  value={form.NOCDate}
                  onChange={(e) => set("NOCDate", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Approval Date</Label>
                <Input
                  type="date"
                  value={form.ApprovalDate}
                  onChange={(e) => set("ApprovalDate", e.target.value)}
                />
              </div>
            </div>

            <div className="noc-form-grid">
              <div className="space-y-2">
                <Label>Issued Date</Label>
                <Input
                  type="date"
                  value={form.IssuedDate}
                  onChange={(e) => set("IssuedDate", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Approved By</Label>
                <Input
                  value={form.ApprovedBy}
                  onChange={(e) => set("ApprovedBy", e.target.value)}
                  placeholder="Authority / name…"
                />
              </div>
            </div>

            {/* Status */}
            <div className="space-y-2">
              <Label>Status</Label>
              <select
                className="noc-status-select"
                value={form.Status}
                onChange={(e) => set("Status", e.target.value as NOCStatus)}
              >
                {(
                  meta?.statusOptions ??
                  (["Pending", "Approved", "Issued", "Rejected"] as NOCStatus[])
                ).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            {/* Reason */}
            <div className="space-y-2">
              <Label>Reason / Purpose</Label>
              <Input
                value={form.Reason}
                onChange={(e) => set("Reason", e.target.value)}
                placeholder="Purpose of the NOC…"
              />
            </div>

            <div className="noc-form-section">Bank NOC / Loan Tracking</div>

            {/* Bank Name + Loan Account */}
            <div className="noc-form-grid">
              <div className="space-y-2">
                <Label>Bank Name</Label>
                <Input
                  value={form.BankName}
                  onChange={(e) => set("BankName", e.target.value)}
                  placeholder="e.g. HDFC Bank"
                />
              </div>
              <div className="space-y-2">
                <Label>Loan Account No</Label>
                <Input
                  value={form.LoanAccountNo}
                  onChange={(e) => set("LoanAccountNo", e.target.value)}
                  placeholder="Loan account number…"
                />
              </div>
            </div>

            {/* Loan Amount + Sanction Status */}
            <div className="noc-form-grid">
              <div className="space-y-2">
                <Label>Loan Amount (₹)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.LoanAmount}
                  onChange={(e) => set("LoanAmount", e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-2">
                <Label>Loan Sanction Status</Label>
                <select
                  className="noc-status-select"
                  value={form.LoanSanctionStatus}
                  onChange={(e) => set("LoanSanctionStatus", e.target.value)}
                >
                  <option value="">— Not set —</option>
                  <option value="Pending">Pending</option>
                  <option value="Sanctioned">Sanctioned</option>
                  <option value="Rejected">Rejected</option>
                </select>
              </div>
            </div>

            {/* Sanction Date + Disbursement Status */}
            <div className="noc-form-grid">
              <div className="space-y-2">
                <Label>Sanction Date</Label>
                <Input
                  type="date"
                  value={form.LoanSanctionDate}
                  onChange={(e) => set("LoanSanctionDate", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Disbursement Status</Label>
                <select
                  className="noc-status-select"
                  value={form.LoanDisbursementStatus}
                  onChange={(e) =>
                    set("LoanDisbursementStatus", e.target.value)
                  }
                >
                  <option value="">— Not set —</option>
                  <option value="Pending">Pending</option>
                  <option value="PartiallyDisbursed">
                    Partially Disbursed
                  </option>
                  <option value="FullyDisbursed">Fully Disbursed</option>
                </select>
              </div>
            </div>

            {/* Disbursement Date + Bank NOC Status */}
            <div className="noc-form-grid">
              <div className="space-y-2">
                <Label>Disbursement Date</Label>
                <Input
                  type="date"
                  value={form.LoanDisbursementDate}
                  onChange={(e) => set("LoanDisbursementDate", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Bank NOC Status</Label>
                <select
                  className="noc-status-select"
                  value={form.BankNOCStatus}
                  onChange={(e) => set("BankNOCStatus", e.target.value)}
                >
                  <option value="">— Not set —</option>
                  <option value="NotApplicable">Not Applicable</option>
                  <option value="Pending">Pending</option>
                  <option value="Applied">Applied</option>
                  <option value="Received">Received</option>
                </select>
              </div>
            </div>

            {/* Bank NOC Date + Notes */}
            <div className="noc-form-grid">
              <div className="space-y-2">
                <Label>Bank NOC Date</Label>
                <Input
                  type="date"
                  value={form.BankNOCDate}
                  onChange={(e) => set("BankNOCDate", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Bank NOC Notes</Label>
                <Input
                  value={form.BankNOCNotes}
                  onChange={(e) => set("BankNOCNotes", e.target.value)}
                  placeholder="Any remarks on bank NOC…"
                />
              </div>
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
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogOpen(false); setEditId(null); setForm(EMPTY_FORM); }}>
              Cancel
            </Button>
            <Button
              disabled={
                !form.ApplicantId || createMut.isPending || updateMut.isPending
              }
              onClick={() => (editId ? updateMut.mutate() : createMut.mutate())}
              className="gradient-accent gap-1.5 font-semibold text-white text-sm px-5 py-2 h-auto"
            >
              {createMut.isPending || updateMut.isPending
                ? "Saving…"
                : editId
                  ? "Update NOC"
                  : "Create NOC"}
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
            <AlertDialogTitle>Delete this NOC?</AlertDialogTitle>
            <AlertDialogDescription>
              This NOC record will be permanently removed. This action cannot be
              undone.
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
    </>
  );
}

export default NOCPage;