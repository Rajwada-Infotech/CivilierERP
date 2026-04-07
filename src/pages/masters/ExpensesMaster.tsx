import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAccountGroups } from "@/api/accountApi";
import { toast } from "sonner";
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
  Tag,
  ChevronDown,
  ChevronsUpDown,
  AlertCircle,
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

// ─── API helpers ─────────────────────────────────────────────────────────────

const BASE = "/api/account-head";

const fetchLedgers = async (): Promise<LedgerHead[]> => {
  const res = await fetch(BASE);
  if (!res.ok) throw new Error(`Failed to fetch ledgers: ${res.status}`);
  return res.json();
};

const createLedger = async (data: LedgerForm) => {
  const res = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      LHeadName: data.LHeadName.trim(),
      LHeadType: data.LHeadType || null,
      LBelongsTo: data.LBelongsTo ? Number(data.LBelongsTo) : null,
    }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Failed to create");
  }
  return res.json();
};

const updateLedger = async ({
  id,
  data,
}: {
  id: number;
  data: LedgerForm;
}) => {
  const res = await fetch(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      LHeadName: data.LHeadName.trim(),
      LHeadType: data.LHeadType || null,
      LBelongsTo: data.LBelongsTo ? Number(data.LBelongsTo) : null,
    }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Failed to update");
  }
  return res.json();
};

