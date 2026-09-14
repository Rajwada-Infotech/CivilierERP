import React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { XCircle, Loader2 } from "lucide-react";

interface CancelTemplate {
  Id: number;
  Reason: string;
}

async function fetchActiveCancelTemplates(): Promise<CancelTemplate[]> {
  const res = await fetchWithAuth("/api/cancel-template-master/active");
  if (!res.ok) return [];
  return res.json().catch(() => []);
}

// Shared by every surface that can cancel a task (Follow-Up drawer, Task
// Master admin grid) — a reason is mandatory, so this is the one place that
// enforces "must pick a Cancel Template" rather than each caller re-deciding
// how to ask for it.
export const CancelReasonDialog: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reasonId: string) => void;
  submitting?: boolean;
}> = ({ open, onOpenChange, onConfirm, submitting }) => {
  const [reasonId, setReasonId] = React.useState("");

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["cancel-template-active"],
    queryFn: fetchActiveCancelTemplates,
    enabled: open,
    staleTime: 60_000,
  });

  React.useEffect(() => {
    if (!open) setReasonId("");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600">
            <XCircle size={16} /> Cancel Task
          </DialogTitle>
          <DialogDescription>
            Select a reason for cancelling this task. This is recorded permanently and the task remains visible in Cancelled Tasks history.
          </DialogDescription>
        </DialogHeader>

        <div>
          <label className="block text-[10px] font-heading uppercase tracking-wider text-muted-foreground mb-1.5">
            Cancel Reason <span className="text-red-500">*</span>
          </label>
          <select
            value={reasonId}
            onChange={(e) => setReasonId(e.target.value)}
            disabled={isLoading}
            className="w-full px-3 py-2 rounded-lg text-sm bg-muted border border-border focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
          >
            <option value="">{isLoading ? "Loading…" : "Select a reason…"}</option>
            {templates.map((t) => (
              <option key={t.Id} value={String(t.Id)}>{t.Reason}</option>
            ))}
          </select>
          {!isLoading && templates.length === 0 && (
            <p className="text-xs text-amber-600 mt-1.5">
              No active Cancel Templates configured. Ask an admin to add one under Setup → Cancel Template.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Back
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!reasonId || submitting}
            onClick={() => onConfirm(reasonId)}
          >
            {submitting ? (
              <span className="flex items-center gap-1.5">
                <Loader2 size={14} className="animate-spin" /> Cancelling…
              </span>
            ) : (
              "Confirm Cancel"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
