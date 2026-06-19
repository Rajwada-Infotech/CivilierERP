import React, { useState, useMemo, useEffect } from "react";
import { FinanceShell } from "@/components/finance/FinanceShell";
import { useTheme } from "@/contexts/ThemeContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getList,
  addRecord,
  updateRecord,
  deleteRecord,
} from "@/api/accountHeadApi";
import { getAccountGroups } from "@/api/accountApi";
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
} from "lucide-react";
import TreeDropdown from "@/components/common/TreeDropdown";

// ─── Constants ────────────────────────────────────────────────────────────────
const SUPPLIER_TYPE = "S";

const SUPPLIER_CATEGORIES = ["Goods", "Services", "Both"] as const;
const GST_TYPES = ["Registered", "Unregistered"] as const;
const GST_STATES = [
  "Andaman and Nicobar Islands",
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chandigarh",
  "Chhattisgarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jammu and Kashmir",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Ladakh",
  "Lakshadweep",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Puducherry",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
] as const;

// ─── Types ────────────────────────────────────────────────────────────────────
interface Supplier {
  LHeadId: number;
  LHeadName: string;
  LHeadContactPerson: string | null;
  LHeadPhone: string | null;
  LHeadEmail: string | null;
  LGST: string | null;
  LHeadPan: string | null;
  supplierCategory: string | null;
  LGSTType: string | null;
  LGSTState: string | null;
  LHeadAddress: string | null;
  LBelongsTo: number | null;
  LHeadStatus: boolean;
  GroupName: string | null;
}

interface AccountGroup {
  _id: string;
  name: string;
  code: string;
  parentId: string | null;
}

interface TreeNode extends AccountGroup {
  children: TreeNode[];
}

function buildTree(items: AccountGroup[]): TreeNode[] {
  const map: Record<string, TreeNode> = {};
  items.forEach((i) => (map[i._id] = { ...i, children: [] }));
  const roots: TreeNode[] = [];
  items.forEach((i) => {
    if (i.parentId && map[i.parentId])
      map[i.parentId].children.push(map[i._id]);
    else roots.push(map[i._id]);
  });
  return roots;
}

interface SupplierForm {
  LHeadName: string;
  LHeadContactPerson: string;
  LHeadPhone: string;
  LHeadEmail: string;
  LGST: string;
  LHeadPan: string;
  supplierCategory: string;
  LGSTType: string;
  LGSTState: string;
  LHeadAddress: string;
  LHeadStatus: boolean;
  LBelongsTo: string;
}

const EMPTY_FORM: SupplierForm = {
  LHeadName: "",
  LHeadContactPerson: "",
  LHeadPhone: "",
  LHeadEmail: "",
  LGST: "",
  LHeadPan: "",
  supplierCategory: "",
  LGSTType: "",
  LGSTState: "",
  LHeadAddress: "",
  LBelongsTo: "",
  LHeadStatus: true,
};

// ─── Export Columns ────────────────────────────────────────────────────────────
const EXPORT_COLUMNS: ExportColumn[] = [
  { header: "Supplier Name", accessor: "LHeadName" },
  { header: "Contact Person", accessor: "LHeadContactPerson" },
  { header: "Phone", accessor: "LHeadPhone" },
  { header: "Email", accessor: "LHeadEmail" },
  { header: "GST Number", accessor: "LGST" },
  { header: "PAN Number", accessor: "LHeadPan" },
  { header: "GST Type", accessor: "LGSTType" },
  { header: "GST State", accessor: "LGSTState" },
  { header: "Category", accessor: "supplierCategory" },
  {
    header: "Group",
    accessor: (r) => {
      // resolved in display — raw value is AGId
      return r.LBelongsTo != null ? String(r.LBelongsTo) : "—";
    },
  },
  { header: "Address", accessor: "LHeadAddress" },
  {
    header: "Status",
    accessor: (r) => (r.LHeadStatus ? "Active" : "Inactive"),
  },
];

