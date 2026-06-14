import { useMemo, useState } from "react";
import { filterProjectsByCompany } from "@/lib/projectBelongsTo";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  RefreshCw,
  Search,
  X,
  HardHat,
  ChevronDown,
  Pencil,
  Trash2,
  MoreHorizontal,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Send,
  Clock,
  AlertCircle,
  Calendar as CalendarIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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

type CUStatus = "Draft" | "Sent" | "Acknowledged" | "Disputed";

interface ConstructionUpdate {
  Id: number;
  UpdateNo: string;
  ApplicantId: number;
  ApplicantNo: string | null;
  ApplicantName: string;
  UnitSelectionId: number | null;
  SelectionNo: string | null;
  UnitNo: string | null;
  ProjectId: number | null;
  ProjectName: string | null;
  CompanyId: number | null;
  CompanyName: string | null;
  UpdateDate: string;
  Stage: string | null;
  PercentComplete: number | null;
  Description: string | null;
  SharedWith: string | null;
  SharedOn: string | null;
  MediaLinks: string | null;
  Status: CUStatus;
  Notes: string | null;
  CreatedBy: string;
  CreatedAt: string;
}

interface MetaOptions {
  applicants: {
    Id: number;
    ApplicantNo: string | null;
    ApplicantName: string;
  }[];
  unitSelections: {
    Id: number;
    SelectionNo: string;
    UnitNo: string;
    ApplicantId: number;
    ProjectId: number | null;
    CompanyId: number | null;
  }[];
  projects: { Id: number; Name: string }[];
  companies: { Id: number; Name: string }[];
  statusOptions: CUStatus[];
  stageOptions: string[];
}

interface FormState {
  ApplicantId: string;
  UnitSelectionId: string;
  ProjectId: string;
  CompanyId: string;
  UpdateDate: string;
  Stage: string;
  PercentComplete: string;
  Description: string;
  SharedWith: string;
  SharedOn: string;
  MediaLinks: string;
  Status: CUStatus;
  Notes: string;
}

