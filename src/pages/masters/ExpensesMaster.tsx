import { useState, useMemo } from "react";
import { usePageRights } from "@/hooks/usePageRights";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAccountGroups } from "@/api/accountApi";
import {
  getList,
  addRecord,
  updateRecord,
  deleteRecord,
} from "@/api/accountHeadApi";
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
  ChevronDown,
  AlertCircle,
  Eye,
  XCircle,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AccountGroupData {
  AGId: number;
  Name: string;
}

interface AccountGroup {
  _id: string;
  name: string;
}

interface LedgerHead {
  LHeadId: number;
  LHeadName: string;
  LHeadType: string | null;
  LBelongsTo: number | null;
  GroupName: string | null;
  LHeadStatus: boolean;
}

interface LedgerForm {
  LHeadName: string;
  LHeadType: string;
  LBelongsTo: string;
}

const EMPTY_FORM: LedgerForm = {
  LHeadName: "",
  LHeadType: "",
  LBelongsTo: "",
};

// ─── Column builder ───────────────────────────────────────────────────────────
function buildExpenseColumns(
  _editingId: number | null,
  deleteConfirm: number | null,
  setDeleteConfirm: (id: number | null) => void,
  startEdit: (l: LedgerHead) => void,
  deleteMut: { mutate: (id: number) => void },
  onView: (l: LedgerHead) => void,
  canEdit: boolean,
  canDelete: boolean,
): ColumnDef<LedgerHead, unknown>[] {
  return [
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
      accessorKey: "LHeadType",
      header: "Type",
      cell: ({ getValue }) => (
        <span className="text-xs text-muted-foreground">
          {(getValue() as string) || "—"}
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
            {canEdit && (
              <button
                onClick={() => startEdit(row.original)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10"
              >
                <Pencil size={13} />
              </button>
            )}
            {canDelete && (
              <button
                onClick={() => setDeleteConfirm(id)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        );
      },
    },
  ];
}

// ─── Component ───────────────────────────────────────────────────────────────

// BASE removed - using accountHeadApi

// fetchLedgers replaced by getList()

// createLedger replaced by addRecord()

// updateLedger replaced by updateRecord()

// deleteLedger replaced by deleteRecord()

// ─── Component ───────────────────────────────────────────────────────────────

const ExpensesMaster: React.FC = () => {
  const rights = usePageRights("expenses-master");
  const qc = useQueryClient();

  // ── Remote data ────────────────────────────────────────────────────────────

  const { data: groupsData, isLoading: groupsLoading } = useQuery({
    queryKey: ["account-groups"],
    queryFn: getAccountGroups,
    retry: 1,
    staleTime: 5 * 60 * 1000, // 5 min
  });

  const {
    data: ledgersData,
    isLoading: ledgersLoading,
  } = useQuery({
    queryKey: ["ledger-heads"],
    queryFn: () => getList(),
    retry: 1,
    staleTime: 5 * 60 * 1000, // 5 min
  });

  const accountGroups: AccountGroup[] = useMemo(() => {
    if (!Array.isArray(groupsData)) return [];
    const dbGroups: AccountGroupData[] = groupsData as AccountGroupData[];
    return dbGroups
      .filter((item) => item.AGId != null && item.Name)
      .map((item) => ({
        _id: String(item.AGId),
        name: item.Name,
      }));
  }, [groupsData]);

  const ledgers: LedgerHead[] = useMemo(() => {
    if (Array.isArray(ledgersData)) return ledgersData;
    if (ledgersData?.data) return ledgersData.data;
    return [];
  }, [ledgersData]);

  // ── Local UI state ─────────────────────────────────────────────────────────

  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<LedgerForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<
    Partial<Record<keyof LedgerForm, boolean>>
  >({});
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [viewRecord, setViewRecord] = useState<LedgerHead | null>(null);

  const [search, setSearch] = useState("");
  const [filterGroup, setFilterGroup] = useState("");
  const sortField: "LHeadName" | "LHeadType" | "GroupName" = "LHeadName";
  const sortAsc = true;

  // ── Mutations ──────────────────────────────────────────────────────────────

  const invalidate = () => qc.invalidateQueries({ queryKey: ["ledger-heads"] });

  const createMut = useMutation({
    mutationFn: (data: LedgerForm) =>
      addRecord(
        {
          LHeadName: data.LHeadName.trim(),
          LBelongsTo: data.LBelongsTo ? Number(data.LBelongsTo) : null,
        },
        data.LHeadType || "Ledger",
      ),
    onSuccess: () => {
      toast.success("Ledger account created");
      invalidate();
      resetForm();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: LedgerForm }) =>
      updateRecord(
        id,
        {
          LHeadName: data.LHeadName.trim(),
          LBelongsTo: data.LBelongsTo ? Number(data.LBelongsTo) : null,
        },
        data.LHeadType || "Ledger",
      ),
    onSuccess: () => {
      toast.success("Ledger account updated");
      invalidate();
      resetForm();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteRecord(id),
    onSuccess: () => {
      toast.success("Ledger account deleted");
      invalidate();
      setDeleteConfirm(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saving = createMut.isPending || updateMut.isPending;

  // ── Helpers ────────────────────────────────────────────────────────────────

  const startEdit = (l: LedgerHead) => {
    setEditingId(l.LHeadId);
    setForm({
      LHeadName: l.LHeadName ?? "",
      LHeadType: l.LHeadType ?? "",
      LBelongsTo: l.LBelongsTo != null ? String(l.LBelongsTo) : "",
    });
    setErrors({});
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const columns = useMemo(
    () =>
      buildExpenseColumns(
        editingId,
        deleteConfirm,
        setDeleteConfirm,
        startEdit,
        deleteMut,
        setViewRecord,
        rights.canEdit,
        rights.canDelete,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editingId, deleteConfirm, rights.canEdit, rights.canDelete],
  );

  const resetForm = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setErrors({});
  };

  const handleSave = () => {
    const e: Partial<Record<keyof LedgerForm, boolean>> = {};
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

  // ── Filtered + sorted list ─────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = ledgers.filter((l) => {
      const matchSearch =
        !q ||
        l.LHeadName?.toLowerCase().includes(q) ||
        (l.LHeadType ?? "").toLowerCase().includes(q);
      const matchGroup = !filterGroup || String(l.LBelongsTo) === filterGroup;
      return matchSearch && matchGroup;
    });

    return [...list].sort((a, b) => {
      const av =
        (sortField === "LHeadName"
          ? a.LHeadName
          : sortField === "LHeadType"
            ? a.LHeadType
            : a.GroupName) ?? "";
      const bv =
        (sortField === "LHeadName"
          ? b.LHeadName
          : sortField === "LHeadType"
            ? b.LHeadType
            : b.GroupName) ?? "";
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }, [ledgers, search, filterGroup, sortField, sortAsc]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <Breadcrumbs items={["Masters", "Expenses"]} />

      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-xl font-heading font-bold text-foreground">
          General Ledger Master
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Define ledger accounts with a name, type and account group
        </p>
      </div>

      {/* ── Form card ── */}
      {(rights.canCreate || rights.canEdit) && <div className="rounded-xl border border-border bg-card mb-6">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">
            {editingId ? "Edit Ledger Account" : "Add Ledger Account"}
          </h2>
          <p className="text-xs text-muted-foreground">
            {editingId
              ? "Modify the selected ledger account"
              : "Fill in the details to create a new record."}
          </p>
        </div>

        <div className="p-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-5">
            {/* Account Name */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-2">
                Account Name <span className="text-red-500">*</span>
              </label>
              <input
                value={form.LHeadName}
                onChange={(e) => {
                  setForm((p) => ({ ...p, LHeadName: e.target.value }));
                  setErrors((p) => ({ ...p, LHeadName: false }));
                }}
                placeholder="e.g. Cash in Hand"
                className={`w-full text-sm rounded-lg border px-3 py-2.5 bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition ${
                  errors.LHeadName
                    ? "border-red-400 ring-red-400"
                    : "border-border"
                }`}
                aria-label="Account Name"
              />
              {errors.LHeadName && (
                <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                  <AlertCircle size={11} /> Required
                </p>
              )}
            </div>

            {/* Type */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-2">
                Type
              </label>
              <div className="relative">
                <select
                  value={form.LHeadType}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, LHeadType: e.target.value }))
                  }
                  className="w-full text-sm rounded-lg border border-border px-3 py-2.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition appearance-none"
                  aria-label="Account Type"
                >
                  <option value="">Select type…</option>
                  <option value="Asset">Asset</option>
                  <option value="Liability">Liability</option>
                  <option value="Income">Income</option>
                  <option value="Expense">Expense</option>
                  <option value="Equity">Equity</option>
                </select>
                <ChevronDown
                  size={13}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                />
              </div>
            </div>

            {/* Account Group */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-2">
                Account Group
              </label>
              {groupsLoading ? (
                <div className="w-full text-sm rounded-lg border border-border px-3 py-2.5 bg-muted/40 text-muted-foreground">
                  Loading…
                </div>
              ) : (
                <div className="relative">
                  <select
                    value={form.LBelongsTo}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, LBelongsTo: e.target.value }))
                    }
                    className="w-full text-sm rounded-lg border border-border px-3 py-2.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition appearance-none"
                    aria-label="Account Group"
                  >
                    <option value="">Select group…</option>
                    {accountGroups.map((g) => (
                      <option key={g._id} value={g._id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={13}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 mt-6 pt-5 border-t border-border">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-60 transition-opacity flex items-center gap-2"
              aria-label="Save Account"
            >
              {saving ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Saving…
                </>
              ) : editingId ? (
                <>
                  <Check size={14} />
                  Update Account
                </>
              ) : (
                <>
                  <Plus size={14} />
                  Save Account
                </>
              )}
            </button>
            {editingId && (
              <button
                onClick={resetForm}
                className="px-5 py-2.5 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition-colors flex items-center gap-2"
                aria-label="Cancel Edit"
              >
                <RotateCcw size={13} />
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>}

      {/* ── Table ── */}
      <div>
        {/* Toolbar */}
        <div className="mb-3 flex items-center gap-3 flex-wrap">
          <div className="relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or type…"
              className="w-56 text-sm rounded-lg border border-border pl-9 pr-3 py-2 bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
              aria-label="Search accounts"
            />
          </div>

          <div className="relative">
            <select
              value={filterGroup}
              onChange={(e) => setFilterGroup(e.target.value)}
              className="text-sm rounded-lg border border-border pl-3 pr-8 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition appearance-none"
              aria-label="Filter by group"
            >
              <option value="">All Groups</option>
              {accountGroups.map((g) => (
                <option key={g._id} value={g._id}>
                  {g.name}
                </option>
              ))}
            </select>
            <ChevronDown
              size={12}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            />
          </div>

          {(search || filterGroup) && (
            <button
              onClick={() => {
                setSearch("");
                setFilterGroup("");
              }}
              className="text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 hover:bg-muted transition-colors flex items-center gap-1.5"
              aria-label="Clear filters"
            >
              <X size={11} />
              Clear
            </button>
          )}

          <span className="ml-auto text-xs text-muted-foreground bg-muted/60 rounded-lg px-3 py-1.5">
            {ledgers.length} Accounts
          </span>
        </div>

        {/* Table */}
        <div className="rounded-xl border border-border overflow-hidden bg-card">
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
                ? "No expense accounts yet."
                : "No results match your search."
            }
            rowClassName={(row) =>
              row.original.LHeadId === editingId ? "bg-primary/5" : ""
            }
          />
        </div>
      </div>
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
                <BookOpen size={15} className="text-primary" />
                <h3 className="font-heading font-semibold text-sm text-foreground">
                  Expense Account Details
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
                  Type
                </p>
                <p className="text-sm text-foreground">
                  {viewRecord.LHeadType || (
                    <span className="text-muted-foreground italic">
                      Not set
                    </span>
                  )}
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
            <div className="px-5 py-3 border-t border-border">
              <button
                onClick={() => {
                  startEdit(viewRecord);
                  setViewRecord(null);
                }}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-heading font-semibold bg-primary text-primary-foreground hover:bg-primary/90"
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

export default ExpensesMaster;
