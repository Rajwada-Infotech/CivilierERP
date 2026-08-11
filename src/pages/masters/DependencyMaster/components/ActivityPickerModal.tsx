import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getActivities } from "@/api/activityMasterApi";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Search, Tag } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (activityId: number, activityName: string) => void;
  /** activityIds already in the chain — shown disabled, can't add twice */
  excludeIds: number[];
}

export function ActivityPickerModal({ open, onClose, onPick, excludeIds }: Props) {
  const [search, setSearch] = useState("");
  const { data: allActivities = [], isLoading } = useQuery({
    queryKey: ["activities-for-dependency-picker"],
    queryFn: getActivities,
    enabled: open,
  });

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

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Activity to Chain</DialogTitle>
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
              return (
                <button
                  key={a.id}
                  type="button"
                  disabled={already}
                  onClick={() => {
                    onPick(a.id, a.activity_name);
                    setSearch("");
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                    already
                      ? "opacity-40 cursor-not-allowed"
                      : "hover:bg-primary/8 cursor-pointer"
                  }`}
                >
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
      </DialogContent>
    </Dialog>
  );
}
