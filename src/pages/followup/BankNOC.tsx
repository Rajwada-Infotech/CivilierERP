import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  RefreshCw,
  Search,
  X,
  Landmark,
  ChevronDown,
  Pencil,
  Trash2,
  CheckCircle2,
  Clock,
  AlertCircle,
  XCircle,
  MoreHorizontal,
  ChevronLeft,
  ChevronRight,
  IndianRupee,
  FileCheck,
  Banknote,
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

type BankNOCStatus = "NotApplicable" | "Pending" | "Applied" | "Received";
type LoanSanctionStatus = "Pending" | "Sanctioned" | "Rejected";
type LoanDisbursementStatus =
  | "Pending"
  | "PartiallyDisbursed"
  | "FullyDisbursed";

interface BankNOCRecord {
  Id: number;
  NOCNo: string;
  ApplicantId: number;
  ApplicantNo: string | null;
  ApplicantName: string;
  UnitSelectionId: number | null;
  AgreementId: number | null;
  ProjectId: number | null;
  CompanyId: number | null;
  UnitNo: string | null;
  SelectionNo: string | null;
  ProjectName: string | null;
  AgreementNo: string | null;
  // Bank / Loan fields
  BankName: string | null;
  LoanAccountNo: string | null;
  LoanAmount: number | null;
  LoanSanctionStatus: LoanSanctionStatus | null;
  LoanSanctionDate: string | null;
  LoanDisbursementStatus: LoanDisbursementStatus | null;
  LoanDisbursementDate: string | null;
  BankNOCStatus: BankNOCStatus | null;
  BankNOCDate: string | null;
  BankNOCNotes: string | null;
  // Parent NOC status
  NOCStatus: string;
  CreatedAt: string;
}

interface OptionApplicant {
  Id: number;
  ApplicantNo: string | null;
  ApplicantName: string;
}

interface MetaOptions {
  applicants: OptionApplicant[];
}

interface BankNOCFormState {
  // Read-only display (set from NOC record, not editable here)
  // Core NOC fields required by PUT endpoint
  ApplicantId: string;
  UnitSelectionId: string;
  AgreementId: string;
  ProjectId: string;
  CompanyId: string;
  NOCStatus: string;
  BankName: string;
  LoanAccountNo: string;
  LoanAmount: string;
  LoanSanctionStatus: string;
  LoanSanctionDate: string;
  LoanDisbursementStatus: string;
  LoanDisbursementDate: string;
  BankNOCStatus: string;
  BankNOCDate: string;
  BankNOCNotes: string;
}

const EMPTY_FORM: BankNOCFormState = {
  ApplicantId: "",
  UnitSelectionId: "",
  AgreementId: "",
  ProjectId: "",
  CompanyId: "",
  NOCStatus: "Pending",
  BankName: "",
  LoanAccountNo: "",
  LoanAmount: "",
  LoanSanctionStatus: "",
  LoanSanctionDate: "",
  LoanDisbursementStatus: "",
  LoanDisbursementDate: "",
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

function fmtMoney(v: number | null | undefined): string {
  if (v == null) return "—";
  return `₹ ${Number(v).toLocaleString("en-IN")}`;
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

// ─── Status configs ───────────────────────────────────────────────────────────

const BANK_NOC_META: Record<
  BankNOCStatus,
  { label: string; icon: React.ReactNode; cls: string }
> = {
  NotApplicable: {
    label: "N/A",
    icon: <XCircle size={11} />,
    cls: "bnoc-badge-na",
  },
  Pending: {
    label: "Pending",
    icon: <Clock size={11} />,
    cls: "bnoc-badge-pending",
  },
  Applied: {
    label: "Applied",
    icon: <FileCheck size={11} />,
    cls: "bnoc-badge-applied",
  },
  Received: {
    label: "Received",
    icon: <CheckCircle2 size={11} />,
    cls: "bnoc-badge-received",
  },
};

const LOAN_SANCTION_META: Record<
  LoanSanctionStatus,
  { label: string; color: string }
> = {
  Pending: { label: "Pending", color: "hsl(var(--muted-foreground))" },
  Sanctioned: { label: "Sanctioned", color: "hsl(142 72% 38%)" },
  Rejected: { label: "Rejected", color: "hsl(0 84% 50%)" },
};

const LOAN_DISB_META: Record<
  LoanDisbursementStatus,
  { label: string; color: string }
> = {
  Pending: { label: "Pending", color: "hsl(var(--muted-foreground))" },
  PartiallyDisbursed: { label: "Partial", color: "hsl(38 92% 45%)" },
  FullyDisbursed: { label: "Full", color: "hsl(142 72% 38%)" },
};

// ─── API ──────────────────────────────────────────────────────────────────────

async function fetchBankNOCs(params: {
  page: number;
  pageSize: number;
  search: string;
  bankNocStatus: string;
}): Promise<{
  data: BankNOCRecord[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}> {
  // POST /search keeps sensitive filter params (bankNocStatus) in the request
  // body instead of the URL. Fixes CodeQL js/sensitive-get-query (#523).
  const res = await fetchWithAuth("/api/followup-noc/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      page: params.page,
      pageSize: params.pageSize,
      ...(params.search ? { search: params.search } : {}),
      ...(params.bankNocStatus ? { bankNocStatus: params.bankNocStatus } : {}),
    }),
  });
  if (!res.ok) throw new Error("Failed to load Bank NOC records");
  return res.json();
}

