import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getDependencyMasters,
  getDependencyMaster,
  type LadderActivity,
} from "@/api/dependencyMasterApi";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Search, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Fires with the copied chain's activities, stripped of their original
   *  rung ids — treated as fresh, unsaved rungs the user can then add to
   *  or remove from like any other. */
  onCopy: (activities: LadderActivity[]) => void;
}

// Lets a new chain start from a copy of an existing one's Activity Chain
// instead of always building it rung by rung — the common case is "this
// flat's Bedroom looks a lot like that flat's Bedroom", not a genuinely
// different sequence every time. Only the activity list is copied; scope
// (Project/Tower/Floor/Flat/Room) and Alias are left for the user to fill
// in themselves, same as always.
export function CopyChainModal({ open, onClose, onCopy }: Props) {
  const [search, setSearch] = useState("");
  const [copyingId, setCopyingId] = useState<number | null>(null);

  const { data: chains = [], isLoading } = useQuery({
    queryKey: ["dependency-masters-for-copy"],
    queryFn: getDependencyMasters,
    enabled: open,
  });

  useEffect(() => {
    if (open) setSearch("");
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const withActivities = chains.filter((c) => c.activityCount > 0);
    if (!q) return withActivities;
    return withActivities.filter(
      (c) =>
        c.alias.toLowerCase().includes(q) ||
        c.scopePath.toLowerCase().includes(q),
    );
  }, [chains, search]);

  const handlePick = async (id: number) => {
    setCopyingId(id);
    try {
      const detail = await getDependencyMaster(id);
      // Strip rungId — these become brand-new DependencyMasterActivity rows
      // once this new chain is saved, not references to the copied-from
      // chain's own rungs (which still carry their own Work Allocation
      // assignments, photos, etc. that must not be touched).
      const copied: LadderActivity[] = detail.activities.map((a) => ({
        activityId: a.activityId,
        activityName: a.activityName,
        sequenceNo: a.sequenceNo,
        workType: a.workType,
      }));
      onCopy(copied);
      toast.success(`Copied ${copied.length} activit${copied.length === 1 ? "y" : "ies"} from "${detail.alias}"`);
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Failed to copy chain");
    } finally {
      setCopyingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sheet-frame sm:max-w-md" style={{ margin: 0 }}>
        <DialogHeader>
          <div className="pb-3" style={{ borderBottom: "1px solid hsl(var(--foreground))" }}>
            <p className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Dependency</p>
            <DialogTitle className="font-heading text-lg font-bold tracking-tight mt-1">Copy the activity chain from</DialogTitle>
          </div>
        </DialogHeader>

        <div className="relative mb-2">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            autoFocus
            placeholder="Search by alias or location…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-9 pl-8 pr-3 border border-foreground/40 focus:border-foreground bg-card text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
          />
        </div>

        <div className="max-h-80 overflow-y-auto divide-y divide-border/70" style={{ border: "1px solid hsl(var(--foreground))" }}>
          {isLoading ? (
            <div className="py-8 text-center text-xs text-muted-foreground">Loading chains…</div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              {chains.length === 0 ? "No existing chains to copy from yet." : "No chains match your search."}
            </div>
          ) : (
            filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                disabled={copyingId != null}
                onClick={() => handlePick(c.id)}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-sm hover:bg-primary/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {copyingId === c.id && <Loader2 size={13} className="text-muted-foreground shrink-0 animate-spin" />}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground truncate">{c.alias}</p>
                  <p className="text-[0.6875rem] text-muted-foreground truncate">{c.scopePath}</p>
                </div>
                <span className="font-heading text-[0.625rem] tabular-nums text-muted-foreground shrink-0">
                  {c.activityCount} step{c.activityCount === 1 ? "" : "s"}
                </span>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
