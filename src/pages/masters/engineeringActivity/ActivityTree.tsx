// The activity list: each group with the activities under it, then any left without a group.
import React, { useState } from "react";
import { ChevronDown, ChevronRight, Eye, Pencil, Trash2 } from "lucide-react";
import { SheetMark } from "@/components/sheet/Sheet";
import type { DbActivity } from "@/api/engineeringActivityMasterApi";

export const RULE = "1px solid hsl(var(--foreground))";
export const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";

export const ActiveMark: React.FC<{ active: boolean }> = ({ active }) => <SheetMark text={active ? "Active" : "Inactive"} tone={active ? "done" : "none"} />;

const Actions: React.FC<{ item: DbActivity; canEdit: boolean; canDelete: boolean; onView: (a: DbActivity) => void; onEdit: (a: DbActivity) => void; onDelete: (a: DbActivity) => void; quiet?: boolean }> = ({
  item, canEdit, canDelete, onView, onEdit, onDelete, quiet,
}) => {
  const btn = `p-1.5 text-muted-foreground hover:text-foreground shrink-0 ${quiet ? "sm:opacity-0 sm:group-hover/row:opacity-100 transition-opacity" : ""}`;
  const stop = (fn: (a: DbActivity) => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn(item);
  };
  return (
    <span className="flex items-center shrink-0">
      <button data-row-view onClick={stop(onView)} className={btn} title="Open">
        <Eye size={13} />
      </button>
      {canEdit && (
        <button onClick={stop(onEdit)} className={btn} title="Edit">
          <Pencil size={13} />
        </button>
      )}
      {canDelete && (
        <button onClick={stop(onDelete)} className={`${btn} hover:text-destructive`} title="Delete">
          <Trash2 size={13} />
        </button>
      )}
    </span>
  );
};

const ActivityLine: React.FC<{ a: DbActivity; indent?: boolean } & Omit<React.ComponentProps<typeof Actions>, "item" | "quiet">> = ({ a, indent, ...rest }) => (
  <div className={`group/row flex items-center gap-3 px-4 py-2.5 ${indent ? "sm:pl-10" : ""} border-t border-foreground/10 hover:bg-primary/5`}>
    <div className="min-w-0 flex-1">
      <p className={`text-sm truncate ${a.is_active ? "text-foreground" : "text-muted-foreground line-through"}`}>{a.activity_name}</p>
      {a.short_description && <p className="text-[0.6875rem] text-muted-foreground truncate">{a.short_description}</p>}
    </div>
    {a.hsn_code && <span className="hidden sm:inline font-heading text-[0.6875rem] tabular-nums text-muted-foreground shrink-0">SAC {a.hsn_code}</span>}
    {a.gl_head_name && <span className="hidden md:inline text-[0.6875rem] text-muted-foreground truncate max-w-[180px] shrink-0">{a.gl_head_name}</span>}
    {!a.is_active && <ActiveMark active={false} />}
    <Actions item={a} quiet {...rest} />
  </div>
);

export const GroupBlock: React.FC<{
  group: DbActivity;
  activities: DbActivity[];
  search: string;
  canEdit: boolean;
  canDelete: boolean;
  onView: (a: DbActivity) => void;
  onEdit: (a: DbActivity) => void;
  onDelete: (a: DbActivity) => void;
}> = ({ group, activities, search, ...rest }) => {
  const [open, setOpen] = useState(true);
  const q = search.trim().toLowerCase();
  const groupHit = !q || group.activity_name.toLowerCase().includes(q);
  const shown = q && !groupHit ? activities.filter((a) => a.activity_name.toLowerCase().includes(q)) : activities;
  if (q && !groupHit && shown.length === 0) return null;
  const expanded = open || !!q;

  return (
    <div className="bg-card" style={{ border: RULE }}>
      <div className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none hover:bg-primary/5" onClick={() => setOpen((p) => !p)}>
        <span className="text-muted-foreground shrink-0">{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
        <div className="min-w-0 flex-1">
          <p className={`font-heading text-[0.75rem] font-bold uppercase tracking-[0.1em] truncate ${group.is_active ? "text-foreground" : "text-muted-foreground line-through"}`}>{group.activity_name}</p>
          {group.short_description && <p className="text-[0.6875rem] text-muted-foreground truncate">{group.short_description}</p>}
        </div>
        <span className={`${LBL} shrink-0`}>
          {activities.length} {activities.length === 1 ? "activity" : "activities"}
        </span>
        {!group.is_active && <ActiveMark active={false} />}
        <Actions item={group} {...rest} />
      </div>
      {expanded &&
        (shown.length === 0 ? (
          <p className="px-4 sm:pl-10 py-2.5 text-xs text-muted-foreground border-t border-foreground/10">No activities in this group yet.</p>
        ) : (
          shown.map((a) => <ActivityLine key={a.id} a={a} indent {...rest} />)
        ))}
    </div>
  );
};

/** Activities whose group is gone — saved before an activity had to belong to one. */
export const UngroupedBlock: React.FC<{
  activities: DbActivity[];
  search: string;
  canEdit: boolean;
  canDelete: boolean;
  onView: (a: DbActivity) => void;
  onEdit: (a: DbActivity) => void;
  onDelete: (a: DbActivity) => void;
}> = ({ activities, search, ...rest }) => {
  const q = search.trim().toLowerCase();
  const shown = q ? activities.filter((a) => a.activity_name.toLowerCase().includes(q)) : activities;
  if (!shown.length) return null;
  return (
    <div className="bg-card" style={{ border: "1px dashed hsl(var(--foreground) / 0.5)" }}>
      <div className="px-4 py-3">
        <p className="font-heading text-[0.75rem] font-bold uppercase tracking-[0.1em] text-muted-foreground">Without a group · {shown.length}</p>
        <p className="text-[0.6875rem] text-muted-foreground">BOQs and work orders can't pick these; edit each one and choose its group.</p>
      </div>
      {shown.map((a) => <ActivityLine key={a.id} a={a} {...rest} />)}
    </div>
  );
};
