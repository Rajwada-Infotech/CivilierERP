import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { StatusBadge } from "@/components/StatusBadge";
import { ApprovalActions } from "@/components/ApprovalActions";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { formatINR } from "@/utils/formatCurrency";
import { computeGrnNetWithTerms } from "@/pages/material/ExpenseBooking/helpers";
import {
  ClipboardCheck,
  ClipboardList,
  Package,
  PackageOpen,
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
  // expense-booking only — null for all other modules
  GrnTotalAmount: number | null;
  BillingTermsData: string | null;
}

// ─── Module config ────────────────────────────────────────────────────────────

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
  "material-issues": {
    icon: PackageOpen,
    color: "text-cyan-500 bg-cyan-500/10",
    navPath: "/material/issues",
    apiEndpoint: "/api/material-issues",
    label: "Material Issues",
  },
};

const ALL_MODULES = Object.keys(MODULE_CONFIG);

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fetchInbox = async (): Promise<InboxItem[]> => {
  const res = await fetchWithAuth("/api/approval-inbox");
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? "Failed to fetch approval inbox");
  }
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

/**
 * For expense-booking rows, if the record is GRN-linked, compute net payable
 * by applying billing terms on top of the live GRN total — same logic as the
 * Expense Booking list page and preview modal.  Falls back to stored Amount for
 * all other modules or non-GRN expense bookings.
 */
function getEffectiveAmount(item: InboxItem): number | null {
  if (
    item.Module === "expense-booking" &&
    item.GrnTotalAmount != null &&
    item.GrnTotalAmount > 0
  ) {
    let terms: any[] = [];
    try {
      if (item.BillingTermsData) {
        let parsed = JSON.parse(item.BillingTermsData);
        if (typeof parsed === "string") parsed = JSON.parse(parsed);
        if (Array.isArray(parsed)) terms = parsed;
      }
    } catch {
      /* ignore malformed JSON */
    }
    return computeGrnNetWithTerms(item.GrnTotalAmount, terms);
  }
  return item.Amount;
}

// ─── Module filter tab ────────────────────────────────────────────────────────

const MODULE_TAB_COLORS: Record<string, { inactive: string; active: string }> =
  {
    "purchase-orders": {
      inactive:
        "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20",
      active: "bg-blue-500 text-white border-blue-500 font-semibold",
    },
    "work-orders": {
      inactive:
        "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20",
      active: "bg-amber-500 text-white border-amber-500 font-semibold",
    },
    payments: {
      inactive:
        "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20",
      active: "bg-emerald-500 text-white border-emerald-500 font-semibold",
    },
    "goods-receipt": {
      inactive:
        "border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400 hover:bg-violet-500/20",
      active: "bg-violet-500 text-white border-violet-500 font-semibold",
    },
    "expense-booking": {
      inactive:
        "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20",
      active: "bg-rose-500 text-white border-rose-500 font-semibold",
    },
    "received-payment": {
      inactive:
        "border-teal-500/30 bg-teal-500/10 text-teal-600 dark:text-teal-400 hover:bg-teal-500/20",
      active: "bg-teal-500 text-white border-teal-500 font-semibold",
    },
    "work-done": {
      inactive:
        "border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-600/20",
      active: "bg-emerald-600 text-white border-emerald-600 font-semibold",
    },
    boq: {
      inactive:
        "border-indigo-500/30 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/20",
      active: "bg-indigo-500 text-white border-indigo-500 font-semibold",
    },
    "material-requests": {
      inactive:
        "border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-400 hover:bg-orange-500/20",
      active: "bg-orange-500 text-white border-orange-500 font-semibold",
    },
    "material-issues": {
      inactive:
        "border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/20",
      active: "bg-cyan-500 text-white border-cyan-500 font-semibold",
    },
  };

