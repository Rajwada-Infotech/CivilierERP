import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
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
} from "lucide-react";

interface AccountGroup {
  _id: string;
  name: string;
}

interface LedgerEntry {
  _id: string;
  name: string;
  shortCode: string;
  groupId: string;
}

const EMPTY_FORM = { name: "", shortCode: "", groupId: "" };

const GeneralLedgerMaster: React.FC = () => {
  const { data: groupsData, isLoading: groupsLoading } = useQuery({
    queryKey: ["account-groups"],
    queryFn: getAccountGroups,
  });

  const accountGroups: AccountGroup[] = useMemo(() => {
    if (!Array.isArray(groupsData)) return [];
    return (groupsData as any[]).map((item) => ({
      _id: String(item.LHeadId),
      name: item.LHeadName || "",
    }));
  }, [groupsData]);

  const [ledgers, setLedgers] = useState<LedgerEntry[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterGroup, setFilterGroup] = useState("");
  const [sortField, setSortField] = useState<"name" | "shortCode" | "group">(
    "name",
  );
  const [sortAsc, setSortAsc] = useState(true);

  const getGroupName = (groupId: string) =>
    accountGroups.find((g) => g._id === groupId)?.name ?? "—";

  const startEdit = (l: LedgerEntry) => {
    setEditingId(l._id);
    setForm({ name: l.name, shortCode: l.shortCode, groupId: l.groupId });
    setErrors({});
  };
  const resetForm = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setErrors({});
  };

  const handleSave = async () => {
    const e: Record<string, boolean> = {};
    if (!form.name.trim()) e.name = true;
    if (!form.shortCode.trim()) e.shortCode = true;
    if (Object.keys(e).length) {
      setErrors(e);
      return;
    }
    setSaving(true);
    await new Promise((r) => setTimeout(r, 250));
    if (editingId) {
      setLedgers((prev) =>
        prev.map((l) =>
          l._id === editingId
            ? {
                ...l,
                name: form.name.trim(),
                shortCode: form.shortCode.trim().toUpperCase(),
                groupId: form.groupId,
              }
            : l,
        ),
      );
      toast.success("Ledger account updated");
    } else {
      setLedgers((prev) => [
        {
          _id: `ledger-${Date.now()}`,
          name: form.name.trim(),
          shortCode: form.shortCode.trim().toUpperCase(),
          groupId: form.groupId,
        },
        ...prev,
      ]);
      toast.success("Ledger account created");
    }
    setSaving(false);
    resetForm();
  };

  const handleDelete = (id: string) => {
    setLedgers((prev) => prev.filter((l) => l._id !== id));
    toast.success("Deleted");
    setDeleteConfirm(null);
    if (editingId === id) resetForm();
  };

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) setSortAsc((a) => !a);
    else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  const filtered = useMemo(() => {
    let list = ledgers;
    const q = search.trim().toLowerCase();
    if (q)
      list = list.filter(
        (l) =>
          l.name.toLowerCase().includes(q) ||
          l.shortCode.toLowerCase().includes(q),
      );
    if (filterGroup) list = list.filter((l) => l.groupId === filterGroup);
    return [...list].sort((a, b) => {
      const av =
        sortField === "name"
          ? a.name
          : sortField === "shortCode"
            ? a.shortCode
            : getGroupName(a.groupId);
      const bv =
        sortField === "name"
          ? b.name
          : sortField === "shortCode"
            ? b.shortCode
            : getGroupName(b.groupId);
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }, [ledgers, search, filterGroup, sortField, sortAsc, accountGroups]);

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

  return (
    <>
      <Breadcrumbs items={["Masters", "General Ledger"]} />

      {/* ── Page header ── */}
      <div className="mb-6">
        <h1 className="text-xl font-heading font-bold text-foreground">
          General Ledger Master
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Define ledger accounts with a name, short code and account group
        </p>
      </div>

      {/* ── Form card ── */}
      <div className="rounded-xl border border-border bg-card mb-6">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">
            {editingId ? "Edit Account" : "Add General Ledger Account"}
          </h2>
          <p className="text-xs text-muted-foreground">
            {editingId
              ? "Modify the selected ledger account"
              : "Fill in the details to create a new record."}
          </p>
        </div>

        <div className="p-5">
          <div className="grid grid-cols-2 gap-x-6 gap-y-5">
            {/* Account Name */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-2">
                ACCOUNT NAME <span className="text-red-500">*</span>
              </label>
              <input
                value={form.name}
                onChange={(e) => {
                  setForm((p) => ({ ...p, name: e.target.value }));
                  setErrors((p) => ({ ...p, name: false }));
                }}
                placeholder="e.g. Cash in Hand"
                className={`w-full text-sm rounded-lg border px-3 py-2.5 bg-background text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition ${errors.name ? "border-red-400" : "border-border"}`}
              />
              {errors.name && (
                <p className="text-xs text-red-500 mt-1">Required</p>
              )}
            </div>

            {/* Short Code */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-2">
                SHORT CODE <span className="text-red-500">*</span>
              </label>
              <input
                value={form.shortCode}
                onChange={(e) => {
                  setForm((p) => ({
                    ...p,
                    shortCode: e.target.value.toUpperCase(),
                  }));
                  setErrors((p) => ({ ...p, shortCode: false }));
                }}
                placeholder="e.g. CASH"
                maxLength={12}
                className={`w-full text-sm rounded-lg border px-3 py-2.5 bg-background text-foreground font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition ${errors.shortCode ? "border-red-400" : "border-border"}`}
              />
              {errors.shortCode && (
                <p className="text-xs text-red-500 mt-1">Required</p>
              )}
            </div>

            {/* Account Group */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-2">
                ACCOUNT GROUP
              </label>
              {groupsLoading ? (
                <div className="w-full text-sm rounded-lg border border-border px-3 py-2.5 bg-muted/40 text-muted-foreground">
                  Loading…
                </div>
              ) : (
                <div className="relative">
                  <select
                    value={form.groupId}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, groupId: e.target.value }))
                    }
                    className="w-full text-sm rounded-lg border border-border px-3 py-2.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition appearance-none"
                  >
                    <option value="">Select...</option>
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
              <X size={11} />
              Clear
            </button>
          )}
          <span className="ml-auto text-xs text-muted-foreground bg-muted/60 rounded-lg px-3 py-1.5">
            {ledgers.length} Accounts
          </span>
        </div>

        <div className="rounded-xl border border-border overflow-hidden bg-card">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <SortTh label="Account Name" field="name" />
                <SortTh label="Short Code" field="shortCode" />
                <SortTh label="Group" field="group" />
                <th className="py-3 px-4 w-24" />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
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
                    key={l._id}
                    className={`group border-b border-border hover:bg-muted/30 transition-colors ${editingId === l._id ? "bg-primary/5" : ""}`}
                  >
                    <td className="py-2.5 px-4">
                      <div className="flex items-center gap-2">
                        <BookOpen
                          size={14}
                          className="text-primary/40 shrink-0"
                        />
                        <span className="text-sm font-medium text-foreground">
                          {l.name}
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 px-4">
                      <span className="text-xs font-mono bg-muted text-foreground/80 rounded px-2 py-0.5 flex items-center gap-1 w-fit">
                        <Tag size={10} className="text-muted-foreground" />
                        {l.shortCode}
                      </span>
                    </td>
                    <td className="py-2.5 px-4">
                      {l.groupId ? (
                        <span className="text-xs text-muted-foreground bg-muted/60 border border-border rounded-full px-2 py-0.5">
                          {getGroupName(l.groupId)}
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
                        {deleteConfirm === l._id ? (
                          <>
                            <button
                              onClick={() => handleDelete(l._id)}
                              className="w-7 h-7 flex items-center justify-center rounded text-red-500 hover:bg-red-50"
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
                            onClick={() => setDeleteConfirm(l._id)}
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
      </div>
    </>
  );
};

export default GeneralLedgerMaster;
