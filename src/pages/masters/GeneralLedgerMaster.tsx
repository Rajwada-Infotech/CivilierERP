import React, { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAccountGroups } from "@/api/accountApi";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
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
  Hash,
  ChevronDown,
  ChevronsUpDown,
  AlertCircle,
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

const BASE_URL = "/api/general-ledger";

// ─── API Functions ───────────────────────────────────────────────────────────
const fetchLedgers = async ({
  page,
  limit,
  search,
  groupId,
}: {
  page: number;
  limit: number;
  search?: string;
  groupId?: string;
}): Promise<PaginatedResponse<LedgerHead>> => {
  const qs = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });
  if (search?.trim()) qs.set("search", search.trim());
  if (groupId) qs.set("groupId", groupId);

  const res = await fetchWithAuth(`${BASE_URL}?${qs.toString()}`);
  if (!res.ok) throw new Error(`Failed to fetch ledgers: ${res.status}`);
  const payload = await res.json();
  if (Array.isArray(payload)) {
    return {
      data: payload,
      page: 1,
      limit: payload.length,
      total: payload.length,
      totalPages: 1,
    };
  }
  return {
    data: Array.isArray(payload?.data) ? payload.data : [],
    page: Number(payload?.page || 1),
    limit: Number(payload?.limit || limit),
    total: Number(payload?.total || payload?.data?.length || 0),
    totalPages: Number(payload?.totalPages || 1),
  };
};

const createLedger = async (data: LedgerForm) => {
  const res = await fetchWithAuth(BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      LHeadName: data.LHeadName.trim(),
      LHeadCode: data.LHeadCode.trim().toUpperCase() || null,
      LBelongsTo: data.LBelongsTo ? Number(data.LBelongsTo) : null,
    }),
  });
  if (!res.ok) {
    const e = await res.json();
    throw new Error(e.error || "Failed to create");
  }
  return res.json();
};

const updateLedger = async ({ id, data }: { id: number; data: LedgerForm }) => {
  const res = await fetchWithAuth(`${BASE_URL}/${id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
      body: JSON.stringify({
      LHeadName: data.LHeadName.trim(),
      LHeadCode: data.LHeadCode.trim().toUpperCase() || null,
      LBelongsTo: data.LBelongsTo ? Number(data.LBelongsTo) : null,
    }),
  });
  if (!res.ok) {
    const e = await res.json();
    throw new Error(e.error || "Failed to update");
  }
  return res.json();
};

const deleteLedger = async (id: number) => {
  const res = await fetchWithAuth(`${BASE_URL}/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const e = await res.json();
    throw new Error(e.error || "Failed to delete");
  }
  return res.json();
};