const ModuleTab: React.FC<{
  module: string | null;
  label: string;
  icon?: React.ElementType;
  count: number;
  active: boolean;
  onClick: () => void;
}> = ({ module, label, icon: Icon, count, active, onClick }) => {
  const colors = module ? MODULE_TAB_COLORS[module] : null;
  const activeClass = colors
    ? colors.active
    : "gradient-accent text-white border-transparent font-semibold";
  const inactiveClass = colors
    ? colors.inactive
    : "border-border bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground";

  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-all whitespace-nowrap ${
        active ? activeClass : inactiveClass
      }`}
    >
      {Icon && <Icon size={12} />}
      <span>{label}</span>
      {count > 0 && (
        <span
          className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${
            active
              ? "bg-white/20 text-white"
              : "bg-muted/60 text-muted-foreground"
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
};

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
  const party =
    item.SupplierName || item.ContractorName || item.CreatedBy || "—";
  const effectiveAmount = getEffectiveAmount(item);

  const actions = (
    <div className="flex items-center gap-2 [&_button]:!filter-none [&_button]:!backdrop-filter-none">
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
          className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
          title={`Go to ${item.ModuleLabel}`}
        >
          <ArrowUpRight size={14} />
        </button>
      )}
    </div>
  );

  return (
    <>
      {/* ── Mobile card (< md) ─────────────────────────────────────────── */}
      <div className="md:hidden border-b border-border last:border-0 px-4 py-3.5 space-y-3">
        {/* Row 1: module + status */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className={`p-1.5 rounded-lg shrink-0 ${cfg?.color ?? "bg-muted text-muted-foreground"}`}
            >
              <Icon size={13} />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-foreground truncate">
                {item.ModuleLabel}
              </p>
              <p className="text-[11px] text-muted-foreground font-mono truncate">
                {item.Reference || `#${item.RecordId}`}
              </p>
            </div>
          </div>
          <StatusBadge status={item.Status} />
        </div>

        {/* Row 2: party + date */}
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="truncate">{party}</span>
          <span className="shrink-0">{fmtDate(item.RecordDate)}</span>
        </div>

        {/* Row 3: amount + approved/rejected by */}
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-mono font-semibold text-foreground">
            {fmtAmount(effectiveAmount)}
          </p>
          <div className="flex items-center gap-1.5">
            {approvedBy && (
              <span className="flex items-center gap-1 text-[10px] text-emerald-600 bg-emerald-500/10 border border-emerald-400/20 px-2 py-0.5 rounded-full truncate max-w-[120px]">
                <CheckCircle2 size={9} /> {approvedBy}
              </span>
            )}
            {rejectedBy && (
              <span className="flex items-center gap-1 text-[10px] text-red-600 bg-red-500/10 border border-red-400/20 px-2 py-0.5 rounded-full truncate max-w-[120px]">
                <XCircle size={9} /> {rejectedBy}
              </span>
            )}
          </div>
        </div>

        {/* Row 4: actions */}
        <div>{actions}</div>
      </div>

      {/* ── Desktop row (≥ md) ─────────────────────────────────────────── */}
      <div className="hidden md:grid grid-cols-[190px_100px_1fr_110px_150px_120px_1fr] items-center gap-2 px-4 py-3.5 border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
        {/* Col 1 — Module */}
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`p-2 rounded-lg shrink-0 ${cfg?.color ?? "bg-muted text-muted-foreground"}`}
          >
            <Icon size={14} />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground truncate">
              {item.ModuleLabel}
            </p>
            <p className="text-[11px] text-muted-foreground font-mono truncate">
              {item.Reference || `#${item.RecordId}`}
            </p>
          </div>
        </div>

        {/* Col 2 — Date */}
        <p className="text-xs text-foreground">{fmtDate(item.RecordDate)}</p>

        {/* Col 3 — Party */}
        <p className="text-xs text-foreground truncate">{party}</p>

        {/* Col 4 — Amount */}
        <p className="text-xs font-mono font-semibold text-foreground">
          {fmtAmount(effectiveAmount)}
        </p>

        {/* Col 5 — Approved/Rejected By */}
        <div className="flex items-center gap-1.5 min-w-0">
          {approvedBy && (
            <span className="flex items-center gap-1 text-[10px] text-emerald-600 bg-emerald-500/10 border border-emerald-400/20 px-2 py-0.5 rounded-full truncate max-w-[130px]">
              <CheckCircle2 size={9} /> {approvedBy}
            </span>
          )}
          {rejectedBy && (
            <span className="flex items-center gap-1 text-[10px] text-red-600 bg-red-500/10 border border-red-400/20 px-2 py-0.5 rounded-full truncate max-w-[130px]">
              <XCircle size={9} /> {rejectedBy}
            </span>
          )}
        </div>

        {/* Col 6 — Status */}
        <div className="flex items-center">
          <StatusBadge status={item.Status} />
        </div>

        {/* Col 7 — Actions */}
        <div className="flex items-center gap-2 [&_button]:!filter-none [&_button]:!backdrop-filter-none">
          {actions}
        </div>
      </div>
    </>
  );
};

