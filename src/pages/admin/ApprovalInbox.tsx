import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { StatusBadge } from "@/components/StatusBadge";
import { ApprovalActions } from "@/components/ApprovalActions";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { formatINR } from "@/utils/formatCurrency";
import {
  ClipboardCheck,
  ClipboardList,
  Package,
  Hammer,
  Banknote,
  Truck,
  Receipt,
  ArrowDownCircle,
  RefreshCw,
  ArrowUpRight,
  Inbox,
  CheckCircle2,
  XCircle,
  User,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface InboxItem {
  Module: string;
  ModuleLabel: string;
  RecordId: string;
  Reference: string | null;
  RecordDate: string | null;
  Status: string;
  ContractorName: string | null;
  SupplierName: string | null;
  Amount: number | null;
  CreatedBy: string | null;
  ApprovedBy: string | null;
  ApprovedAt: string | null;
  RejectedBy: string | null;
  RejectionNote: string | null;
  LastModified: string | null;
}

// ─── Module config ────────────────────────────────────────────────────────────
// Module keys MUST match what approvalService.js TABLE_REGISTRY uses
// and what the backend route file is mounted as in server.js

const MODULE_CONFIG: Record<
  string,
  {
    icon: React.ElementType;
    color: string;
    navPath: string;
    apiEndpoint: string;
    label: string;
  }
> = {
  "purchase-orders": {
    icon: Package,
    color: "text-blue-500 bg-blue-500/10",
    navPath: "/material/purchase-order",
    apiEndpoint: "/api/purchase-orders",
    label: "Purchase Orders",
  },
  "work-orders": {
    icon: Hammer,
    color: "text-amber-500 bg-amber-500/10",
    navPath: "/material/work-order",
    apiEndpoint: "/api/work-orders",
    label: "Work Orders",
  },
  payments: {
    icon: Banknote,
    color: "text-emerald-500 bg-emerald-500/10",
    navPath: "/payments",
    apiEndpoint: "/api/new-payment",
    label: "Payments",
  },
  // KEY FIX: was "grns" — now "goods-receipt" to match approvalService TABLE_REGISTRY
  "goods-receipt": {
    icon: Truck,
    color: "text-violet-500 bg-violet-500/10",
    navPath: "/material/grn",
    apiEndpoint: "/api/grns",
    label: "GRNs",
  },
  "expense-booking": {
    icon: Receipt,
    color: "text-rose-500 bg-rose-500/10",
    navPath: "/material/expense-booking",
    apiEndpoint: "/api/expense-booking",
    label: "Expense Bookings",
  },
  "received-payment": {
    icon: ArrowDownCircle,
    color: "text-teal-500 bg-teal-500/10",
    navPath: "/received-payments",
    apiEndpoint: "/api/received-payment",
    label: "Received Payments",
  },

  // Engineering → Work Done approval
  "work-done": {
    icon: Hammer,
    color: "text-emerald-500 bg-emerald-500/10",
    navPath: "/engineering/work-done",
    apiEndpoint: "/api/engineering/work-done",
    label: "Work Done",
  },
  boq: {
    icon: ClipboardCheck,
    color: "text-indigo-500 bg-indigo-500/10",
    navPath: "/engineering/boq",
    apiEndpoint: "/api/boq",
    label: "BOQ",
  },
  "material-requests": {
    icon: ClipboardList,
    color: "text-orange-500 bg-orange-500/10",
    navPath: "/material/material-request",
    apiEndpoint: "/api/material-requests",
    label: "Material Requests",
  },
};

const ALL_MODULES = Object.keys(MODULE_CONFIG);

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fetchInbox = async (module?: string): Promise<InboxItem[]> => {
  const url = module
    ? `/api/approval-inbox?module=${module}`
    : "/api/approval-inbox";
  const res = await fetchWithAuth(url);
  if (!res.ok) throw new Error("Failed to fetch approval inbox");
  return res.json();
};

const fmtDate = (d: string | null) => {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "—";
  }
};

const fmtAmount = (n: number | null) => {
  if (n == null) return "—";
  return formatINR(n, { decimals: 2 });
};

// ─── Module filter tab ────────────────────────────────────────────────────────

