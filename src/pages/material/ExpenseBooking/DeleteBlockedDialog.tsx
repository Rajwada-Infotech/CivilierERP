import { AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface DeleteBlockInfo {
  reason: "brs_cleared" | "has_payments" | "debit_note";
  clearedPayments?: { paymentId: number; paymentName: string; amount: number }[];
  linkedPayments?: { paymentId: number; paymentName: string; amount: number }[];
}

interface DeleteBlockedDialogProps {
  info: DeleteBlockInfo | null;
  onClose: () => void;
}

export function DeleteBlockedDialog({ info, onClose }: DeleteBlockedDialogProps) {
  return (
    <Dialog open={!!info} onOpenChange={onClose}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle size={16} className="shrink-0" />
            Cannot Delete Booking
          </DialogTitle>
        </DialogHeader>

        {info?.reason === "brs_cleared" && (
          <div className="space-y-4 text-sm">
            <p className="text-muted-foreground">
              This expense booking has payment(s) that are{" "}
              <span className="font-semibold text-foreground">
                cleared in BRS
              </span>
              . To delete it, complete the following steps in order:
            </p>
            <ol className="space-y-2 pl-1">
              {[
                {
                  step: 1,
                  label: "Go to Finance → BRS",
                  sub: "Find the payment record and mark it as Uncleared",
                },
                {
                  step: 2,
                  label: "Go to Finance → Payment Management",
                  sub: "Delete the payment record linked to this booking",
                },
                {
                  step: 3,
                  label: "Return here",
                  sub: "Delete this expense booking",
                },
              ].map(({ step, label, sub }) => (
                <li key={step} className="flex gap-3">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-destructive/10 text-destructive text-[11px] font-bold flex items-center justify-center mt-0.5">
                    {step}
                  </span>
                  <div>
                    <p className="font-medium text-foreground">{label}</p>
                    <p className="text-xs text-muted-foreground">{sub}</p>
                  </div>
                </li>
              ))}
            </ol>
            {info.clearedPayments && info.clearedPayments.length > 0 && (
              <div className="rounded-lg border border-border bg-muted/30 divide-y divide-border">
                {info.clearedPayments.map((p) => (
                  <div
                    key={p.paymentId}
                    className="flex items-center justify-between px-3 py-2"
                  >
                    <span className="text-xs font-mono text-foreground">
                      {p.paymentName || `Payment #${p.paymentId}`}
                    </span>
                    <span className="text-xs font-semibold text-foreground">
                      ₹
                      {Number(p.amount).toLocaleString("en-IN", {
                        minimumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {info?.reason === "has_payments" && (
          <div className="space-y-4 text-sm">
            <p className="text-muted-foreground">
              This expense booking has{" "}
              <span className="font-semibold text-foreground">
                linked payment records
              </span>
              . Delete the payment(s) first before deleting this booking.
            </p>
            {info.linkedPayments && info.linkedPayments.length > 0 && (
              <div className="rounded-lg border border-border bg-muted/30 divide-y divide-border">
                {info.linkedPayments.map((p) => (
                  <div
                    key={p.paymentId}
                    className="flex items-center justify-between px-3 py-2"
                  >
                    <span className="text-xs font-mono text-foreground">
                      {p.paymentName || `Payment #${p.paymentId}`}
                    </span>
                    <span className="text-xs font-semibold text-foreground">
                      ₹
                      {Number(p.amount).toLocaleString("en-IN", {
                        minimumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
