import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import * as spApi from "@/api/supplierPortalApi";
import { useTheme } from "@/contexts/ThemeContext";
import {
  AlertTriangle, Clock, CheckCircle2, Bell, ChevronRight,
  RefreshCw, FileText, Zap, Package,
} from "lucide-react";

const fade = (delay = 0) => ({
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.38, delay, ease: [0.16, 1, 0.3, 1] as const },
});

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const fmtRelative = (d?: string | null) => {
  if (!d) return "";
  const diff = Date.now() - new Date(d).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return fmtDate(d);
};

type Alert = {
  id: string;
  type: "overdue" | "due_soon" | "new" | "submitted" | "goods_pending";
  title: string;
  subtitle: string;
  time?: string;
  href: string;
};

export default function SupplierNotifications() {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isDark = theme !== "light";

  const { data: quotations = [], isLoading: loadingQ, refetch: refetchQ, isFetching: fetchingQ } = useQuery({
    queryKey: ["supplier-quotations"],
    queryFn: spApi.getSupplierQuotations,
    refetchInterval: 60_000,
  });
  const { data: grnOrders = [], isLoading: loadingG, refetch: refetchG, isFetching: fetchingG } = useQuery({
    queryKey: ["supplier-grns"],
    queryFn: spApi.getSupplierGrnSummary,
    refetchInterval: 60_000,
  });
  const isLoading = loadingQ || loadingG;
  const isFetching = fetchingQ || fetchingG;
  const refetch = () => { refetchQ(); refetchG(); };

  const now = Date.now();
  const THREE_DAYS = 3 * 86_400_000;

  const alerts: Alert[] = [];

  quotations.forEach((q) => {
    const due = q.DueDate ? new Date(q.DueDate).getTime() : null;
    const invited = q.InvitedAt ? new Date(q.InvitedAt).getTime() : null;
    const isPending = q.MySubmissionStatus === "Pending";
    const isSubmitted = q.MySubmissionStatus === "Submitted";

    if (isPending && due && due < now) {
      alerts.push({
        id: `overdue-${q.QuotationId}`,
        type: "overdue",
        title: `${q.DocNo} is overdue`,
        subtitle: `Due ${fmtDate(q.DueDate)} — ${q.ItemCount} item${q.ItemCount !== 1 ? "s" : ""} awaiting your rates`,
        time: q.DueDate,
        href: `/supplier/quotation/${q.QuotationId}`,
      });
    } else if (isPending && due && due - now <= THREE_DAYS) {
      alerts.push({
        id: `soon-${q.QuotationId}`,
        type: "due_soon",
        title: `${q.DocNo} due soon`,
        subtitle: `Closes ${fmtDate(q.DueDate)} — ${q.ItemCount} item${q.ItemCount !== 1 ? "s" : ""} need rates`,
        time: q.DueDate,
        href: `/supplier/quotation/${q.QuotationId}`,
      });
    } else if (isPending && invited && now - invited < 7 * 86_400_000) {
      alerts.push({
        id: `new-${q.QuotationId}`,
        type: "new",
        title: `New RFQ: ${q.DocNo}`,
        subtitle: `${q.CompanyName ?? "Company"} — ${q.ItemCount} item${q.ItemCount !== 1 ? "s" : ""}, due ${fmtDate(q.DueDate)}`,
        time: q.InvitedAt,
        href: `/supplier/quotation/${q.QuotationId}`,
      });
    } else if (isSubmitted) {
      alerts.push({
        id: `submitted-${q.QuotationId}`,
        type: "submitted",
        title: `${q.DocNo} submitted`,
        subtitle: `Your prices have been shared with the procurement team`,
        time: q.SubmittedAt ?? q.InvitedAt,
        href: `/supplier/quotation/${q.QuotationId}`,
      });
    }
  });

  grnOrders.forEach((o) => {
    if (o.isFullyReceived) return;
    const shortfall = o.items.filter((it) => it.remainingQty > 0);
    alerts.push({
      id: `goods-${o.purchaseOrderId}`,
      type: "goods_pending",
      title: `${o.docNo}: ${o.totalRemaining} item${o.totalRemaining !== 1 ? "s" : ""} still pending`,
      subtitle: shortfall
        .map((it) => `${it.remainingQty} ${it.uom ?? ""} ${it.itemName}`.trim())
        .join(", "),
      href: `/supplier?order=${o.purchaseOrderId}`,
    });
  });

  // Sort: overdue first, then due_soon, then new, then goods_pending, then submitted
  const ORDER: Record<string, number> = { overdue: 0, due_soon: 1, new: 2, goods_pending: 3, submitted: 4 };
  alerts.sort((a, b) => ORDER[a.type] - ORDER[b.type]);

  const META = {
    overdue: {
      icon: AlertTriangle,
      color: "text-red-500 dark:text-red-400",
      bg: "bg-red-50 dark:bg-red-500/10",
      border: "border-red-200 dark:border-red-500/20",
      label: "Overdue",
      labelColor: "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20",
    },
    due_soon: {
      icon: Clock,
      color: "text-amber-500",
      bg: "bg-amber-50 dark:bg-amber-500/10",
      border: "border-amber-200 dark:border-amber-500/20",
      label: "Due Soon",
      labelColor: "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20",
    },
    new: {
      icon: Zap,
      color: "text-blue-500",
      bg: "bg-blue-50 dark:bg-blue-500/10",
      border: "border-blue-200 dark:border-blue-500/20",
      label: "New",
      labelColor: "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20",
    },
    submitted: {
      icon: CheckCircle2,
      color: "text-emerald-500",
      bg: "bg-emerald-50 dark:bg-emerald-500/10",
      border: "border-emerald-200 dark:border-emerald-500/20",
      label: "Submitted",
      labelColor: "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20",
    },
    goods_pending: {
      icon: Package,
      color: "text-amber-500",
      bg: "bg-amber-50 dark:bg-amber-500/10",
      border: "border-amber-200 dark:border-amber-500/20",
      label: "Pending Delivery",
      labelColor: "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20",
    },
  };

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-background">
      <div className="fixed inset-0 pointer-events-none z-0">
        <div style={{
          position: "absolute", top: "-5%", left: "50%", transform: "translateX(-50%)",
          width: "60vw", height: "30vh",
          background: `radial-gradient(ellipse at 50% 0%, rgba(16,185,129,${isDark ? "0.06" : "0.03"}) 0%, transparent 70%)`,
        }} />
      </div>

      <div className="relative z-10 max-w-2xl mx-auto px-4 py-8 space-y-5">

        {/* Header */}
        <motion.div {...fade(0)} className="flex items-center justify-between">
          <div>
            <h1 className="font-heading text-xl font-bold text-foreground flex items-center gap-2">
              <Bell size={18} className="text-emerald-500" /> Notifications
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {alerts.length === 0 ? "All caught up" : `${alerts.length} alert${alerts.length !== 1 ? "s" : ""} require attention`}
            </p>
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
          >
            <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} /> Refresh
          </button>
        </motion.div>

        {/* Alerts list */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 rounded-xl bg-muted/50 animate-pulse" />
            ))}
          </div>
        ) : alerts.length === 0 ? (
          <motion.div {...fade(0.08)}
            className="flex flex-col items-center justify-center py-16 text-center rounded-2xl border border-dashed border-border"
          >
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center mb-3">
              <Bell size={22} className="text-emerald-500" />
            </div>
            <p className="font-heading font-semibold text-foreground text-sm">All clear!</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-[200px]">
              No pending alerts. You'll be notified when new RFQs arrive.
            </p>
          </motion.div>
        ) : (
          <div className="space-y-2.5">
            {alerts.map((alert, i) => {
              const m = META[alert.type];
              const Icon = m.icon;
              return (
                <motion.button
                  key={alert.id}
                  {...fade(0.06 + i * 0.04)}
                  onClick={() => navigate(alert.href)}
                  className={`w-full flex items-center gap-4 px-4 py-4 rounded-xl border text-left hover:shadow-sm transition-all group ${m.border} bg-card hover:bg-card/80`}
                >
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${m.bg}`}>
                    <Icon size={16} className={m.color} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-foreground truncate">{alert.title}</span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${m.labelColor}`}>
                        {m.label}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{alert.subtitle}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {alert.time && (
                      <span className="text-[10px] text-muted-foreground/60 hidden sm:block">
                        {fmtRelative(alert.time)}
                      </span>
                    )}
                    <ChevronRight size={14} className="text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
                  </div>
                </motion.button>
              );
            })}
          </div>
        )}

        {/* Footer hint */}
        {!isLoading && alerts.length > 0 && (
          <motion.div {...fade(0.2)} className="flex items-center justify-center gap-1.5 py-2">
            <FileText size={11} className="text-muted-foreground/40" />
            <span className="text-[11px] text-muted-foreground/50">
              Alerts are generated from your active RFQ list
            </span>
          </motion.div>
        )}
      </div>
    </div>
  );
}
