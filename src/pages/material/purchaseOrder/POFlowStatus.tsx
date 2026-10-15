import { DocumentChainPanel } from "@/components/material/DocumentChainPanel";
import { Check, CheckCircle2, CircleDollarSign, Truck, Link2, Receipt } from "lucide-react";
import type { POState } from "./usePurchaseOrder";

// View mode: how far the PO has travelled (GRNs, bills, payments).
export function POFlowStatus({ m }: { m: POState }) {
  const { editingId, items, poChainStatus, poChainLoading, isReadOnly } = m;
  return (
    <>
      {/* ── Flow Status Panel (view mode only) ────────────────────────────── */}
      {isReadOnly && (
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5 mb-4">
            <Link2
              size={11}
              className="text-emerald-600 dark:text-emerald-400"
            />
            Purchase Flow Status
          </h3>

          {poChainLoading ? (
            <div className="flex items-center gap-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-16 flex-1 bg-muted animate-pulse rounded-xl"
                />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Step 1: GRN */}
              <div className="rounded-xl border border-border bg-muted/20 p-3 flex items-start gap-3">
                <div className="mt-0.5 w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-950/40 flex items-center justify-center shrink-0">
                  <Truck
                    size={13}
                    className="text-emerald-600 dark:text-emerald-400"
                  />
                </div>
                <div>
                  <p className="text-[0.625rem] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">
                    GRN
                  </p>
                  <p className="text-xs font-semibold text-foreground">
                    Goods Received
                  </p>
                  <p className="text-[0.625rem] text-muted-foreground mt-0.5">
                    Check GRN list for receipts against this PO
                  </p>
                </div>
              </div>

              {/* Step 2: Expense Booking */}
              <div
                className={`rounded-xl border p-3 flex items-start gap-3 ${
                  (poChainStatus?.expenseCount ?? 0) > 0
                    ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/20"
                    : "border-border bg-muted/20"
                }`}
              >
                <div
                  className={`mt-0.5 w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                    (poChainStatus?.expenseCount ?? 0) > 0
                      ? "bg-emerald-100 dark:bg-emerald-950/40"
                      : "bg-muted"
                  }`}
                >
                  {(poChainStatus?.expenseCount ?? 0) > 0 ? (
                    <CheckCircle2
                      size={13}
                      className="text-emerald-600 dark:text-emerald-400"
                    />
                  ) : (
                    <Receipt size={13} className="text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-[0.625rem] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">
                    Expense Booking
                  </p>
                  {(poChainStatus?.expenseCount ?? 0) > 0 ? (
                    <>
                      <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                        {poChainStatus!.expenseCount} booking
                        {poChainStatus!.expenseCount > 1 ? "s" : ""}
                      </p>
                      {poChainStatus?.latestExpenseDocNo && (
                        <p className="text-[0.625rem] font-mono text-muted-foreground mt-0.5 truncate">
                          {poChainStatus.latestExpenseDocNo}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Not booked yet
                    </p>
                  )}
                </div>
              </div>

              {/* Step 3: Payment */}
              <div
                className={`rounded-xl border p-3 flex items-start gap-3 ${
                  poChainStatus?.isPaid
                    ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/20"
                    : "border-border bg-muted/20"
                }`}
              >
                <div
                  className={`mt-0.5 w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                    poChainStatus?.isPaid
                      ? "bg-emerald-100 dark:bg-emerald-950/40"
                      : "bg-muted"
                  }`}
                >
                  <CircleDollarSign
                    size={13}
                    className={
                      poChainStatus?.isPaid
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-muted-foreground"
                    }
                  />
                </div>
                <div>
                  <p className="text-[0.625rem] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">
                    Payment
                  </p>
                  {poChainStatus?.isPaid ? (
                    <>
                      <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                        {poChainStatus.paymentCount} payment
                        {poChainStatus.paymentCount > 1 ? "s" : ""}
                      </p>
                      {poChainStatus.latestPaymentAmount != null && (
                        <p className="text-[0.625rem] font-mono text-muted-foreground mt-0.5">
                          ₹
                          {poChainStatus.latestPaymentAmount.toLocaleString(
                            "en-IN",
                          )}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Not paid yet
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
          <DocumentChainPanel
            docType="po"
            id={editingId ? Number(editingId) : null}
          />
        </div>
      )}
    </>
  );
}
