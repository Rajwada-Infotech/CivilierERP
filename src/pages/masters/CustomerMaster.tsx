/**
 * CustomerMaster
 * ─────────────────────────────────────────────────────────────────────────────
 * Matches the SupplierMaster layout / UX pattern exactly while keeping every
 * field that Customer already had.  The one new addition is an Account Group
 * picker using <TreeDropdown variant="tree"> — same inline pattern as SupplierMaster.
 *
 * API shape (same as Supplier, just LHeadType = "A"):
 *   LHeadId, LHeadName, LHeadContactPerson, LHeadPhone, LHeadEmail,
 *   LGST, LHeadPan, LGSTType, LGSTState, LHeadPaymentTerms, LHeadAddress,
 *   LHeadStatus, LBelongsTo (FK → AccountGroup.AGId), GroupName
 */

import React, { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getList,
  addRecord,
  updateRecord,
  deleteRecord,
} from "@/api/accountHeadApi";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { safeHtml } from "@/utils/escapeHtml";
import { FollowupShell } from "@/components/followup/FollowupShell";
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
  RotateCcw,
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
import { getAccountGroups } from "@/api/accountApi";
import { usePageRights } from "@/hooks/usePageRights";
import TreeDropdown from "@/components/common/TreeDropdown";

// ─── Constants ────────────────────────────────────────────────────────────────

const CUSTOMER_TYPE = "A";

const GST_TYPES = [
  "Regular",
  "Composition",
  "Unregistered",
  "SEZ",
  "Deemed Export",
] as const;

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

const PAYMENT_TERMS = [
  "Advance",
  "15 Days",
  "30 Days",
  "45 Days",
  "60 Days",
] as const;

// ─── Types ────────────────────────────────────────────────────────────────────

interface AccountGroup {
  _id: string;
  name: string;
  code: string;
  parentId: string | null;
}


interface Customer {
  LHeadId: number;
  LHeadName: string;
  LHeadContactPerson: string | null;
  LHeadPhone: string | null;
  LHeadEmail: string | null;
  LGST: string | null;
  LHeadPan: string | null;
  LGSTType: string | null;
  LGSTState: string | null;
  LHeadPaymentTerms: string | null;
  LHeadAddress: string | null;
  LHeadStatus: boolean;
  LBelongsTo: number | null;
  GroupName: string | null;
}

interface CustomerForm {
  LHeadName: string;
  LHeadContactPerson: string;
  LHeadPhone: string;
  LHeadEmail: string;
  LGST: string;
  LHeadPan: string;
  LGSTType: string;
  LGSTState: string;
  LHeadPaymentTerms: string;
  LHeadAddress: string;
  LHeadStatus: boolean;
  LBelongsTo: string; // string id; converted to Number on save
}

const EMPTY_FORM: CustomerForm = {
  LHeadName: "",
  LHeadContactPerson: "",
  LHeadPhone: "",
  LHeadEmail: "",
  LGST: "",
  LHeadPan: "",
  LGSTType: "",
  LGSTState: "",
  LHeadPaymentTerms: "",
  LHeadAddress: "",
  LHeadStatus: true,
  LBelongsTo: "",
};

// ─── Export Columns ────────────────────────────────────────────────────────────

const EXPORT_COLUMNS: ExportColumn[] = [
  { header: "Customer Name", accessor: "LHeadName" },
  { header: "Contact Person", accessor: "LHeadContactPerson" },
  { header: "Phone", accessor: "LHeadPhone" },
  { header: "Email", accessor: "LHeadEmail" },
  { header: "GST Number", accessor: "LGST" },
  { header: "PAN Number", accessor: "LHeadPan" },
  { header: "GST Type", accessor: "LGSTType" },
  { header: "GST State", accessor: "LGSTState" },
  { header: "Payment Terms", accessor: "LHeadPaymentTerms" },
  { header: "Account Group", accessor: "GroupName" },
  { header: "Address", accessor: "LHeadAddress" },
  {
    header: "Status",
    accessor: (r) => (r.LHeadStatus ? "Active" : "Inactive"),
  },
];

// ─── Column builder ────────────────────────────────────────────────────────────