async function updateBankNOC(id: number, payload: Record<string, unknown>) {
  const res = await fetchWithAuth(`/api/followup-noc/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error || "Failed to update Bank NOC",
    );
  }
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
    <div className="bnoc-combo">
      <button
        type="button"
        className={`bnoc-combo-trigger${open ? " open" : ""}${!value ? " empty" : ""}${disabled ? " disabled" : ""}`}
        onClick={() => {
          if (!disabled) {
            setOpen((v) => !v);
            setQ("");
          }
        }}
      >
        <span className="bnoc-combo-left">
          {selected ? (
            <span className="bnoc-combo-val">{selected.label}</span>
          ) : (
            <span className="bnoc-combo-placeholder">{placeholder}</span>
          )}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {value && !disabled && (
            <span
              className="bnoc-combo-clear"
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
            className={`bnoc-combo-chevron${open ? " open" : ""}`}
          />
        </span>
      </button>
      {open && (
        <div className="bnoc-combo-drop">
          <div className="bnoc-combo-search-wrap">
            <Search size={13} />
            <input
              className="bnoc-combo-search"
              placeholder="Search…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoFocus
            />
          </div>
          <div className="bnoc-combo-list">
            {filtered.length === 0 ? (
              <div className="bnoc-combo-empty">No results</div>
            ) : (
              filtered.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={`bnoc-combo-item${value === item.value ? " selected" : ""}`}
                  onClick={() => {
                    onChange(item.value);
                    setOpen(false);
                    setQ("");
                  }}
                >
                  <span className="bnoc-combo-item-label">{item.label}</span>
                  {item.sub && (
                    <span className="bnoc-combo-item-sub">{item.sub}</span>
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

export function BankNOCPage() {
  const qc = useQueryClient();
  const rights = usePageRights("followup-bank-noc");

  const [search, setSearch] = useState("");
  const [bankNocFilter, setBankNocFilter] = useState<BankNOCStatus | "">("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<BankNOCFormState>(EMPTY_FORM);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);

  const {
    data: result,
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ["bank-nocs", page, search, bankNocFilter],
    queryFn: () =>
      fetchBankNOCs({
        page,
        pageSize: PAGE_SIZE,
        search,
        bankNocStatus: bankNocFilter,
      }),
    placeholderData: (prev) => prev,
  });

  const records = result?.data ?? [];
  const pagination = result?.pagination;

  const stats = useMemo(
    () => ({
      total: pagination?.total ?? 0,
      pending: records.filter((r) => r.BankNOCStatus === "Pending").length,
      applied: records.filter((r) => r.BankNOCStatus === "Applied").length,
      received: records.filter((r) => r.BankNOCStatus === "Received").length,
      isPageScoped: (pagination?.totalPages ?? 1) > 1,
    }),
    [records, pagination],
  );

  function set(k: keyof BankNOCFormState, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function openEdit(rec: BankNOCRecord) {
    setEditId(rec.Id);
    setForm({
      ApplicantId: String(rec.ApplicantId),
      UnitSelectionId: rec.UnitSelectionId ? String(rec.UnitSelectionId) : "",
      AgreementId: rec.AgreementId ? String(rec.AgreementId) : "",
      ProjectId: rec.ProjectId ? String(rec.ProjectId) : "",
      CompanyId: rec.CompanyId ? String(rec.CompanyId) : "",
      NOCStatus: rec.NOCStatus ?? "Pending",
      BankName: rec.BankName ?? "",
      LoanAccountNo: rec.LoanAccountNo ?? "",
      LoanAmount: rec.LoanAmount != null ? String(rec.LoanAmount) : "",
      LoanSanctionStatus: rec.LoanSanctionStatus ?? "",
      LoanSanctionDate: rec.LoanSanctionDate ?? "",
      LoanDisbursementStatus: rec.LoanDisbursementStatus ?? "",
      LoanDisbursementDate: rec.LoanDisbursementDate ?? "",
      BankNOCStatus: rec.BankNOCStatus ?? "",
      BankNOCDate: rec.BankNOCDate ?? "",
      BankNOCNotes: rec.BankNOCNotes ?? "",
    });
    setDialogOpen(true);
  }

  function buildPayload() {
    return {
      // Required by PUT getPayload() — pass through from stored form
      ApplicantId: form.ApplicantId || null,
      UnitSelectionId: form.UnitSelectionId || null,
      AgreementId: form.AgreementId || null,
      ProjectId: form.ProjectId || null,
      CompanyId: form.CompanyId || null,
      Status: form.NOCStatus || "Pending",
      // Bank NOC fields
      BankName: form.BankName || null,
      LoanAccountNo: form.LoanAccountNo || null,
      LoanAmount: form.LoanAmount ? parseFloat(form.LoanAmount) : null,
      LoanSanctionStatus: form.LoanSanctionStatus || null,
      LoanSanctionDate: form.LoanSanctionDate || null,
      LoanDisbursementStatus: form.LoanDisbursementStatus || null,
      LoanDisbursementDate: form.LoanDisbursementDate || null,
      BankNOCStatus: form.BankNOCStatus || null,
      BankNOCDate: form.BankNOCDate || null,
      BankNOCNotes: form.BankNOCNotes || null,
    };
  }

  const invalidate = () => qc.invalidateQueries({ queryKey: ["bank-nocs"] });

  const updateMut = useMutation({
    mutationFn: () => updateBankNOC(editId!, buildPayload()),
    onSuccess: () => {
      toast.success("Bank NOC updated");
      invalidate();
      setDialogOpen(false);
      setEditId(null);
      setForm(EMPTY_FORM);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const BANK_NOC_FILTERS: Array<BankNOCStatus | ""> = [
    "",
    "Pending",
    "Applied",
    "Received",
    "NotApplicable",
  ];
  const FILTER_LABELS: Record<string, string> = {
    "": "All",
    Pending: "Pending",
    Applied: "Applied",
    Received: "Received",
    NotApplicable: "N/A",
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
        .bnoc-page { font-family: 'DM Sans','Segoe UI',sans-serif; color: hsl(var(--foreground)); }

        .bnoc-filter-bar { display:flex; align-items:center; gap:12px; padding:14px 0; flex-wrap:wrap; }
        .bnoc-search-wrap { flex:1; min-width:200px; max-width:380px; position:relative; }
        .bnoc-search-wrap svg { position:absolute; left:12px; top:50%; transform:translateY(-50%); color:hsl(var(--muted-foreground)); pointer-events:none; }
        .bnoc-search { width:100%; padding:8px 12px 8px 36px; border:1.5px solid hsl(var(--border)); border-radius:9px; font-size:13.5px; color:hsl(var(--foreground)); background:hsl(var(--card)); outline:none; transition:border-color .15s; font-family:inherit; box-sizing:border-box; }
        .bnoc-search:focus { border-color:hsl(var(--primary)); }
        .bnoc-search-clear { position:absolute; right:10px; top:50%; transform:translateY(-50%); background:none; border:none; cursor:pointer; color:hsl(var(--muted-foreground)); padding:2px; display:flex; border-radius:4px; }

        .bnoc-pills { display:flex; gap:6px; flex-wrap:wrap; }
        .bnoc-pill { padding:5px 12px; border-radius:20px; font-size:12px; font-weight:500; border:1.5px solid hsl(var(--border)); background:hsl(var(--card)); color:hsl(var(--muted-foreground)); cursor:pointer; transition:all .12s; font-family:inherit; white-space:nowrap; }
        .bnoc-pill:hover { border-color:hsl(var(--primary)); color:hsl(var(--primary)); }
        .bnoc-pill.active      { background:hsl(var(--primary)); border-color:hsl(var(--primary)); color:hsl(var(--primary-foreground)); }
        .bnoc-pill.active-applied   { background:hsl(var(--primary)/0.1); border-color:hsl(var(--primary)/0.4); color:hsl(var(--primary)); }
        .bnoc-pill.active-received  { background:hsl(142 76% 36%/0.12); border-color:hsl(142 76% 36%/0.4); color:hsl(142 76% 36%); }
        .bnoc-pill.active-pending   { background:hsl(var(--muted)); border-color:hsl(var(--border)); color:hsl(var(--muted-foreground)); }
        .bnoc-pill.active-na        { background:hsl(var(--muted)); border-color:hsl(var(--border)); color:hsl(var(--muted-foreground)); }

        .bnoc-stats { display:flex; border-top:1px solid hsl(var(--border)); }
        .bnoc-stat { flex:1; padding:12px 0; text-align:center; border-right:1px solid hsl(var(--border)); }
        .bnoc-stat:last-child { border-right:none; }
        .bnoc-stat-val { font-size:18px; font-weight:700; color:hsl(var(--foreground)); }
        .bnoc-stat-label { font-size:10px; font-weight:600; color:hsl(var(--muted-foreground)); text-transform:uppercase; letter-spacing:.5px; margin-top:1px; }
        .bnoc-stat-val.blue  { color:hsl(var(--primary)); }
        .bnoc-stat-val.amber { color:hsl(38 92% 45%); }
        .bnoc-stat-val.green { color:hsl(142 72% 38%); }

        .bnoc-body { padding:24px 0; width:100%; display:flex; flex-direction:column; gap:20px; }

        .bnoc-table-wrap { background:hsl(var(--card)); border:1px solid hsl(var(--border)); border-radius:14px; overflow:hidden; box-shadow:0 1px 4px rgba(0,0,0,.04); }
        .bnoc-table { width:100%; border-collapse:collapse; }
        .bnoc-table thead tr { border-bottom:1.5px solid hsl(var(--border)); }
        .bnoc-table th { padding:11px 16px; text-align:left; font-size:11px; font-weight:600; color:hsl(var(--muted-foreground)); text-transform:uppercase; letter-spacing:.5px; background:hsl(var(--muted)); white-space:nowrap; }
        .bnoc-table td { padding:14px 16px; font-size:13.5px; color:hsl(var(--foreground)); border-bottom:1px solid hsl(var(--border)); vertical-align:middle; }
        .bnoc-table tbody tr:last-child td { border-bottom:none; }
        .bnoc-table tbody tr { transition:background .1s; }
        .bnoc-table tbody tr:hover { background:hsl(var(--background)); }

        .bnoc-nocno { font-weight:700; color:hsl(var(--primary)); font-size:13px; font-family:'DM Mono',monospace; }
        .bnoc-applicant-cell { display:flex; align-items:center; gap:9px; }
        .bnoc-avatar { width:30px; height:30px; border-radius:8px; font-size:11px; font-weight:700; color:hsl(var(--primary-foreground)); display:flex; align-items:center; justify-content:center; flex-shrink:0; }
        .bnoc-applicant-name { font-weight:600; color:hsl(var(--foreground)); font-size:13px; }
        .bnoc-applicant-no   { font-size:11px; color:hsl(var(--muted-foreground)); }
        .bnoc-sub { font-size:11px; color:hsl(var(--muted-foreground)); }

        /* Badges */
        .bnoc-badge { display:inline-flex; align-items:center; gap:4px; padding:3px 9px; border-radius:20px; font-size:11px; font-weight:600; }
        .bnoc-badge-na       { background:hsl(var(--muted));              color:hsl(var(--muted-foreground)); }
        .bnoc-badge-pending  { background:hsl(var(--muted));              color:hsl(var(--muted-foreground)); }
        .bnoc-badge-applied  { background:hsl(var(--primary)/0.1);        color:hsl(var(--primary)); }
        .bnoc-badge-received { background:hsl(142 76% 36%/0.12);         color:hsl(142 76% 36%); }

        .bnoc-actions { position:relative; }
        .bnoc-menu-btn { width:30px; height:30px; border-radius:7px; display:flex; align-items:center; justify-content:center; background:none; border:none; cursor:pointer; color:hsl(var(--muted-foreground)); transition:all .1s; }
        .bnoc-menu-btn:hover { background:hsl(var(--muted)); color:hsl(var(--foreground)); }
        .bnoc-menu { position:absolute; right:0; top:100%; margin-top:4px; background:hsl(var(--card)); border:1px solid hsl(var(--border)); border-radius:10px; box-shadow:0 8px 24px rgba(0,0,0,.10); z-index:50; min-width:140px; overflow:hidden; animation:bnoc-menu-in .1s ease; }
        @keyframes bnoc-menu-in { from{opacity:0;transform:translateY(-4px)} to{opacity:1;transform:translateY(0)} }
        .bnoc-menu-item { display:flex; align-items:center; gap:9px; padding:9px 14px; font-size:13px; font-weight:500; cursor:pointer; background:none; border:none; width:100%; text-align:left; font-family:inherit; color:hsl(var(--foreground)); transition:background .1s; }
        .bnoc-menu-item:hover { background:hsl(var(--background)); }
        .bnoc-menu-item.danger { color:hsl(0 84% 50%); }
        .bnoc-menu-item.danger:hover { background:hsl(0 84% 60%/0.08); }

        .bnoc-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; padding:72px 24px; gap:12px; color:hsl(var(--muted-foreground)); text-align:center; }
        .bnoc-empty-icon { width:56px; height:56px; background:hsl(var(--primary)/0.1); border-radius:14px; display:flex; align-items:center; justify-content:center; }
        .bnoc-empty h3 { font-size:15px; font-weight:600; color:hsl(var(--muted-foreground)); margin:0; }
        .bnoc-empty p  { font-size:13px; color:hsl(var(--muted-foreground)); margin:0; }

        .bnoc-pagination { display:flex; align-items:center; justify-content:space-between; padding:14px 20px; border-top:1px solid hsl(var(--border)); font-size:13px; color:hsl(var(--muted-foreground)); }
        .bnoc-pag-btns { display:flex; gap:6px; }
        .bnoc-pag-btn { width:32px; height:32px; border-radius:8px; display:flex; align-items:center; justify-content:center; background:none; border:1px solid hsl(var(--border)); cursor:pointer; color:hsl(var(--foreground)); transition:all .12s; font-family:inherit; font-size:12px; }
        .bnoc-pag-btn:hover:not(:disabled) { border-color:hsl(var(--primary)); color:hsl(var(--primary)); }
        .bnoc-pag-btn:disabled { opacity:.4; cursor:not-allowed; }
        .bnoc-pag-btn.active { background:hsl(var(--primary)); border-color:hsl(var(--primary)); color:hsl(var(--primary-foreground)); font-weight:600; }

        .bnoc-skel { background:linear-gradient(90deg,hsl(var(--muted)) 25%,hsl(var(--border)) 50%,hsl(var(--muted)) 75%); background-size:200% 100%; animation:bnoc-shimmer 1.4s infinite; border-radius:6px; }
        @keyframes bnoc-shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }

        /* Combobox */
        .bnoc-combo { position:relative; width:100%; }
        .bnoc-combo-trigger { width:100%; display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 12px; border:1.5px solid hsl(var(--border)); border-radius:9px; font-size:14px; background:hsl(var(--card)); color:hsl(var(--foreground)); cursor:pointer; text-align:left; transition:border-color .15s; font-family:inherit; min-height:38px; }
        .bnoc-combo-trigger:focus { outline:none; border-color:hsl(var(--primary)); }
        .bnoc-combo-trigger.open { border-color:hsl(var(--primary)); border-bottom-left-radius:0; border-bottom-right-radius:0; }
        .bnoc-combo-trigger.empty { color:hsl(var(--muted-foreground)); }
        .bnoc-combo-trigger.disabled { background:hsl(var(--background)); opacity:.6; cursor:not-allowed; }
        .bnoc-combo-left { display:flex; align-items:center; gap:8px; min-width:0; flex:1; }
        .bnoc-combo-val { font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-size:13.5px; }
        .bnoc-combo-placeholder { font-size:13.5px; }
        .bnoc-combo-chevron { color:hsl(var(--muted-foreground)); flex-shrink:0; transition:transform .15s; }
        .bnoc-combo-chevron.open { transform:rotate(180deg); }
        .bnoc-combo-clear { background:none; border:none; cursor:pointer; color:hsl(var(--muted-foreground)); padding:2px; display:flex; flex-shrink:0; border-radius:4px; }
        .bnoc-combo-clear:hover { background:hsl(var(--muted)); }
        .bnoc-combo-drop { position:absolute; top:100%; left:0; right:0; background:hsl(var(--card)); border:1.5px solid hsl(var(--primary)); border-top:1px solid hsl(var(--border)); border-radius:0 0 9px 9px; box-shadow:0 8px 24px rgba(0,0,0,.10); z-index:100; overflow:hidden; max-height:220px; display:flex; flex-direction:column; }
        .bnoc-combo-search-wrap { position:relative; border-bottom:1px solid hsl(var(--muted)); flex-shrink:0; }
        .bnoc-combo-search-wrap svg { position:absolute; left:12px; top:50%; transform:translateY(-50%); color:hsl(var(--muted-foreground)); pointer-events:none; }
        .bnoc-combo-search { width:100%; padding:8px 12px 8px 34px; border:none; font-size:13px; color:hsl(var(--foreground)); background:hsl(var(--background)); outline:none; font-family:inherit; box-sizing:border-box; }
        .bnoc-combo-list { overflow-y:auto; flex:1; }
        .bnoc-combo-item { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:8px 12px; cursor:pointer; transition:background .1s; border:none; background:none; width:100%; text-align:left; font-family:inherit; }
        .bnoc-combo-item:hover { background:hsl(var(--primary)/0.1); }
        .bnoc-combo-item.selected { background:hsl(var(--primary)/0.15); }
        .bnoc-combo-item-label { font-size:13px; font-weight:500; color:hsl(var(--foreground)); flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .bnoc-combo-item-sub { font-size:11px; color:hsl(var(--muted-foreground)); flex-shrink:0; }
        .bnoc-combo-empty { padding:16px; text-align:center; font-size:13px; color:hsl(var(--muted-foreground)); }

        .bnoc-form-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
        .bnoc-form-section { font-size:10px; font-weight:700; color:hsl(var(--muted-foreground)); text-transform:uppercase; letter-spacing:1px; padding-top:8px; border-top:1px solid hsl(var(--border)); margin-top:4px; }
        .bnoc-status-select { width:100%; padding:8px 12px; border:1.5px solid hsl(var(--border)); border-radius:9px; font-size:13.5px; color:hsl(var(--foreground)); background:hsl(var(--card)); outline:none; transition:border-color .15s; font-family:inherit; cursor:pointer; appearance:none; -webkit-appearance:none; }
        .bnoc-status-select:focus { border-color:hsl(var(--primary)); }

        @media (max-width:768px) {
          .bnoc-form-grid { grid-template-columns:1fr; }
          .bnoc-stats { flex-wrap:wrap; }
          .bnoc-stat { min-width:50%; }
          .bnoc-table th:nth-child(4), .bnoc-table td:nth-child(4) { display:none; }
        }
      `}</style>

      <Breadcrumbs
        items={[
          { label: "Follow-Up", path: "/followup" },
          { label: "Closure", path: "/followup/closure/noc" },
          { label: "Bank NOC", path: "/followup/closure/bank-noc" },
        ]}
      />

      <FollowupShell title="Bank NOC">
      <div
        className="bnoc-page relative space-y-8 mt-6"
        onClick={() => setOpenMenuId(null)}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              style={{
                width: 40,
                height: 40,
                background: "hsl(var(--primary))",
                borderRadius: 12,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "hsl(var(--primary-foreground))",
                flexShrink: 0,
                boxShadow: "0 2px 8px hsl(var(--primary)/0.25)",
              }}
            >
              <Landmark size={20} />
            </div>
            <span
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: "hsl(var(--foreground))",
              }}
            >
              Bank NOC
            </span>
            <span
              style={{
                background: "hsl(var(--primary)/0.1)",
                color: "hsl(var(--primary))",
                fontSize: 12,
                fontWeight: 600,
                padding: "2px 8px",
                borderRadius: 20,
              }}
            >
              {pagination?.total ?? 0}
            </span>
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
          >
            <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        {/* Filter bar */}
        <div className="bnoc-filter-bar">
          <div className="bnoc-search-wrap">
            <Search size={14} />
            <input
              className="bnoc-search"
              placeholder="Search by applicant, NOC no, bank, unit…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
            {search && (
              <button
                className="bnoc-search-clear"
                onClick={() => {
                  setSearch("");
                  setPage(1);
                }}
              >
                <X size={13} />
              </button>
            )}
          </div>
          <div className="bnoc-pills">
            {BANK_NOC_FILTERS.map((s) => {
              const isActive = bankNocFilter === s;
              const cls = isActive
                ? s === ""
                  ? "bnoc-pill active"
                  : s === "Applied"
                    ? "bnoc-pill active-applied"
                    : s === "Received"
                      ? "bnoc-pill active-received"
                      : s === "Pending"
                        ? "bnoc-pill active-pending"
                        : "bnoc-pill active-na"
                : "bnoc-pill";
              return (
                <button
                  key={s}
                  className={cls}
                  onClick={() => {
                    setBankNocFilter(s as BankNOCStatus | "");
                    setPage(1);
                  }}
                >
                  {FILTER_LABELS[s]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Stats */}
        <div className="bnoc-stats">
          {[
            { label: "Total", val: pagination?.total ?? 0, cls: "blue" },
            { label: stats.isPageScoped ? "Pending (Page)" : "Pending", val: stats.pending, cls: "" },
            { label: stats.isPageScoped ? "Applied (Page)" : "Applied", val: stats.applied, cls: "amber" },
            { label: stats.isPageScoped ? "Received (Page)" : "Received", val: stats.received, cls: "green" },
          ].map(({ label, val, cls }) => (
            <div key={label} className="bnoc-stat">
              <div className={`bnoc-stat-val ${cls}`}>{val}</div>
              <div className="bnoc-stat-label">{label}</div>
            </div>
          ))}
        </div>

        {/* Table */}
        <div className="bnoc-body" style={{ paddingTop: 0, paddingBottom: 0 }}>
          <div className="bnoc-table-wrap">
            {isLoading ? (
              <table className="bnoc-table">
                <thead>
                  <tr>
                    {[
                      "NOC No",
                      "Applicant",
                      "Bank / Loan",
                      "Loan Amount",
                      "Sanction",
                      "Disbursement",
                      "Bank NOC",
                      "",
                    ].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>
                      {[80, 160, 120, 100, 100, 100, 90, 40].map((w, j) => (
                        <td key={j}>
                          <div
                            className="bnoc-skel"
                            style={{ height: 14, width: w }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : records.length === 0 ? (
              <div className="bnoc-empty">
                <div className="bnoc-empty-icon">
                  <Landmark
                    size={26}
                    style={{ color: "hsl(var(--primary))" }}
                  />
                </div>
                <h3>
                  {search || bankNocFilter
                    ? "No matching records"
                    : "No Bank NOC records"}
                </h3>
                <p>
                  {search || bankNocFilter
                    ? "Try clearing your filters"
                    : "Bank NOC details are tracked through the NOC module"}
                </p>
              </div>
            ) : (
              <>
                <table className="bnoc-table">
                  <thead>
                    <tr>
                      <th>NOC No</th>
                      <th>Applicant</th>
                      <th>Bank / Account</th>
                      <th>Loan Amount</th>
                      <th>Sanction</th>
                      <th>Disbursement</th>
                      <th>Bank NOC Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((rec) => {
                      const bns = rec.BankNOCStatus as BankNOCStatus | null;
                      const bMeta = bns ? BANK_NOC_META[bns] : null;
                      const color = avatarColor(rec.ApplicantName);

                      const ls = rec.LoanSanctionStatus;
                      const lsMeta = ls ? LOAN_SANCTION_META[ls] : null;

                      const ld = rec.LoanDisbursementStatus;
                      const ldMeta = ld ? LOAN_DISB_META[ld] : null;

                      return (
                        <tr key={rec.Id}>
                          {/* NOC No */}
                          <td>
                            <div className="bnoc-nocno">{rec.NOCNo}</div>
                            {rec.UnitNo && (
                              <div className="bnoc-sub">Unit: {rec.UnitNo}</div>
                            )}
                            {rec.ProjectName && (
                              <div className="bnoc-sub">{rec.ProjectName}</div>
                            )}
                          </td>

                          {/* Applicant */}
                          <td>
                            <div className="bnoc-applicant-cell">
                              <div
                                className="bnoc-avatar"
                                style={{ background: color }}
                              >
                                {initials(rec.ApplicantName)}
                              </div>
                              <div>
                                <div className="bnoc-applicant-name">
                                  {rec.ApplicantName}
                                </div>
                                <div className="bnoc-applicant-no">
                                  {rec.ApplicantNo}
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* Bank / Account */}
                          <td>
                            {rec.BankName ? (
                              <div>
                                <div
                                  style={{
                                    fontWeight: 600,
                                    fontSize: 13,
                                    color: "hsl(var(--foreground))",
                                  }}
                                >
                                  {rec.BankName}
                                </div>
                                {rec.LoanAccountNo && (
                                  <div className="bnoc-sub">
                                    A/C: {rec.LoanAccountNo}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span
                                style={{
                                  color: "hsl(var(--muted-foreground))",
                                }}
                              >
                                —
                              </span>
                            )}
                          </td>

                          {/* Loan Amount */}
                          <td>
                            <div
                              style={{
                                fontWeight: 600,
                                fontSize: 13,
                                color: "hsl(var(--foreground))",
                              }}
                            >
                              {fmtMoney(rec.LoanAmount)}
                            </div>
                          </td>

                          {/* Sanction */}
                          <td>
                            {lsMeta ? (
                              <div>
                                <div
                                  style={{
                                    fontSize: 12,
                                    fontWeight: 600,
                                    color: lsMeta.color,
                                  }}
                                >
                                  {lsMeta.label}
                                </div>
                                {rec.LoanSanctionDate && (
                                  <div className="bnoc-sub">
                                    {fmtDate(rec.LoanSanctionDate)}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span
                                style={{
                                  color: "hsl(var(--muted-foreground))",
                                  fontSize: 13,
                                }}
                              >
                                —
                              </span>
                            )}
                          </td>

                          {/* Disbursement */}
                          <td>
                            {ldMeta ? (
                              <div>
                                <div
                                  style={{
                                    fontSize: 12,
                                    fontWeight: 600,
                                    color: ldMeta.color,
                                  }}
                                >
                                  {ldMeta.label}
                                </div>
                                {rec.LoanDisbursementDate && (
                                  <div className="bnoc-sub">
                                    {fmtDate(rec.LoanDisbursementDate)}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span
                                style={{
                                  color: "hsl(var(--muted-foreground))",
                                  fontSize: 13,
                                }}
                              >
                                —
                              </span>
                            )}
                          </td>

                          {/* Bank NOC Status */}
                          <td>
                            {bMeta ? (
                              <div>
                                <span className={`bnoc-badge ${bMeta.cls}`}>
                                  {bMeta.icon} {bMeta.label}
                                </span>
                                {rec.BankNOCDate && (
                                  <div
                                    className="bnoc-sub"
                                    style={{ marginTop: 4 }}
                                  >
                                    {fmtDate(rec.BankNOCDate)}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span
                                style={{
                                  color: "hsl(var(--muted-foreground))",
                                  fontSize: 13,
                                }}
                              >
                                —
                              </span>
                            )}
                          </td>

                          {/* Actions */}
                          <td>
                            <div
                              className="bnoc-actions"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                className="bnoc-menu-btn"
                                onClick={() =>
                                  setOpenMenuId(
                                    openMenuId === rec.Id ? null : rec.Id,
                                  )
                                }
                              >
                                <MoreHorizontal size={16} />
                              </button>
                              {openMenuId === rec.Id && rights.canEdit && (
                                <div className="bnoc-menu">
                                  <button
                                    className="bnoc-menu-item"
                                    onClick={() => {
                                      openEdit(rec);
                                      setOpenMenuId(null);
                                    }}
                                  >
                                    <Pencil size={13} /> Edit Bank NOC
                                  </button>
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
                  <div className="bnoc-pagination">
                    <span>
                      {(pagination.page - 1) * pagination.pageSize + 1}–
                      {Math.min(
                        pagination.page * pagination.pageSize,
                        pagination.total,
                      )}{" "}
                      of {pagination.total}
                    </span>
                    <div className="bnoc-pag-btns">
                      <button
                        className="bnoc-pag-btn"
                        disabled={page <= 1}
                        onClick={() => setPage((p) => p - 1)}
                      >
                        <ChevronLeft size={14} />
                      </button>
                      {pageNums.map((n, i) =>
                        n === "…" ? (
                          <span
                            key={`e-${i}`}
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
                            className={`bnoc-pag-btn${page === n ? " active" : ""}`}
                            onClick={() => setPage(n as number)}
                          >
                            {n}
                          </button>
                        ),
                      )}
                      <button
                        className="bnoc-pag-btn"
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

      {/* Edit Dialog */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(v) => {
          if (!v) { setDialogOpen(false); setEditId(null); setForm(EMPTY_FORM); }
        }}
      >
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
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
                <Landmark
                  size={15}
                  style={{ color: "hsl(var(--primary-foreground))" }}
                />
              </div>
              Update Bank NOC Details
            </DialogTitle>
            <DialogDescription>
              Update the bank loan and NOC tracking information for this record.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            {/* Bank Name + Loan Account */}
            <div className="bnoc-form-grid">
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
            <div className="bnoc-form-grid">
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
                  className="bnoc-status-select"
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
            <div className="bnoc-form-grid">
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
                  className="bnoc-status-select"
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
            <div className="bnoc-form-grid">
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
                  className="bnoc-status-select"
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
            <div className="bnoc-form-grid">
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
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogOpen(false); setEditId(null); setForm(EMPTY_FORM); }}>
              Cancel
            </Button>
            <Button
              disabled={updateMut.isPending}
              onClick={() => updateMut.mutate()}
              className="gradient-accent gap-1.5 font-semibold text-white text-sm px-5 py-2 h-auto"
            >
              {updateMut.isPending ? "Saving…" : "Update Bank NOC"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default BankNOCPage;