const deleteLedger = async (id: number) => {
  const res = await fetch(`${BASE}/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Failed to delete");
  }
  return res.json();
};

// ─── Component ───────────────────────────────────────────────────────────────

const ExpensesMaster: React.FC = () => {
  const qc = useQueryClient();

  // ── Remote data ────────────────────────────────────────────────────────────

  const {
    data: groupsData,
    isLoading: groupsLoading,
  } = useQuery({
    queryKey: ["account-groups"],
    queryFn: getAccountGroups,
  });

  const {
    data: ledgersData,
    isLoading: ledgersLoading,
    isError: ledgersError,
  } = useQuery({
    queryKey: ["ledger-heads"],
    queryFn: fetchLedgers,
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

  const ledgers: LedgerHead[] = useMemo(
    () => (Array.isArray(ledgersData) ? ledgersData : []),
    [ledgersData],
  );

  // ── Local UI state ─────────────────────────────────────────────────────────

  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<LedgerForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof LedgerForm, boolean>>>({});
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [filterGroup, setFilterGroup] = useState("");
  const [sortField, setSortField] = useState<"LHeadName" | "LHeadType" | "GroupName">("LHeadName");
  const [sortAsc, setSortAsc] = useState(true);

  // ── Mutations ──────────────────────────────────────────────────────────────

  const invalidate = () => qc.invalidateQueries({ queryKey: ["ledger-heads"] });

  const createMut = useMutation({
    mutationFn: createLedger,
    onSuccess: () => { 
      toast.success("Ledger account created"); 
      invalidate(); 
      resetForm(); 
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: updateLedger,
    onSuccess: () => { 
      toast.success("Ledger account updated"); 
      invalidate(); 
      resetForm(); 
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: deleteLedger,
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

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) setSortAsc((a) => !a);
    else { 
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
        (l.LHeadType ?? "").toLowerCase().includes(q);
      const matchGroup =
        !filterGroup || String(l.LBelongsTo) === filterGroup;
      return matchSearch && matchGroup;
    });

    return [...list].sort((a, b) => {
      const av = (sortField === "LHeadName"
        ? a.LHeadName
        : sortField === "LHeadType"
          ? a.LHeadType
          : a.GroupName) ?? "";
      const bv = (sortField === "LHeadName"
        ? b.LHeadName
        : sortField === "LHeadType"
          ? b.LHeadType
          : b.GroupName) ?? "";
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }, [ledgers, search, filterGroup, sortField, sortAsc]);

  // ── Sub-components ─────────────────────────────────────────────────────────

  const SortTh = ({
    label,
    field,
  }: {
    label: string;
    field: typeof sortField;
  }) => (
    <th
      className="text-xs font-semibold text-muted-foreground uppercase tracking-wide py-3 px-4 cursor-pointer select-none hover:text-foreground transition-colors"
      onClick={() => toggleSort(field)}
    >
      <div className="flex items-center gap-1">
        {label}
        <ChevronsUpDown
          size={11}
          className={sortField === field ? "text-primary" : "opacity-40"}
        />
      </div>
    </th>
  );

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
      <div className="rounded-xl border border-border bg-card mb-6">
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
                  errors.LHeadName ? "border-red-400 ring-red-400" : "border-border"
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
      </div>

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
              onClick={() => { setSearch(""); setFilterGroup(""); }}
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
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <SortTh label="Account Name" field="LHeadName" />
                <SortTh label="Type" field="LHeadType" />
                <SortTh label="Group" field="GroupName" />
                <th className="py-3 px-4 w-24" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {ledgersLoading ? (
                <tr>
                  <td colSpan={4} className="py-12 text-center">
                    <span className="text-sm text-muted-foreground animate-pulse">
                      Loading ledger accounts…
                    </span>
                  </td>
                </tr>
              ) : ledgersError ? (
                <tr>
                  <td colSpan={4} className="py-12 text-center">
                    <AlertCircle size={24} className="text-red-400 mx-auto mb-2" />
                    <p className="text-sm text-red-500">
                      Failed to load ledger accounts.
                    </p>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-12 text-center">
                    <BookOpen size={28} className="text-muted-foreground/30 mx-auto mb-3" />
                    {ledgers.length === 0 ? (
                      <>
                        <p className="text-sm text-muted-foreground">No ledger accounts yet.</p>
                        <p className="text-xs text-muted-foreground/70 mt-1">
                          Use the form above to create your first account.
                        </p>
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No results match your search.
                      </p>
                    )}
                  </td>
                </tr>
              ) : (
                filtered.map((l) => (
                  <tr
                    key={l.LHeadId}
                    className={`group border-b border-border hover:bg-muted/30 transition-colors ${
                      editingId === l.LHeadId ? "bg-primary/5" : ""
                    }`}
                  >
                    {/* Name */}
                    <td className="py-2.5 px-4">
                      <div className="flex items-center gap-2">
                        <BookOpen size={14} className="text-primary/40 shrink-0" />
                        <span className="text-sm font-medium text-foreground">
                          {l.LHeadName}
                        </span>
                      </div>
                    </td>

                    {/* Type */}
                    <td className="py-2.5 px-4">
                      {l.LHeadType ? (
                        <span className="text-xs font-mono bg-muted text-foreground/80 rounded px-2 py-0.5 flex items-center gap-1 w-fit">
                          <Tag size={10} className="text-muted-foreground" />
                          {l.LHeadType}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground/50">—</span>
                      )}
                    </td>

                    {/* Group */}
                    <td className="py-2.5 px-4">
                      {l.GroupName ? (
                        <span className="text-xs text-muted-foreground bg-muted/60 border border-border rounded-full px-2 py-0.5">
                          {l.GroupName}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground/50">—</span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="py-2.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => startEdit(l)}
                          className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                          aria-label="Edit account"
                          title="Edit"
                        >
                          <Pencil size={13} />
                        </button>

                        {deleteConfirm === l.LHeadId ? (
                          <>
                            <button
                              onClick={() => deleteMut.mutate(l.LHeadId)}
                              disabled={deleteMut.isPending}
                              className="w-7 h-7 flex items-center justify-center rounded text-red-500 hover:bg-red-50 disabled:opacity-50"
                              aria-label="Confirm delete"
                              title="Confirm delete"
                            >
                              <Check size={13} />
                            </button>
                            <button
                              onClick={() => setDeleteConfirm(null)}
                              className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:bg-muted"
                              aria-label="Cancel delete"
                              title="Cancel"
                            >
                              <X size={13} />
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => setDeleteConfirm(l.LHeadId)}
                            className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors"
                            aria-label="Delete account"
                            title="Delete"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
};

export default ExpensesMaster;