const ModuleTab: React.FC<{
  module: string | null;
  label: string;
  icon?: React.ElementType;
  count: number;
  active: boolean;
  onClick: () => void;
}> = ({ label, icon: Icon, count, active, onClick }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
      active
        ? "bg-primary text-primary-foreground shadow-sm"
        : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
    }`}
  >
    {Icon && <Icon size={13} />}
    <span>{label}</span>
    {count > 0 && (
      <span
        className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${
          active ? "bg-white/20 text-white" : "bg-muted text-muted-foreground"
        }`}
      >
        {count}
      </span>
    )}
  </button>
);

// ─── Inbox row ────────────────────────────────────────────────────────────────

const InboxRow: React.FC<{
  item: InboxItem;
  onActionDone: () => void;
  onOptimisticUpdate: (recordId: string, module: string) => void;
}> = ({ item, onActionDone, onOptimisticUpdate }) => {
  const navigate = useNavigate();
  const cfg = MODULE_CONFIG[item.Module];
  const Icon = cfg?.icon ?? ClipboardCheck;

  const approvedBy = item.ApprovedBy?.trim();
  const rejectedBy = item.RejectedBy?.trim();

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 px-4 py-3.5 border-b border-border last:border-0 hover:bg-muted/30 transition-colors group">
      {/* Module icon + label */}
      <div className="flex items-center gap-3 min-w-[160px]">
        <div
          className={`p-2 rounded-lg shrink-0 ${
            cfg?.color ?? "bg-muted text-muted-foreground"
          }`}
        >
          <Icon size={14} />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-foreground">
            {item.ModuleLabel}
          </p>
          <p className="text-[11px] text-muted-foreground font-mono truncate">
            {item.Reference || `#${item.RecordId}`}
          </p>
        </div>
      </div>

      {/* Date */}
      <div className="hidden md:block min-w-[100px]">
        <p className="text-[11px] text-muted-foreground">Date</p>
        <p className="text-xs text-foreground">{fmtDate(item.RecordDate)}</p>
      </div>

      {/* Party */}
      <div className="hidden lg:block flex-1 min-w-0">
        <p className="text-[11px] text-muted-foreground">Party</p>
        <p className="text-xs text-foreground truncate">
          {item.SupplierName || item.ContractorName || item.CreatedBy || "—"}
        </p>
      </div>

      {/* Amount */}
      <div className="hidden md:block min-w-[100px]">
        <p className="text-[11px] text-muted-foreground">Amount</p>
        <p className="text-xs font-mono font-semibold text-foreground">
          {fmtAmount(item.Amount)}
        </p>
      </div>

      {/* ApprovedBy / RejectedBy indicator */}
      {(approvedBy || rejectedBy) && (
        <div className="hidden lg:flex items-center gap-1.5 min-w-[140px]">
          {approvedBy && (
            <span className="flex items-center gap-1 text-[10px] text-emerald-600 bg-emerald-500/10 border border-emerald-400/20 px-2 py-0.5 rounded-full font-heading truncate max-w-[130px]">
              <CheckCircle2 size={9} />
              {approvedBy}
            </span>
          )}
          {rejectedBy && (
            <span className="flex items-center gap-1 text-[10px] text-red-600 bg-red-500/10 border border-red-400/20 px-2 py-0.5 rounded-full font-heading truncate max-w-[130px]">
              <XCircle size={9} />
              {rejectedBy}
            </span>
          )}
        </div>
      )}

      {/* Status */}
      <div className="shrink-0">
        <StatusBadge status={item.Status} />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 shrink-0 ml-auto">
        <ApprovalActions
          status={item.Status}
          recordId={item.RecordId}
          endpoint={cfg?.apiEndpoint ?? `/api/${item.Module}`}
          onSuccess={(action) => {
            if (action === "approve" || action === "reject") {
              onOptimisticUpdate(item.RecordId, item.Module);
            }
            onActionDone();
          }}
        />
        {cfg?.navPath && (
          <button
            onClick={() => navigate(cfg.navPath)}
            className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors opacity-0 group-hover:opacity-100"
            title={`Go to ${item.ModuleLabel}`}
          >
            <ArrowUpRight size={14} />
          </button>
        )}
      </div>
    </div>
  );
};

// ─── Main Page ────────────────────────────────────────────────────────────────