const EMPTY_FORM: FormState = {
  ApplicantId: "",
  UnitSelectionId: "",
  ProjectId: "",
  CompanyId: "",
  UpdateDate: new Date().toISOString().slice(0, 10),
  Stage: "",
  PercentComplete: "",
  Description: "",
  SharedWith: "",
  SharedOn: "",
  MediaLinks: "",
  Status: "Draft",
  Notes: "",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
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

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_META: Record<
  CUStatus,
  { label: string; icon: React.ReactNode; cls: string }
> = {
  Draft: { label: "Draft", icon: <Clock size={11} />, cls: "cu-badge-draft" },
  Sent: { label: "Sent", icon: <Send size={11} />, cls: "cu-badge-sent" },
  Acknowledged: {
    label: "Acknowledged",
    icon: <CheckCircle2 size={11} />,
    cls: "cu-badge-acknowledged",
  },
  Disputed: {
    label: "Disputed",
    icon: <AlertCircle size={11} />,
    cls: "cu-badge-disputed",
  },
};

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
    <div className="cu-combo">
      <button
        type="button"
        className={`cu-combo-trigger${open ? " open" : ""}${!value ? " empty" : ""}${disabled ? " disabled" : ""}`}
        onClick={() => {
          if (!disabled) {
            setOpen((v) => !v);
            setQ("");
          }
        }}
      >
        <span className="cu-combo-left">
          {selected ? (
            <span className="cu-combo-val">{selected.label}</span>
          ) : (
            <span className="cu-combo-placeholder">{placeholder}</span>
          )}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {value && !disabled && (
            <span
              className="cu-combo-clear"
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
            className={`cu-combo-chevron${open ? " open" : ""}`}
          />
        </span>
      </button>
      {open && (
        <div className="cu-combo-drop">
          <div className="cu-combo-search-wrap">
            <Search size={13} />
            <input
              className="cu-combo-search"
              placeholder="Search…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoFocus
            />
          </div>
          <div className="cu-combo-list">
            {filtered.length === 0 ? (
              <div className="cu-combo-empty">No results</div>
            ) : (
              filtered.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={`cu-combo-item${value === item.value ? " selected" : ""}`}
                  onClick={() => {
                    onChange(item.value);
                    setOpen(false);
                    setQ("");
                  }}
                >
                  <span className="cu-combo-item-label">{item.label}</span>
                  {item.sub && (
                    <span className="cu-combo-item-sub">{item.sub}</span>
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

// ─── Progress Bar ─────────────────────────────────────────────────────────────

function ProgressBar({ pct }: { pct: number | null }) {
  if (pct === null)
    return (
      <span style={{ color: "hsl(var(--muted-foreground))", fontSize: 12 }}>
        —
      </span>
    );
  const color =
    pct >= 80 ? "#059669" : pct >= 50 ? "#d97706" : "hsl(var(--primary))";
  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 100 }}
    >
      <div
        style={{
          flex: 1,
          height: 6,
          background: "hsl(var(--muted))",
          borderRadius: 4,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: color,
            borderRadius: 4,
            transition: "width 0.3s",
          }}
        />
      </div>
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: "hsl(var(--foreground))",
          minWidth: 32,
        }}
      >
        {pct}%
      </span>
    </div>
  );
}

// ─── API ──────────────────────────────────────────────────────────────────────

async function fetchMeta(): Promise<MetaOptions> {
  const res = await fetchWithAuth(
    "/api/followup-construction-updates/meta/options",
  );
  if (!res.ok) throw new Error("Failed to load options");
  return res.json();
}

async function fetchUpdates(params: {
  page: number;
  pageSize: number;
  search: string;
  status: string;
}) {
  const q = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
    ...(params.search ? { search: params.search } : {}),
    ...(params.status ? { status: params.status } : {}),
  });
  const res = await fetchWithAuth(`/api/followup-construction-updates?${q}`);
  if (!res.ok) throw new Error("Failed to load updates");
  return res.json() as Promise<{
    data: ConstructionUpdate[];
    pagination: {
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
    };
  }>;
}

async function createUpdate(payload: Record<string, unknown>) {
  const res = await fetchWithAuth("/api/followup-construction-updates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error || "Failed to create update",
    );
  }
}

async function updateRecord(id: number, payload: Record<string, unknown>) {
  const res = await fetchWithAuth(`/api/followup-construction-updates/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error || "Failed to update record",
    );
  }
}

async function deleteUpdate(id: number) {
  const res = await fetchWithAuth(`/api/followup-construction-updates/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete update");
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function ConstructionUpdatesPage() {
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  const canDeleteRecords = currentUser?.role !== "engineer";

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<CUStatus | "">("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);

  const { data: meta } = useQuery({
    queryKey: ["cu-meta"],
    queryFn: fetchMeta,
    staleTime: 5 * 60 * 1000,
  });

  const {
    data: result,
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ["construction-updates", page, search, statusFilter],
    queryFn: () =>
      fetchUpdates({ page, pageSize: PAGE_SIZE, search, status: statusFilter }),
    placeholderData: (prev) => prev,
  });

  const updates = result?.data ?? [];
  const pagination = result?.pagination;

  // ── Combobox items ──
  const applicantItems: ComboItem[] = useMemo(
    () =>
      (meta?.applicants ?? []).map((a) => ({
        value: String(a.Id),
        label: a.ApplicantName,
        sub: a.ApplicantNo ?? undefined,
      })),
    [meta],
  );

  const unitItems: ComboItem[] = useMemo(() => {
    const all = meta?.unitSelections ?? [];
    const filtered = form.ApplicantId
      ? all.filter((u) => String(u.ApplicantId) === form.ApplicantId)
      : all;
    return filtered.map((u) => ({
      value: String(u.Id),
      label: u.UnitNo,
      sub: u.SelectionNo,
    }));
  }, [meta, form.ApplicantId]);

  const projectItems: ComboItem[] = useMemo(
    () =>
      filterProjectsByCompany(meta?.projects ?? [], form.CompanyId).map(
        (p) => ({
          value: String(p.Id),
          label: p.Name,
        }),
      ),
    [meta, form.CompanyId],
  );

  const companyItems: ComboItem[] = useMemo(
    () =>
      (meta?.companies ?? []).map((c) => ({
        value: String(c.Id),
        label: c.Name,
      })),
    [meta],
  );

  const stageOptions = meta?.stageOptions ?? [];
  const statusOptions: Array<CUStatus | ""> = [
    "",
    "Draft",
    "Sent",
    "Acknowledged",
    "Disputed",
  ];

  function set(k: keyof FormState, v: string) {
    setForm((f) => {
      const next = { ...f, [k]: v };
      if (k === "ApplicantId") {
        next.UnitSelectionId = "";
      }
      if (k === "UnitSelectionId") {
        const us = meta?.unitSelections.find((u) => String(u.Id) === v);
        if (us) {
          if (us.ProjectId) next.ProjectId = String(us.ProjectId);
          if (us.CompanyId) next.CompanyId = String(us.CompanyId);
        }
      }
      return next;
    });
  }

  function openCreate() {
    setEditId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(cu: ConstructionUpdate) {
    setEditId(cu.Id);
    setForm({
      ApplicantId: String(cu.ApplicantId),
      UnitSelectionId: cu.UnitSelectionId ? String(cu.UnitSelectionId) : "",
      ProjectId: cu.ProjectId ? String(cu.ProjectId) : "",
      CompanyId: cu.CompanyId ? String(cu.CompanyId) : "",
      UpdateDate: cu.UpdateDate ?? "",
      Stage: cu.Stage ?? "",
      PercentComplete:
        cu.PercentComplete !== null ? String(cu.PercentComplete) : "",
      Description: cu.Description ?? "",
      SharedWith: cu.SharedWith ?? "",
      SharedOn: cu.SharedOn ?? "",
      MediaLinks: cu.MediaLinks ?? "",
      Status: cu.Status,
      Notes: cu.Notes ?? "",
    });
    setDialogOpen(true);
  }

  function buildPayload() {
    return {
      ApplicantId: form.ApplicantId || null,
      UnitSelectionId: form.UnitSelectionId || null,
      ProjectId: form.ProjectId || null,
      CompanyId: form.CompanyId || null,
      UpdateDate: form.UpdateDate || null,
      Stage: form.Stage || null,
      PercentComplete:
        form.PercentComplete !== "" ? Number(form.PercentComplete) : null,
      Description: form.Description || null,
      SharedWith: form.SharedWith || null,
      SharedOn: form.SharedOn || null,
      MediaLinks: form.MediaLinks || null,
      Status: form.Status,
      Notes: form.Notes || null,
    };
  }

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["construction-updates"] });

  const createMut = useMutation({
    mutationFn: () => createUpdate(buildPayload()),
    onSuccess: () => {
      toast.success("Construction update created");
      invalidate();
      setDialogOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: () => updateRecord(editId!, buildPayload()),
    onSuccess: () => {
      toast.success("Construction update saved");
      invalidate();
      setDialogOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: () => deleteUpdate(deleteId!),
    onSuccess: () => {
      toast.success("Deleted");
      invalidate();
      setDeleteId(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── KPI stats ──
  const stats = useMemo(
    () => ({
      total: pagination?.total ?? 0,
      sent: updates.filter((u) => u.Status === "Sent").length,
      acknowledged: updates.filter((u) => u.Status === "Acknowledged").length,
      disputed: updates.filter((u) => u.Status === "Disputed").length,
    }),
    [updates, pagination],
  );

  // ── Pagination ──
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
        .cu-page {
          font-family: 'DM Sans', 'Segoe UI', sans-serif;
          color: hsl(var(--foreground));
        }

        /* ── Header ── */
        .cu-header {
          background: hsl(var(--card));
          border-bottom: 1px solid hsl(var(--border));
          padding: 20px 28px 0;
          position: sticky; top: 0; z-index: 20;
        }
        .cu-header-top {
          display: flex; align-items: flex-start;
          justify-content: space-between; margin-bottom: 16px; gap: 16px;
        }
        .cu-title-row { display: flex; align-items: center; gap: 12px; }
        .cu-icon {
          width: 40px; height: 40px;
          background: hsl(var(--primary));
          border-radius: 12px;
          display: flex; align-items: center; justify-content: center;
          color: hsl(var(--primary-foreground)); flex-shrink: 0;
          box-shadow: 0 2px 8px hsl(var(--primary) / 0.25);
        }
        .cu-title { font-size: 20px; font-weight: 700; color: hsl(var(--foreground)); }
        .cu-count {
          background: hsl(var(--primary) / 0.1); color: hsl(var(--primary));
          font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 20px;
        }
        .cu-add-btn {
          display: flex; align-items: center; gap: 6px;
          background: hsl(var(--primary)); color: hsl(var(--primary-foreground));
          border: none; border-radius: 10px; padding: 9px 16px;
          font-size: 13px; font-weight: 600; cursor: pointer;
          transition: all 0.15s; font-family: inherit;
          box-shadow: 0 2px 8px hsl(var(--primary) / 0.25); white-space: nowrap;
        }
        .cu-add-btn:hover { opacity: 0.9; transform: translateY(-1px); }

        /* ── Filter bar ── */
        .cu-filter-bar {
          display: flex; align-items: center; gap: 12px;
          padding: 14px 0; flex-wrap: wrap;
        }
        .cu-search-wrap { flex: 1; min-width: 200px; max-width: 380px; position: relative; }
        .cu-search-wrap svg { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: hsl(var(--muted-foreground)); pointer-events: none; }
        .cu-search {
          width: 100%; padding: 8px 12px 8px 36px;
          border: 1.5px solid hsl(var(--border)); border-radius: 9px;
          font-size: 13.5px; color: hsl(var(--foreground)); background: hsl(var(--card));
          outline: none; transition: border-color 0.15s; font-family: inherit; box-sizing: border-box;
        }
        .cu-search:focus { border-color: hsl(var(--primary)); }
        .cu-search-clear { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; color: hsl(var(--muted-foreground)); padding: 2px; display: flex; border-radius: 4px; }

        .cu-pills { display: flex; gap: 6px; flex-wrap: wrap; }
        .cu-pill {
          padding: 5px 12px; border-radius: 20px; font-size: 12px; font-weight: 500;
          border: 1.5px solid hsl(var(--border)); background: hsl(var(--card)); color: hsl(var(--muted-foreground));
          cursor: pointer; transition: all 0.12s; font-family: inherit; white-space: nowrap;
        }
        .cu-pill:hover { border-color: hsl(var(--primary)); color: hsl(var(--primary)); }
        .cu-pill.active          { background: hsl(var(--primary)); border-color: hsl(var(--primary)); color: hsl(var(--primary-foreground)); }
        .cu-pill.active-draft    { background: hsl(var(--muted)); border-color: hsl(var(--border)); color: hsl(var(--muted-foreground)); }
        .cu-pill.active-sent     { background: hsl(var(--primary) / 0.1); border-color: hsl(var(--primary) / 0.4); color: hsl(var(--primary)); }
        .cu-pill.active-ack      { background: hsl(142 76% 36% / 0.12); border-color: hsl(142 76% 36% / 0.4); color: hsl(142 76% 36%); }
        .cu-pill.active-disputed { background: hsl(0 84% 60% / 0.12); border-color: hsl(0 84% 60% / 0.4); color: hsl(0 84% 40%); }

        /* ── Stats bar ── */
        .cu-stats { display: flex; border-top: 1px solid hsl(var(--border)); }
        .cu-stat { flex: 1; padding: 12px 0; text-align: center; border-right: 1px solid hsl(var(--border)); }
        .cu-stat:last-child { border-right: none; }
        .cu-stat-val { font-size: 18px; font-weight: 700; color: hsl(var(--foreground)); }
        .cu-stat-label { font-size: 10px; font-weight: 600; color: hsl(var(--muted-foreground)); text-transform: uppercase; letter-spacing: 0.5px; margin-top: 1px; }
        .cu-stat-val.blue   { color: hsl(var(--primary)); }
        .cu-stat-val.green  { color: hsl(142 72% 38%); }
        .cu-stat-val.red    { color: hsl(0 84% 50%); }

        /* ── Body ── */
        .cu-body { padding: 24px 28px; width: 100%; display: flex; flex-direction: column; }

        /* ── Table ── */
        .cu-table-wrap {
          background: hsl(var(--card)); border: 1px solid hsl(var(--border));
          border-radius: 14px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.04);
        }
        .cu-table { width: 100%; border-collapse: collapse; }
        .cu-table thead tr { border-bottom: 1.5px solid hsl(var(--border)); }
        .cu-table th {
          padding: 11px 16px; text-align: left;
          font-size: 11px; font-weight: 600; color: hsl(var(--muted-foreground));
          text-transform: uppercase; letter-spacing: 0.5px;
          background: hsl(var(--muted)); white-space: nowrap;
        }
        .cu-table td {
          padding: 14px 16px; font-size: 13.5px; color: hsl(var(--foreground));
          border-bottom: 1px solid hsl(var(--border)); vertical-align: middle;
        }
        .cu-table tbody tr:last-child td { border-bottom: none; }
        .cu-table tbody tr { transition: background 0.1s; }
        .cu-table tbody tr:hover { background: hsl(var(--background)); }

        .cu-updateno { font-weight: 700; color: hsl(var(--primary)); font-size: 13px; font-family: 'DM Mono', monospace; }
        .cu-applicant-cell { display: flex; align-items: center; gap: 9px; }
        .cu-avatar {
          width: 30px; height: 30px; border-radius: 8px;
          font-size: 11px; font-weight: 700; color: #fff;
          display: flex; align-items: center; justify-content: center; flex-shrink: 0;
        }
        .cu-applicant-name { font-weight: 600; font-size: 13px; }
        .cu-applicant-no   { font-size: 11px; color: hsl(var(--muted-foreground)); }

        .cu-sub { font-size: 11px; color: hsl(var(--muted-foreground)); }
        .cu-stage-pill {
          display: inline-block; padding: 2px 9px; border-radius: 20px; font-size: 11px; font-weight: 500;
          background: hsl(var(--primary) / 0.08); color: hsl(var(--primary));
          border: 1px solid hsl(var(--primary) / 0.2);
        }

        /* ── Status badge ── */
        .cu-badge {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 3px 9px; border-radius: 20px; font-size: 11px; font-weight: 600;
        }
        .cu-badge-draft        { background: hsl(var(--muted));            color: hsl(var(--muted-foreground)); }
        .cu-badge-sent         { background: hsl(var(--primary) / 0.1);   color: hsl(var(--primary)); }
        .cu-badge-acknowledged { background: hsl(142 76% 36% / 0.12);     color: hsl(142 76% 36%); }
        .cu-badge-disputed     { background: hsl(0 84% 60% / 0.12);       color: hsl(0 84% 40%); }

        /* ── Row actions ── */
        .cu-actions { position: relative; }
        .cu-menu-btn {
          width: 30px; height: 30px; border-radius: 7px;
          display: flex; align-items: center; justify-content: center;
          background: none; border: none; cursor: pointer; color: hsl(var(--muted-foreground));
          transition: all 0.1s;
        }
        .cu-menu-btn:hover { background: hsl(var(--muted)); color: hsl(var(--foreground)); }
        .cu-menu {
          position: absolute; right: 0; top: 100%; margin-top: 4px;
          background: hsl(var(--card)); border: 1px solid hsl(var(--border));
          border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,0.10);
          z-index: 50; min-width: 140px; overflow: hidden;
          animation: cu-menu-in 0.1s ease;
        }
        @keyframes cu-menu-in { from { opacity:0; transform: translateY(-4px); } to { opacity:1; transform: translateY(0); } }
        .cu-menu-item {
          display: flex; align-items: center; gap: 9px; padding: 9px 14px;
          font-size: 13px; font-weight: 500; cursor: pointer;
          background: none; border: none; width: 100%; text-align: left;
          font-family: inherit; color: hsl(var(--foreground)); transition: background 0.1s;
        }
        .cu-menu-item:hover { background: hsl(var(--background)); }
        .cu-menu-item.danger { color: hsl(0 84% 50%); }
        .cu-menu-item.danger:hover { background: hsl(0 84% 60% / 0.08); }

        /* ── Empty ── */
        .cu-empty {
          display: flex; flex-direction: column; align-items: center;
          justify-content: center; padding: 72px 24px; gap: 12px;
          color: hsl(var(--muted-foreground)); text-align: center;
        }
        .cu-empty-icon {
          width: 56px; height: 56px; background: hsl(var(--primary) / 0.1);
          border-radius: 14px; display: flex; align-items: center; justify-content: center;
        }
        .cu-empty h3 { font-size: 15px; font-weight: 600; color: hsl(var(--muted-foreground)); margin: 0; }
        .cu-empty p  { font-size: 13px; color: hsl(var(--muted-foreground)); margin: 0; }

        /* ── Pagination ── */
        .cu-pagination {
          display: flex; align-items: center; justify-content: space-between;
          padding: 14px 20px; border-top: 1px solid hsl(var(--border));
          font-size: 13px; color: hsl(var(--muted-foreground));
        }
        .cu-pag-btns { display: flex; gap: 6px; }
        .cu-pag-btn {
          width: 32px; height: 32px; border-radius: 8px;
          display: flex; align-items: center; justify-content: center;
          background: none; border: 1px solid hsl(var(--border)); cursor: pointer;
          color: hsl(var(--foreground)); transition: all 0.12s; font-family: inherit; font-size: 12px;
        }
        .cu-pag-btn:hover:not(:disabled) { border-color: hsl(var(--primary)); color: hsl(var(--primary)); }
        .cu-pag-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .cu-pag-btn.active { background: hsl(var(--primary)); border-color: hsl(var(--primary)); color: hsl(var(--primary-foreground)); font-weight: 600; }

        /* ── Skeleton ── */
        .cu-skel {
          background: linear-gradient(90deg, hsl(var(--muted)) 25%, hsl(var(--border)) 50%, hsl(var(--muted)) 75%);
          background-size: 200% 100%; animation: cu-shimmer 1.4s infinite; border-radius: 6px;
        }
        @keyframes cu-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

        /* ── Combobox ── */
        .cu-combo { position: relative; width: 100%; }
        .cu-combo-trigger {
          width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px;
          padding: 8px 12px; border: 1.5px solid hsl(var(--border)); border-radius: 9px;
          font-size: 14px; background: hsl(var(--card)); color: hsl(var(--foreground));
          cursor: pointer; text-align: left; transition: border-color 0.15s;
          font-family: inherit; min-height: 38px;
        }
        .cu-combo-trigger:focus { outline: none; border-color: hsl(var(--primary)); }
        .cu-combo-trigger.open { border-color: hsl(var(--primary)); border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
        .cu-combo-trigger.empty { color: hsl(var(--muted-foreground)); }
        .cu-combo-trigger.disabled { background: hsl(var(--background)); opacity: 0.6; cursor: not-allowed; }
        .cu-combo-left { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; }
        .cu-combo-val { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 13.5px; }
        .cu-combo-placeholder { font-size: 13.5px; }
        .cu-combo-chevron { color: hsl(var(--muted-foreground)); flex-shrink: 0; transition: transform 0.15s; }
        .cu-combo-chevron.open { transform: rotate(180deg); }
        .cu-combo-clear { background: none; border: none; cursor: pointer; color: hsl(var(--muted-foreground)); padding: 2px; display: flex; flex-shrink: 0; border-radius: 4px; }
        .cu-combo-clear:hover { background: hsl(var(--muted)); }
        .cu-combo-drop {
          position: absolute; top: 100%; left: 0; right: 0; background: hsl(var(--card));
          border: 1.5px solid hsl(var(--primary)); border-top: 1px solid hsl(var(--border));
          border-radius: 0 0 9px 9px; box-shadow: 0 8px 24px rgba(0,0,0,0.10);
          z-index: 100; overflow: hidden; max-height: 220px; display: flex; flex-direction: column;
        }
        .cu-combo-search-wrap { position: relative; border-bottom: 1px solid hsl(var(--muted)); flex-shrink: 0; }
        .cu-combo-search-wrap svg { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: hsl(var(--muted-foreground)); pointer-events: none; }
        .cu-combo-search { width: 100%; padding: 8px 12px 8px 34px; border: none; font-size: 13px; color: hsl(var(--foreground)); background: hsl(var(--background)); outline: none; font-family: inherit; box-sizing: border-box; }
        .cu-combo-list { overflow-y: auto; flex: 1; }
        .cu-combo-item { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 12px; cursor: pointer; transition: background 0.1s; border: none; background: none; width: 100%; text-align: left; font-family: inherit; }
        .cu-combo-item:hover { background: hsl(var(--primary) / 0.1); }
        .cu-combo-item.selected { background: hsl(var(--primary) / 0.15); }
        .cu-combo-item-label { font-size: 13px; font-weight: 500; color: hsl(var(--foreground)); flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .cu-combo-item-sub { font-size: 11px; color: hsl(var(--muted-foreground)); flex-shrink: 0; }
        .cu-combo-empty { padding: 16px; text-align: center; font-size: 13px; color: hsl(var(--muted-foreground)); }

        /* ── Form ── */
        .cu-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .cu-form-grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
        .cu-form-section {
          font-size: 10px; font-weight: 700; color: hsl(var(--muted-foreground));
          text-transform: uppercase; letter-spacing: 1px;
          padding-top: 8px; border-top: 1px solid hsl(var(--border)); margin-top: 4px;
        }
        .cu-select {
          width: 100%; padding: 8px 32px 8px 12px; border: 1.5px solid hsl(var(--border)); border-radius: 9px;
          font-size: 13.5px; color: hsl(var(--foreground)); background: hsl(var(--card));
          outline: none; transition: border-color 0.15s; font-family: inherit;
          cursor: pointer; appearance: none; -webkit-appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 10px center;
        }
        .cu-select:focus { border-color: hsl(var(--primary)); }

        @media (max-width: 768px) {
          .cu-header { padding: 16px 16px 0; }
          .cu-body { padding: 16px; }
          .cu-form-grid, .cu-form-grid-3 { grid-template-columns: 1fr; }
          .cu-stats { flex-wrap: wrap; }
          .cu-stat { min-width: 50%; }
          .cu-table th:nth-child(4), .cu-table td:nth-child(4),
          .cu-table th:nth-child(5), .cu-table td:nth-child(5) { display: none; }
        }
      `}</style>

      <Breadcrumbs
        items={[
          { label: "Follow-Up", path: "/followup" },
          { label: "Construction", path: "/followup/construction/updates" },
          { label: "Updates", path: "/followup/construction/updates" },
        ]}
      />
      <div
        className="cu-page relative space-y-8 mt-6"
        onClick={() => setOpenMenuId(null)}
      >
        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-4">
          <div className="cu-title-row">
            <div className="cu-icon">
              <HardHat size={20} />
            </div>
            <span className="cu-title">Construction Updates</span>
            <span className="cu-count">{pagination?.total ?? 0}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
            >
              <RefreshCw
                size={13}
                className={isFetching ? "animate-spin" : ""}
              />
              Refresh
            </button>
            <Button
              onClick={openCreate}
              className="gradient-accent gap-1.5 shrink-0 font-semibold text-white text-sm px-5 py-2 h-auto"
            >
              <Plus size={14} /> New Update
            </Button>
          </div>
        </div>

        {/* Filter + search */}
        <div className="cu-filter-bar">
          <div className="cu-search-wrap">
            <Search size={14} />
            <input
              className="cu-search"
              placeholder="Search by applicant, unit, stage, project…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
            {search && (
              <button
                className="cu-search-clear"
                onClick={() => {
                  setSearch("");
                  setPage(1);
                }}
              >
                <X size={13} />
              </button>
            )}
          </div>
          <div className="cu-pills">
            {statusOptions.map((s) => {
              const isActive = statusFilter === s;
              const pillClass = isActive
                ? s === ""
                  ? "cu-pill active"
                  : s === "Draft"
                    ? "cu-pill active-draft"
                    : s === "Sent"
                      ? "cu-pill active-sent"
                      : s === "Acknowledged"
                        ? "cu-pill active-ack"
                        : "cu-pill active-disputed"
                : "cu-pill";
              return (
                <button
                  key={s}
                  className={pillClass}
                  onClick={() => {
                    setStatusFilter(s);
                    setPage(1);
                  }}
                >
                  {s === "" ? "All" : s}
                </button>
              );
            })}
          </div>
        </div>

        {/* Stats bar */}
        <div className="cu-stats">
          {[
            { label: "Total", val: pagination?.total ?? 0, cls: "blue" },
            { label: "Sent", val: stats.sent, cls: "" },
            { label: "Acknowledged", val: stats.acknowledged, cls: "green" },
            { label: "Disputed", val: stats.disputed, cls: "red" },
          ].map(({ label, val, cls }) => (
            <div key={label} className="cu-stat">
              <div className={`cu-stat-val ${cls}`}>{val}</div>
              <div className="cu-stat-label">{label}</div>
            </div>
          ))}
        </div>

        {/* ── Body ── */}
        <div className="cu-body" style={{ paddingTop: 0, paddingBottom: 0 }}>
          <div className="cu-table-wrap">
            {isLoading ? (
              <table className="cu-table">
                <thead>
                  <tr>
                    {[
                      "Update No",
                      "Applicant",
                      "Unit / Project",
                      "Stage & Progress",
                      "Date",
                      "Shared With",
                      "Status",
                      "",
                    ].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>
                      {[70, 160, 110, 130, 90, 110, 80, 40].map((w, j) => (
                        <td key={j}>
                          <div
                            className="cu-skel"
                            style={{ height: 14, width: w }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : updates.length === 0 ? (
              <div className="cu-empty">
                <div className="cu-empty-icon">
                  <HardHat size={26} style={{ color: "hsl(var(--primary))" }} />
                </div>
                <h3>
                  {search || statusFilter
                    ? "No matching updates"
                    : "No construction updates yet"}
                </h3>
                <p>
                  {search || statusFilter
                    ? "Try clearing your filters"
                    : "Record the first update to start tracking construction progress"}
                </p>
                {!search && !statusFilter && (
                  <Button
                    onClick={openCreate}
                    className="gradient-accent gap-1.5 font-semibold text-white text-sm px-5 py-2 h-auto mt-2"
                  >
                    <Plus size={14} /> New Update
                  </Button>
                )}
              </div>
            ) : (
              <>
                <table className="cu-table">
                  <thead>
                    <tr>
                      <th>Update No</th>
                      <th>Applicant</th>
                      <th>Unit / Project</th>
                      <th>Stage & Progress</th>
                      <th>Date</th>
                      <th>Shared With</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {updates.map((cu) => {
                      const sm = STATUS_META[cu.Status];
                      const color = avatarColor(cu.ApplicantName);
                      return (
                        <tr key={cu.Id}>
                          {/* Update No */}
                          <td>
                            <div className="cu-updateno">{cu.UpdateNo}</div>
                          </td>

                          {/* Applicant */}
                          <td>
                            <div className="cu-applicant-cell">
                              <div
                                className="cu-avatar"
                                style={{ background: color }}
                              >
                                {initials(cu.ApplicantName)}
                              </div>
                              <div>
                                <div className="cu-applicant-name">
                                  {cu.ApplicantName}
                                </div>
                                <div className="cu-applicant-no">
                                  {cu.ApplicantNo || cu.ApplicantId}
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* Unit / Project */}
                          <td>
                            {cu.UnitNo ? (
                              <div style={{ fontSize: 13, fontWeight: 500 }}>
                                {cu.UnitNo}
                              </div>
                            ) : null}
                            {cu.ProjectName ? (
                              <div className="cu-sub">{cu.ProjectName}</div>
                            ) : null}
                            {!cu.UnitNo && !cu.ProjectName && (
                              <span
                                style={{
                                  color: "hsl(var(--muted-foreground))",
                                }}
                              >
                                —
                              </span>
                            )}
                          </td>

                          {/* Stage & Progress */}
                          <td>
                            {cu.Stage && (
                              <div style={{ marginBottom: 6 }}>
                                <span className="cu-stage-pill">
                                  {cu.Stage}
                                </span>
                              </div>
                            )}
                            <ProgressBar pct={cu.PercentComplete} />
                          </td>

                          {/* Date */}
                          <td>
                            <div style={{ fontSize: 13 }}>
                              {fmtDate(cu.UpdateDate)}
                            </div>
                            {cu.SharedOn && (
                              <div className="cu-sub">
                                Shared: {fmtDate(cu.SharedOn)}
                              </div>
                            )}
                          </td>

                          {/* Shared With */}
                          <td>
                            {cu.SharedWith ? (
                              <div
                                style={{
                                  fontSize: 12,
                                  color: "hsl(var(--foreground))",
                                }}
                              >
                                {cu.SharedWith}
                              </div>
                            ) : (
                              <span
                                style={{
                                  color: "hsl(var(--muted-foreground))",
                                  fontSize: 12,
                                }}
                              >
                                —
                              </span>
                            )}
                          </td>

                          {/* Status */}
                          <td>
                            <span className={`cu-badge ${sm.cls}`}>
                              {sm.icon} {sm.label}
                            </span>
                          </td>

                          {/* Actions */}
                          <td>
                            <div
                              className="cu-actions"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                className="cu-menu-btn"
                                onClick={() =>
                                  setOpenMenuId(
                                    openMenuId === cu.Id ? null : cu.Id,
                                  )
                                }
                              >
                                <MoreHorizontal size={16} />
                              </button>
                              {openMenuId === cu.Id && (
                                <div className="cu-menu">
                                  <button
                                    className="cu-menu-item"
                                    onClick={() => {
                                      openEdit(cu);
                                      setOpenMenuId(null);
                                    }}
                                  >
                                    <Pencil size={13} /> Edit
                                  </button>
                                  {canDeleteRecords && (
                                    <button
                                      className="cu-menu-item danger"
                                      onClick={() => {
                                        setDeleteId(cu.Id);
                                        setOpenMenuId(null);
                                      }}
                                    >
                                      <Trash2 size={13} /> Delete
                                    </button>
                                  )}
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
                  <div className="cu-pagination">
                    <span>
                      {(pagination.page - 1) * pagination.pageSize + 1}–
                      {Math.min(
                        pagination.page * pagination.pageSize,
                        pagination.total,
                      )}{" "}
                      of {pagination.total}
                    </span>
                    <div className="cu-pag-btns">
                      <button
                        className="cu-pag-btn"
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
                            className={`cu-pag-btn${page === n ? " active" : ""}`}
                            onClick={() => setPage(n as number)}
                          >
                            {n}
                          </button>
                        ),
                      )}
                      <button
                        className="cu-pag-btn"
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

      {/* ── Create / Edit Dialog ── */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(v) => {
          if (!v) setDialogOpen(false);
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
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
                <HardHat
                  size={15}
                  style={{ color: "hsl(var(--primary-foreground))" }}
                />
              </div>
              {editId ? "Edit Construction Update" : "New Construction Update"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-1">
            {/* Applicant */}
            <div className="space-y-2">
              <Label>
                Applicant <span className="text-destructive">*</span>
              </Label>
              <Combobox
                value={form.ApplicantId}
                onChange={(v) => set("ApplicantId", v)}
                items={applicantItems}
                placeholder="Select applicant…"
              />
            </div>

            {/* Unit + Project */}
            <div className="cu-form-grid">
              <div className="space-y-2">
                <Label>Unit Selection</Label>
                <Combobox
                  value={form.UnitSelectionId}
                  onChange={(v) => set("UnitSelectionId", v)}
                  items={unitItems}
                  placeholder="Select unit…"
                  disabled={!form.ApplicantId}
                />
              </div>
              <div className="space-y-2">
                <Label>Project</Label>
                <Combobox
                  value={form.ProjectId}
                  onChange={(v) => set("ProjectId", v)}
                  items={projectItems}
                  placeholder="Select project…"
                />
              </div>
            </div>

            {/* Company */}
            <div className="space-y-2">
              <Label>Company</Label>
              <Combobox
                value={form.CompanyId}
                onChange={(v) => set("CompanyId", v)}
                items={companyItems}
                placeholder="Select company…"
              />
            </div>

            <div className="cu-form-section">Update Details</div>

            {/* Date + Stage + Percent */}
            <div className="cu-form-grid-3">
              <div className="space-y-2">
                <Label>Update Date</Label>
                <div className="relative">
                  <CalendarIcon
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    size={14}
                  />
                  <input
                    type="date"
                    value={form.UpdateDate}
                    onChange={(e) => set("UpdateDate", e.target.value)}
                    className="w-full pl-8 pr-3 py-2 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Stage</Label>
                <select
                  className="cu-select"
                  value={form.Stage}
                  onChange={(e) => set("Stage", e.target.value)}
                >
                  <option value="">— Select stage —</option>
                  {stageOptions.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>% Complete</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={form.PercentComplete}
                  onChange={(e) => set("PercentComplete", e.target.value)}
                  placeholder="0–100"
                />
              </div>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label>Progress Description</Label>
              <Textarea
                value={form.Description}
                onChange={(e) => set("Description", e.target.value)}
                placeholder="Describe the construction progress…"
                rows={3}
              />
            </div>

            <div className="cu-form-section">Communication</div>

            {/* Shared With + Shared On */}
            <div className="cu-form-grid">
              <div className="space-y-2">
                <Label>Shared With</Label>
                <Input
                  value={form.SharedWith}
                  onChange={(e) => set("SharedWith", e.target.value)}
                  placeholder="Name / email / phone…"
                />
              </div>
              <div className="space-y-2">
                <Label>Shared On</Label>
                <div className="relative">
                  <CalendarIcon
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    size={14}
                  />
                  <input
                    type="date"
                    value={form.SharedOn}
                    onChange={(e) => set("SharedOn", e.target.value)}
                    className="w-full pl-8 pr-3 py-2 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                  />
                </div>
              </div>
            </div>

            {/* Media Links */}
            <div className="space-y-2">
              <Label>Media Links</Label>
              <Input
                value={form.MediaLinks}
                onChange={(e) => set("MediaLinks", e.target.value)}
                placeholder="Photo / video URLs (comma-separated)…"
              />
            </div>

            {/* Status */}
            <div className="space-y-2">
              <Label>Status</Label>
              <select
                className="cu-select"
                value={form.Status}
                onChange={(e) => set("Status", e.target.value as CUStatus)}
              >
                {(
                  meta?.statusOptions ??
                  (["Draft", "Sent", "Acknowledged", "Disputed"] as CUStatus[])
                ).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={form.Notes}
                onChange={(e) => set("Notes", e.target.value)}
                placeholder="Internal notes…"
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                !form.ApplicantId || createMut.isPending || updateMut.isPending
              }
              onClick={() => (editId ? updateMut.mutate() : createMut.mutate())}
              className="gradient-accent gap-1.5 font-semibold text-white text-sm px-5 py-2 h-auto"
            >
              {createMut.isPending || updateMut.isPending
                ? "Saving…"
                : editId
                  ? "Update"
                  : "Create Update"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirm ── */}
      <AlertDialog
        open={!!deleteId}
        onOpenChange={(v) => {
          if (!v) setDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete this construction update?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This update record will be permanently removed. This action cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteMut.mutate()}
              disabled={deleteMut.isPending}
            >
              {deleteMut.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default ConstructionUpdatesPage;
