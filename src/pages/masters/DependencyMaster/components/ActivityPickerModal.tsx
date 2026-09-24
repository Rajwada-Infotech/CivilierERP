import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getActivities } from "@/api/activityMasterApi";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Search, Tag } from "lucide-react";

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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Activities to Chain</DialogTitle>
        </DialogHeader>

        <div className="relative mb-2">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            autoFocus
            placeholder="Search activities…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9"
          />
        </div>

        <div className="max-h-80 overflow-y-auto divide-y divide-border/40 -mx-1">
          {isLoading ? (
            <div className="py-8 text-center text-xs text-muted-foreground">Loading activities…</div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground italic">
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
                        ? "bg-primary/10"
                        : "hover:bg-primary/8 cursor-pointer"
                  }`}
                >
                  {!already && <Checkbox checked={checked} onCheckedChange={() => toggle(a)} className="shrink-0" />}
                  <Tag size={12} className="text-teal-400 shrink-0" />
                  <span className="flex-1 truncate">{a.activity_name}</span>
                  {already && (
                    <span className="text-[9px] uppercase tracking-wide text-muted-foreground shrink-0">
                      Already added
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between pt-3 mt-1 border-t border-border/40">
          <span className="text-xs text-muted-foreground">
            {selected.length > 0 ? `${selected.length} selected` : "Select one or more activities"}
          </span>
          <button
            type="button"
            onClick={confirm}
            disabled={selected.length === 0}
            className="px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {selected.length > 0
              ? `Add ${selected.length} Activit${selected.length === 1 ? "y" : "ies"}`
              : "Add Activities"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
