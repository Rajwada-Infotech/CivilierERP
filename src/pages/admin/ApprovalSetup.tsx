import React, { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { getUsers, type User } from "@/api/userApi";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { AdminShell } from "@/components/admin/AdminShell";
import { PageKey } from "@/contexts/AuthContext";
import {
  Plus,
  Pencil,
  Trash2,
  ChevronUp,
  ChevronDown,
  X,
  Check,
  ShieldCheck,
  Loader2,
  ArrowDown,
  Users,
  GitBranch,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
  {
    id: "GRN",
    label: "Goods Receipt (GRN)",
    icon: "📦",
    desc: "When goods arrive at site",
  },
  {
    id: "PurchaseOrders",
    label: "Purchase Order",
    icon: "🛒",
    desc: "Before a PO is raised",
  },
  {
    id: "MaterialIssues",
    label: "Material Issue",
    icon: "🚚",
    desc: "When materials leave store",
  },
  {
    id: "Expenses",
    label: "Expense Booking",
    icon: "🧾",
    desc: "Staff expense claims",
  },
  {
    id: "WorkOrderHeader",
    label: "Work Order",
    icon: "🔧",
    desc: "Before work begins",
  },
  {
    id: "NewPayment",
    label: "Payment",
    icon: "💳",
    desc: "Before payments are made",
  },
  {
    id: "StockTransfer",
    label: "Stock Transfer",
    icon: "🔄",
    desc: "Moving stock between sites",
  },
  {
    id: "SaleOrder",
    label: "Sale Order",
    icon: "🛍️",
    desc: "Inter-company / inter-project item sales",
  },
  {
    id: "JournalVoucher",
    label: "Journal Voucher",
    icon: "📒",
    desc: "Forceful account-head mismatch correction — approval is always restricted to super_admin regardless of who's assigned here",
  },
  {
    id: "InterCompanyTransfer",
    label: "Inter-Company Transfer",
    icon: "🏭",
    desc: "Approving fires the full auto-generated document chain (SO→SI→Payment→PO→GRN→Expense→Payment) — restricted to super_admin regardless of who's assigned here",
  },
  {
    id: "Contract",
    label: "Contract",
    icon: "📄",
    desc: "Auto-submitted for approval as soon as it's created — no Draft step",
  },
  {
    id: "crm-agreements",
    label: "CRM Agreement (Senior Approval)",
    icon: "📝",
    desc: "Before an agreement is sent to the customer portal — approver roles here are always restricted to admin/super_admin/marketing_head regardless of who's assigned",
  },
] as const;

type ModuleId = (typeof MODULE_OPTIONS)[number]["id"];

const MODULE_GROUPS = [
  {
    id: "material",
    label: "Material",
    icon: "🏗️",
    modules: [
      "GRN",
      "PurchaseOrders",
      "MaterialIssues",
      "Expenses",
      "StockTransfer",
      "InterCompanyTransfer",
    ],
  },
  {
    id: "finance",
    label: "Finance",
    icon: "💰",
    modules: ["NewPayment", "JournalVoucher", "Contract"],
  },
  {
    id: "engineering",
    label: "Engineering",
    icon: "⚙️",
    modules: ["WorkOrderHeader"],
  },
  {
    id: "sales",
    label: "Sales",
    icon: "🛍️",
    modules: ["SaleOrder"],
  },
  {
    id: "crm",
    label: "CRM",
    icon: "🏠",
    modules: ["crm-agreements"],
  },
] as const;

const APPROVAL_TYPES = [
  {
    id: "sequential" as const,
    label: "One by one",
    icon: ArrowDown,
    desc: "Each person must approve before the next is asked. Like a chain — first Manager, then Director.",
    example: "Manager → Director → CFO",
  },
  {
    id: "any" as const,
    label: "Anyone can approve",
    icon: Users,
    desc: "Any one person from the list can approve. Useful when multiple people share the same role.",
    example: "Manager A or Manager B",
  },
  {
    id: "parallel" as const,
    label: "Everyone at once",
    icon: GitBranch,
    desc: "All approvers are asked at the same time. All must approve before it moves forward.",
    example: "Manager + Director + CFO (simultaneously)",
  },
] as const;

const APPROVAL_API = "/api/approval-workflows";

// ─── API helpers ──────────────────────────────────────────────────────────────

async function fetchWorkflows(): Promise<ApprovalWorkflow[]> {
  const res = await fetchWithAuth(APPROVAL_API);
  if (!res.ok) throw new Error("Failed to fetch workflows");
  return res.json().catch(() => ({}));
}

async function apiSave(
  body: Omit<ApprovalWorkflow, "id" | "createdAt">,
  id?: number,
) {
  const method = id ? "PUT" : "POST";
  const url = id ? `${APPROVAL_API}/${id}` : APPROVAL_API;
  const res = await fetchWithAuth(url, { method, body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Save failed");
  return res.json().catch(() => ({}));
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

// ─── UserMultiSelect ──────────────────────────────────────────────────────────

function UserMultiSelect({
  value,
  onChange,
  users,
  placeholder = "Click to choose people…",
}: {
  value: number[];
  onChange: (ids: number[]) => void;
  users: User[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  const updatePosition = useCallback(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const DROPDOWN_HEIGHT = 320;
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      const spaceAbove = rect.top - 8;
      const openUpward =
        spaceBelow < DROPDOWN_HEIGHT && spaceAbove > spaceBelow;

      if (openUpward) {
        setDropdownStyle({
          position: "fixed",
          bottom: window.innerHeight - rect.top + 4,
          left: rect.left,
          width: rect.width,
          zIndex: 9999,
          maxHeight: `${Math.min(DROPDOWN_HEIGHT, spaceAbove)}px`,
        });
      } else {
        setDropdownStyle({
          position: "fixed",
          top: rect.bottom + 4,
          left: rect.left,
          width: rect.width,
          zIndex: 9999,
          maxHeight: `${Math.min(DROPDOWN_HEIGHT, spaceBelow)}px`,
        });
      }
    }
  }, []);

  useEffect(() => {
    if (open) updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open, updatePosition]);

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
        ref={triggerRef}
        className={cn(
          "min-h-10 flex flex-wrap gap-1.5 items-center px-3 py-2 rounded-lg border cursor-pointer transition-all",
          "bg-muted/30 border-border hover:border-primary/50",
          open && "border-primary ring-2 ring-primary/20",
        )}
        onClick={() => setOpen((o) => !o)}
      >
        {selectedUsers.length === 0 ? (
          <span className="text-sm text-muted-foreground">{placeholder}</span>
        ) : (
          selectedUsers.map((u) => (
            <span
              key={u.id}
              className="inline-flex items-center gap-1.5 pl-1 pr-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20"
            >
              <span className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center text-[9px] font-bold">
                {initials(u.name)}
              </span>
              {u.name.split(" ")[0]}
              <button
                className="ml-0.5 opacity-60 hover:opacity-100 rounded-full hover:bg-primary/20 p-0.5"
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
        <span className="ml-auto text-muted-foreground/50 text-xs pl-1">
          {open ? "▲" : "▼"}
        </span>
      </div>

      {open && (
        <div
          style={dropdownStyle}
          className="rounded-xl border border-border bg-popover shadow-xl overflow-hidden"
        >
          <div className="px-3 py-2 border-b border-border bg-muted/30">
            <p className="text-xs text-muted-foreground font-medium">
              {selectedUsers.length === 0
                ? "Select who can approve at this level"
                : `${selectedUsers.length} person${selectedUsers.length > 1 ? "s" : ""} selected — click to add/remove`}
            </p>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {users.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                No users available
              </div>
            ) : (
              users.map((u) => {
                const sel = value.includes(u.id);
                return (
                  <div
                    key={u.id}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5 cursor-pointer text-sm transition-colors",
                      "hover:bg-muted/60",
                      sel && "bg-primary/5",
                    )}
                    onClick={() => toggle(u.id)}
                  >
                    <span
                      className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
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
                      <div className="text-[11px] text-muted-foreground">
                        {u.role}
                      </div>
                    </div>
                    <div
                      className={cn(
                        "w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all",
                        sel ? "border-primary bg-primary" : "border-border",
                      )}
                    >
                      {sel && <Check className="w-3 h-3 text-white" />}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── AddLevelRow ──────────────────────────────────────────────────────────────

function AddLevelRow({
  users,
  levelNumber,
  onConfirm,
  onCancel,
}: {
  users: User[];
  levelNumber: number;
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
    <div className="rounded-xl border-2 border-primary/30 bg-primary/3 p-4 space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-6 h-6 rounded-full bg-primary text-white text-xs font-bold flex items-center justify-center">
          {levelNumber}
        </div>
        <span className="text-sm font-semibold text-foreground">
          New approval step
        </span>
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            What is this step called?{" "}
            <span className="text-destructive">*</span>
          </label>
          <Input
            ref={labelRef}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Site Manager, Finance Head, Director…"
            className="h-9 text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter") confirm();
              if (e.key === "Escape") onCancel();
            }}
          />
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            Who can approve at this step?
          </label>
          <UserMultiSelect
            value={userIds}
            onChange={setUserIds}
            users={users}
          />
          <p className="text-[11px] text-muted-foreground mt-1">
            You can assign multiple people — anyone assigned can approve unless
            you chose "Everyone at once" above.
          </p>
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <Button
          size="sm"
          className="gap-1.5 bg-primary hover:bg-primary/90 text-white"
          onClick={confirm}
        >
          <Check className="w-3.5 h-3.5" /> Add this step
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onCancel}
          className="gap-1.5"
        >
          <X className="w-3.5 h-3.5" /> Cancel
        </Button>
      </div>
    </div>
  );
}

// ─── LevelCard ────────────────────────────────────────────────────────────────

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
    <div className="flex items-stretch gap-3">
      {/* Step number + connector */}
      <div className="flex flex-col items-center flex-shrink-0 w-8">
        {index > 0 && <div className="w-0.5 h-3 bg-primary/30" />}
        <div className="w-8 h-8 rounded-full bg-primary text-white text-sm font-bold flex items-center justify-center shadow-sm">
          {index + 1}
        </div>
        {index < total - 1 && (
          <div className="w-0.5 flex-1 bg-primary/30 mt-1" />
        )}
      </div>

      {/* Card */}
      <div className="flex-1 flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 mb-1 hover:border-primary/30 hover:shadow-sm transition-all">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-foreground">
            {level.label}
          </div>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            {levelUsers.length === 0 ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-amber-500 bg-amber-500/10 border border-amber-500/20 rounded-full px-2 py-0.5">
                <AlertCircle className="w-3 h-3" /> No one assigned yet
              </span>
            ) : (
              levelUsers.map((u) => (
                <span
                  key={u.id}
                  className="inline-flex items-center gap-1.5 pl-1 pr-2 py-0.5 rounded-full text-[11px] bg-muted text-muted-foreground border border-border"
                >
                  <span
                    className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold"
                    style={{
                      background: `hsl(${(u.id * 47) % 360} 60% 40% / 0.25)`,
                      color: `hsl(${(u.id * 47) % 360} 60% 55%)`,
                    }}
                  >
                    {initials(u.name)}
                  </span>
                  {u.name}
                </span>
              ))
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {total > 1 && (
            <div className="flex flex-col gap-0.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                disabled={index === 0}
                onClick={onMoveUp}
                title="Move up"
              >
                <ChevronUp className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                disabled={index === total - 1}
                onClick={onMoveDown}
                title="Move down"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 ml-1"
            onClick={onRemove}
            title="Remove this step"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Step wrapper ─────────────────────────────────────────────────────────────

function FormStep({
  number,
  title,
  subtitle,
  children,
}: {
  number: number;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center flex-shrink-0">
        <div className="w-7 h-7 rounded-full bg-primary/10 border-2 border-primary/30 text-primary text-xs font-bold flex items-center justify-center">
          {number}
        </div>
        <div className="w-0.5 flex-1 bg-border/50 mt-1" />
      </div>
      <div className="flex-1 pb-6">
        <div className="mb-3">
          <div className="text-sm font-semibold text-foreground">{title}</div>
          {subtitle && (
            <div className="text-xs text-muted-foreground mt-0.5">
              {subtitle}
            </div>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── ConfigForm ───────────────────────────────────────────────────────────────

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
      toast.error("Please give this approval rule a name");
      return;
    }
    if (!selectedModules.length) {
      toast.error("Please select at least one area where this applies");
      return;
    }
    if (!levels.length) {
      toast.error("Please add at least one approval step");
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
    <div className="rounded-xl border border-border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/20 rounded-t-xl">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            {initial ? "Edit Approval Rule" : "Create a New Approval Rule"}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Follow the steps below — it only takes a minute
          </p>
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

      <div className="p-6">
        {/* Step 1: Name */}
        <FormStep
          number={1}
          title="Give this rule a name"
          subtitle="Something clear so your team knows what it's for"
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Site Manager Approval, Finance Sign-off…"
            className="h-10 text-sm max-w-md"
          />
        </FormStep>

        {/* Step 2: Where it applies */}
        <FormStep
          number={2}
          title="Where does this rule apply?"
          subtitle="Choose the areas of the system that need this approval before proceeding"
        >
          <ModuleGroupSelector
            selectedModules={selectedModules}
            toggleModule={toggleModule}
          />
          {selectedModules.length > 0 && (
            <p className="text-xs text-primary mt-2 font-medium">
              ✓ {selectedModules.length} area
              {selectedModules.length > 1 ? "s" : ""} selected
            </p>
          )}
        </FormStep>

        {/* Step 3: Approval style */}
        <FormStep
          number={3}
          title="How should approvals work?"
          subtitle="Choose how approvers respond when a request comes in"
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {APPROVAL_TYPES.map((t) => {
              const Icon = t.icon;
              const selected = type === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setType(t.id)}
                  className={cn(
                    "text-left p-4 rounded-xl border-2 transition-all",
                    selected
                      ? "border-primary bg-primary/5 shadow-sm"
                      : "border-border bg-muted/20 hover:border-primary/30 hover:bg-muted/40",
                  )}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div
                      className={cn(
                        "w-7 h-7 rounded-lg flex items-center justify-center",
                        selected
                          ? "bg-primary/15 text-primary"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <span
                      className={cn(
                        "text-sm font-semibold",
                        selected ? "text-primary" : "text-foreground",
                      )}
                    >
                      {t.label}
                    </span>
                    {selected && (
                      <Check className="w-4 h-4 text-primary ml-auto" />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {t.desc}
                  </p>
                  <p className="text-[11px] text-muted-foreground/60 mt-2 font-mono">
                    {t.example}
                  </p>
                </button>
              );
            })}
          </div>
        </FormStep>

        {/* Step 4: Approval steps */}
        <div className="flex gap-4">
          <div className="flex flex-col items-center flex-shrink-0">
            <div className="w-7 h-7 rounded-full bg-primary/10 border-2 border-primary/30 text-primary text-xs font-bold flex items-center justify-center">
              4
            </div>
          </div>
          <div className="flex-1 pb-2">
            <div className="mb-3">
              <div className="text-sm font-semibold text-foreground">
                Who needs to approve, and in what order?
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Add approval steps — each step is one person or group that must
                sign off
              </div>
            </div>

            {/* Empty state */}
            {levels.length === 0 && !addingLevel && (
              <div className="rounded-xl border-2 border-dashed border-border bg-muted/10 px-5 py-8 text-center mb-3">
                <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-3">
                  <Users className="w-6 h-6 text-muted-foreground/40" />
                </div>
                <p className="text-sm font-medium text-foreground mb-1">
                  No approval steps yet
                </p>
                <p className="text-xs text-muted-foreground mb-4">
                  Click the button below to add your first approver.
                  <br />
                  Example: Step 1 → Site Manager, Step 2 → Finance Head
                </p>
              </div>
            )}

            {/* Level cards */}
            <div className="space-y-0">
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

              {/* Arrow between last card and add row */}
              {levels.length > 0 && !addingLevel && (
                <div className="flex items-center gap-3 py-1 pl-3.5">
                  <div className="w-0.5 h-5 bg-primary/30" />
                </div>
              )}

              {addingLevel ? (
                <AddLevelRow
                  users={users}
                  levelNumber={levels.length + 1}
                  onConfirm={addLevel}
                  onCancel={() => setAddingLevel(false)}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setAddingLevel(true)}
                  className={cn(
                    "inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 border-dashed text-sm transition-all",
                    "border-border text-muted-foreground hover:border-primary hover:text-primary hover:bg-primary/5",
                    levels.length > 0 && "ml-11",
                  )}
                >
                  <Plus className="w-4 h-4" />
                  {levels.length === 0
                    ? "Add first approval step"
                    : "Add another step"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-border bg-muted/10 rounded-b-xl">
        <p className="text-xs text-muted-foreground">
          {levels.length > 0 && selectedModules.length > 0
            ? `✓ Ready — ${levels.length} step${levels.length > 1 ? "s" : ""} across ${selectedModules.length} area${selectedModules.length > 1 ? "s" : ""}`
            : "Fill in all steps above to save"}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            Discard
          </Button>
          <Button
            size="sm"
            className="gap-1.5 bg-gradient-to-r from-blue-500 to-indigo-600 shadow-sm hover:opacity-90 text-white font-semibold px-5"
            onClick={submit}
            disabled={saving}
          >
            {saving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5" />
            )}
            {initial ? "Save Changes" : "Save Rule"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Module group selector ─────────────────────────────────────────────────────

function ModuleGroupSelector({
  selectedModules,
  toggleModule,
}: {
  selectedModules: string[];
  toggleModule: (id: string) => void;
}) {
  const [openGroups, setOpenGroups] = React.useState<string[]>(() =>
    MODULE_GROUPS.filter((g) =>
      g.modules.some((mid) => selectedModules.includes(mid)),
    ).map((g) => g.id),
  );

  const toggleGroup = (gid: string) =>
    setOpenGroups((prev) =>
      prev.includes(gid) ? prev.filter((x) => x !== gid) : [...prev, gid],
    );

  const toggleGroupAll = (g: (typeof MODULE_GROUPS)[number]) => {
    const allSelected = g.modules.every((mid) => selectedModules.includes(mid));
    g.modules.forEach((mid) => {
      const isSelected = selectedModules.includes(mid);
      if (allSelected && isSelected) toggleModule(mid);
      else if (!allSelected && !isSelected) toggleModule(mid);
    });
  };

  return (
    <div className="flex flex-wrap gap-2">
      {MODULE_GROUPS.map((group) => {
        const isOpen = openGroups.includes(group.id);
        const groupMods = MODULE_OPTIONS.filter((m) =>
          (group.modules as readonly string[]).includes(m.id),
        );
        const selectedCount = groupMods.filter((m) =>
          selectedModules.includes(m.id),
        ).length;
        const allSelected = selectedCount === groupMods.length;
        const someSelected = selectedCount > 0 && !allSelected;

        return (
          <div key={group.id} className="relative">
            <div
              className={cn(
                "inline-flex items-center rounded-lg border transition-all overflow-visible",
                someSelected || allSelected
                  ? "border-primary bg-primary/10"
                  : "border-border bg-muted/30",
              )}
            >
              <button
                type="button"
                onClick={() => toggleGroupAll(group)}
                title={allSelected ? "Deselect all" : "Select all"}
                className={cn(
                  "flex items-center gap-1.5 pl-3 pr-2 py-2 text-sm transition-colors",
                  allSelected
                    ? "text-primary font-medium"
                    : someSelected
                      ? "text-primary/70 font-medium"
                      : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="text-base">{group.icon}</span>
                <span>{group.label}</span>
                {selectedCount > 0 && (
                  <span className="text-[10px] font-bold bg-primary/20 text-primary px-1.5 py-0.5 rounded-full">
                    {selectedCount}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                className={cn(
                  "px-2 py-2 border-l transition-colors",
                  isOpen
                    ? "border-primary/30 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                <ChevronDown
                  className={cn(
                    "w-3.5 h-3.5 transition-transform duration-200",
                    isOpen && "rotate-180",
                  )}
                />
              </button>
            </div>

            {isOpen && (
              <div className="absolute top-full left-0 mt-1 z-20 bg-card border border-border rounded-xl shadow-xl py-1 min-w-[200px]">
                {groupMods.map((m) => {
                  const active = selectedModules.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => toggleModule(m.id)}
                      title={m.desc}
                      className={cn(
                        "w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors text-left",
                        active
                          ? "text-primary bg-primary/5"
                          : "text-foreground hover:bg-muted/50",
                      )}
                    >
                      <span className="text-base">{m.icon}</span>
                      <span className="flex-1">{m.label}</span>
                      {active && (
                        <Check className="w-3.5 h-3.5 shrink-0 text-primary" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
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
        toast.success(
          editing ? "Approval rule updated" : "Approval rule created",
        );
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
      if (
        !confirm(
          "Are you sure you want to delete this approval rule? This cannot be undone.",
        )
      )
        return;
      try {
        await apiDelete(id);
        toast.success("Approval rule deleted");
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
      <AdminShell
        title="Approval Rules"
        subtitle="Control who needs to approve requests before they go through — like purchase orders, expenses, and more."
        icon={ShieldCheck}
        action={
          mode === "list" && canCreate && (
            <Button
              className="bg-gradient-to-r from-blue-500 to-indigo-600 shadow-sm hover:opacity-90 gap-1.5 shrink-0 font-heading font-semibold text-white text-sm px-5 py-2 h-auto"
              onClick={() => {
                setEditing(null);
                setMode("new");
              }}
            >
              <Plus className="h-4 w-4" /> New Approval Rule
            </Button>
          )
        }
      >
        {/* Form */}
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

        {/* List */}
        {mode === "list" && (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-border bg-muted/20">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <ShieldCheck className="w-4 h-4 text-primary" />
              </div>
              <div>
                <div className="text-sm font-semibold text-foreground">
                  Your Approval Rules
                </div>
                <div className="text-xs text-muted-foreground">
                  {workflows.length === 0
                    ? "No rules set up yet"
                    : `${workflows.length} rule${workflows.length > 1 ? "s" : ""} — toggle to turn them on or off`}
                </div>
              </div>
            </div>

            {workflows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center px-6">
                <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
                  <ShieldCheck className="w-8 h-8 text-muted-foreground/30" />
                </div>
                <div className="text-base font-semibold text-foreground mb-1">
                  No approval rules yet
                </div>
                <p className="text-sm text-muted-foreground mb-5 max-w-sm">
                  Once you create a rule, any matching request will
                  automatically be sent for approval before it's processed.
                </p>
                {canCreate && (
                  <Button
                    className="bg-gradient-to-r from-blue-500 to-indigo-600 shadow-sm hover:opacity-90 text-white gap-1.5 font-semibold"
                    onClick={() => {
                      setEditing(null);
                      setMode("new");
                    }}
                  >
                    <Plus className="w-4 h-4" /> Create your first rule
                  </Button>
                )}
              </div>
            ) : (
              <div className="divide-y divide-border/60">
                {workflows.map((wf) => {
                  const typeInfo = APPROVAL_TYPES.find((t) => t.id === wf.type);
                  const TypeIcon = typeInfo?.icon ?? ArrowDown;
                  return (
                    <div
                      key={wf.id}
                      className={cn(
                        "flex items-center gap-4 px-5 py-4 transition-colors",
                        wf.active
                          ? "hover:bg-muted/20"
                          : "opacity-60 hover:bg-muted/10",
                      )}
                    >
                      {/* Active indicator */}
                      <div
                        className={cn(
                          "w-2 h-2 rounded-full flex-shrink-0",
                          wf.active ? "bg-green-500" : "bg-muted-foreground/30",
                        )}
                      />

                      {/* Main info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-foreground">
                            {wf.name}
                          </span>
                          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full border border-border">
                            <TypeIcon className="w-3 h-3" />
                            {typeInfo?.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                          {/* Modules */}
                          <div className="flex flex-wrap gap-1">
                            {wf.modules.slice(0, 4).map((mid) => {
                              const m = MODULE_OPTIONS.find(
                                (x) => x.id === mid,
                              );
                              return (
                                <span
                                  key={mid}
                                  className="text-[11px] px-2 py-0.5 rounded-full bg-muted border border-border text-muted-foreground"
                                >
                                  {m?.icon} {m?.label ?? mid}
                                </span>
                              );
                            })}
                            {wf.modules.length > 4 && (
                              <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted border border-border text-muted-foreground">
                                +{wf.modules.length - 4} more
                              </span>
                            )}
                          </div>
                          {/* Levels summary */}
                          <span className="text-[11px] text-muted-foreground">
                            {wf.levels.length} approval step
                            {wf.levels.length !== 1 ? "s" : ""}
                          </span>
                        </div>
                      </div>

                      {/* Toggle + actions */}
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <div className="flex flex-col items-center gap-0.5">
                          <Switch
                            checked={wf.active}
                            onCheckedChange={() => handleToggle(wf.id)}
                            disabled={!canEdit}
                          />
                          <span className="text-[10px] text-muted-foreground">
                            {wf.active ? "On" : "Off"}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 border-l border-border pl-3">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                            disabled={!canEdit}
                            title="Edit this rule"
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
                            className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                            disabled={!canDel}
                            title="Delete this rule"
                            onClick={() => handleDelete(wf.id)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </AdminShell>
    </>
  );
}
