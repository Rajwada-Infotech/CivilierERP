import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getActivities } from "@/api/activityMasterApi";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Search } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Fires once with every checked activity, in the order they were checked. */
  onPick: (picks: { activityId: number; activityName: string }[]) => void;
  /** activityIds already in the chain — shown disabled, can't add twice */
  excludeIds: number[];
}

export function ActivityPickerModal({ open, onClose, onPick, excludeIds }: Props) {
  const [search, setSearch] = useState("");
  // Ordered so "Add N Activities" appends them in the sequence they were
  // checked, not whatever order the filtered list happens to render in.
  const [selected, setSelected] = useState<{ activityId: number; activityName: string }[]>([]);
  const { data: allActivities = [], isLoading } = useQuery({
    queryKey: ["activities-for-dependency-picker"],
    queryFn: getActivities,
    enabled: open,
  });

  // Selection is scoped to one picker session — reopening starts fresh
  // rather than carrying over a stale selection from last time.
  useEffect(() => {
    if (open) { setSelected([]); setSearch(""); }
  }, [open]);

  // Only real Activities (activity_type === 1), not Groups.
  const activities = useMemo(
    () => allActivities.filter((a) => a.activity_type === 1 && a.is_active),
    [allActivities],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return activities;
    return activities.filter((a) => a.activity_name.toLowerCase().includes(q));
  }, [activities, search]);

  const toggle = (a: { id: number; activity_name: string }) => {
    setSelected((prev) =>
      prev.some((p) => p.activityId === a.id)
        ? prev.filter((p) => p.activityId !== a.id)
        : [...prev, { activityId: a.id, activityName: a.activity_name }],
    );
  };

  const confirm = () => {
    if (selected.length === 0) return;
    onPick(selected);
    setSelected([]);
    setSearch("");
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sheet-frame sm:max-w-md" style={{ margin: 0 }}>
        <DialogHeader>
          <div className="pb-3" style={{ borderBottom: "1px solid hsl(var(--foreground))" }}>
            <p className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Dependency</p>
            <DialogTitle className="font-heading text-lg font-bold tracking-tight mt-1">Add activities to the chain</DialogTitle>
          </div>
        </DialogHeader>

        <div className="relative mb-2">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            autoFocus
            placeholder="Search activities…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-9 pl-8 pr-3 border border-foreground/40 focus:border-foreground bg-card text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
          />
        </div>

        <div className="max-h-80 overflow-y-auto divide-y divide-border/70" style={{ border: "1px solid hsl(var(--foreground))" }}>
          {isLoading ? (
            <div className="py-8 text-center text-xs text-muted-foreground">Loading activities…</div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              No activities match your search
            </div>
          ) : (
            filtered.map((a) => {
              const already = excludeIds.includes(a.id);
              const checked = selected.some((p) => p.activityId === a.id);
              return (
                <button
                  key={a.id}
                  type="button"
                  disabled={already}
                  onClick={() => toggle(a)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                    already
                      ? "opacity-40 cursor-not-allowed"
                      : checked
                        ? "bg-primary/10 font-medium"
                        : "hover:bg-primary/10 cursor-pointer"
                  }`}
                >
                  {!already && <Checkbox checked={checked} onCheckedChange={() => toggle(a)} className="shrink-0" />}
                  <span className="flex-1 truncate">{a.activity_name}</span>
                  {already && (
                    <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground shrink-0">
                      Already added
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between gap-3 pt-3 mt-1">
          <span className="text-xs text-muted-foreground">
            {selected.length > 0 ? `${selected.length} selected` : "Select one or more activities"}
          </span>
          <button
            type="button"
            onClick={confirm}
            disabled={selected.length === 0}
            className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed h-9 px-4 bg-foreground text-card border border-foreground"
          >
            {selected.length > 0
              ? `Add ${selected.length} activit${selected.length === 1 ? "y" : "ies"}`
              : "Add activities"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