function buildCustomerColumns(
  _editingId: number | null,
  deleteConfirm: number | null,
  setDeleteConfirm: (id: number | null) => void,
  startEdit: (c: Customer) => void,
  deleteMut: { mutate: (id: number) => void },
  onView: (c: Customer) => void,
  onPrint: (c: Customer) => void,
  canEdit: boolean,
  canDelete: boolean,
  canPrint: boolean,
): ColumnDef<Customer, unknown>[] {
  return [
    {
      accessorKey: "LHeadName",
      header: "Customer Name",
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
            className={`px-2 py-0.5 rounded-full text-xs font-medium ${
              active
                ? "bg-emerald-500/10 text-emerald-600"
                : "bg-muted text-muted-foreground"
            }`}
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
            {canPrint && (
              <button
                onClick={() => onPrint(row.original)}
                className="p-1 rounded text-amber-500 hover:bg-amber-500/10 transition-colors"
                title="Print"
              >
                <Printer size={15} />
              </button>
            )}
            {canEdit && (
              <button
                onClick={() => startEdit(row.original)}
                className="p-1 rounded text-blue-400 hover:bg-blue-400/10 transition-colors"
                title="Edit"
              >
                <Pencil size={15} />
              </button>
            )}
            {canDelete && (
              <button
                onClick={() => setDeleteConfirm(id)}
                className="p-1 rounded text-destructive hover:bg-destructive/10 transition-colors"
                title="Delete"
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        );
      },
    },
  ];
}

// ─── Component ────────────────────────────────────────────────────────────────

