import React, { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getList,
  addRecord,
  updateRecord,
  deleteRecord,
  getAccountGroups,
  type AccountGroup,
} from "@/api/accountHeadApi";
import { getContractorCategoryOptions } from "@/api/contractorCategoryApi";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  DataTable,
  type ColumnDef,
  type ExportColumn,
} from "@/components/ui/DataTable";
import {
  Pencil,
  Trash2,
  X,
  Check,
  Plus,
  Search,
  ChevronDown,
  AlertCircle,
  Eye,
  XCircle,
  User,
  Building2,
  Phone,
  Mail,
  MapPin,
  FileText,
  Printer,
  HardHat,
  CreditCard,
  Layers,
} from "lucide-react";

// ─── Constants ────────────────────────────────────────────────────────────────
const CONTRACTOR_TYPE = "C";

const DEFAULT_CONTRACTOR_CATEGORIES = [
  "Civil",
  "Electrical",
  "Mechanical",
  "Plumbing",
  "General",
] as const;

// ─── Types ────────────────────────────────────────────────────────────────────
interface Contractor {
  LHeadId: number;
  LHeadName: string;
  LHeadContactPerson: string | null;
  LHeadPhone: string | null;
  LHeadEmail: string | null;
  LGST: string | null;
  LHeadPan: string | null;
  contractorType: string | null;
  LHeadPaymentTerms: string | null;
  LHeadAddress: string | null;
  LBelongsTo: number | null;
  LHeadStatus: boolean;
}

interface ContractorForm {
  LHeadName: string;
  LHeadContactPerson: string;
  LHeadPhone: string;
  LHeadEmail: string;
  LGST: string;
  LHeadPan: string;
  contractorType: string;
  LHeadPaymentTerms: string;
  LHeadAddress: string;
  LBelongsTo: number | "";
  LHeadStatus: boolean;
}

const EMPTY_FORM: ContractorForm = {
  LHeadName: "",
  LHeadContactPerson: "",
  LHeadPhone: "",
  LHeadEmail: "",
  LGST: "",
  LHeadPan: "",
  contractorType: "",
  LHeadPaymentTerms: "",
  LHeadAddress: "",
  LBelongsTo: "",
  LHeadStatus: true,
};

