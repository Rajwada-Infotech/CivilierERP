import { AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { GRNState } from "./useGRN";

// Shown when a GRN cannot be deleted because later documents hang off it.
export function GRNDeleteBlockDialog({ m }: { m: GRNState }) {
  const { deleteBlockInfo, setDeleteBlockInfo } = m;
  return (
    <>
      {/* GRN Delete Block Dialog */}
      <Dialog
        open={!!deleteBlockInfo}
        onOpenChange={() => setDeleteBlockInfo(null)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
              <AlertTriangle size={18} className="shrink-0" />
              Cannot Delete GRN
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            {deleteBlockInfo?.reason === "brs_cleared" && (
              <div className="space-y-2">
                <p className="font-medium text-destructive">
                  This GRN has an expense booking with payments cleared in BRS.
                  Follow these steps:
                </p>
                <ol className="list-decimal ml-5 space-y-1 text-muted-foreground">
                  <li>
                    Go to <strong>BRS</strong> and <strong>unclear</strong> the
                    matched payment entries.
                  </li>
                  <li>
                    Go to <strong>Payment Management</strong> and{" "}
                    <strong>delete</strong> the payment records.
                  </li>
                  <li>
                    Go to <strong>Expense Booking</strong> and{" "}
                    <strong>delete</strong> the expense booking(s).
                  </li>
                  <li>Return here and delete this GRN.</li>
                </ol>
                {deleteBlockInfo.clearedPayments &&
                  deleteBlockInfo.clearedPayments.length > 0 && (
                    <div className="rounded border bg-muted/40 p-2 space-y-1 text-xs">
                      <p className="font-semibold">
                        Cleared payments blocking deletion:
                      </p>
                      {deleteBlockInfo.clearedPayments.map((p) => (
                        <div key={p.paymentId} className="flex justify-between">
                          <span>
                            {p.paymentName || "Payment #" + p.paymentId} (Exp:{" "}
                            {p.expenseDocNo})
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
            {deleteBlockInfo?.reason === "has_payments" && (
              <div className="space-y-2">
                <p className="font-medium text-amber-700">
                  This GRN has expense bookings with linked payment records.
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
                  <li>Return here and delete this GRN.</li>
                </ol>
              </div>
            )}
            {deleteBlockInfo?.reason === "has_expense" && (
              <div className="space-y-2">
                <p className="font-medium text-amber-700">
                  This GRN has linked expense booking(s). Delete them first,
                  then delete this GRN.
                </p>
                {deleteBlockInfo.expenseBookings &&
                  deleteBlockInfo.expenseBookings.length > 0 && (
                    <div className="rounded border bg-muted/40 p-2 space-y-1 text-xs">
                      <p className="font-semibold">
                        Expense bookings to delete first:
                      </p>
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteBlockInfo(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
