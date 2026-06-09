import React, { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { getUsers, type User } from "@/api/userApi";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { PageKey } from "@/contexts/AuthContext";
import {
  Plus,
  Pencil,
  Trash2,
  ChevronUp,
  ChevronDown,
  X,
  Check,
  Layers,
  ShieldCheck,
  Info,
  Loader2,
  GripVertical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ApprovalLevel {
  id: number;
  label: string;
  userIds: number[];
}

export interface ApprovalWorkflow {
  id: number;
  name: string;
  type: "sequential" | "any" | "parallel";
  modules: string[];
  levels: ApprovalLevel[];
  active: boolean;
  description?: string;
  createdAt?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MODULE_OPTIONS = [
  { id: "GRN", label: "GRN", icon: "📦" },
  { id: "PurchaseOrders", label: "Purchase Order", icon: "🛒" },
  { id: "MaterialIssues", label: "Material Issue", icon: "🚚" },
  { id: "Expenses", label: "Expense Booking", icon: "🧾" },
  { id: "WorkOrderHeader", label: "Work Order", icon: "🔧" },
  { id: "NewPayment", label: "Payment", icon: "💳" },
  { id: "StockTransfer", label: "Stock Transfer", icon: "🔄" },
] as const;

const APPROVAL_API = "/api/approval-workflows";

// ─── API helpers ──────────────────────────────────────────────────────────────

async function fetchWorkflows(): Promise<ApprovalWorkflow[]> {
  const res = await fetchWithAuth(APPROVAL_API);
  if (!res.ok) throw new Error("Failed to fetch workflows");
  return res.json();
}

async function apiSave(
  body: Omit<ApprovalWorkflow, "id" | "createdAt">,
  id?: number,
) {
  const method = id ? "PUT" : "POST";
  const url = id ? `${APPROVAL_API}/${id}` : APPROVAL_API;
  const res = await fetchWithAuth(url, { method, body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json()).error || "Save failed");
  return res.json();
}

async function apiToggle(id: number) {
  const res = await fetchWithAuth(`${APPROVAL_API}/${id}/toggle`, {
    method: "PATCH",
  });
  if (!res.ok) throw new Error("Toggle failed");
}

async function apiDelete(id: number) {
  const res = await fetchWithAuth(`${APPROVAL_API}/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Delete failed");
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Multi-select user picker with avatar tags */
function UserMultiSelect({
  value,
  onChange,
  users,
  placeholder = "Select approvers…",
}: {
  value: number[];
  onChange: (ids: number[]) => void;
  users: User[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  function toggle(id: number) {
    onChange(
      value.includes(id) ? value.filter((x) => x !== id) : [...value, id],
    );
  }

  function initials(name: string) {
    return name
      .split(" ")
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase();
  }

  const selectedUsers = users.filter((u) => value.includes(u.id));

  return (
    <div ref={ref} className="relative">
      <div
        className={cn(
          "min-h-9 flex flex-wrap gap-1 items-center px-2 py-1.5 rounded-lg border cursor-pointer transition-colors",
          "bg-muted/40 border-border hover:border-primary/50",
          open && "border-primary ring-1 ring-primary/20",
        )}
        onClick={() => setOpen((o) => !o)}
      >
        {selectedUsers.length === 0 ? (
          <span className="text-xs text-muted-foreground px-1">
            {placeholder}
          </span>
        ) : (
          selectedUsers.map((u) => (
            <span
              key={u.id}
              className="inline-flex items-center gap-1 pl-1 pr-1.5 py-0.5 rounded-full text-[11px] font-medium bg-primary/10 text-primary border border-primary/20"
            >
              <span className="w-4 h-4 rounded-full bg-primary/20 flex items-center justify-center text-[9px] font-bold">
                {initials(u.name)}
              </span>
              {u.name.split(" ")[0]}
              <button
                className="ml-0.5 opacity-60 hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(u.id);
                }}
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))
        )}
      </div>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-popover shadow-lg max-h-44 overflow-y-auto">
          {users.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">
              No users available
            </div>
          ) : (
            users.map((u) => {
              const sel = value.includes(u.id);
              return (
                <div
                  key={u.id}
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-2 cursor-pointer text-sm transition-colors",
                    "hover:bg-muted/60",
                    sel && "bg-primary/5",
                  )}
                  onClick={() => toggle(u.id)}
                >
                  <span
                    className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                    style={{
                      background: `hsl(${(u.id * 47) % 360} 60% 40% / 0.2)`,
                      color: `hsl(${(u.id * 47) % 360} 60% 55%)`,
                    }}
                  >
                    {initials(u.name)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-foreground truncate">
                      {u.name}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {u.role}
                    </div>
                  </div>
                  {sel && (
                    <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

/** Inline "Add Level" form row */
function AddLevelRow({
  users,
  onConfirm,
  onCancel,
}: {
  users: User[];
  onConfirm: (level: Omit<ApprovalLevel, "id">) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState("");
  const [userIds, setUserIds] = useState<number[]>([]);
  const labelRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    labelRef.current?.focus();
  }, []);

  function confirm() {
    if (!label.trim()) {
      labelRef.current?.focus();
      return;
    }
    onConfirm({ label: label.trim(), userIds });
  }

  return (
    <div className="ml-9 rounded-lg border border-primary/40 bg-card p-3">
      <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">
            Level Label
          </label>
          <Input
            ref={labelRef}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Site Manager"
            className="h-8 text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter") confirm();
              if (e.key === "Escape") onCancel();
            }}
          />
        </div>
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">
            Approvers
          </label>
          <UserMultiSelect
            value={userIds}
            onChange={setUserIds}
            users={users}
          />
        </div>
        <div className="flex gap-1.5 pb-0.5">
          <Button
            size="sm"
            className="h-8 w-8 p-0 bg-primary hover:bg-primary/90"
            onClick={confirm}
          >
            <Check className="w-3.5 h-3.5" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 w-8 p-0"
            onClick={onCancel}
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Single level card in the hierarchy */
function LevelCard({
  level,
  index,
  total,
  users,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  level: ApprovalLevel;
  index: number;
  total: number;
  users: User[];
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}) {
  function initials(name: string) {
    return name
      .split(" ")
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase();
  }

  const levelUsers = users.filter((u) => level.userIds.includes(u.id));

  return (
    <div className="flex items-center gap-2.5">
      {/* Connector line + number */}
      <div className="flex flex-col items-center gap-0 flex-shrink-0">
        {index > 0 && <div className="w-px h-3 bg-border" />}
        <div className="w-7 h-7 rounded-full bg-primary/10 border-2 border-primary flex items-center justify-center text-[11px] font-bold text-primary">
          {index + 1}
        </div>
        {index < total - 1 && <div className="w-px h-3 bg-border" />}
      </div>

      {/* Card */}
      <div className="flex-1 flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5 hover:border-primary/30 transition-colors">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-foreground">
            {level.label}
          </div>
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            {levelUsers.length === 0 ? (
              <span className="text-[11px] text-muted-foreground italic">
                No approvers assigned
              </span>
            ) : (
              levelUsers.map((u) => (
                <span
                  key={u.id}
                  className="inline-flex items-center gap-1 pl-1 pr-1.5 py-0.5 rounded-full text-[10px] bg-muted text-muted-foreground border border-border"
                >
                  <span
                    className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-bold"
                    style={{
                      background: `hsl(${(u.id * 47) % 360} 60% 40% / 0.25)`,
                      color: `hsl(${(u.id * 47) % 360} 60% 55%)`,
                    }}
                  >
                    {initials(u.name)}
                  </span>
                  {u.name.split(" ")[0]}
                </span>
              ))
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
            L{index + 1}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
            disabled={index === 0}
            onClick={onMoveUp}
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
            disabled={index === total - 1}
            onClick={onMoveDown}
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            onClick={onRemove}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Config form (new / edit) ─────────────────────────────────────────────────

function ConfigForm({
  initial,
  users,
  onSave,
  onCancel,
  saving,
}: {
  initial?: ApprovalWorkflow;
  users: User[];
  onSave: (data: Omit<ApprovalWorkflow, "id" | "createdAt">) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<"sequential" | "any" | "parallel">(
    initial?.type ?? "sequential",
  );
  const [selectedModules, setSelectedModules] = useState<string[]>(
    initial?.modules ?? [],
  );
  const [levels, setLevels] = useState<ApprovalLevel[]>(initial?.levels ?? []);
  const [addingLevel, setAddingLevel] = useState(false);
  const nextId = useRef(Date.now());

  function toggleModule(id: string) {
    setSelectedModules((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function addLevel(lv: Omit<ApprovalLevel, "id">) {
    setLevels((prev) => [...prev, { ...lv, id: nextId.current++ }]);
    setAddingLevel(false);
  }

  function moveUp(idx: number) {
    setLevels((prev) => {
      const a = [...prev];
      [a[idx - 1], a[idx]] = [a[idx], a[idx - 1]];
      return a;
    });
  }

  function moveDown(idx: number) {
    setLevels((prev) => {
      const a = [...prev];
      [a[idx], a[idx + 1]] = [a[idx + 1], a[idx]];
      return a;
    });
  }

  function submit() {
    if (!name.trim()) {
      toast.error("Configuration name is required");
      return;
    }
    if (!selectedModules.length) {
      toast.error("Select at least one module");
      return;
    }
    if (!levels.length) {
      toast.error("Add at least one approval level");
      return;
    }
    onSave({
      name: name.trim(),
      type,
      modules: selectedModules,
      levels,
      active: initial?.active ?? true,
    });
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Layers className="w-4 h-4 text-primary" />
          </div>
          <div>
            <div className="text-sm font-semibold text-foreground">
              {initial ? "Edit Configuration" : "New Approval Configuration"}
            </div>
            <div className="text-[11px] text-muted-foreground">
              Define hierarchy and assign approvers per level
            </div>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-xs"
          onClick={onCancel}
        >
          <X className="w-3.5 h-3.5" /> Cancel
        </Button>
      </div>

      <div className="p-5 space-y-5">
        {/* Row 1: name + type */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 block">
              Configuration Name *
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Material Approval Chain"
              className="h-9 text-sm"
            />
          </div>
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 block">
              Approval Type
            </label>
            <Select
              value={type}
              onValueChange={(v) => setType(v as typeof type)}
            >
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sequential">
                  Sequential — one by one
                </SelectItem>
                <SelectItem value="any">
                  Any Approver — one is enough
                </SelectItem>
                <SelectItem value="parallel">Parallel — all at once</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Module chips */}
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">
            Apply to Modules *
          </label>
          <div className="flex flex-wrap gap-2">
            {MODULE_OPTIONS.map((m) => {
              const active = selectedModules.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => toggleModule(m.id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all",
                    active
                      ? "bg-primary/10 border-primary/50 text-primary"
                      : "bg-muted/40 border-border text-muted-foreground hover:border-primary/30 hover:text-foreground",
                  )}
                >
                  <span>{m.icon}</span>
                  {m.label}
                  {active && <Check className="w-3 h-3" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Hierarchy builder */}
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">
            Approval Levels *
          </label>

          {/* Info bar */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/5 border border-primary/15 text-xs text-primary mb-3">
            <Info className="w-3.5 h-3.5 flex-shrink-0" />
            Approvals flow top → bottom. Each level must approve before
            proceeding to the next.
          </div>

          {/* Levels list */}
          <div className="space-y-0">
            {levels.length === 0 && !addingLevel && (
              <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                <Layers className="w-8 h-8 mx-auto mb-2 opacity-30" />
                No levels yet. Click "Add Level" to define your first approver.
              </div>
            )}

            {levels.map((lv, idx) => (
              <LevelCard
                key={lv.id}
                level={lv}
                index={idx}
                total={levels.length}
                users={users}
                onMoveUp={() => moveUp(idx)}
                onMoveDown={() => moveDown(idx)}
                onRemove={() =>
                  setLevels((prev) => prev.filter((_, i) => i !== idx))
                }
              />
            ))}

            {/* Connector dot to add-level area */}
            {levels.length > 0 && (
              <div
                className="flex flex-col items-center"
                style={{ marginLeft: "14px", width: "28px" }}
              >
                <div className="w-px h-3 bg-border" />
              </div>
            )}

            {addingLevel ? (
              <AddLevelRow
                users={users}
                onConfirm={addLevel}
                onCancel={() => setAddingLevel(false)}
              />
            ) : (
              <div className={cn("flex", levels.length > 0 && "ml-9")}>
                <button
                  type="button"
                  onClick={() => setAddingLevel(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:border-primary hover:text-primary hover:bg-primary/5 transition-all"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Level
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex justify-end gap-2 px-5 py-3 border-t border-border bg-muted/20">
        <Button variant="outline" size="sm" onClick={onCancel}>
          Discard
        </Button>
        <Button
          size="sm"
          className="gap-1.5 gradient-accent text-white font-semibold"
          onClick={submit}
          disabled={saving}
        >
          {saving ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Check className="w-3.5 h-3.5" />
          )}
          {initial ? "Save Changes" : "Create Configuration"}
        </Button>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ApprovalSetup() {
  const qc = useQueryClient();
  const { canDoAction } = useAuth() as any;

  const [mode, setMode] = useState<"list" | "new" | "edit">("list");
  const [editing, setEditing] = useState<ApprovalWorkflow | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: workflows = [], isLoading } = useQuery<ApprovalWorkflow[]>({
    queryKey: ["approval-workflows"],
    queryFn: fetchWorkflows,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    select: (data) => (Array.isArray(data) ? data : []),
  });

  const { data: users = [] } = useQuery<User[]>({
    queryKey: ["users"],
    queryFn: getUsers,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const handleSave = useCallback(
    async (data: Omit<ApprovalWorkflow, "id" | "createdAt">) => {
      setSaving(true);
      try {
        await apiSave(data, editing?.id);
        toast.success(editing ? "Workflow updated" : "Workflow created");
        qc.invalidateQueries({ queryKey: ["approval-workflows"] });
        setMode("list");
        setEditing(null);
      } catch (err: any) {
        toast.error(err.message);
      } finally {
        setSaving(false);
      }
    },
    [editing, qc],
  );

  const handleToggle = useCallback(
    async (id: number) => {
      try {
        await apiToggle(id);
        qc.invalidateQueries({ queryKey: ["approval-workflows"] });
      } catch (err: any) {
        toast.error(err.message);
      }
    },
    [qc],
  );

  const handleDelete = useCallback(
    async (id: number) => {
      if (!confirm("Delete this workflow?")) return;
      try {
        await apiDelete(id);
        toast.success("Workflow deleted");
        qc.invalidateQueries({ queryKey: ["approval-workflows"] });
      } catch (err: any) {
        toast.error(err.message);
      }
    },
    [qc],
  );

  if (isLoading) {
    return (
      <div className="p-6 space-y-4 animate-pulse">
        <div className="h-6 w-48 bg-muted rounded" />
        <div className="h-64 bg-muted rounded-xl" />
      </div>
    );
  }

  const canCreate = canDoAction("admin_approval_setup" as PageKey, "create");
  const canEdit = canDoAction("admin_approval_setup" as PageKey, "edit");
  const canDel = canDoAction("admin_approval_setup" as PageKey, "delete");

  return (
    <>
      <Breadcrumbs items={["Admin", "Approval", "Approval Setup"]} />

      <div className="relative space-y-6 mt-6">
        {/* Page header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-heading font-bold text-foreground flex items-center gap-2">
              <ShieldCheck className="text-primary w-5 h-5" />
              Approval Setup
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Configure multi-level approval hierarchies for each module
            </p>
          </div>
          {mode === "list" && canCreate && (
            <Button
              className="gradient-accent gap-1.5 shrink-0 font-semibold text-white text-sm px-5 py-2 h-auto"
              onClick={() => {
                setEditing(null);
                setMode("new");
              }}
            >
              <Plus className="h-4 w-4" /> New Configuration
            </Button>
          )}
        </div>

        {/* Form (new / edit) */}
        {(mode === "new" || mode === "edit") && (
          <ConfigForm
            initial={mode === "edit" ? (editing ?? undefined) : undefined}
            users={users}
            onSave={handleSave}
            onCancel={() => {
              setMode("list");
              setEditing(null);
            }}
            saving={saving}
          />
        )}

        {/* Existing configurations table */}
        {mode === "list" && (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-border bg-muted/30">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <ShieldCheck className="w-4 h-4 text-primary" />
              </div>
              <div>
                <div className="text-sm font-semibold text-foreground">
                  Active Configurations
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Approval chains currently in use
                </div>
              </div>
            </div>

            {workflows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Layers className="w-12 h-12 text-muted-foreground/30 mb-3" />
                <div className="text-sm font-medium text-foreground mb-1">
                  No configurations yet
                </div>
                <p className="text-xs text-muted-foreground mb-4">
                  Create your first approval hierarchy to get started.
                </p>
                {canCreate && (
                  <Button
                    size="sm"
                    className="gradient-accent text-white gap-1.5 font-semibold"
                    onClick={() => {
                      setEditing(null);
                      setMode("new");
                    }}
                  >
                    <Plus className="w-3.5 h-3.5" /> New Configuration
                  </Button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Name
                      </th>
                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Modules
                      </th>
                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Levels
                      </th>
                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Type
                      </th>
                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Status
                      </th>
                      <th className="px-4 py-2.5 w-24" />
                    </tr>
                  </thead>
                  <tbody>
                    {workflows.map((wf) => {
                      const modLabels = wf.modules
                        .map(
                          (mid) =>
                            MODULE_OPTIONS.find((m) => m.id === mid)?.label ??
                            mid,
                        )
                        .join(", ");
                      return (
                        <tr
                          key={wf.id}
                          className="border-b border-border/60 hover:bg-muted/20 transition-colors"
                        >
                          <td className="px-4 py-3 font-medium text-foreground">
                            {wf.name}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              {wf.modules.slice(0, 3).map((mid) => {
                                const m = MODULE_OPTIONS.find(
                                  (x) => x.id === mid,
                                );
                                return (
                                  <span
                                    key={mid}
                                    className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted border border-border text-muted-foreground"
                                  >
                                    {m?.label ?? mid}
                                  </span>
                                );
                              })}
                              {wf.modules.length > 3 && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted border border-border text-muted-foreground">
                                  +{wf.modules.length - 3}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                              <Layers className="w-3.5 h-3.5" />
                              {wf.levels.length} level
                              {wf.levels.length !== 1 ? "s" : ""}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs text-muted-foreground capitalize">
                              {wf.type === "sequential"
                                ? "Sequential"
                                : wf.type === "any"
                                  ? "Any approver"
                                  : "Parallel"}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <Switch
                              checked={wf.active}
                              onCheckedChange={() => handleToggle(wf.id)}
                              disabled={!canEdit}
                            />
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1 justify-end">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                                disabled={!canEdit}
                                onClick={() => {
                                  setEditing(wf);
                                  setMode("edit");
                                }}
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                disabled={!canDel}
                                onClick={() => handleDelete(wf.id)}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