// ─── FlatDropdown ─────────────────────────────────────────────────────────────
function FlatDropdown({
  value,
  onChange,
  options,
  placeholder = "Select\u2026",
  icon,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  icon?: React.ReactNode;
  error?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selected = options.find((o) => o.value === value);

  return (
    <div className="relative" ref={dropRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm rounded-lg border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition text-left ${error ? "border-red-400" : "border-border"}`}
      >
        {icon && <span className="shrink-0 text-muted-foreground">{icon}</span>}
        <span className={`flex-1 truncate ${selected ? "text-foreground font-medium" : "text-muted-foreground/70"}`}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown size={14} className={`text-muted-foreground shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-card shadow-lg overflow-hidden">
          <div className="max-h-56 overflow-y-auto py-1">
            <div
              className={`px-3 py-2 text-sm cursor-pointer transition-colors ${!value ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted/60"}`}
              onClick={() => { onChange(""); setOpen(false); }}
            >
              {placeholder}
            </div>
            <div className="border-t border-border/40 mb-1" />
            {options.map((o) => (
              <div
                key={o.value}
                className={`px-3 py-2 text-sm cursor-pointer transition-colors ${value === o.value ? "bg-primary/10 text-primary font-medium" : "text-foreground hover:bg-muted/60"}`}
                onClick={() => { onChange(o.value); setOpen(false); }}
              >
                {o.label}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Export Columns ────────────────────────────────────────────────────────────
const EXPORT_COLUMNS: ExportColumn[] = [
  { header: "Contractor Name", accessor: "LHeadName" },
  { header: "Contact Person", accessor: "LHeadContactPerson" },
  { header: "Phone", accessor: "LHeadPhone" },
  { header: "Email", accessor: "LHeadEmail" },
  { header: "GST Number", accessor: "LGST" },
  { header: "PAN Number", accessor: "LHeadPan" },
  { header: "Contractor Type", accessor: "contractorType" },
  { header: "Payment Terms", accessor: "LHeadPaymentTerms" },
  {
    header: "Group",
    accessor: (r) => (r.LBelongsTo != null ? String(r.LBelongsTo) : "—"),
  },
  { header: "Address", accessor: "LHeadAddress" },
  {
    header: "Status",
    accessor: (r) => (r.LHeadStatus ? "Active" : "Inactive"),
  },
];

// ─── Column builder ────────────────────────────────────────────────────────────
function buildContractorColumns(
  _editingId: number | null,
  deleteConfirm: number | null,
  setDeleteConfirm: (id: number | null) => void,
  startEdit: (c: Contractor) => void,
  deleteMut: { mutate: (id: number) => void },
  onView: (c: Contractor) => void,
  onPrint: (c: Contractor) => void,
): ColumnDef<Contractor, unknown>[] {
  return [
    {
      accessorKey: "LHeadName",
      header: "Contractor Name",
      cell: ({ getValue }) => (
        <span className="font-medium text-foreground">
          {getValue() as string}
        </span>
      ),
    },
    {
      accessorKey: "LHeadContactPerson",
      header: "Contact Person",
      cell: ({ getValue }) => (
        <span className="text-sm text-muted-foreground">
          {(getValue() as string) || "—"}
        </span>
      ),
    },
    {
      accessorKey: "LHeadPhone",
      header: "Phone",
      cell: ({ getValue }) => (
        <span className="font-mono text-xs text-foreground">
          {(getValue() as string) || "—"}
        </span>
      ),
    },
    {
      accessorKey: "LGST",
      header: "GST No.",
      cell: ({ getValue }) => (
        <span className="font-mono text-xs font-semibold text-primary">
          {(getValue() as string) || "—"}
        </span>
      ),
    },
    {
      accessorKey: "LHeadPaymentTerms",
      header: "Payment Terms",
      cell: ({ getValue }) => (
        <span className="text-sm text-muted-foreground">
          {(getValue() as string) || "—"}
        </span>
      ),
    },
    {
      accessorKey: "LHeadStatus",
      header: "Status",
      cell: ({ getValue }) => {
        const active = getValue() as boolean;
        return (
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-medium ${active ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground"}`}
          >
            {active ? "Active" : "Inactive"}
          </span>
        );
      },
    },
    {
      id: "actions",
      header: "Actions",
      enableSorting: false,
      meta: { align: "right", className: "text-right" },
      cell: ({ row }) => {
        const id = row.original.LHeadId;
        if (deleteConfirm === id) {
          return (
            <div className="flex items-center gap-1 justify-start">
              <span className="text-[11px] text-muted-foreground mr-1">
                Delete?
              </span>
              <button
                onClick={() => deleteMut.mutate(id)}
                className="p-1 rounded text-destructive hover:bg-destructive/10"
              >
                <Check size={12} />
              </button>
              <button
                onClick={() => setDeleteConfirm(null)}
                className="p-1 rounded text-muted-foreground hover:bg-muted"
              >
                <X size={12} />
              </button>
            </div>
          );
        }
        return (
          <div className="flex items-center justify-start gap-2 w-full min-w-[120px]">
            <button
              onClick={() => onView(row.original)}
              className="p-1 rounded text-sky-500 hover:bg-sky-500/10 transition-colors"
              title="View details"
            >
              <Eye size={15} />
            </button>
            <button
              onClick={() => onPrint(row.original)}
              className="p-1 rounded text-amber-500 hover:bg-amber-500/10 transition-colors"
              title="Print"
            >
              <Printer size={15} />
            </button>
            <button
              onClick={() => startEdit(row.original)}
              className="p-1 rounded text-blue-400 hover:bg-blue-400/10 transition-colors"
              title="Edit"
            >
              <Pencil size={15} />
            </button>
            <button
              onClick={() => setDeleteConfirm(id)}
              className="p-1 rounded text-destructive hover:bg-destructive/10 transition-colors"
              title="Delete"
            >
              <Trash2 size={15} />
            </button>
          </div>
        );
      },
    },
  ];
}

// ─── Component ────────────────────────────────────────────────────────────────
const ContractorMaster: React.FC = () => {
  const qc = useQueryClient();

  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ContractorForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<
    Partial<Record<keyof ContractorForm, boolean>>
  >({});
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [viewRecord, setViewRecord] = useState<Contractor | null>(null);

  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [page, setPage] = useState(1);
  const limit = 10;
  const [sortField, setSortField] = useState<
    "LHeadName" | "LHeadContactPerson" | "LHeadPhone"
  >("LHeadName");
  const [sortAsc, setSortAsc] = useState(true);

  useEffect(() => {
    setPage(1);
  }, [search, filterCategory, filterStatus]);

  // ── Remote data ────────────────────────────────────────────────────────────
  const {
    data: rawData,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["account-head", CONTRACTOR_TYPE],
    queryFn: () => getList(CONTRACTOR_TYPE),
    staleTime: 5 * 60 * 1000,
  });

  const { data: categoryOptions } = useQuery({
    queryKey: ["contractor-category-options"],
    queryFn: async () => {
      const options = await getContractorCategoryOptions();
      return options.map((o: { name: string }) => o.name);
    },
    staleTime: 5 * 60 * 1000,
  });

  const contractorCategories: string[] = useMemo(
    () =>
      categoryOptions && categoryOptions.length > 0
        ? categoryOptions
        : [...DEFAULT_CONTRACTOR_CATEGORIES],
    [categoryOptions],
  );

  const contractors: Contractor[] = useMemo(() => {
    if (!Array.isArray(rawData)) return [];
    return rawData.map((item: any) => ({
      LHeadId: item.LHeadId,
      LHeadName: item.LHeadName || "",
      LHeadContactPerson: item.LHeadContactPerson || null,
      LHeadPhone: item.LHeadPhone || null,
      LHeadEmail: item.LHeadEmail || null,
      LGST: item.LGST || null,
      LHeadPan: item.LHeadPan || null,
      contractorType: item.LHeadCategory || null,
      LHeadPaymentTerms: item.LHeadPaymentTerms || null,
      LHeadAddress: item.LHeadAddress || null,
      LBelongsTo: item.LBelongsTo != null ? Number(item.LBelongsTo) : null,
      LHeadStatus: Boolean(item.LHeadStatus),
    }));
  }, [rawData]);

  // ── Account Groups ─────────────────────────────────────────────────────────
  const { data: accountGroups = [] } = useQuery<AccountGroup[]>({
    queryKey: ["account-groups"],
    queryFn: getAccountGroups,
    staleTime: 10 * 60 * 1000,
  });

  // AGId → Name lookup for display
  const groupNameById = useMemo(
    () => new Map<number, string>(accountGroups.map((g) => [g.AGId, g.Name])),
    [accountGroups],
  );

  // Build { label: parentName, options: children[] } for <optgroup> dropdown
  const groupedAccountGroups = useMemo(() => {
    const byId = new Map<number, AccountGroup>(
      accountGroups.map((g) => [g.AGId, g]),
    );
    const childrenOf = new Map<number, AccountGroup[]>();
    const roots: AccountGroup[] = [];
    for (const g of accountGroups) {
      if (g.ParentGroupId === null) {
        roots.push(g);
      } else {
        const list = childrenOf.get(g.ParentGroupId) ?? [];
        list.push(g);
        childrenOf.set(g.ParentGroupId, list);
      }
    }
    const result: { label: string; options: AccountGroup[] }[] = [];
    for (const root of roots) {
      const kids = childrenOf.get(root.AGId);
      if (kids && kids.length > 0) {
        result.push({ label: root.Name, options: kids });
      }
    }
    const uncategorised = [
      ...roots.filter((r) => !childrenOf.has(r.AGId)),
      ...accountGroups.filter(
        (g) => g.ParentGroupId !== null && !byId.has(g.ParentGroupId),
      ),
    ];
    if (uncategorised.length > 0) {
      result.push({ label: "Other", options: uncategorised });
    }
    return result;
  }, [accountGroups]);

  // ── Mutations ──────────────────────────────────────────────────────────────
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["account-head", CONTRACTOR_TYPE] });

  const buildPayload = (f: ContractorForm) => ({
    LHeadName: f.LHeadName,
    LHeadType: CONTRACTOR_TYPE,
    LHeadContactPerson: f.LHeadContactPerson || null,
    LHeadPhone: f.LHeadPhone || null,
    LHeadEmail: f.LHeadEmail || null,
    LGST: f.LGST || null,
    LHeadPan: f.LHeadPan || null,
    LHeadCategory: f.contractorType || null,
    LHeadPaymentTerms: f.LHeadPaymentTerms || null,
    LHeadAddress: f.LHeadAddress || null,
    LHeadStatus: f.LHeadStatus,
    LBranchName: null,
    LGSTState: null,
    LCountry: "India",
    LBelongsTo: f.LBelongsTo !== "" ? Number(f.LBelongsTo) : null,
    LDescription: null,
  });

  const createMut = useMutation({
    mutationFn: (f: ContractorForm) =>
      addRecord(buildPayload(f), CONTRACTOR_TYPE),
    onSuccess: () => {
      toast.success("Contractor created");
      invalidate();
      resetForm();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: ContractorForm }) =>
      updateRecord(id, buildPayload(data), CONTRACTOR_TYPE),
    onSuccess: () => {
      toast.success("Contractor updated");
      invalidate();
      resetForm();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteRecord(id),
    onSuccess: () => {
      toast.success("Contractor deleted");
      invalidate();
      setDeleteConfirm(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saving = createMut.isPending || updateMut.isPending;
  const canSave = form.LHeadName.trim() !== "";

  // ── Helpers ────────────────────────────────────────────────────────────────
  const startEdit = (c: Contractor) => {
    setEditingId(c.LHeadId);
    setForm({
      LHeadName: c.LHeadName ?? "",
      LHeadContactPerson: c.LHeadContactPerson ?? "",
      LHeadPhone: c.LHeadPhone ?? "",
      LHeadEmail: c.LHeadEmail ?? "",
      LGST: c.LGST ?? "",
      LHeadPan: c.LHeadPan ?? "",
      contractorType: c.contractorType ?? "",
      LHeadPaymentTerms: c.LHeadPaymentTerms ?? "",
      LHeadAddress: c.LHeadAddress ?? "",
      LBelongsTo: c.LBelongsTo ?? "",
      LHeadStatus: c.LHeadStatus,
    });
    setErrors({});
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const resetForm = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setErrors({});
  };

  const handleSave = () => {
    const e: Partial<Record<keyof ContractorForm, boolean>> = {};
    if (!form.LHeadName.trim()) e.LHeadName = true;
    if (Object.keys(e).length) {
      setErrors(e);
      return;
    }
    if (editingId !== null) {
      updateMut.mutate({ id: editingId, data: form });
    } else {
      createMut.mutate(form);
    }
  };

  const handlePrint = (c: Contractor) => {
    const win = window.open("", "_blank", "width=700,height=600");
    if (!win) return;
    win.document.write(`
      <html><head><title>Contractor — ${c.LHeadName}</title>
      <style>body{font-family:sans-serif;padding:24px;color:#111}h2{margin-bottom:16px}table{border-collapse:collapse;width:100%}td{padding:6px 12px;border:1px solid #ddd;font-size:13px}td:first-child{font-weight:600;width:40%;background:#f5f5f5}</style>
      </head><body>
      <h2>Contractor Card</h2>
      <table>
        <tr><td>Contractor Name</td><td>${c.LHeadName || "—"}</td></tr>
        <tr><td>Contact Person</td><td>${c.LHeadContactPerson || "—"}</td></tr>
        <tr><td>Phone</td><td>${c.LHeadPhone || "—"}</td></tr>
        <tr><td>Email</td><td>${c.LHeadEmail || "—"}</td></tr>
        <tr><td>GST Number</td><td>${c.LGST || "—"}</td></tr>
        <tr><td>PAN Number</td><td>${c.LHeadPan || "—"}</td></tr>
        <tr><td>Contractor Type</td><td>${c.contractorType || "—"}</td></tr>
        <tr><td>Payment Terms</td><td>${c.LHeadPaymentTerms || "—"}</td></tr>
        <tr><td>Group</td><td>${c.LBelongsTo != null ? (groupNameById.get(c.LBelongsTo) ?? "—") : "—"}</td></tr>
        <tr><td>Address</td><td>${c.LHeadAddress || "—"}</td></tr>
        <tr><td>Status</td><td>${c.LHeadStatus ? "Active" : "Inactive"}</td></tr>
      </table>
      </body></html>
    `);
    win.document.close();
    win.print();
  };

  // ── Columns ────────────────────────────────────────────────────────────────
  const columns = useMemo(
    () =>
      buildContractorColumns(
        editingId,
        deleteConfirm,
        setDeleteConfirm,
        startEdit,
        deleteMut,
        setViewRecord,
        handlePrint,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editingId, deleteConfirm],
  );

  // ── Filtered + sorted list ─────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = contractors.filter((c) => {
      const matchSearch =
        !q ||
        c.LHeadName?.toLowerCase().includes(q) ||
        (c.LHeadPhone ?? "").toLowerCase().includes(q) ||
        (c.LGST ?? "").toLowerCase().includes(q) ||
        (c.LHeadContactPerson ?? "").toLowerCase().includes(q);
      const matchCat = !filterCategory || c.contractorType === filterCategory;
      const matchStatus =
        !filterStatus ||
        (filterStatus === "active" ? c.LHeadStatus : !c.LHeadStatus);
      return matchSearch && matchCat && matchStatus;
    });

    return [...list].sort((a, b) => {
      const av =
        (sortField === "LHeadName"
          ? a.LHeadName
          : sortField === "LHeadContactPerson"
            ? a.LHeadContactPerson
            : a.LHeadPhone) ?? "";
      const bv =
        (sortField === "LHeadName"
          ? b.LHeadName
          : sortField === "LHeadContactPerson"
            ? b.LHeadContactPerson
            : b.LHeadPhone) ?? "";
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }, [contractors, search, filterCategory, filterStatus, sortField, sortAsc]);

  // ── Shared field classes ───────────────────────────────────────────────────
  const inputCls =
    "w-full text-sm rounded-lg border border-border px-3 py-2.5 bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition";
  const selectCls =
    "w-full appearance-none pl-3 pr-9 py-2.5 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition";

  const totalPages = Math.max(Math.ceil(filtered.length / limit), 1);
  const paginated = filtered.slice((page - 1) * limit, page * limit);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <Breadcrumbs
        items={["Dashboard", "Finance Module", "Contractor Master"]}
      />

      <div className="relative space-y-8 mt-6">
        {/* ── Page header ── */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-heading font-bold text-foreground">
              Contractor Master
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Manage contractor accounts with contact, GST and type details
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-muted-foreground bg-muted/60 rounded-lg px-3 py-1.5">
              {contractors.length} Contractors
            </span>
          </div>
        </div>

        {/* ── Form Card ── */}
        <div className="rounded-xl border border-border bg-card shadow-sm">
          {/* Card header — title only */}
          <div className="flex items-center gap-3 px-5 sm:px-6 py-4 border-b border-border bg-muted/20">
            <div>
              <h2 className="text-sm font-heading font-semibold text-foreground">
                {editingId ? "Edit Contractor" : "Add Contractor"}
              </h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Fields marked <span className="text-destructive">*</span> are required
              </p>
            </div>
          </div>

          <div className="px-5 sm:px-6 py-6 space-y-7">
            {/* ── Section: Basic Info ── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2.5 pb-2 border-b border-border/60">
                <div className="flex items-center justify-center w-6 h-6 rounded-md bg-primary/10 shrink-0">
                  <HardHat size={12} className="text-primary" />
                </div>
                <p className="text-[11px] font-heading uppercase tracking-wider text-muted-foreground flex-1">
                  Basic Information
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-5">
                {/* Contractor Name */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                    Contractor Name <span className="text-destructive">*</span>
                  </label>
                  <input
                    value={form.LHeadName}
                    onChange={(e) => {
                      setForm((p) => ({ ...p, LHeadName: e.target.value }));
                      setErrors((p) => ({ ...p, LHeadName: false }));
                    }}
                    placeholder="e.g. Buildmax Contractors Pvt. Ltd."
                    className={`${inputCls} ${errors.LHeadName ? "border-red-400" : ""}`}
                  />
                  {errors.LHeadName && (
                    <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                      <AlertCircle size={11} /> Required
                    </p>
                  )}
                </div>

                {/* Contact Person */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider block">
                    Contact Person
                  </label>
                  <div className="relative">
                    <User
                      size={13}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                    <input
                      value={form.LHeadContactPerson}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          LHeadContactPerson: e.target.value,
                        }))
                      }
                      placeholder="e.g. Rajesh Kumar"
                      className="w-full text-sm rounded-lg border border-border pl-8 pr-3 py-2.5 bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
                    />
                  </div>
                </div>

                {/* Contractor Type */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider block">
                    Contractor Type
                  </label>
                  <FlatDropdown
                    value={form.contractorType}
                    onChange={(v) => setForm((p) => ({ ...p, contractorType: v }))}
                    options={contractorCategories.map((c) => ({ value: c, label: c }))}
                    placeholder="Select type\u2026"
                  />
                </div>

                {/* Account Group */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Layers size={11} className="text-primary" />
                    Group Name
                  </label>
                  <div className="relative">
                    <select
                      value={form.LBelongsTo}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          LBelongsTo:
                            e.target.value === "" ? "" : Number(e.target.value),
                        }))
                      }
                      className={selectCls}
                    >
                      <option value="">— No Group —</option>
                      {groupedAccountGroups.map(({ label, options }) => (
                        <optgroup key={label} label={`── ${label}`}>
                          {options.map((g) => (
                            <option key={g.AGId} value={g.AGId}>
                              {g.Name}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    <ChevronDown
                      size={13}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* ── Section: Contact Details ── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2.5 pb-2 border-b border-border/60">
                <div className="flex items-center justify-center w-6 h-6 rounded-md bg-primary/10 shrink-0">
                  <Phone size={12} className="text-primary" />
                </div>
                <p className="text-[11px] font-heading uppercase tracking-wider text-muted-foreground flex-1">
                  Contact Details
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-5">
                {/* Phone */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider block">
                    Phone Number
                  </label>
                  <div className="relative">
                    <Phone
                      size={13}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                    <input
                      value={form.LHeadPhone}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          LHeadPhone: e.target.value,
                        }))
                      }
                      placeholder="e.g. +91 98765 43210"
                      className="w-full text-sm rounded-lg border border-border pl-8 pr-3 py-2.5 bg-background text-foreground font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
                    />
                  </div>
                </div>

                {/* Email */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider block">
                    Email Address
                  </label>
                  <div className="relative">
                    <Mail
                      size={13}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                    <input
                      value={form.LHeadEmail}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          LHeadEmail: e.target.value,
                        }))
                      }
                      placeholder="e.g. contact@buildmax.com"
                      className="w-full text-sm rounded-lg border border-border pl-8 pr-3 py-2.5 bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
                    />
                  </div>
                </div>

                {/* Address */}
                <div className="space-y-1.5 sm:col-span-3">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider block">
                    Address
                  </label>
                  <div className="relative">
                    <MapPin
                      size={13}
                      className="absolute left-3 top-3 text-muted-foreground pointer-events-none"
                    />
                    <textarea
                      value={form.LHeadAddress}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          LHeadAddress: e.target.value,
                        }))
                      }
                      placeholder="Full address…"
                      rows={2}
                      className="w-full text-sm rounded-lg border border-border pl-8 pr-3 py-2.5 bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition resize-none"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* ── Section: Tax & Payment ── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2.5 pb-2 border-b border-border/60">
                <div className="flex items-center justify-center w-6 h-6 rounded-md bg-primary/10 shrink-0">
                  <FileText size={12} className="text-primary" />
                </div>
                <p className="text-[11px] font-heading uppercase tracking-wider text-muted-foreground flex-1">
                  Tax &amp; Payment Details
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-5">
                {/* GST Number */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider block">
                    GST Number
                  </label>
                  <input
                    value={form.LGST}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        LGST: e.target.value.toUpperCase(),
                      }))
                    }
                    placeholder="e.g. 27AAPFU0939F1ZV"
                    maxLength={15}
                    className={`${inputCls} font-mono`}
                  />
                </div>

                {/* PAN */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider block">
                    PAN Number
                  </label>
                  <input
                    value={form.LHeadPan}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        LHeadPan: e.target.value.toUpperCase(),
                      }))
                    }
                    placeholder="e.g. AAPFU0939F"
                    maxLength={10}
                    className={`${inputCls} font-mono`}
                  />
                </div>

                {/* Payment Terms */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider block">
                    Payment Terms
                  </label>
                  <div className="relative">
                    <CreditCard
                      size={13}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                    <input
                      value={form.LHeadPaymentTerms}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          LHeadPaymentTerms: e.target.value,
                        }))
                      }
                      placeholder="e.g. Net 30"
                      className="w-full text-sm rounded-lg border border-border pl-8 pr-3 py-2.5 bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* ── Status toggle ── */}
            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={() =>
                  setForm((p) => ({ ...p, LHeadStatus: !p.LHeadStatus }))
                }
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 ${form.LHeadStatus ? "bg-emerald-500" : "bg-muted-foreground/30"}`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${form.LHeadStatus ? "translate-x-4" : "translate-x-0.5"}`}
                />
              </button>
              <span className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider">
                Status —{" "}
                <span
                  className={
                    form.LHeadStatus ? "text-emerald-600" : "text-foreground"
                  }
                >
                  {form.LHeadStatus ? "Active" : "Inactive"}
                </span>
              </span>
            </div>
          </div>

          {/* Card footer — actions */}
          <div className="flex items-center justify-between gap-3 px-5 sm:px-6 py-4 border-t border-border bg-muted/20">
            <p className="text-[11px] text-muted-foreground">
              {canSave
                ? <span className="text-emerald-500 font-medium">Ready to save</span>
                : "Fill in the required fields to save"}
            </p>
            <div className="flex items-center gap-2">
              {editingId && (
                <button
                  onClick={resetForm}
                  className="px-4 py-2 rounded-lg text-sm font-heading border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
              )}
              <button
                onClick={handleSave}
                disabled={saving || !canSave}
                className="px-5 py-2 rounded-lg text-sm font-heading font-semibold gradient-accent text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 transition-opacity"
              >
                {saving ? (
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : editingId ? (
                  <Check size={14} />
                ) : (
                  <Plus size={14} />
                )}
                {saving ? "Saving…" : editingId ? "Update Contractor" : "Save Contractor"}
              </button>
            </div>
          </div>
        </div>

        {/* ── Table Section ── */}
        <div>
          {/* Toolbar */}
          <div className="mb-3 flex items-center gap-3 flex-wrap">
            <div className="relative">
              <Search
                size={13}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, phone, GST…"
                className="w-56 text-sm rounded-lg border border-border pl-9 pr-3 py-2 bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
              />
            </div>

            <FlatDropdown
              value={filterCategory}
              onChange={(v) => setFilterCategory(v)}
              options={contractorCategories.map((c) => ({ value: c, label: c }))}
              placeholder="All Types"
            />

            <FlatDropdown
              value={filterStatus}
              onChange={(v) => setFilterStatus(v)}
              options={[{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]}
              placeholder="All Status"
            />

            {(search || filterCategory || filterStatus) && (
              <button
                onClick={() => {
                  setSearch("");
                  setFilterCategory("");
                  setFilterStatus("");
                }}
                className="text-xs font-heading text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 hover:bg-muted transition-colors flex items-center gap-1.5"
              >
                <X size={11} /> Clear
              </button>
            )}
          </div>

          {/* Table */}
          <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden [&_th:last-child]:text-left [&_td:last-child]:text-left">
            <DataTable
              data={paginated}
              columns={columns}
              loading={isLoading}
              searchPlaceholder="Search contractors..."
              getRowId={(row) => String(row.LHeadId)}
              emptyMessage={
                isError
                  ? "Failed to load contractors."
                  : contractors.length === 0
                    ? "No contractors yet."
                    : "No results match your search."
              }
              exportConfig={{
                title: "Contractor Master",
                filename: "contractor-master",
                columns: EXPORT_COLUMNS,
              }}
              rowClassName={(row) =>
                row.original.LHeadId === editingId ? "bg-primary/5" : ""
              }
            />
          </div>
          <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm">
            <span className="text-xs text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(p - 1, 1))}
                disabled={page <= 1}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-heading text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
                disabled={page >= totalPages}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-heading text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── View Detail Drawer ── */}
      {viewRecord && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={() => setViewRecord(null)}
          />
          <div className="relative w-full max-w-sm bg-card border-l border-border shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <Building2 size={15} className="text-primary" />
                <h3 className="font-heading font-semibold text-sm text-foreground">
                  Contractor Details
                </h3>
              </div>
              <button
                onClick={() => setViewRecord(null)}
                className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted"
              >
                <XCircle size={15} />
              </button>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              {[
                { label: "Contractor Name", value: viewRecord.LHeadName },
                {
                  label: "Contact Person",
                  value: viewRecord.LHeadContactPerson || "—",
                },
                {
                  label: "Phone",
                  value: viewRecord.LHeadPhone || "—",
                  mono: true,
                },
                { label: "Email", value: viewRecord.LHeadEmail || "—" },
                {
                  label: "GST Number",
                  value: viewRecord.LGST || "—",
                  mono: true,
                },
                {
                  label: "PAN Number",
                  value: viewRecord.LHeadPan || "—",
                  mono: true,
                },
                {
                  label: "Contractor Type",
                  value: viewRecord.contractorType || "—",
                },
                {
                  label: "Payment Terms",
                  value: viewRecord.LHeadPaymentTerms || "—",
                },
                {
                  label: "Group Name",
                  value:
                    viewRecord.LBelongsTo != null
                      ? (groupNameById.get(viewRecord.LBelongsTo) ?? "—")
                      : "—",
                },
                { label: "Address", value: viewRecord.LHeadAddress || "—" },
              ].map(({ label, value, mono }) => (
                <div key={label}>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading mb-1">
                    {label}
                  </p>
                  <p
                    className={`text-sm text-foreground ${mono ? "font-mono font-semibold text-primary" : ""}`}
                  >
                    {value}
                  </p>
                </div>
              ))}
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading mb-1">
                  Status
                </p>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${viewRecord.LHeadStatus ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground"}`}
                >
                  {viewRecord.LHeadStatus ? "Active" : "Inactive"}
                </span>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-border flex justify-end gap-2 bg-muted/20">
              <button
                onClick={() => handlePrint(viewRecord)}
                className="px-3 py-2 rounded-lg text-sm font-heading border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center gap-1.5"
              >
                <Printer size={13} /> Print
              </button>
              <button
                onClick={() => setViewRecord(null)}
                className="px-4 py-2 rounded-lg text-sm font-heading border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                Close
              </button>
              <button
                onClick={() => {
                  startEdit(viewRecord);
                  setViewRecord(null);
                }}
                className="px-4 py-2 rounded-lg text-sm font-heading font-semibold gradient-accent text-white shadow-sm flex items-center gap-1.5"
              >
                <Pencil size={13} /> Edit Contractor
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ContractorMaster;
