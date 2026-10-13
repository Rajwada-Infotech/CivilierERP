import React, { useState, useMemo, useEffect, useRef } from "react";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import TreeDropdown from "@/components/common/TreeDropdown";
import { GroupTreePicker } from "@/components/common/GroupTreePicker";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAccountGroups } from "@/api/accountApi";
import { usePageRights } from "@/hooks/usePageRights";
import { useDraftForm, preventEnterSubmit } from "@/hooks/useDraftForm";
import {
  getLedgers,
  addLedger,
  updateLedger as updateLedgerApi,
  deleteLedger as deleteLedgerApi,
} from "@/api/generalLedgerApi";
import { toast } from "sonner";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ExportMenu } from "@/components/ExportMenu";
import type { ExportColumn } from "@/lib/export";
import { Pencil, Trash2, X, Check, Plus, Search, BookOpen, Eye, RotateCcw, Lock } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { BodyPortal } from "@/components/ui/body-portal";

// ─── Types ────────────────────────────────────────────────────────────────────
interface AccountGroup {
  _id: string;        // String(AGId)
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

interface LedgerHead {
  LHeadId: number;
  LHeadName: string;
  LHeadCode: string | null;
  LBelongsTo: number | null;
  GroupName: string | null;
  LHeadStatus: boolean;
  IsSystemGenerated: boolean;
}

interface LedgerForm {
  LHeadName: string;
  LHeadCode: string;
  LBelongsTo: string;
  IsSystemGenerated: boolean;
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
  IsSystemGenerated: false,
};


const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const RULE = "1px solid hsl(var(--foreground))";
const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const ACT = "w-7 h-7 flex items-center justify-center border border-transparent text-muted-foreground hover:text-foreground hover:border-foreground transition-colors";

// ─── Column builder ────────────────────────────────────────────────────────────
function buildGLColumns(
  _editingId: number | null,
  deleteConfirm: number | null,
  setDeleteConfirm: (id: number | null) => void,
  startEdit: (l: LedgerHead) => void,
  deleteMut: { mutate: (id: number) => void },
  onView: (l: LedgerHead) => void,
  canEdit: boolean,
  canDelete: boolean,
  isSuperAdmin: boolean,
): ColumnDef<LedgerHead, unknown>[] {
  return [
    {
      accessorKey: "LHeadCode",
      header: "Code",
      cell: ({ getValue }) => (
        <span className="font-heading text-[0.6875rem] font-semibold tabular-nums text-foreground">{(getValue() as string) || "—"}</span>
      ),
    },
    {
      accessorKey: "LHeadName",
      header: "Account Name",
      cell: ({ row, getValue }) => (
        <div className="flex items-baseline gap-2.5">
          <span className="font-medium text-foreground">{getValue() as string}</span>
          {row.original.IsSystemGenerated && (
            <span className={`${LBL} inline-flex items-center gap-1`} title="System-generated: protected">
              <Lock size={9} /> System
            </span>
          )}
        </div>
      ),
    },
    {
      accessorKey: "GroupName",
      header: "Account Group",
      cell: ({ getValue }) => <span className="text-xs text-muted-foreground">{(getValue() as string) || "—"}</span>,
    },
    {
      accessorKey: "LHeadStatus",
      header: "Status",
      cell: ({ getValue }) => {
        const active = getValue() as boolean;
        return <SheetMark text={active ? "Active" : "Inactive"} tone={active ? "done" : "none"} />;
      },
    },
    {
      id: "actions",
      header: "Actions",
      enableSorting: false,
      cell: ({ row }) => {
        const id = row.original.LHeadId;
        if (deleteConfirm === id) {
          return (
            <div className="flex items-center gap-1 justify-end">
              <button
                onClick={() => deleteMut.mutate(id)}
                className="h-7 px-2 flex items-center gap-1 border border-destructive bg-destructive text-destructive-foreground font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em]"
                title="Confirm delete"
              >
                <Check size={12} /> Delete
              </button>
              <button onClick={() => setDeleteConfirm(null)} className={ACT} title="Keep" aria-label="Keep">
                <X size={13} />
              </button>
            </div>
          );
        }
        return (
          <div className="flex items-center justify-end gap-1">
            <button data-row-view onClick={() => onView(row.original)} className={ACT} title="View details" aria-label="View details">
              <Eye size={13} />
            </button>
            {canEdit && (
              <button onClick={() => startEdit(row.original)} className={ACT} title="Edit" aria-label="Edit">
                <Pencil size={13} />
              </button>
            )}
            {canDelete && (
              row.original.IsSystemGenerated && !isSuperAdmin ? (
                <span className="w-7 h-7 flex items-center justify-center text-muted-foreground/40 cursor-not-allowed" title="System-generated: only Super Admin can delete">
                  <Lock size={13} />
                </span>
              ) : (
                <button
                  onClick={() => setDeleteConfirm(id)}
                  className="w-7 h-7 flex items-center justify-center border border-transparent text-muted-foreground hover:text-destructive hover:border-destructive transition-colors"
                  title="Delete"
                  aria-label="Delete"
                >
                  <Trash2 size={13} />
                </button>
              )
            )}
          </div>
        );
      },
    },
  ];
}

// ─── Component ────────────────────────────────────────────────────────────────
const GeneralLedgerMaster: React.FC = () => {
  const qc = useQueryClient();
  const rights = usePageRights("general-ledger");
  const { currentUser } = useAuth();
  const isSuperAdmin = currentUser?.role === "super_admin";
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useDraftForm<LedgerForm>("general-ledger-master", EMPTY_FORM, {
    skip: editingId !== null,
  });
  const [errors, setErrors] = useState<
    Partial<Record<keyof LedgerForm, boolean>>
  >({});
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [viewRecord, setViewRecord] = useState<LedgerHead | null>(null);

  const [search, setSearch] = useState("");
  const [filterGroup, setFilterGroup] = useState("");
  const [page, setPage] = useState(1);
  // Chart of accounts is bounded/human-curated (hundreds, not the
  // hundreds-of-thousands a real transactional table can reach) — one
  // request for "basically everything" (backend caps at 2000) instead of
  // 10-at-a-time, so DataTable's own pagination below is the only paging
  // control a user sees instead of two disagreeing ones stacked on each
  // other.
  const limit = 2000;
  const [sortField] = useState<
    "LHeadName" | "LHeadCode" | "GroupName"
  >("LHeadName");
  const [sortAsc] = useState(true);

  useEffect(() => {
    setPage(1);
  }, [search, filterGroup]);

  const ledgerExportColumns: ExportColumn[] = useMemo(
    () => [
      { header: "Code", accessor: "LHeadCode" },
      { header: "Account Name", accessor: "LHeadName" },
      { header: "Account Group", accessor: "GroupName" },
      {
        header: "Status",
        accessor: (row: any) => (row.LHeadStatus ? "Active" : "Inactive"),
      },
    ],
    [],
  );

  const fetchAllLedgersForExport = async () => {
    // Backend caps `limit` at 100 per request — page through until every
    // matching row (across all filters) has been pulled, not just the
    // currently-visible page.
    const EXPORT_PAGE_SIZE = 100;
    const first = await getLedgers({
      page: 1,
      limit: EXPORT_PAGE_SIZE,
      search,
      groupId: filterGroup,
    });
    let all = [...first.data];
    for (let p = 2; p <= first.totalPages; p++) {
      const next = await getLedgers({
        page: p,
        limit: EXPORT_PAGE_SIZE,
        search,
        groupId: filterGroup,
      });
      all = all.concat(next.data);
    }
    return all as unknown as Record<string, unknown>[];
  };

  // ── Remote data ────────────────────────────────────────────────────────────
  const { data: groupsData, isLoading: groupsLoading } = useQuery({
    queryKey: ["account-groups"],
    queryFn: getAccountGroups,
    staleTime: 5 * 60 * 1000,
  });

  const {
    data: ledgersData,
    isLoading: ledgersLoading,
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
        code: item.Code || "",
        parentId: item.ParentGroupId ? String(item.ParentGroupId) : null,
      }));
  }, [groupsData]);

  const accountGroupTree = useMemo(() => buildTree(accountGroups), [accountGroups]);

  const ledgers: LedgerHead[] = useMemo(
    () => ledgersData?.data ?? [],
    [ledgersData],
  );
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
        IsSystemGenerated: data.IsSystemGenerated,
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
        IsSystemGenerated: data.IsSystemGenerated,
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
      IsSystemGenerated: !!l.IsSystemGenerated,
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
        rights.canEdit,
        rights.canDelete,
        isSuperAdmin,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editingId, deleteConfirm, rights.canEdit, rights.canDelete],
  );

  const isDirty = Object.keys(form).some((k) => String((form as unknown as Record<string,unknown>)[k] ?? "") !== String((EMPTY_FORM as unknown as Record<string,unknown>)[k] ?? ""));
  const canSave = form.LHeadName.trim() !== "" && !!form.LBelongsTo;

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
  const inputCls = (bad?: boolean) =>
    `w-full h-10 text-sm px-3 bg-card text-foreground placeholder:text-muted-foreground/50 focus:outline-none border ${
      bad ? "border-destructive" : "border-foreground/40 focus:border-foreground"
    }`;
  const activeCount = ledgers.filter((l) => l.LHeadStatus).length;
  const systemCount = ledgers.filter((l) => l.IsSystemGenerated).length;

  return (
    <>
      <Breadcrumbs items={["Masters", "General Ledger"]} />

      <SheetShell
        eyebrow="CivilierERP · Masters"
        title="General ledger"
        subtitle="The ledger accounts money is posted to: each with a name, a short code and the account group it sits in."
      >
        {/* ── Figures ── */}
        <div className="bg-card" style={{ border: RULE }}>
          <div className="statrow" style={{ padding: "16px 16px 18px" }}>
            {[
              { label: "Accounts", value: totalRecords, note: search || filterGroup ? "matching the filter" : "in all" },
              { label: "Active", value: activeCount, note: "open for posting" },
              { label: "System", value: systemCount, note: "protected accounts" },
            ].map((x) => (
              <div key={x.label}>
                <p className="label">{x.label}</p>
                <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{x.value.toLocaleString("en-IN")}</p>
                <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Form ── */}
        {(rights.canCreate || (rights.canEdit && editingId !== null)) && (
          <div className="bg-card relative" onKeyDown={preventEnterSubmit} style={{ border: RULE, zIndex: 10 }}>
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3" style={{ borderBottom: RULE }}>
              <h2 className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground">
                {editingId ? "Edit ledger account" : "Add ledger account"}
              </h2>
              <p className="text-[0.6875rem] text-muted-foreground">
                Fields marked <span className="text-destructive">*</span> are required
              </p>
            </div>

            <div className="px-4 py-5 grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-5">
              {/* Account Name */}
              <div>
                <label className={`${LBL} block mb-1.5`}>
                  Account name <span className="text-destructive">*</span>
                </label>
                <input
                  value={form.LHeadName}
                  onChange={(e) => {
                    setForm((p) => ({ ...p, LHeadName: e.target.value }));
                    setErrors((p) => ({ ...p, LHeadName: false }));
                  }}
                  placeholder="e.g. Cash in Hand"
                  className={inputCls(errors.LHeadName)}
                />
                {errors.LHeadName && <p className="text-xs text-destructive mt-1">Required</p>}
              </div>

              {/* Short Code */}
              <div>
                <label className={`${LBL} block mb-1.5`}>Short code</label>
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
                  className={`${inputCls()} font-heading font-semibold tabular-nums tracking-wide`}
                />
                <p className="text-[0.6875rem] text-muted-foreground mt-1.5">Made from the account name; you can type your own.</p>
              </div>

              {/* Account Group */}
              <div>
                <label className={`${LBL} block mb-1.5`}>
                  Account group <span className="text-destructive">*</span>
                </label>
                {groupsLoading ? (
                  <div className="w-full h-10 flex items-center text-sm border border-foreground/40 px-3 text-muted-foreground">Loading…</div>
                ) : (
                  <>
                    <GroupTreePicker
                      value={form.LBelongsTo}
                      onChange={(v) => {
                        setForm((p) => ({ ...p, LBelongsTo: v }));
                        setErrors((p) => ({ ...p, LBelongsTo: false }));
                      }}
                      tree={accountGroupTree}
                      allGroups={accountGroups}
                      error={errors.LBelongsTo}
                    />
                    {errors.LBelongsTo && <p className="text-xs text-destructive mt-1">Please select an account group</p>}
                  </>
                )}
              </div>

              {/* System Generated — super_admin only */}
              {isSuperAdmin && (
                <label className="sm:col-span-3 flex items-center gap-2.5 cursor-pointer select-none w-fit">
                  <input
                    type="checkbox"
                    checked={form.IsSystemGenerated}
                    onChange={() => setForm((p) => ({ ...p, IsSystemGenerated: !p.IsSystemGenerated }))}
                    className="accent-foreground w-3.5 h-3.5"
                  />
                  <span className="text-xs text-foreground font-medium">System account</span>
                  <span className="text-xs text-muted-foreground">
                    {form.IsSystemGenerated ? "protected: only Super Admin can delete it" : "not protected"}
                  </span>
                </label>
              )}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-4 py-3" style={{ borderTop: RULE }}>
              <div className="hidden sm:block">
                {canSave ? <SheetMark text="Ready to save" tone="done" /> : <span className="text-[0.6875rem] text-muted-foreground">Fill in the required fields to save</span>}
              </div>
              <div className="flex items-center gap-2 sm:ml-auto">
                <button
                  onClick={resetForm}
                  disabled={!isDirty && !editingId}
                  className={`${KEY} flex-1 sm:flex-none h-9 px-4 border border-foreground text-foreground hover:bg-primary/10`}
                >
                  <RotateCcw size={12} />
                  {editingId ? "Cancel" : "Reset"}
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !canSave}
                  className={`${KEY} flex-1 sm:flex-none h-9 px-5 bg-foreground text-card border border-foreground whitespace-nowrap`}
                >
                  {saving ? (
                    <span className="w-3.5 h-3.5 border-2 border-card/30 border-t-card rounded-full animate-spin" />
                  ) : editingId ? (
                    <Check size={13} />
                  ) : (
                    <Plus size={13} />
                  )}
                  {saving ? "Saving…" : editingId ? "Update account" : "Save account"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── The accounts ── */}
        <div className="bg-card" style={{ border: RULE }}>
          <div className="px-4 py-3 flex items-center gap-3 flex-wrap" style={{ borderBottom: RULE }}>
            <div className="relative flex-1 sm:flex-none">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or code…"
                className="w-full sm:w-56 h-9 text-sm border border-foreground/40 focus:border-foreground pl-9 pr-3 bg-card text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
              />
            </div>

            <TreeDropdown
              variant="flat"
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
                className={`${KEY} h-9 px-3 border border-foreground/40 text-muted-foreground hover:text-foreground hover:border-foreground`}
              >
                <X size={11} /> Clear
              </button>
            )}

            <div className="ml-auto">
              <ExportMenu
                data={filtered as unknown as Record<string, unknown>[]}
                fetchData={fetchAllLedgersForExport}
                columns={ledgerExportColumns}
                title="General Ledger Master"
                filename="general-ledger-master"
                disabled={!rights.canExport || (ledgersData?.total ?? 0) === 0}
              />
            </div>
          </div>

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
              row.original.LHeadId === editingId ? "shadow-[inset_3px_0_0_hsl(var(--primary))]" : ""
            }
          />
        </div>
      </SheetShell>

      {/* ── View Detail Drawer ── */}
      {viewRecord && (
        <BodyPortal><div className="fixed inset-0 z-[60] flex justify-end">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setViewRecord(null)} />
          <div
            className="sheet-frame relative w-full max-w-sm bg-card flex flex-col animate-in slide-in-from-right duration-200"
            style={{ margin: 0, borderLeft: RULE }}
          >
            <div className="flex items-end justify-between gap-3 px-5 py-4" style={{ borderBottom: RULE }}>
              <div className="min-w-0">
                <p className={LBL}>Ledger account</p>
                <h3 className="font-heading text-lg font-bold tracking-tight text-foreground mt-1 break-words">{viewRecord.LHeadName}</h3>
              </div>
              <button onClick={() => setViewRecord(null)} className="p-1.5 text-muted-foreground hover:text-foreground transition-colors" aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <div className="p-5 space-y-5 overflow-y-auto flex-1">
              <div>
                <p className={LBL}>Short code</p>
                <p className="font-heading text-sm font-semibold tabular-nums text-foreground mt-1">{viewRecord.LHeadCode || "—"}</p>
              </div>
              <div>
                <p className={LBL}>Account group</p>
                <p className={`text-sm mt-1 ${viewRecord.GroupName ? "text-foreground" : "text-muted-foreground"}`}>{viewRecord.GroupName || "No group assigned"}</p>
              </div>
              <div>
                <p className={`${LBL} mb-1.5`}>Status</p>
                <SheetMark text={viewRecord.LHeadStatus ? "Active" : "Inactive"} tone={viewRecord.LHeadStatus ? "done" : "none"} />
              </div>
              {viewRecord.IsSystemGenerated && (
                <div>
                  <p className={LBL}>Protection</p>
                  <p className="text-sm text-foreground mt-1 flex items-center gap-1.5">
                    <Lock size={12} /> System account: only Super Admin can delete it
                  </p>
                </div>
              )}
            </div>
            <div className="px-5 py-3 flex justify-end gap-2" style={{ borderTop: RULE }}>
              <button onClick={() => setViewRecord(null)} className={`${KEY} h-9 px-4 border border-foreground text-foreground hover:bg-primary/10`}>
                Close
              </button>
              {rights.canEdit && (
                <button
                  onClick={() => {
                    startEdit(viewRecord);
                    setViewRecord(null);
                  }}
                  className={`${KEY} h-9 px-4 bg-foreground text-card border border-foreground`}
                >
                  <Pencil size={12} /> Edit account
                </button>
              )}
            </div>
          </div>
        </div></BodyPortal>
      )}
    </>
  );
};

export default GeneralLedgerMaster;
