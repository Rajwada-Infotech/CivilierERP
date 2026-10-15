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
        <div className="border border-foreground bg-card p-5">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.12em] flex items-center gap-1.5 mb-4">
            <Link2
              size={11}
              className="text-foreground"
            />
            Purchase Flow Status
          </h3>

          {poChainLoading ? (
            <div className="flex items-center gap-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-16 flex-1 bg-card animate-pulse"
                />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Step 1: GRN */}
              <div className="border border-foreground/30 bg-card p-3 flex items-start gap-3">
                <div className="mt-0.5 w-7 h-7 bg-card flex items-center justify-center shrink-0">
                  <Truck
                    size={13}
                    className="text-foreground"
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
                className={`border p-3 flex items-start gap-3 ${
                  (poChainStatus?.expenseCount ?? 0) > 0
                    ? "border-foreground/40 bg-card"
                    : "border-foreground/30 bg-card"
                }`}
              >
                <div
                  className={`mt-0.5 w-7 h-7 flex items-center justify-center shrink-0 ${
                    (poChainStatus?.expenseCount ?? 0) > 0
                      ? "bg-card"
                      : "bg-card"
                  }`}
                >
                  {(poChainStatus?.expenseCount ?? 0) > 0 ? (
                    <CheckCircle2
                      size={13}
                      className="text-foreground"
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
                      <p className="text-xs font-semibold text-foreground">
                        {poChainStatus!.expenseCount} booking
                        {poChainStatus!.expenseCount > 1 ? "s" : ""}
                      </p>
                      {poChainStatus?.latestExpenseDocNo && (
                        <p className="text-[0.625rem] font-heading text-muted-foreground mt-0.5 truncate">
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
                className={`border p-3 flex items-start gap-3 ${
                  poChainStatus?.isPaid
                    ? "border-foreground/40 bg-card"
                    : "border-foreground/30 bg-card"
                }`}
              >
                <div
                  className={`mt-0.5 w-7 h-7 flex items-center justify-center shrink-0 ${
                    poChainStatus?.isPaid
                      ? "bg-card"
                      : "bg-card"
                  }`}
                >
                  <CircleDollarSign
                    size={13}
                    className={
                      poChainStatus?.isPaid
                        ? "text-foreground"
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
                      <p className="text-xs font-semibold text-foreground">
                        {poChainStatus.paymentCount} payment
                        {poChainStatus.paymentCount > 1 ? "s" : ""}
                      </p>
                      {poChainStatus.latestPaymentAmount != null && (
                        <p className="text-[0.625rem] font-heading text-muted-foreground mt-0.5">
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