// ─── Column builder ────────────────────────────────────────────────────────────
function buildSupplierColumns(
  _editingId: number | null,
  deleteConfirm: number | null,
  setDeleteConfirm: (id: number | null) => void,
  startEdit: (s: Supplier) => void,
  deleteMut: { mutate: (id: number) => void },
  onView: (s: Supplier) => void,
  onPrint: (s: Supplier) => void,
): ColumnDef<Supplier, unknown>[] {
  return [
    {
      accessorKey: "LHeadName",
      header: "Supplier Name",
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
const SupplierMaster: React.FC = () => {
  const qc = useQueryClient();
  const { theme } = useTheme();
  const isDark = theme !== "light";

  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<SupplierForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<
    Partial<Record<keyof SupplierForm, boolean>>
  >({});
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [viewRecord, setViewRecord] = useState<Supplier | null>(null);

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
    queryKey: ["account-head", SUPPLIER_TYPE],
    queryFn: () => getList(SUPPLIER_TYPE),
    staleTime: 5 * 60 * 1000,
  });

  const { data: groupsData } = useQuery({
    queryKey: ["account-groups"],
    queryFn: getAccountGroups,
    staleTime: 10 * 60 * 1000,
  });

  const accountGroups: AccountGroup[] = useMemo(() => {
    if (!Array.isArray(groupsData)) return [];
    return (groupsData as any[])
      .filter((item) => item.AGId != null && item.Name)
      .map((item) => ({
        _id: String(item.AGId),
        name: item.Name as string,
        code: item.Code || "",
        parentId: item.ParentGroupId ? String(item.ParentGroupId) : null,
      }));
  }, [groupsData]);

  const accountGroupTree = useMemo(
    () => buildTree(accountGroups),
    [accountGroups],
  );

  const suppliers: Supplier[] = useMemo(() => {
    if (!Array.isArray(rawData)) return [];
    return rawData.map((item: any) => ({
      LHeadId: item.LHeadId,
      LHeadName: item.LHeadName || "",
      LHeadContactPerson: item.LHeadContactPerson || null,
      LHeadPhone: item.LHeadPhone || null,
      LHeadEmail: item.LHeadEmail || null,
      LGST: item.LGST || null,
      LHeadPan: item.LHeadPan || null,
      supplierCategory: item.LHeadCategory || null,
      LGSTType: item.LGSTType || null,
      LGSTState: item.LGSTState || null,
      LHeadAddress: item.LHeadAddress || null,
      LBelongsTo: item.LBelongsTo != null ? Number(item.LBelongsTo) : null,
      LHeadStatus: Boolean(item.LHeadStatus),
      GroupName: item.GroupName ?? null,
    }));
  }, [rawData]);

  // ── Mutations ──────────────────────────────────────────────────────────────
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["account-head", SUPPLIER_TYPE] });

  const buildPayload = (f: SupplierForm) => ({
    LHeadName: f.LHeadName,
    LHeadType: SUPPLIER_TYPE,
    LHeadContactPerson: f.LHeadContactPerson || null,
    LHeadPhone: f.LHeadPhone || null,
    LHeadEmail: f.LHeadEmail || null,
    LGST: f.LGST || null,
    LHeadPan: f.LHeadPan || null,
    LHeadCategory: f.supplierCategory || null,
    LGSTType: f.LGSTType || null,
    LHeadAddress: f.LHeadAddress || null,
    LHeadStatus: f.LHeadStatus,
    LBranchName: null,
    LGSTState: f.LGSTState || null,
    LCountry: "India",
    LBelongsTo: f.LBelongsTo ? Number(f.LBelongsTo) : null,
    LDescription: null,
  });

  const createMut = useMutation({
    mutationFn: (f: SupplierForm) => addRecord(buildPayload(f), SUPPLIER_TYPE),
    onSuccess: () => {
      toast.success("Supplier created");
      invalidate();
      resetForm();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: SupplierForm }) =>
      updateRecord(id, buildPayload(data), SUPPLIER_TYPE),
    onSuccess: () => {
      toast.success("Supplier updated");
      invalidate();
      resetForm();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteRecord(id),
    onSuccess: () => {
      toast.success("Supplier deleted");
      invalidate();
      setDeleteConfirm(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saving = createMut.isPending || updateMut.isPending;
  const canSave =
    form.LHeadName.trim() !== "" &&
    form.LHeadPan.trim() !== "" &&
    (form.LGSTType !== "Registered" || form.LGST.trim() !== "");

  // ── Helpers ────────────────────────────────────────────────────────────────
  const normalizeGSTType = (t: string | null): string => {
    if (!t) return "";
    if (t === "Unregistered") return "Unregistered";
    // Legacy values (Regular, Composition, SEZ, Deemed Export) all imply a registered GSTIN
    return "Registered";
  };

  const startEdit = (s: Supplier) => {
    setEditingId(s.LHeadId);
    setForm({
      LHeadName: s.LHeadName ?? "",
      LHeadContactPerson: s.LHeadContactPerson ?? "",
      LHeadPhone: s.LHeadPhone ?? "",
      LHeadEmail: s.LHeadEmail ?? "",
      LGST: s.LGST ?? "",
      LHeadPan: s.LHeadPan ?? "",
      supplierCategory: s.supplierCategory ?? "",
      LGSTType: normalizeGSTType(s.LGSTType),
      LGSTState: s.LGSTState ?? "",
      LHeadAddress: s.LHeadAddress ?? "",
      LBelongsTo: s.LBelongsTo != null ? String(s.LBelongsTo) : "",
      LHeadStatus: s.LHeadStatus,
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
    const e: Partial<Record<keyof SupplierForm, boolean>> = {};
    if (!form.LHeadName.trim()) e.LHeadName = true;
    if (!form.LHeadPan.trim()) e.LHeadPan = true;
    if (form.LGSTType === "Registered" && !form.LGST.trim()) e.LGST = true;
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

  const handlePrint = (s: Supplier) => {
    const win = window.open("", "_blank", "width=700,height=600");
    if (!win) return;
    win.document.write(`
      <html><head><title>Supplier — ${s.LHeadName}</title>
      <style>body{font-family:sans-serif;padding:24px;color:#111}h2{margin-bottom:16px}table{border-collapse:collapse;width:100%}td{padding:6px 12px;border:1px solid #ddd;font-size:13px}td:first-child{font-weight:600;width:40%;background:#f5f5f5}</style>
      </head><body>
      <h2>Supplier Card</h2>
      <table>
        <tr><td>Supplier Name</td><td>${s.LHeadName || "—"}</td></tr>
        <tr><td>Contact Person</td><td>${s.LHeadContactPerson || "—"}</td></tr>
        <tr><td>Phone</td><td>${s.LHeadPhone || "—"}</td></tr>
        <tr><td>Email</td><td>${s.LHeadEmail || "—"}</td></tr>
        <tr><td>GST Number</td><td>${s.LGST || "—"}</td></tr>
        <tr><td>PAN Number</td><td>${s.LHeadPan || "—"}</td></tr>
        <tr><td>GST Type</td><td>${s.LGSTType || "—"}</td></tr>
        <tr><td>GST State</td><td>${s.LGSTState || "—"}</td></tr>
        <tr><td>Category</td><td>${s.supplierCategory || "—"}</td></tr>
        <tr><td>Group</td><td>${s.LBelongsTo != null ? (accountGroups.find((g) => g._id === String(s.LBelongsTo))?.name ?? "—") : "—"}</td></tr>
        <tr><td>Address</td><td>${s.LHeadAddress || "—"}</td></tr>
        <tr><td>Status</td><td>${s.LHeadStatus ? "Active" : "Inactive"}</td></tr>
      </table>
      </body></html>
    `);
    win.document.close();
    win.print();
  };

  // ── Columns ────────────────────────────────────────────────────────────────
  const columns = useMemo(
    () =>
      buildSupplierColumns(
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
    const list = suppliers.filter((s) => {
      const matchSearch =
        !q ||
        s.LHeadName?.toLowerCase().includes(q) ||
        (s.LHeadPhone ?? "").toLowerCase().includes(q) ||
        (s.LGST ?? "").toLowerCase().includes(q) ||
        (s.LHeadContactPerson ?? "").toLowerCase().includes(q);
      const matchCat = !filterCategory || s.supplierCategory === filterCategory;
      const matchStatus =
        !filterStatus ||
        (filterStatus === "active" ? s.LHeadStatus : !s.LHeadStatus);
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
  }, [suppliers, search, filterCategory, filterStatus, sortField, sortAsc]);

  // ── Shared field class ─────────────────────────────────────────────────────
  const inputCls =
    "w-full text-sm rounded-lg border border-border px-3 py-2.5 bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition";

  const totalPages = Math.max(Math.ceil(filtered.length / limit), 1);
  const paginated = filtered.slice((page - 1) * limit, page * limit);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <Breadcrumbs items={["Masters", "Supplier Master"]} />

      <FinanceShell
        title="Supplier Master"
        subtitle="Manage supplier accounts with contact, GST and category details"
        action={
          <span
            className="text-xs font-heading px-3 py-1.5 rounded-lg"
            style={{ background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.25)", color: "#818cf8" }}
          >
            {suppliers.length} Suppliers
          </span>
        }
      >

        {/* ── Form Card ── */}
        <div
          className="rounded-xl overflow-hidden"
          style={{
            background: isDark ? "rgba(12,14,22,0.55)" : "rgba(255,255,255,0.82)",
            border: isDark ? "1px solid rgba(99,102,241,0.20)" : "1px solid rgba(99,102,241,0.16)",
            backdropFilter: "blur(18px) saturate(150%)",
            WebkitBackdropFilter: "blur(18px) saturate(150%)",
            boxShadow: isDark
              ? "0 8px 32px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.06)"
              : "0 8px 32px rgba(99,102,241,0.07), inset 0 1px 0 rgba(255,255,255,0.9)",
          }}
        >
          {/* Card header — title only */}
          <div
            className="flex items-center gap-3 px-5 sm:px-6 py-4 relative overflow-hidden"
            style={{
              background: isDark ? "rgba(99,102,241,0.09)" : "rgba(99,102,241,0.05)",
              borderBottom: isDark ? "1px solid rgba(99,102,241,0.18)" : "1px solid rgba(99,102,241,0.13)",
            }}
          >
            <div>
              <h2 className="text-sm font-heading font-semibold text-foreground">
                {editingId ? "Edit Supplier" : "Add Supplier"}
              </h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Fields marked <span className="text-destructive">*</span> are
                required
              </p>
            </div>
          </div>

          <div className="px-5 sm:px-6 py-6 space-y-7">
            {/* ── Section: Basic Info ── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2.5 pb-2 border-b border-border/60">
                <div className="flex items-center justify-center w-6 h-6 rounded-md bg-primary/10 shrink-0">
                  <Building2 size={12} className="text-primary" />
                </div>
                <p className="text-[11px] font-heading uppercase tracking-wider text-muted-foreground flex-1">
                  Basic Information
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-5">
                {/* Supplier Name */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                    Supplier Name <span className="text-destructive">*</span>
                  </label>
                  <input
                    value={form.LHeadName}
                    onChange={(e) => {
                      setForm((p) => ({ ...p, LHeadName: e.target.value }));
                      setErrors((p) => ({ ...p, LHeadName: false }));
                    }}
                    placeholder="e.g. Acme Supplies Ltd."
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
                      placeholder="e.g. Rahul Sharma"
                      className="w-full text-sm rounded-lg border border-border pl-8 pr-3 py-2.5 bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
                    />
                  </div>
                </div>

                {/* Supplier Category */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider block">
                    Supplier Category
                  </label>
                  <TreeDropdown
                    variant="flat"
                    value={form.supplierCategory}
                    onChange={(v) =>
                      setForm((p) => ({ ...p, supplierCategory: v }))
                    }
                    options={SUPPLIER_CATEGORIES.map((c) => ({
                      value: c,
                      label: c,
                    }))}
                    placeholder="Select category…"
                  />
                </div>

                {/* Account Group */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider block">
                    Account Group
                  </label>
                  <TreeDropdown
                    variant="tree"
                    value={form.LBelongsTo}
                    onChange={(v) => setForm((p) => ({ ...p, LBelongsTo: v }))}
                    items={accountGroupTree}
                    allGroups={accountGroups}
                  />
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
                      placeholder="e.g. contact@acme.com"
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

            {/* ── Section: GST & Tax ── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2.5 pb-2 border-b border-border/60">
                <div className="flex items-center justify-center w-6 h-6 rounded-md bg-primary/10 shrink-0">
                  <FileText size={12} className="text-primary" />
                </div>
                <p className="text-[11px] font-heading uppercase tracking-wider text-muted-foreground flex-1">
                  GST &amp; Tax Details
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-x-6 gap-y-5">
                {/* PAN */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                    PAN Number <span className="text-destructive">*</span>
                  </label>
                  <input
                    value={form.LHeadPan}
                    onChange={(e) => {
                      setForm((p) => ({
                        ...p,
                        LHeadPan: e.target.value.toUpperCase(),
                      }));
                      setErrors((p) => ({ ...p, LHeadPan: false }));
                    }}
                    placeholder="e.g. AAPFU0939F"
                    maxLength={10}
                    className={`${inputCls} font-mono ${errors.LHeadPan ? "border-red-400" : ""}`}
                  />
                  {errors.LHeadPan && (
                    <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                      <AlertCircle size={11} /> Required
                    </p>
                  )}
                </div>

                {/* GST Type */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider block">
                    GST Type
                  </label>
                  <TreeDropdown
                    variant="flat"
                    value={form.LGSTType}
                    onChange={(v) => {
                      setForm((p) => ({
                        ...p,
                        LGSTType: v,
                        LGST: v === "Registered" ? p.LGST : "",
                      }));
                      setErrors((p) => ({ ...p, LGST: false }));
                    }}
                    options={GST_TYPES.map((t) => ({ value: t, label: t }))}
                    placeholder="Select type…"
                  />
                </div>

                {/* GST Number — only when Registered */}
                {form.LGSTType === "Registered" && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                      GST Number <span className="text-destructive">*</span>
                    </label>
                    <input
                      value={form.LGST}
                      onChange={(e) => {
                        setForm((p) => ({
                          ...p,
                          LGST: e.target.value.toUpperCase(),
                        }));
                        setErrors((p) => ({ ...p, LGST: false }));
                      }}
                      placeholder="e.g. 27AAPFU0939F1ZV"
                      maxLength={15}
                      className={`${inputCls} font-mono ${errors.LGST ? "border-red-400" : ""}`}
                    />
                    {errors.LGST && (
                      <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                        <AlertCircle size={11} /> Required
                      </p>
                    )}
                  </div>
                )}

                {/* GST State */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider block">
                    GST State
                  </label>
                  <TreeDropdown
                    variant="flat"
                    value={form.LGSTState}
                    onChange={(v) => setForm((p) => ({ ...p, LGSTState: v }))}
                    options={GST_STATES.map((s) => ({ value: s, label: s }))}
                    placeholder="Select state…"
                  />
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
              {canSave ? (
                <span className="text-emerald-500 font-medium">
                  Ready to save
                </span>
              ) : (
                "Fill in the required fields to save"
              )}
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
                {saving
                  ? "Saving…"
                  : editingId
                    ? "Update Supplier"
                    : "Save Supplier"}
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

            <TreeDropdown
              variant="flat"
              value={filterCategory}
              onChange={(v) => setFilterCategory(v)}
              options={SUPPLIER_CATEGORIES.map((c) => ({ value: c, label: c }))}
              placeholder="All Categories"
            />

            <TreeDropdown
              variant="flat"
              value={filterStatus}
              onChange={(v) => setFilterStatus(v)}
              options={[
                { value: "active", label: "Active" },
                { value: "inactive", label: "Inactive" },
              ]}
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
              searchPlaceholder="Search suppliers..."
              getRowId={(row) => String(row.LHeadId)}
              emptyMessage={
                isError
                  ? "Failed to load suppliers."
                  : suppliers.length === 0
                    ? "No suppliers yet."
                    : "No results match your search."
              }
              exportConfig={{
                title: "Supplier Master",
                filename: "supplier-master",
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
      </FinanceShell>

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
                  Supplier Details
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
                { label: "Supplier Name", value: viewRecord.LHeadName },
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
                { label: "GST Type", value: viewRecord.LGSTType || "—" },
                { label: "GST State", value: viewRecord.LGSTState || "—" },
                {
                  label: "Supplier Category",
                  value: viewRecord.supplierCategory || "—",
                },
                {
                  label: "Group Name",
                  value:
                    viewRecord.LBelongsTo != null
                      ? (accountGroups.find(
                          (g) => g._id === String(viewRecord.LBelongsTo),
                        )?.name ?? "—")
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
                <Pencil size={13} /> Edit Supplier
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default SupplierMaster;
