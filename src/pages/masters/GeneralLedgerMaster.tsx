import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAccountGroups } from "@/api/accountApi";
import {
  getLedgers,
  addLedger,
  updateLedger as updateLedgerApi,
  deleteLedger as deleteLedgerApi,
} from "@/api/generalLedgerApi";
import { toast } from "sonner";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  Pencil,
  Trash2,
  X,
  Check,
  RotateCcw,
  Plus,
  Search,
  BookOpen,
  Hash,
  ChevronDown,
  AlertCircle,
  Eye,
  XCircle,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
interface AccountGroup {
  _id: string;
  name: string;
}

interface LedgerHead {
  LHeadId: number;
  LHeadName: string;
  LHeadCode: string | null;
  LBelongsTo: number | null;
  GroupName: string | null;
  LHeadStatus: boolean;
}

interface LedgerForm {
  LHeadName: string;
  LHeadCode: string;
  LBelongsTo: string;
}

interface PaginatedResponse<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const EMPTY_FORM: LedgerForm = {
  LHeadName: "",
  LHeadCode: "",
  LBelongsTo: "",
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

// ─── Column builder ────────────────────────────────────────────────────────────
function buildGLColumns(
  _editingId: number | null,
  deleteConfirm: number | null,
  setDeleteConfirm: (id: number | null) => void,
  startEdit: (l: LedgerHead) => void,
  deleteMut: { mutate: (id: number) => void },
  onView: (l: LedgerHead) => void,
): ColumnDef<LedgerHead, unknown>[] {
  return [
    {
      accessorKey: "LHeadCode",
      header: "Code",
      cell: ({ getValue }) => (
        <span className="font-mono text-xs font-semibold text-primary">
          {(getValue() as string) || "—"}
        </span>
      ),
    },
    {
      accessorKey: "LHeadName",
      header: "Account Name",
      cell: ({ getValue }) => (
        <span className="font-medium text-foreground">
          {getValue() as string}
        </span>
      ),
    },
    {
      accessorKey: "GroupName",
      header: "Account Group",
      cell: ({ getValue }) => (
        <span className="text-xs text-muted-foreground">
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
      header: "",
      enableSorting: false,
      cell: ({ row }) => {
        const id = row.original.LHeadId;
        if (deleteConfirm === id) {
          return (
            <div className="flex items-center gap-1 justify-end">
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
          <div className="flex items-center justify-end gap-1">
            <button
              onClick={() => onView(row.original)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-sky-500 hover:bg-sky-500/10"
              title="View details"
            >
              <Eye size={13} />
            </button>
            <button
              onClick={() => startEdit(row.original)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10"
            >
              <Pencil size={13} />
            </button>
            <button
              onClick={() => setDeleteConfirm(id)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            >
              <Trash2 size={13} />
            </button>
          </div>
        );
      },
    },
  ];
}

// ─── Component ────────────────────────────────────────────────────────────────
const GeneralLedgerMaster: React.FC = () => {
  const qc = useQueryClient();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<LedgerForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<
    Partial<Record<keyof LedgerForm, boolean>>
  >({});
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [viewRecord, setViewRecord] = useState<LedgerHead | null>(null);

  const [search, setSearch] = useState("");
  const [filterGroup, setFilterGroup] = useState("");
  const [page, setPage] = useState(1);
  const limit = 10;
  const [sortField, setSortField] = useState<
    "LHeadName" | "LHeadCode" | "GroupName"
  >("LHeadName");
  const [sortAsc, setSortAsc] = useState(true);

  useEffect(() => {
    setPage(1);
  }, [search, filterGroup]);

  // ── Remote data ────────────────────────────────────────────────────────────
  const { data: groupsData, isLoading: groupsLoading } = useQuery({
    queryKey: ["account-groups"],
    queryFn: getAccountGroups,
    staleTime: 5 * 60 * 1000,
  });

  const {
    data: ledgersData,
    isLoading: ledgersLoading,
    isError: ledgersError,
  } = useQuery({
    queryKey: ["ledger-heads", page, limit, search, filterGroup],
    queryFn: () => getLedgers({ page, limit, search, groupId: filterGroup }),
  });

  const accountGroups: AccountGroup[] = useMemo(() => {
    if (!Array.isArray(groupsData)) return [];
    return (groupsData as any[])
      .filter((item) => item.AGId != null && item.Name)
      .map((item) => ({
        _id: String(item.AGId),
        name: item.Name as string,
      }));
  }, [groupsData]);

  const ledgers: LedgerHead[] = useMemo(
    () => ledgersData?.data ?? [],
    [ledgersData],
  );
  const totalPages = Math.max(ledgersData?.totalPages ?? 1, 1);
  const totalRecords = ledgersData?.total ?? ledgers.length;

  // ── Local UI state ─────────────────────────────────────────────────────────
  // Track whether user has manually edited the short code
  const hasManuallyEditedCode = useRef(false);

  // ── Mutations ──────────────────────────────────────────────────────────────
  const invalidate = () => qc.invalidateQueries({ queryKey: ["ledger-heads"] });

  const createMut = useMutation({
    mutationFn: (data: LedgerForm) =>
      addLedger({
        LHeadName: data.LHeadName,
        LHeadCode: data.LHeadCode || null,
        LBelongsTo: data.LBelongsTo ? Number(data.LBelongsTo) : null,
      }),
    onSuccess: () => {
      toast.success("Ledger account created");
      invalidate();
      resetForm();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: LedgerForm }) =>
      updateLedgerApi(id, {
        LHeadName: data.LHeadName,
        LHeadCode: data.LHeadCode || null,
        LBelongsTo: data.LBelongsTo ? Number(data.LBelongsTo) : null,
      }),
    onSuccess: () => {
      toast.success("Ledger account updated");
      invalidate();
      resetForm();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteLedgerApi(id),
    onSuccess: () => {
      toast.success("Ledger account deleted");
      invalidate();
      setDeleteConfirm(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saving = createMut.isPending || updateMut.isPending;

  // ── Auto-generate Short Code Logic ────────────────────────────────────────
  const generateShortCode = (name: string): string => {
    const cleaned = name.trim().replace(/[^a-zA-Z0-9\s]/g, "");
    const words = cleaned.split(/\s+/).filter(Boolean);

    if (words.length === 0) return "";

    if (words.length === 1) {
      return words[0].substring(0, 4).toUpperCase();
    } else if (words.length === 2) {
      return (
        words[0].substring(0, 3) + words[1].substring(0, 1)
      ).toUpperCase();
    } else {
      return words
        .slice(0, 4)
        .map((w) => w[0])
        .join("")
        .toUpperCase();
    }
  };

  // Auto-generate short code when account name changes (only for new records)
  useEffect(() => {
    if (editingId !== null) return; // Don't auto-generate during edit

    const name = form.LHeadName.trim();

    if (!name) {
      setForm((prev) => ({ ...prev, LHeadCode: "" }));
      hasManuallyEditedCode.current = false;
      return;
    }

    // Auto-generate only if user has not manually edited the code
    if (!hasManuallyEditedCode.current) {
      const generated = generateShortCode(name);
      setForm((prev) => ({ ...prev, LHeadCode: generated }));
    }
  }, [form.LHeadName, editingId]);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const startEdit = (l: LedgerHead) => {
    setEditingId(l.LHeadId);
    setForm({
      LHeadName: l.LHeadName ?? "",
      LHeadCode: l.LHeadCode ?? "",
      LBelongsTo: l.LBelongsTo != null ? String(l.LBelongsTo) : "",
    });
    hasManuallyEditedCode.current = true; // Existing code should be preserved
    setErrors({});
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const columns = useMemo(
    () =>
      buildGLColumns(
        editingId,
        deleteConfirm,
        setDeleteConfirm,
        startEdit,
        deleteMut,
        setViewRecord,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editingId, deleteConfirm],
  );

  const resetForm = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setErrors({});
    hasManuallyEditedCode.current = false;
  };

  const handleSave = () => {
    const e: Partial<Record<keyof LedgerForm, boolean>> = {};
    if (!form.LHeadName.trim()) e.LHeadName = true;
    if (!form.LBelongsTo) e.LBelongsTo = true;

    if (Object.keys(e).length) {
      setErrors(e);
      if (e.LBelongsTo) {
        toast.error("Please select an Account Group before creating a Ledger Account.");
      }
      return;
    }

    if (editingId !== null) {
      updateMut.mutate({ id: editingId, data: form });
    } else {
      createMut.mutate(form);
    }
  };

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortAsc((a) => !a);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  // ── Filtered + sorted list ─────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = ledgers.filter((l) => {
      const matchSearch =
        !q ||
        l.LHeadName?.toLowerCase().includes(q) ||
        (l.LHeadCode ?? "").toLowerCase().includes(q);
      const matchGroup = !filterGroup || String(l.LBelongsTo) === filterGroup;
      return matchSearch && matchGroup;
    });

    return [...list].sort((a, b) => {
      const av =
        (sortField === "LHeadName"
          ? a.LHeadName
          : sortField === "LHeadCode"
            ? a.LHeadCode
            : a.GroupName) ?? "";
      const bv =
        (sortField === "LHeadName"
          ? b.LHeadName
          : sortField === "LHeadCode"
            ? b.LHeadCode
            : b.GroupName) ?? "";
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }, [ledgers, search, filterGroup, sortField, sortAsc]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <Breadcrumbs items={["Masters", "General Ledger"]} />

      <div className="relative space-y-8 mt-6">
        {/* ── Page header ── */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-heading font-bold text-foreground">
              General Ledger Master
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Define ledger accounts with a name, short code and account group
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-muted-foreground bg-muted/60 rounded-lg px-3 py-1.5">
              {totalRecords} Accounts
            </span>
          </div>
        </div>

        {/* ── Form Card ── */}
        <div className="rounded-xl border border-border bg-card shadow-sm">
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
                {editingId ? "Edit Ledger Account" : "Add Ledger Account"}
              </h2>
            </div>
            <div className="flex items-center gap-2">
              {editingId && (
                <button
                  onClick={resetForm}
                  className="px-5 py-2 rounded-lg text-sm h-auto font-heading border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
              )}
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
                {saving ? "Saving…" : editingId ? "Update Account" : "Save Account"}
              </button>
            </div>
          </div>

          <div className="px-5 sm:px-6 py-6 space-y-7">
            <div className="space-y-3">
              <div className="flex items-center gap-2.5 pb-2 border-b border-border/60">
                <div className="flex items-center justify-center w-6 h-6 rounded-md bg-primary/10 shrink-0">
                  <BookOpen size={12} className="text-primary" />
                </div>
                <p className="text-[11px] font-heading uppercase tracking-wider text-muted-foreground flex-1">
                  Account Details
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-5">
                {/* Account Name */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                    Account Name <span className="text-destructive">*</span>
                  </label>
                  <input
                    value={form.LHeadName}
                    onChange={(e) => {
                      setForm((p) => ({ ...p, LHeadName: e.target.value }));
                      setErrors((p) => ({ ...p, LHeadName: false }));
                    }}
                    placeholder="e.g. Cash in Hand"
                    className={`w-full text-sm rounded-lg border px-3 py-2.5 bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition ${
                      errors.LHeadName ? "border-red-400" : "border-border"
                    }`}
                  />
                  {errors.LHeadName && (
                    <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                      <AlertCircle size={11} /> Required
                    </p>
                  )}
                </div>

                {/* Short Code */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider block">
                    Short Code
                  </label>
                  <div className="relative">
                    <Hash
                      size={13}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    />
                    <input
                      value={form.LHeadCode}
                      onChange={(e) => {
                        setForm((p) => ({
                          ...p,
                          LHeadCode: e.target.value.toUpperCase(),
                        }));
                        hasManuallyEditedCode.current = true;
                      }}
                      placeholder="e.g. CIH"
                      maxLength={20}
                      className="w-full text-sm rounded-lg border border-border pl-8 pr-3 py-2.5 bg-background text-foreground font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground/70">
                    Auto-generated from account name (you can override manually)
                  </p>
                </div>

                {/* Account Group */}
                <div className="space-y-1.5">
                  <label className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                    Account Group <span className="text-destructive">*</span>
                  </label>
                  {groupsLoading ? (
                    <div className="w-full text-sm rounded-lg border border-border px-3 py-2.5 bg-muted/40 text-muted-foreground">
                      Loading…
                    </div>
                  ) : (
                    <>
                    <FlatDropdown
                      value={form.LBelongsTo}
                      onChange={(v) => {
                        setForm((p) => ({ ...p, LBelongsTo: v }));
                        setErrors((p) => ({ ...p, LBelongsTo: false }));
                      }}
                      options={accountGroups.map((g) => ({ value: g._id, label: g.name }))}
                      placeholder="Select group…"
                      icon={<BookOpen size={13} />}
                      error={errors.LBelongsTo}
                    />
                    {errors.LBelongsTo && (
                      <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                        <AlertCircle size={11} /> Please select an Account Group
                      </p>
                    )}
                    </>
                  )}
                </div>
              </div>
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
                placeholder="Search name or code…"
                className="w-56 text-sm rounded-lg border border-border pl-9 pr-3 py-2 bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
              />
            </div>

            <FlatDropdown
              value={filterGroup}
              onChange={(v) => setFilterGroup(v)}
              options={accountGroups.map((g) => ({ value: g._id, label: g.name }))}
              placeholder="All Groups"
              icon={<BookOpen size={13} />}
            />

            {(search || filterGroup) && (
              <button
                onClick={() => {
                  setSearch("");
                  setFilterGroup("");
                }}
                className="text-xs font-heading text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 hover:bg-muted transition-colors flex items-center gap-1.5"
              >
                <X size={11} /> Clear
              </button>
            )}
          </div>

          {/* Table */}
          <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
          <DataTable
            data={filtered}
            columns={columns}
            loading={ledgersLoading}
            searchable={false}
            paginated={true}
            defaultPageSize={25}
            getRowId={(row) => String(row.LHeadId)}
            emptyMessage={
              ledgers.length === 0
                ? "No ledger accounts yet."
                : "No results match your search."
            }
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
                <BookOpen size={15} className="text-primary" />
                <h3 className="font-heading font-semibold text-sm text-foreground">
                  Ledger Details
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
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading mb-1">
                  Account Name
                </p>
                <p className="text-sm font-medium text-foreground">
                  {viewRecord.LHeadName}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading mb-1">
                  Short Code
                </p>
                <p className="font-mono text-sm font-semibold text-primary">
                  {viewRecord.LHeadCode || "—"}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading mb-1">
                  Account Group
                </p>
                <p className="text-sm text-foreground">
                  {viewRecord.GroupName || (
                    <span className="text-muted-foreground italic">
                      No group assigned
                    </span>
                  )}
                </p>
              </div>
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
                <Pencil size={13} /> Edit Account
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default GeneralLedgerMaster;