// A group of activities with its totals.
import React from "react";
import { Trash2, ChevronDown, ChevronRight, FilePlus, AlertCircle } from "lucide-react";
import { Activity, ActivityGroup, DropdownOption, ItemOption, ActivityOption, fmt, ensureArray, EMPTY_ACTIVITY, actLabour, matCost } from "./config";
import { ActivityRow } from "./ActivityRow";

// ─── Activity Group Card ──────────────────────────────────────────────────────

export const ActivityGroupCard: React.FC<{
  group: ActivityGroup;
  index: number;
  onUpdate: (updated: ActivityGroup) => void;
  onDelete: () => void;
  canDelete: boolean;
  activityGroupOptions: DropdownOption[];
  activityOptions: ActivityOption[];
  uomOptions: DropdownOption[];
  itemOptions: ItemOption[];
  suppliers: DropdownOption[];
  loadingDropdowns: boolean;
  loadingItems: boolean;
  hsnRecords: {
    code: string;
    shortDesc: string;
    igstRate: number;
    cgstRate: number;
    sgstRate: number;
  }[];
}> = ({
  group,
  index,
  onUpdate,
  onDelete,
  canDelete,
  activityGroupOptions,
  activityOptions,
  uomOptions,
  itemOptions,
  suppliers,
  loadingDropdowns,
  loadingItems,
  hsnRecords,
}) => {
  const safeGroupOptions = ensureArray<DropdownOption>(activityGroupOptions);
  const safeActivityOptions = ensureArray<ActivityOption>(activityOptions);

  const groupLabourTotal = group.activities.reduce(
    (sum, a) => sum + actLabour(a),
    0,
  );
  const groupMaterialsTotal = group.activities.reduce(
    (sum, a) =>
      sum +
      a.materials.reduce(
        (ms, m) => ms + matCost(m, a),
        0,
      ),
    0,
  );
  const groupTotal = groupLabourTotal + groupMaterialsTotal;

  const filteredActivities =
    group.groupId !== null
      ? safeActivityOptions.filter(
          (a) => Number(a.groupId) === Number(group.groupId),
        )
      : safeActivityOptions;

  const updateActivity = (actIdx: number, patch: Partial<Activity>) => {
    onUpdate({
      ...group,
      activities: group.activities.map((a, i) =>
        i === actIdx ? { ...a, ...patch } : a,
      ),
    });
  };

  const addActivity = () =>
    onUpdate({ ...group, activities: [...group.activities, EMPTY_ACTIVITY()] });

  const deleteActivity = (actIdx: number) =>
    onUpdate({
      ...group,
      activities: group.activities.filter((_, i) => i !== actIdx),
    });

  const toggleExpand = () => onUpdate({ ...group, expanded: !group.expanded });

  const handleGroupChange = (selectedId: string) => {
    const found = safeGroupOptions.find((g) => String(g.id) === selectedId);
    onUpdate({
      ...group,
      groupId: found ? found.id : null,
      name: found ? found.name : "",
      activities: [EMPTY_ACTIVITY()],
    });
  };

  return (
    <div className="border border-foreground/30 bg-card">
      <div className="flex items-center gap-2 px-3 sm:px-4 py-3 bg-card border-b border-foreground/30">
        <button
          onClick={toggleExpand}
          className="w-6 h-6 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-primary/5 transition-colors shrink-0"
        >
          {group.expanded ? (
            <ChevronDown size={14} />
          ) : (
            <ChevronRight size={14} />
          )}
        </button>
        <span className="text-xs font-heading font-bold text-primary bg-primary/10 px-2 py-0.5 shrink-0">
          {index + 1}
        </span>
        {loadingDropdowns ? (
          <div className="flex-1 h-8 bg-card animate-pulse" />
        ) : (
          <select
            value={group.groupId !== null ? String(group.groupId) : ""}
            onChange={(e) => handleGroupChange(e.target.value)}
            className="flex-1 min-w-0 text-sm font-semibold bg-card border border-foreground/30 pl-2 pr-7 py-1 text-foreground focus:outline-none transition wo-select-arrow cursor-pointer"
          >
            <option value="">
              {safeGroupOptions.length === 0
                ? "No groups available"
                : "Select group…"}
            </option>
            {safeGroupOptions.map((g) => (
              <option key={g.id} value={String(g.id)}>
                {g.name}
              </option>
            ))}
          </select>
        )}
        <span
          className={`text-sm font-bold shrink-0 ${groupTotal > 0 ? "text-foreground" : "text-muted-foreground"}`}
        >
          {groupTotal > 0 ? fmt(groupTotal) : "₹0"}
        </span>
        <button
          onClick={onDelete}
          disabled={!canDelete}
          className="w-7 h-7 flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 dark:hover:bg-destructive/10 transition-colors disabled:opacity-20 disabled:cursor-not-allowed shrink-0"
        >
          <Trash2 size={13} />
        </button>
      </div>
      {group.expanded && (
        <div className="p-3 space-y-2">
          {/* The desktop grid's fixed-width columns (750px+) don't fit
              most viewports once the sidebar is open — contain the
              horizontal scroll to this table instead of letting it push
              the whole page wide (which was dragging the entire app into
              a sideways scroll, cutting off unrelated content). Header and
              rows share this one scroll container so they always scroll
              in sync; sm:min-w-[960px] on each (below) is what actually
              forces the overflow, not this wrapper itself. */}
          <div className="overflow-x-auto">
            {group.activities.length > 0 && (
              <div className="hidden sm:grid grid-cols-[48px_1fr_120px_128px_112px_90px_100px_120px_32px] gap-2 px-3 pb-1 sm:min-w-[960px]">
                {[
                  "#",
                  "Activity",
                  "Unit",
                  "Total Rate (Labour)",
                  "Area",
                  "Materials",
                  "SAC / GST",
                  "Activity Total",
                  "",
                ].map((h) => (
                  <div
                    key={h}
                    className="text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {h}
                  </div>
                ))}
              </div>
            )}
            <div className="space-y-2">
              {group.activities.map((activity, actIdx) => (
                <ActivityRow
                  key={activity.id}
                  activity={activity}
                  index={actIdx}
                  groupIndex={index}
                  onUpdate={(patch) => updateActivity(actIdx, patch)}
                  onDelete={() => deleteActivity(actIdx)}
                  canDelete={group.activities.length > 1}
                  activityOptions={filteredActivities}
                  uomOptions={uomOptions}
                  itemOptions={itemOptions}
                  suppliers={suppliers}
                  loadingActivities={loadingDropdowns}
                  loadingItems={loadingItems}
                  hsnRecords={hsnRecords}
                />
              ))}
            </div>
          </div>
          {group.groupId !== null &&
            filteredActivities.length === 0 &&
            !loadingDropdowns && (
              <div className="flex items-center gap-2 px-3 py-2 bg-card border border-foreground/40">
                <AlertCircle size={13} className="text-foreground shrink-0" />
                <span className="text-xs text-foreground">
                  No activities found for this group.
                </span>
              </div>
            )}
          <button
            onClick={addActivity}
            className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 px-3 py-2 hover:bg-primary/5 transition-colors font-medium"
          >
            <FilePlus size={13} />
            Add Activity {index + 1}.{group.activities.length + 1}
          </button>
        </div>
      )}
    </div>
  );
};
