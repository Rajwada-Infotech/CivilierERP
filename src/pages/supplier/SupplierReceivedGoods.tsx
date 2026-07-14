import React from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import * as spApi from "@/api/supplierPortalApi";
import { useTheme } from "@/contexts/ThemeContext";
import {
  Package,
  CheckCircle2,
  Clock,
  ChevronRight,
  RefreshCw,
  Truck,
} from "lucide-react";

const fade = (delay = 0) => ({
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.38, delay, ease: [0.16, 1, 0.3, 1] as const },
});

const fmtDate = (d?: string | null) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

export default function SupplierReceivedGoods() {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isDark = theme !== "light";

  const {
    data: orders = [],
    isLoading,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["supplier-grns"],
    queryFn: spApi.getSupplierGrnSummary,
    refetchInterval: 60_000,
  });

  const pending = orders.filter((o) => !o.isFullyReceived);
  const complete = orders.filter((o) => o.isFullyReceived);
  const sorted = [...pending, ...complete];

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-background">
      <div className="fixed inset-0 pointer-events-none z-0">
        <div
          style={{
            position: "absolute",
            top: "-5%",
            left: "50%",
            transform: "translateX(-50%)",
            width: "60vw",
            height: "30vh",
            background: `radial-gradient(ellipse at 50% 0%, rgba(16,185,129,${isDark ? "0.06" : "0.03"}) 0%, transparent 70%)`,
          }}
        />
      </div>

      <div className="relative z-10 max-w-2xl mx-auto px-4 py-8 space-y-5">
        {/* Header */}
        <motion.div {...fade(0)} className="flex items-center justify-between">
          <div>
            <h1 className="font-heading text-xl font-bold text-foreground flex items-center gap-2">
              <Truck size={18} className="text-emerald-500" /> Received by Customer
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {pending.length === 0
                ? "All shipments fully received"
                : `${pending.length} order${pending.length !== 1 ? "s" : ""} still awaiting the remaining quantity`}
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

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 rounded-xl bg-muted/50 animate-pulse" />
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <motion.div
            {...fade(0.08)}
            className="flex flex-col items-center justify-center py-16 text-center rounded-2xl border border-dashed border-border"
          >
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center mb-3">
              <Package size={22} className="text-emerald-500" />
            </div>
            <p className="font-heading font-semibold text-foreground text-sm">
              No goods receipts yet
            </p>
            <p className="text-xs text-muted-foreground mt-1 max-w-[240px]">
              Once the customer logs a GRN against one of your orders, its
              receipt progress will show up here.
            </p>
          </motion.div>
        ) : (
          <div className="space-y-2.5">
            {sorted.map((o, i) => (
              <motion.button
                key={o.purchaseOrderId}
                {...fade(0.06 + i * 0.04)}
                onClick={() => navigate(`/supplier?order=${o.purchaseOrderId}`)}
                className={`w-full text-left px-4 py-4 rounded-xl border transition-all hover:shadow-sm ${
                  o.isFullyReceived
                    ? "border-emerald-500/20 bg-card hover:bg-card/80"
                    : "border-amber-500/25 bg-amber-500/[0.03] hover:bg-amber-500/[0.06]"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                        o.isFullyReceived
                          ? "bg-emerald-500/10"
                          : "bg-amber-500/10"
                      }`}
                    >
                      {o.isFullyReceived ? (
                        <CheckCircle2 size={16} className="text-emerald-500" />
                      ) : (
                        <Clock size={16} className="text-amber-500" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-foreground truncate">
                          {o.docNo}
                        </span>
                        {o.isFullyReceived ? (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20">
                            Complete
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20">
                            {o.totalRemaining} remaining
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {o.companyName ?? "Company"}
                        {o.projectName ? ` · ${o.projectName}` : ""} ·{" "}
                        {fmtDate(o.poDate)}
                      </p>
                    </div>
                  </div>
                  <ChevronRight
                    size={14}
                    className="text-muted-foreground/40 shrink-0 mt-2"
                  />
                </div>

                <div className="mt-3 space-y-1.5">
                  {o.items.map((it) => {
                    const pct =
                      it.orderedQty > 0
                        ? Math.min(100, (it.receivedQty / it.orderedQty) * 100)
                        : 100;
                    return (
                      <div key={it.itemId}>
                        <div className="flex items-center justify-between text-[11px] mb-1">
                          <span className="text-foreground truncate">{it.itemName}</span>
                          <span className="font-mono text-muted-foreground shrink-0 ml-2">
                            {it.receivedQty}/{it.orderedQty} {it.uom ?? ""}
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full ${it.remainingQty > 0 ? "bg-amber-500" : "bg-emerald-500"}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </motion.button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