const CustomerMaster: React.FC = () => {
  const qc = useQueryClient();
  const rights = usePageRights("customer-master");

  // ── Local state ────────────────────────────────────────────────────────────
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<CustomerForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<
    Partial<Record<keyof CustomerForm, boolean>>
  >({});
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [viewRecord, setViewRecord] = useState<Customer | null>(null);

  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [page, setPage] = useState(1);
  const LIMIT = 10;

  useEffect(() => {
    setPage(1);
  }, [search, filterStatus]);

  // ── Remote data ────────────────────────────────────────────────────────────
  const {
    data: rawData,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["account-head", CUSTOMER_TYPE],
    queryFn: () => getList(CUSTOMER_TYPE),
    staleTime: 5 * 60 * 1000,
  });

  const customers: Customer[] = useMemo(() => {
    if (!Array.isArray(rawData)) return [];
    return rawData.map((item: any) => ({
      LHeadId: item.LHeadId,
      LHeadName: item.LHeadName || "",
      LHeadContactPerson: item.LHeadContactPerson || null,
      LHeadPhone: item.LHeadPhone || null,
      LHeadEmail: item.LHeadEmail || null,
      LGST: item.LGST || null,
      LHeadPan: item.LHeadPan || null,
      LGSTType: item.LGSTType || null,
      LGSTState: item.LGSTState || null,
      LHeadPaymentTerms: item.LHeadPaymentTerms || null,
      LHeadAddress: item.LHeadAddress || null,
      LHeadStatus: Boolean(item.LHeadStatus),
      LBelongsTo: item.LBelongsTo ?? null,
      GroupName: item.GroupName ?? null,
    }));
  }, [rawData]);

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

  // ── Mutations ──────────────────────────────────────────────────────────────
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["account-head", CUSTOMER_TYPE] });

  const buildPayload = (f: CustomerForm) => ({
    LHeadName: f.LHeadName,
    LHeadType: CUSTOMER_TYPE,
    LHeadContactPerson: f.LHeadContactPerson || null,
    LHeadPhone: f.LHeadPhone || null,
    LHeadEmail: f.LHeadEmail || null,
    LGST: f.LGST || null,
    LHeadPan: f.LHeadPan || null,
    LGSTType: f.LGSTType || null,
    LGSTState: f.LGSTState || null,
    LHeadPaymentTerms: f.LHeadPaymentTerms || null,
    LHeadAddress: f.LHeadAddress || null,
    LHeadStatus: f.LHeadStatus,
    LBranchName: null,
    LCountry: "India",
    LBelongsTo: f.LBelongsTo ? Number(f.LBelongsTo) : null,
    LDescription: null,
  });

  const createMut = useMutation({
    mutationFn: (f: CustomerForm) => addRecord(buildPayload(f), CUSTOMER_TYPE),
    onSuccess: () => {
      toast.success("Customer created");
      invalidate();
      resetForm();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: CustomerForm }) =>
      updateRecord(id, buildPayload(data), CUSTOMER_TYPE),
    onSuccess: () => {
      toast.success("Customer updated");
      invalidate();
      resetForm();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteRecord(id),
    onSuccess: () => {
      toast.success("Customer deleted");
      invalidate();
      setDeleteConfirm(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saving = createMut.isPending || updateMut.isPending;

  // ── Helpers ────────────────────────────────────────────────────────────────
  const startEdit = (c: Customer) => {
    setEditingId(c.LHeadId);
    setForm({
      LHeadName: c.LHeadName ?? "",
      LHeadContactPerson: c.LHeadContactPerson ?? "",
      LHeadPhone: c.LHeadPhone ?? "",
      LHeadEmail: c.LHeadEmail ?? "",
      LGST: c.LGST ?? "",
      LHeadPan: c.LHeadPan ?? "",
      LGSTType: c.LGSTType ?? "",
      LGSTState: c.LGSTState ?? "",
      LHeadPaymentTerms: c.LHeadPaymentTerms ?? "",
      LHeadAddress: c.LHeadAddress ?? "",
      LHeadStatus: c.LHeadStatus,
      LBelongsTo: c.LBelongsTo != null ? String(c.LBelongsTo) : "",
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
    const e: Partial<Record<keyof CustomerForm, boolean>> = {};
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

  const handlePrint = (c: Customer) => {
    const win = window.open("", "_blank", "width=700,height=600");
    if (!win) return;
    win.document.write(safeHtml`
      <html><head><title>Customer — ${c.LHeadName}</title>
      <style>body{font-family:sans-serif;padding:24px;color:#111}h2{margin-bottom:16px}table{border-collapse:collapse;width:100%}td{padding:6px 12px;border:1px solid #ddd;font-size:13px}td:first-child{font-weight:600;width:40%;background:#f5f5f5}</style>
      </head><body>
      <h2>Customer Card</h2>
      <table>
        <tr><td>Customer Name</td><td>${c.LHeadName || "—"}</td></tr>
        <tr><td>Contact Person</td><td>${c.LHeadContactPerson || "—"}</td></tr>
        <tr><td>Phone</td><td>${c.LHeadPhone || "—"}</td></tr>
        <tr><td>Email</td><td>${c.LHeadEmail || "—"}</td></tr>
        <tr><td>GST Number</td><td>${c.LGST || "—"}</td></tr>
        <tr><td>PAN Number</td><td>${c.LHeadPan || "—"}</td></tr>
        <tr><td>GST Type</td><td>${c.LGSTType || "—"}</td></tr>
        <tr><td>GST State</td><td>${c.LGSTState || "—"}</td></tr>
        <tr><td>Payment Terms</td><td>${c.LHeadPaymentTerms || "—"}</td></tr>
        <tr><td>Account Group</td><td>${c.GroupName || "—"}</td></tr>
        <tr><td>Address</td><td>${c.LHeadAddress || "—"}</td></tr>
        <tr><td>Status</td><td>${c.LHeadStatus ? "Active" : "Inactive"}</td></tr>
      </table>
      </body></html>
    `);
    win.document.close();
    win.print();
  };

  // ── Table columns ──────────────────────────────────────────────────────────
  const columns = useMemo(
    () =>
      buildCustomerColumns(
        editingId,
        deleteConfirm,
        setDeleteConfirm,
        startEdit,
        deleteMut,
        setViewRecord,
        handlePrint,
        rights.canEdit,
        rights.canDelete,
        rights.canPrint,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editingId, deleteConfirm, rights.canEdit, rights.canDelete, rights.canPrint],
  );

  // ── Filter + paginate ──────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return customers.filter((c) => {
      const matchSearch =
        !q ||
        c.LHeadName?.toLowerCase().includes(q) ||
        (c.LHeadPhone ?? "").toLowerCase().includes(q) ||
        (c.LGST ?? "").toLowerCase().includes(q) ||
        (c.LHeadContactPerson ?? "").toLowerCase().includes(q);
      const matchStatus =
        !filterStatus ||
        (filterStatus === "active" ? c.LHeadStatus : !c.LHeadStatus);
      return matchSearch && matchStatus;
    });
  }, [customers, search, filterStatus]);

  const totalPages = Math.max(Math.ceil(filtered.length / LIMIT), 1);
  const paginated = filtered.slice((page - 1) * LIMIT, page * LIMIT);

  // ── Shared CSS ─────────────────────────────────────────────────────────────
  const inputCls =
    "w-full text-sm rounded-lg border border-border px-3 py-2.5 bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition";

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <Breadcrumbs items={["Masters", "Customer Master"]} />

      <FollowupShell
        title="Customer Master"
        subtitle="Manage customer accounts with contact, GST and payment details"
        icon={User}
        action={
          <span className="text-xs text-muted-foreground bg-muted/60 rounded-lg px-3 py-1.5">
            {customers.length} Customers
          </span>
        }
      >
      <div className="relative space-y-8">

        {/* ── Form Card ── */}
        {rights.canCreate && (
        <div className="rounded-xl border border-border bg-card shadow-sm">
          {/* Card header */}
          <div className="flex items-center justify-between gap-3 px-5 sm:px-6 py-4 border-b border-border">
            <div className="flex items-center gap-3">
              {editingId && (
                <button
                  onClick={resetForm}
                  className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <RotateCcw size={15} />
                  <span className="hidden sm:inline">Back</span>
                </button>
              )}
              {editingId && <span className="text-border/60">|</span>}
              <h2 className="text-base font-heading font-semibold text-foreground">
                {editingId ? "Edit Customer" : "Add Customer"}
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={resetForm}
                className="px-4 py-2 rounded-lg text-sm h-auto font-heading border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center gap-1.5"
              >
                <RotateCcw size={13} />
                {editingId ? "Cancel" : "Reset"}
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-2 rounded-lg text-sm h-auto font-heading font-semibold gradient-accent text-white disabled:opacity-60 flex items-center gap-2"
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
                    ? "Update Customer"
                    : "Save Customer"}
              </button>
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
                {/* Customer Name */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                    Customer Name <span className="text-destructive">*</span>
                  </label>
                  <input
                    value={form.LHeadName}
                    onChange={(e) => {
                      setForm((p) => ({ ...p, LHeadName: e.target.value }));
                      setErrors((p) => ({ ...p, LHeadName: false }));
                    }}
                    placeholder="e.g. Sharma Enterprises"
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

                {/* Account Group — always Sundry Debtors for customers,
                    never picked manually (see accountHeadMaster.js's
                    getSundryDebtorsGroupId, applied server-side on every
                    create/update regardless of what's sent here). */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider block">
                    Account Group
                  </label>
                  <div className="h-9 px-3 flex items-center rounded-lg border border-border/60 bg-muted/30 text-sm text-muted-foreground">
                    Sundry Debtors
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
                        setForm((p) => ({ ...p, LHeadPhone: e.target.value }))
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
                        setForm((p) => ({ ...p, LHeadEmail: e.target.value }))
                      }
                      placeholder="e.g. contact@sharma.com"
                      className="w-full text-sm rounded-lg border border-border pl-8 pr-3 py-2.5 bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
                    />
                  </div>
                </div>

                {/* Payment Terms */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider block">
                    Payment Terms
                  </label>
                  <TreeDropdown
                    variant="flat"
                    value={form.LHeadPaymentTerms}
                    onChange={(v) =>
                      setForm((p) => ({ ...p, LHeadPaymentTerms: v }))
                    }
                    options={PAYMENT_TERMS.map((t) => ({ value: t, label: t }))}
                    placeholder="Select terms…"
                  />
                </div>

                {/* Address — full width */}
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

                {/* GST Type */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider block">
                    GST Type
                  </label>
                  <TreeDropdown
                    variant="flat"
                    value={form.LGSTType}
                    onChange={(v) => setForm((p) => ({ ...p, LGSTType: v }))}
                    options={GST_TYPES.map((t) => ({ value: t, label: t }))}
                    placeholder="Select type…"
                  />
                </div>

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
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 ${
                  form.LHeadStatus ? "bg-emerald-500" : "bg-muted-foreground/30"
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                    form.LHeadStatus ? "translate-x-4" : "translate-x-0.5"
                  }`}
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
        </div>
        )}

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
              value={filterStatus}
              onChange={(v) => setFilterStatus(v)}
              options={[
                { value: "active", label: "Active" },
                { value: "inactive", label: "Inactive" },
              ]}
              placeholder="All Status"
            />

            {(search || filterStatus) && (
              <button
                onClick={() => {
                  setSearch("");
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
              searchPlaceholder="Search customers..."
              getRowId={(row) => String(row.LHeadId)}
              emptyMessage={
                isError
                  ? "Failed to load customers."
                  : customers.length === 0
                    ? "No customers yet."
                    : "No results match your search."
              }
              exportConfig={rights.canExport ? {
                title: "Customer Master",
                filename: "customer-master",
                columns: EXPORT_COLUMNS,
              } : undefined}
              rowClassName={(row) =>
                row.original.LHeadId === editingId ? "bg-primary/5" : ""
              }
            />
          </div>

          {/* Pagination */}
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
      </FollowupShell>

      {/* ── View Detail Drawer ── */}
      {viewRecord && (
        <div className="fixed inset-0 z-[60] flex justify-end">
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={() => setViewRecord(null)}
          />
          <div className="relative w-full max-w-sm bg-card border-l border-border shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <Building2 size={15} className="text-primary" />
                <h3 className="font-heading font-semibold text-sm text-foreground">
                  Customer Details
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
                { label: "Customer Name", value: viewRecord.LHeadName },
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
                  label: "Payment Terms",
                  value: viewRecord.LHeadPaymentTerms || "—",
                },
                {
                  label: "Account Group",
                  value: viewRecord.GroupName || "—",
                },
                { label: "Address", value: viewRecord.LHeadAddress || "—" },
              ].map(({ label, value, mono }) => (
                <div key={label}>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading mb-1">
                    {label}
                  </p>
                  <p
                    className={`text-sm text-foreground ${
                      mono ? "font-mono font-semibold text-primary" : ""
                    }`}
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
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                    viewRecord.LHeadStatus
                      ? "bg-emerald-500/10 text-emerald-600"
                      : "bg-muted text-muted-foreground"
                  }`}
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
                <Pencil size={13} /> Edit Customer
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default CustomerMaster;
