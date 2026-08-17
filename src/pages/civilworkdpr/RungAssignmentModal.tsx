import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { X, UserRound, CalendarDays, Package, Loader2 } from "lucide-react";
import type { LadderActivity } from "@/api/dependencyMasterApi";
import {
  getEngineers,
  getRungAssignment,
  saveRungAssignment,
  type AssignmentMaterial,
} from "@/api/dependencyActivityAssignmentApi";

const inputCls =
  "w-full px-3 py-2.5 rounded-lg text-sm bg-muted border border-border text-foreground transition-all focus:outline-none focus:ring-2 focus:ring-cyan-500/30 disabled:opacity-50 disabled:cursor-not-allowed";
const labelCls = "text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5 mb-1.5";

interface Props {
  rung: LadderActivity;
  onClose: () => void;
}

// Centered modal opened by clicking an activity chip in Work Reporting's
// linked Dependency chain preview — lets the user assign an engineer, a
// start date, and the quantities of the activity's own linked materials
// (dbo.ActivityItems) needed for that specific chain rung.
export function RungAssignmentModal({ rung, onClose }: Props) {
  const queryClient = useQueryClient();
  const rungId = rung.rungId!;

  const [engineerId, setEngineerId] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});

  const { data: engineers = [] } = useQuery({
    queryKey: ["dependency-activity-assignment-engineers"],
    queryFn: getEngineers,
  });

  const { data: detail, isLoading } = useQuery({
    queryKey: ["dependency-activity-assignment", rungId],
    queryFn: () => getRungAssignment(rungId),
  });

  useEffect(() => {
    if (!detail?.assignment) return;
    setEngineerId(detail.assignment.engineerId != null ? String(detail.assignment.engineerId) : "");
    setStartDate(detail.assignment.startDate ? detail.assignment.startDate.slice(0, 10) : "");
    const qtyMap: Record<string, string> = {};
    for (const m of detail.assignment.materials) qtyMap[m.itemId] = String(m.quantity);
    setQuantities(qtyMap);
  }, [detail]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const materials: AssignmentMaterial[] = Object.entries(quantities)
        .map(([itemId, qty]) => ({ itemId, quantity: parseFloat(qty) }))
        .filter((m) => Number.isFinite(m.quantity) && m.quantity > 0);
      return saveRungAssignment(rungId, {
        engineerId: engineerId ? parseInt(engineerId, 10) : null,
        startDate: startDate || null,
        materials,
      });
    },
    onSuccess: () => {
      toast.success("Assignment saved.");
      queryClient.invalidateQueries({ queryKey: ["dependency-activity-assignment", rungId] });
      // Prefix match — refreshes Work Reporting's "Saved Flow" list for
      // whichever chain is currently open there, without this modal needing
      // to know that page's exact query key/params.
      queryClient.invalidateQueries({ queryKey: ["civilworkdpr-work-done-saved-flow"] });
      onClose();
    },
    onError: (err: any) => toast.error(err?.message || "Failed to save assignment."),
  });

  const candidateItems = detail?.candidateItems ?? [];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-card border border-border rounded-xl shadow-2xl flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div>
            <h3 className="font-heading font-semibold text-sm text-foreground">{rung.activityName}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Assign engineer & material</p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-10">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : (
          <div className="px-5 py-4 space-y-4 overflow-y-auto">
            <div>
              <label className={labelCls}>
                <UserRound size={11} /> Engineer
              </label>
              <select value={engineerId} onChange={(e) => setEngineerId(e.target.value)} className={inputCls}>
                <option value="">Select engineer…</option>
                {engineers.map((eng) => (
                  <option key={eng.id} value={String(eng.id)}>
                    {eng.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelCls}>
                <CalendarDays size={11} /> Start Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={inputCls}
              />
            </div>

            <div>
              <label className={labelCls}>
                <Package size={11} /> Material
              </label>
              {candidateItems.length === 0 ? (
                <p className="text-xs text-muted-foreground italic py-1.5">
                  No materials are linked to this activity yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {candidateItems.map((item) => (
                    <div
                      key={item.itemId}
                      className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/40 px-3 py-2"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">{item.itemName}</p>
                        {item.itemCode && (
                          <p className="text-[10px] text-muted-foreground">{item.itemCode}</p>
                        )}
                      </div>
                      <input
                        type="number"
                        min={0}
                        step="any"
                        placeholder="Qty"
                        value={quantities[item.itemId] ?? ""}
                        onChange={(e) =>
                          setQuantities((q) => ({ ...q, [item.itemId]: e.target.value }))
                        }
                        className="w-20 px-2 py-1.5 rounded-md text-xs bg-background border border-border text-foreground text-right focus:outline-none focus:ring-2 focus:ring-cyan-500/30"
                      />
                      {item.uom && <span className="text-[10px] text-muted-foreground w-8 shrink-0">{item.uom}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-border shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-xs font-heading font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || isLoading}
            className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-gradient-to-r from-cyan-500 to-teal-400 hover:from-cyan-600 hover:to-teal-500 transition-all disabled:opacity-50"
          >
            {saveMutation.isPending && <Loader2 size={12} className="animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