// ─── Main Page ────────────────────────────────────────────────────────────────

const ApprovalInbox: React.FC = () => {
  const queryClient = useQueryClient();
  const [activeModule, setActiveModule] = useState<string | null>(null);

  const {
    data: allItems = [],
    isLoading,
    isRefetching,
    refetch,
  } = useQuery({
    queryKey: ["approval-inbox"],
    queryFn: fetchInbox,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const [removedKeys, setRemovedKeys] = useState<Set<string>>(new Set());

  const items = (
    activeModule ? allItems.filter((i) => i.Module === activeModule) : allItems
  ).filter((i) => !removedKeys.has(`${i.Module}-${i.RecordId}`));

  const handleOptimisticUpdate = (recordId: string, module: string) => {
    setRemovedKeys((prev) => new Set(prev).add(`${module}-${recordId}`));
  };

  const handleActionDone = () => {
    queryClient.invalidateQueries({ queryKey: ["approval-inbox"] });
    queryClient.invalidateQueries({ queryKey: ["payments"], exact: false });
    queryClient.invalidateQueries({ queryKey: ["boqs"], exact: false });
  };

  const countFor = (mod: string) =>
    allItems.filter((i) => i.Module === mod).length;
  const totalCount = allItems.length;

  return (
    <>
      <Breadcrumbs items={["Approvals", "Inbox"]} />

      <div className="relative space-y-4 mt-6">
        {/* Page header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-heading font-bold text-foreground flex items-center gap-2">
                <Inbox className="text-primary" /> Approval Inbox
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
            className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50 shrink-0"
            title="Refresh"
          >
            <RefreshCw
              size={13}
              className={isRefetching ? "animate-spin" : ""}
            />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>

        {/* Module filter tabs — scrollable on mobile */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
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
                onClick={() =>
                  setActiveModule(activeModule === mod ? null : mod)
                }
              />
            );
          })}
        </div>

        {/* Content */}
        <div className="rounded-xl border border-border bg-card">
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
                {activeModule
                  ? "No pending items in this module"
                  : "All clear!"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {activeModule
                  ? "Switch to All to see the full inbox"
                  : "No records are awaiting approval right now"}
              </p>
            </div>
          ) : (
            <>
              {/* Desktop table header */}
              <div className="hidden md:grid grid-cols-[190px_100px_1fr_110px_150px_120px_1fr] gap-2 px-4 py-2.5 bg-muted/40 border-b border-border rounded-t-xl">
                {[
                  "Module / Ref",
                  "Date",
                  "Party",
                  "Amount",
                  "Approved/Rejected By",
                  "Status",
                  "Actions",
                ].map((h) => (
                  <p
                    key={h}
                    className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
                  >
                    {h}
                  </p>
                ))}
              </div>

              <div>
                {items.map((item) => (
                  <InboxRow
                    key={`${item.Module}-${item.RecordId}`}
                    item={item}
                    onActionDone={handleActionDone}
                    onOptimisticUpdate={handleOptimisticUpdate}
                  />
                ))}
              </div>

              <div className="px-4 py-2.5 border-t border-border bg-muted/20 rounded-b-xl">
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
      </div>
    </>
  );
};

export default ApprovalInbox;