// ─── Component ────────────────────────────────────────────────────────────────
const GeneralLedgerMaster: React.FC = () => {
  const qc = useQueryClient();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<LedgerForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<
    Partial<Record<keyof LedgerForm, boolean>>
  >({});
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
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
    queryFn: () => fetchLedgers({ page, limit, search, groupId: filterGroup }),
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

  const resetForm = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setErrors({});
    hasManuallyEditedCode.current = false;
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

      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-xl font-heading font-bold text-foreground">
          General Ledger Master
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Define ledger accounts with a name, short code and account group
        </p>
      </div>

      {/* Form Card */}
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
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-2">
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
              <p className="text-[11px] text-muted-foreground mt-1">
                Auto-generated from account name (you can override manually)
              </p>
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

          {/* Form Actions */}
          <div className="flex items-center gap-3 mt-6 pt-5 border-t border-border">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-60 transition-opacity flex items-center gap-2"
            >
              {saving ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Saving…
                </>
              ) : editingId ? (
                <>
                  <Check size={14} /> Update Account
                </>
              ) : (
                <>
                  <Plus size={14} /> Save Account
                </>
              )}
            </button>

            {editingId && (
              <button
                onClick={resetForm}
                className="px-5 py-2.5 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition-colors flex items-center gap-2"
              >
                <RotateCcw size={13} /> Cancel
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Table Section */}
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
              placeholder="Search name or code…"
              className="w-56 text-sm rounded-lg border border-border pl-9 pr-3 py-2 bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
            />
          </div>

          <div className="relative">
            <select
              value={filterGroup}
              onChange={(e) => setFilterGroup(e.target.value)}
              className="text-sm rounded-lg border border-border pl-3 pr-8 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition appearance-none"
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
            >
              <X size={11} /> Clear
            </button>
          )}

          <span className="ml-auto text-xs text-muted-foreground bg-muted/60 rounded-lg px-3 py-1.5">
            {totalRecords} Accounts
          </span>
        </div>

        {/* Table */}
        <div className="rounded-xl border border-border overflow-hidden bg-card">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th
                  className="text-xs font-semibold text-muted-foreground uppercase tracking-wide py-3 px-4 cursor-pointer select-none hover:text-foreground transition-colors"
                  onClick={() => toggleSort("LHeadName")}
                >
                  <div className="flex items-center gap-1">
                    Account Name
                    <ChevronsUpDown
                      size={11}
                      className={
                        sortField === "LHeadName"
                          ? "text-primary"
                          : "opacity-40"
                      }
                    />
                  </div>
                </th>
                <th
                  className="text-xs font-semibold text-muted-foreground uppercase tracking-wide py-3 px-4 cursor-pointer select-none hover:text-foreground transition-colors"
                  onClick={() => toggleSort("LHeadCode")}
                >
                  <div className="flex items-center gap-1">
                    Code
                    <ChevronsUpDown
                      size={11}
                      className={
                        sortField === "LHeadCode"
                          ? "text-primary"
                          : "opacity-40"
                      }
                    />
                  </div>
                </th>
                <th
                  className="text-xs font-semibold text-muted-foreground uppercase tracking-wide py-3 px-4 cursor-pointer select-none hover:text-foreground transition-colors"
                  onClick={() => toggleSort("GroupName")}
                >
                  <div className="flex items-center gap-1">
                    Group
                    <ChevronsUpDown
                      size={11}
                      className={
                        sortField === "GroupName"
                          ? "text-primary"
                          : "opacity-40"
                      }
                    />
                  </div>
                </th>
                <th className="py-3 px-4 w-24" />
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
                    <AlertCircle
                      size={24}
                      className="text-red-400 mx-auto mb-2"
                    />
                    <p className="text-sm text-red-500">
                      Failed to load ledger accounts.
                    </p>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-12 text-center">
                    <BookOpen
                      size={28}
                      className="text-muted-foreground/30 mx-auto mb-3"
                    />
                    {ledgers.length === 0 ? (
                      <>
                        <p className="text-sm text-muted-foreground">
                          No ledger accounts yet.
                        </p>
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
                    <td className="py-2.5 px-4">
                      <div className="flex items-center gap-2">
                        <BookOpen
                          size={14}
                          className="text-primary/40 shrink-0"
                        />
                        <span className="text-sm font-medium text-foreground">
                          {l.LHeadName}
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 px-4">
                      {l.LHeadCode ? (
                        <span className="text-xs font-mono bg-muted text-foreground/80 rounded px-2 py-0.5 flex items-center gap-1 w-fit">
                          <Hash size={10} className="text-muted-foreground" />
                          {l.LHeadCode}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground/50">
                          —
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-4">
                      {l.GroupName ? (
                        <span className="text-xs text-muted-foreground bg-muted/60 border border-border rounded-full px-2 py-0.5">
                          {l.GroupName}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground/50">
                          —
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => startEdit(l)}
                          className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                        >
                          <Pencil size={13} />
                        </button>

                        {deleteConfirm === l.LHeadId ? (
                          <>
                            <button
                              onClick={() => deleteMut.mutate(l.LHeadId)}
                              disabled={deleteMut.isPending}
                              className="w-7 h-7 flex items-center justify-center rounded text-red-500 hover:bg-red-50 disabled:opacity-50"
                            >
                              <Check size={13} />
                            </button>
                            <button
                              onClick={() => setDeleteConfirm(null)}
                              className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:bg-muted"
                            >
                              <X size={13} />
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => setDeleteConfirm(l.LHeadId)}
                            className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors"
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
        <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm">
          <span className="text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(p - 1, 1))}
              disabled={page <= 1}
              className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-50"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
              disabled={page >= totalPages}
              className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default GeneralLedgerMaster;
