import { AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { POState } from "./usePurchaseOrder";

// Shown when a PO cannot be deleted because later documents hang off it.
export function PODeleteBlockDialog({ m }: { m: POState }) {
  const { deleteBlockInfo, setDeleteBlockInfo, items } = m;
  return (
    <>
      {/* ── PO Delete Block Dialog ─────────────────────────────────────────── */}
      <Dialog
        open={!!deleteBlockInfo}
        onOpenChange={() => setDeleteBlockInfo(null)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
              <AlertTriangle size={18} className="shrink-0" />
              Cannot Delete Purchase Order
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            {deleteBlockInfo?.reason === "grn_expense_brs_cleared" && (
              <div className="space-y-2">
                <p className="font-medium text-destructive">
                  This PO has GRNs with expense bookings cleared in BRS.
                  Follow these steps to delete:
                </p>
                <ol className="list-decimal ml-5 space-y-1 text-muted-foreground">
                  <li>
                    Go to <strong>BRS</strong> and <strong>unclear</strong>{" "}
                    the matched payment entries.
                  </li>
                  <li>
                    Go to <strong>Payment Management</strong> and{" "}
                    <strong>delete</strong> the payment records.
                  </li>
                  <li>
                    Go to <strong>Expense Booking</strong> and{" "}
                    <strong>delete</strong> the expense booking(s).
                  </li>
                  <li>
                    Go to <strong>GRN</strong> and <strong>delete</strong>{" "}
                    the GRN(s).
                  </li>
                  <li>Return here and delete this Purchase Order.</li>
                </ol>
                {deleteBlockInfo.clearedPayments &&
                  deleteBlockInfo.clearedPayments.length > 0 && (
                    <div className="rounded border bg-muted/40 p-2 space-y-1 text-xs">
                      <p className="font-semibold">
                        Cleared payments blocking deletion:
                      </p>
                      {deleteBlockInfo.clearedPayments.map((p) => (
                        <div
                          key={p.paymentId}
                          className="flex justify-between"
                        >
                          <span>
                            {p.paymentName || "Payment #" + p.paymentId}{" "}
                            (Exp: {p.expenseDocNo})
                          </span>
                          <span className="font-medium">
                            {Number(p.amount).toLocaleString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
              </div>
            )}
            {deleteBlockInfo?.reason === "grn_expense_has_payments" && (
              <div className="space-y-2">
                <p className="font-medium text-amber-700">
                  This PO has GRNs with expense bookings that have linked
                  payment records.
                </p>
                <ol className="list-decimal ml-5 space-y-1 text-muted-foreground">
                  <li>
                    Go to <strong>Payment Management</strong> and{" "}
                    <strong>delete</strong> the payment records.
                  </li>
                  <li>
                    Go to <strong>Expense Booking</strong> and{" "}
                    <strong>delete</strong> the expense booking(s).
                  </li>
                  <li>
                    Go to <strong>GRN</strong> and <strong>delete</strong>{" "}
                    the GRN(s).
                  </li>
                  <li>Return here and delete this Purchase Order.</li>
                </ol>
                {deleteBlockInfo.linkedPayments &&
                  deleteBlockInfo.linkedPayments.length > 0 && (
                    <div className="rounded border bg-muted/40 p-2 space-y-1 text-xs">
                      <p className="font-semibold">Linked payments:</p>
                      {deleteBlockInfo.linkedPayments.map((p) => (
                        <div
                          key={p.paymentId}
                          className="flex justify-between"
                        >
                          <span>
                            {p.paymentName || "Payment #" + p.paymentId}{" "}
                            (Exp: {p.expenseDocNo})
                          </span>
                          <span className="font-medium">
                            {Number(p.amount).toLocaleString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
              </div>
            )}
            {deleteBlockInfo?.reason === "grn_has_expense" && (
              <div className="space-y-2">
                <p className="font-medium text-amber-700">
                  This PO has GRNs with linked expense bookings.
                </p>
                <ol className="list-decimal ml-5 space-y-1 text-muted-foreground">
                  <li>
                    Go to <strong>Expense Booking</strong> and{" "}
                    <strong>delete</strong> the expense booking(s).
                  </li>
                  <li>
                    Go to <strong>GRN</strong> and <strong>delete</strong>{" "}
                    the GRN(s).
                  </li>
                  <li>Return here and delete this Purchase Order.</li>
                </ol>
                {deleteBlockInfo.expenseBookings &&
                  deleteBlockInfo.expenseBookings.length > 0 && (
                    <div className="rounded border bg-muted/40 p-2 space-y-1 text-xs">
                      {deleteBlockInfo.expenseBookings.map((e) => (
                        <div key={e.id} className="flex justify-between">
                          <span>{e.docNo || "Expense #" + e.id}</span>
                          <span className="text-muted-foreground">
                            {e.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
              </div>
            )}
            {deleteBlockInfo?.reason === "has_grns" && (
              <div className="space-y-2">
                <p className="font-medium text-amber-700">
                  This PO has linked GRN(s). Delete the GRN(s) first, then
                  delete the PO.
                </p>
                <ol className="list-decimal ml-5 space-y-1 text-muted-foreground">
                  <li>
                    Go to <strong>GRN</strong> and <strong>delete</strong>{" "}
                    each linked GRN.
                  </li>
                  <li>Return here and delete this Purchase Order.</li>
                </ol>
                {deleteBlockInfo.grns &&
                  deleteBlockInfo.grns.length > 0 && (
                    <div className="rounded border bg-muted/40 p-2 space-y-1 text-xs">
                      {deleteBlockInfo.grns.map((g) => (
                        <div key={g.grnId} className="flex justify-between">
                          <span>{g.grnNo || "GRN #" + g.grnId}</span>
                          <span className="text-muted-foreground">
                            {g.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
              </div>
            )}
            {deleteBlockInfo?.reason === "has_expense" && (
              <div className="space-y-2">
                <p className="font-medium text-amber-700">
                  This PO has linked expense bookings. Delete them first.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteBlockInfo(null)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