const ApprovalInbox: React.FC = () => {
  const queryClient = useQueryClient();
  const [activeModule, setActiveModule] = useState<string | null>(null);

  const {
    data: items = [],
    isLoading,
    isRefetching,
    refetch,
  } = useQuery({
    queryKey: ["approval-inbox", activeModule],
    queryFn: () => fetchInbox(activeModule ?? undefined),
    refetchInterval: 60_000,
  });

  const [removedKeys, setRemovedKeys] = useState<Set<string>>(new Set());

  const handleOptimisticUpdate = (recordId: string, module: string) => {
    setRemovedKeys((prev) => new Set(prev).add(`${module}-${recordId}`));
  };

  const handleActionDone = () => {
    queryClient.invalidateQueries({ queryKey: ["approval-inbox"] });
    queryClient.invalidateQueries({ queryKey: ["payments"], exact: false });
    queryClient.invalidateQueries({ queryKey: ["boqs"], exact: false });
  };

  const { data: allItems = [] } = useQuery({
    queryKey: ["approval-inbox", null],
    queryFn: () => fetchInbox(),
  });

  const countFor = (mod: string) =>
    allItems.filter((i) => i.Module === mod).length;
  const totalCount = allItems.length;

  return (
    <>
      <Breadcrumbs items={["Approvals", "Inbox"]} />

      {/* Page header */}
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-heading font-bold text-foreground">
              Approval Inbox
            </h1>
            {totalCount > 0 && (
              <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full leading-none">
                {totalCount}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 hidden sm:block">
            All records awaiting your approval across every module
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isRefetching}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-xs text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
        >
          <RefreshCw size={13} className={isRefetching ? "animate-spin" : ""} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      {/* Module filter tabs */}
      <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-1 scrollbar-hide">
        <ModuleTab
          module={null}
          label="All"
          icon={ClipboardCheck}
          count={totalCount}
          active={activeModule === null}
          onClick={() => setActiveModule(null)}
        />
        {ALL_MODULES.map((mod) => {
          const cfg = MODULE_CONFIG[mod];
          return (
            <ModuleTab
              key={mod}
              module={mod}
              label={cfg.label}
              icon={cfg.icon}
              count={countFor(mod)}
              active={activeModule === mod}
              onClick={() => setActiveModule(activeModule === mod ? null : mod)}
            />
          );
        })}
      </div>

      {/* Content */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {isLoading ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-4 px-4 py-3.5 animate-pulse"
              >
                <div className="w-8 h-8 rounded-lg bg-muted shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-32 rounded bg-muted" />
                  <div className="h-2.5 w-24 rounded bg-muted" />
                </div>
                <div className="h-6 w-20 rounded-full bg-muted" />
                <div className="h-7 w-24 rounded-lg bg-muted" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-4">
            <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mb-4">
              <Inbox size={24} className="text-muted-foreground/40" />
            </div>
            <p className="text-sm font-semibold text-foreground">
              {activeModule ? "No pending items in this module" : "All clear!"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {activeModule
                ? "Switch to All to see the full inbox"
                : "No records are awaiting approval right now"}
            </p>
          </div>
        ) : (
          <>
            {/* Table header — desktop */}
            <div className="hidden sm:grid grid-cols-[160px_100px_1fr_100px_140px_120px_auto] gap-4 px-4 py-2.5 bg-muted/40 border-b border-border">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Module / Ref
              </p>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Date
              </p>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Party
              </p>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Amount
              </p>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Approved/Rejected By
              </p>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Status
              </p>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Actions
              </p>
            </div>

            <div>
              {items
                .filter(
                  (item) => !removedKeys.has(`${item.Module}-${item.RecordId}`),
                )
                .map((item) => (
                  <InboxRow
                    key={`${item.Module}-${item.RecordId}`}
                    item={item}
                    onActionDone={handleActionDone}
                    onOptimisticUpdate={handleOptimisticUpdate}
                  />
                ))}
            </div>

            <div className="px-4 py-2.5 border-t border-border bg-muted/20">
              <p className="text-[11px] text-muted-foreground">
                {items.length} record{items.length !== 1 ? "s" : ""} pending
                approval
                {activeModule &&
                  ` in ${MODULE_CONFIG[activeModule]?.label ?? activeModule}`}
              </p>
            </div>
          </>
        )}
      </div>
    </>
  );
};

export default ApprovalInbox;
