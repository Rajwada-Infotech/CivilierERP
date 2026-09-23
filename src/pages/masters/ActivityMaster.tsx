import React, { useState } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CivilWorkDprShell } from "@/components/civilworkdpr/CivilWorkDprShell";
import { useModule } from "@/contexts/ModuleContext";
import {
  MasterPage,
  type DataChangeEvent,
  type RecordWithId,
} from "@/components/MasterPage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Activity,
  Layers,
  Tag,
  ChevronDown,
  ChevronRight,
  Search,
  Download,
  Hash,
  Eye,
  XCircle,
  Plus,
  Package,
  Trash2,
  Pencil,
  Flag,
} from "lucide-react";
import {
  getActivities,
  addActivity,
  updateActivity,
  deleteActivity,
  toPayload,
  type DbActivity,
} from "@/api/activityMasterApi";
import { getHsn } from "@/api/hsnApi";
import { getItems, type DbItem } from "@/api/itemMasterApi";
import { getLedgerOptions } from "@/api/generalLedgerApi";
import {
  getActivityItems,
  addActivityItems,
  deleteActivityItem,
} from "@/api/activityItemsApi";
import {
  getCheckpoints as getCheckpointCatalog,
  getActivityCheckpointTemplate,
  attachCheckpointsToActivity,
  detachCheckpointFromActivity,
} from "@/api/activityCheckpointApi";
import { Checkbox } from "@/components/ui/checkbox";
import { usePageRights } from "@/hooks/usePageRights";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

// ─── Status badge ─────────────────────────────────────────────────────────────
const StatusBadge = ({ active }: { active: boolean }) => (
  <span
    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
      active
        ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
        : "bg-red-500/10 border-red-500/20 text-red-400"
    }`}
  >
    <span
      className={`w-1.5 h-1.5 rounded-full ${active ? "bg-emerald-400" : "bg-red-400"}`}
    />
    {active ? "Active" : "Inactive"}
  </span>
);

// ─── Collapsible Group Row ────────────────────────────────────────────────────
const GroupRow = ({
  group,
  activities,
  search,
  onView,
  onEdit,
  onDelete,
  canEdit,
  canDelete,
}: {
  group: DbActivity;
  activities: DbActivity[];
  search: string;
  onView: (item: DbActivity) => void;
  onEdit: (item: DbActivity) => void;
  onDelete: (item: DbActivity) => void;
  canEdit: boolean;
  canDelete: boolean;
}) => {
  const [open, setOpen] = useState(true);

  const filtered = activities.filter((a) =>
    search
      ? a.activity_name.toLowerCase().includes(search.toLowerCase())
      : true,
  );

  if (
    search &&
    !group.activity_name.toLowerCase().includes(search.toLowerCase()) &&
    filtered.length === 0
  )
    return null;

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      {/* Group header */}
      <div
        className="flex items-center gap-3 px-4 py-3 bg-muted/40 cursor-pointer select-none hover:bg-muted/60 transition-colors"
        onClick={() => setOpen((p) => !p)}
      >
        <span className="text-muted-foreground shrink-0">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <Layers size={14} className="text-violet-400 shrink-0" />
        <span className="font-semibold text-sm text-foreground flex-1">
          {group.activity_name}
        </span>
        <span className="px-2 py-0.5 rounded-md text-[10px] bg-violet-500/10 text-violet-400 font-mono mr-2">
          {filtered.length} {filtered.length === 1 ? "activity" : "activities"}
        </span>
        <span className="hidden sm:block text-xs text-muted-foreground font-mono mr-3 truncate max-w-[220px]">
          {group.short_description}
        </span>
        <StatusBadge active={group.is_active} />
        <button
          onClick={(e) => {
            e.stopPropagation();
            onView(group);
          }}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-sky-500 hover:bg-sky-500/10 shrink-0"
          title="View details"
        >
          <Eye size={13} />
        </button>
        {canEdit && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit(group);
            }}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 shrink-0"
            title="Edit"
          >
            <Pencil size={13} />
          </button>
        )}
        {canDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(group);
            }}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
            title="Delete"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>

      {/* Activities */}
      {open && (
        <div className="divide-y divide-border/40">
          {filtered.length === 0 ? (
            <div className="px-10 py-2.5 text-xs text-muted-foreground italic flex items-center gap-2">
              <Tag size={11} className="opacity-50" /> No activities in this
              group
            </div>
          ) : (
            filtered.map((activity) => (
              <div
                key={activity.id}
                className="flex items-center gap-3 px-4 py-2.5 pl-10 hover:bg-muted/20 transition-colors group/row"
              >
                <div className="w-3 h-px bg-border/60 shrink-0" />
                <Tag size={12} className="text-teal-400 shrink-0" />
                <span className="text-sm text-foreground flex-1 truncate">
                  {activity.activity_name}
                </span>
                <span className="hidden md:block text-xs text-muted-foreground font-mono truncate max-w-[260px]">
                  {activity.short_description}
                </span>
                {activity.hsn_code && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono bg-blue-500/10 text-blue-400 border border-blue-500/20 shrink-0">
                    <Hash size={9} />
                    {activity.hsn_code}
                  </span>
                )}
                <StatusBadge active={activity.is_active} />
                <button
                  onClick={() => onView(activity)}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-sky-500 hover:bg-sky-500/10 shrink-0 opacity-0 group-hover/row:opacity-100 transition-opacity"
                  title="View details"
                >
                  <Eye size={13} />
                </button>
                {canEdit && (
                  <button
                    onClick={() => onEdit(activity)}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 shrink-0 opacity-0 group-hover/row:opacity-100 transition-opacity"
                    title="Edit"
                  >
                    <Pencil size={13} />
                  </button>
                )}
                {canDelete && (
                  <button
                    onClick={() => onDelete(activity)}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0 opacity-0 group-hover/row:opacity-100 transition-opacity"
                    title="Delete"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

// ─── CSV Export Helper ────────────────────────────────────────────────────────
const exportToCSV = (items: DbActivity[], groups: DbActivity[]) => {
  const headers = [
    "Activity Name",
    "Short Description",
    "Type",
    "Group",
    "Status",
  ];
  const rows = items.map((item) => {
    const group = groups.find((g) => g.id === item.group_id);
    return [
      item.activity_name,
      item.short_description,
      item.activity_type === 0 ? "Group" : "Activity",
      group?.activity_name ?? "—",
      item.is_active ? "Active" : "Inactive",
    ];
  });

  const csv = [headers, ...rows]
    .map((row) =>
      row
        .map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`)
        .join(","),
    )
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "activity-master.csv";
  link.click();
  URL.revokeObjectURL(url);
};

// ─── Main Component ───────────────────────────────────────────────────────────
const MODULE_BREADCRUMB_LABEL: Record<string, string> = {
  engineering: "Engineering",
  civilworkdpr: "Civil Work DPR",
  material: "Material",
};

const ActivityMaster: React.FC = () => {
  const queryClient = useQueryClient();
  const rights = usePageRights("activity-master");
  const { activeModule } = useModule();
  // Civil Work DPR's own Activity Master — Engineering split off onto its
  // own copy (see src/pages/masters/EngineeringActivityMaster.tsx,
  // migration 463). Keeping the module-aware breadcrumb rather than
  // hardcoding "Civil Work DPR" since this page is also still reachable
  // from the generic Masters area.
  const moduleBreadcrumb =
    (activeModule && MODULE_BREADCRUMB_LABEL[activeModule]) || "Masters";
  const [treeSearch, setTreeSearch] = useState("");
  const [viewRecord, setViewRecord] = useState<DbActivity | null>(null);
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [pickedItemIds, setPickedItemIds] = useState<string[]>([]);
  const [itemSearch, setItemSearch] = useState("");
  const [addCheckpointOpen, setAddCheckpointOpen] = useState(false);
  const [pickedCheckpointIds, setPickedCheckpointIds] = useState<number[]>([]);
  const [checkpointSearch, setCheckpointSearch] = useState("");

  // Edit, triggered from the grouped tree view below (the table itself is
  // hidden — hideTable — so MasterPage's own row-level Edit button never
  // renders; this drives its edit mode from the outside instead).
  const [editId, setEditId] = useState<string | null>(null);
  const [editKey, setEditKey] = useState(0);
  const handleEditRequest = (item: DbActivity) => {
    setEditId(String(item.id));
    setEditKey((k) => k + 1);
  };

  const {
    data: dbData,
    isLoading,
    error,
  } = useQuery<DbActivity[]>({
    queryKey: ["activities"],
    queryFn: getActivities,
    staleTime: 0,
    refetchOnMount: true,
  });

  // Items linked to the activity currently open in the detail drawer.
  const { data: linkedItems = [] } = useQuery({
    queryKey: ["activityItems", viewRecord?.id],
    queryFn: () => getActivityItems(viewRecord!.id),
    enabled: !!viewRecord && viewRecord.activity_type === 1,
  });

  // Full item master list, for the "Add Item" picker.
  const { data: allItems = [] } = useQuery<DbItem[]>({
    queryKey: ["items-for-activity-link"],
    queryFn: getItems,
    enabled: addItemOpen,
  });
  const unlinkedItems = allItems.filter(
    (i) => !linkedItems.some((li) => li.itemId === i.M_Id),
  );

  // Checkpoints tagged onto the activity currently open in the detail
  // drawer — this is now the ONLY place they're configured (see
  // RungAssignmentModal, which used to let Work Allocation pick these by
  // hand; a rung's own checklist auto-seeds from this the first time it's
  // viewed instead).
  const { data: checkpointTemplate = [] } = useQuery({
    queryKey: ["activityCheckpointTemplate", viewRecord?.id],
    queryFn: () => getActivityCheckpointTemplate(viewRecord!.id),
    enabled: !!viewRecord && viewRecord.activity_type === 1,
  });

  // Work Checkpoint Master's full catalog, for the "Add Checkpoint" picker.
  const { data: checkpointCatalog = [] } = useQuery({
    queryKey: ["checkpoint-catalog-for-activity-link"],
    queryFn: getCheckpointCatalog,
    enabled: addCheckpointOpen,
  });
  const unattachedCheckpoints = checkpointCatalog.filter(
    (c) => !checkpointTemplate.some((t) => t.id === c.id),
  );

  const handleAttachCheckpoint = async () => {
    if (!viewRecord || pickedCheckpointIds.length === 0) return;
    try {
      await attachCheckpointsToActivity(viewRecord.id, pickedCheckpointIds);
      toast.success(
        pickedCheckpointIds.length === 1
          ? "Checkpoint tagged to activity ✓"
          : `${pickedCheckpointIds.length} checkpoints tagged to activity ✓`,
      );
      await queryClient.invalidateQueries({ queryKey: ["activityCheckpointTemplate", viewRecord.id] });
      setAddCheckpointOpen(false);
      setPickedCheckpointIds([]);
      setCheckpointSearch("");
    } catch (err: any) {
      toast.error("Failed to tag checkpoint(s): " + err.message);
    }
  };

  const handleDetachCheckpoint = async (linkId: number) => {
    if (!viewRecord) return;
    try {
      await detachCheckpointFromActivity(viewRecord.id, linkId);
      await queryClient.invalidateQueries({ queryKey: ["activityCheckpointTemplate", viewRecord.id] });
    } catch (err: any) {
      toast.error("Failed to remove checkpoint: " + err.message);
    }
  };

  const handleAddItem = async () => {
    if (!viewRecord || pickedItemIds.length === 0) return;
    try {
      await addActivityItems(viewRecord.id, pickedItemIds);
      toast.success(
        pickedItemIds.length === 1
          ? "Item linked to activity ✓"
          : `${pickedItemIds.length} items linked to activity ✓`,
      );
      await queryClient.invalidateQueries({
        queryKey: ["activityItems", viewRecord.id],
      });
      setAddItemOpen(false);
      setPickedItemIds([]);
      setItemSearch("");
    } catch (err: any) {
      toast.error("Failed to link item(s): " + err.message);
    }
  };

  const handleRemoveItem = async (id: number) => {
    if (!viewRecord) return;
    try {
      await deleteActivityItem(id);
      await queryClient.invalidateQueries({
        queryKey: ["activityItems", viewRecord.id],
      });
    } catch (err: any) {
      toast.error("Failed to unlink item: " + err.message);
    }
  };

  // HSN master for the dropdown
  const { data: hsnRaw = [] } = useQuery({
    queryKey: ["hsn-master"],
    queryFn: getHsn,
  });

  // GL Head options, for the Activity-only field below.
  const { data: glHeadOptions = [] } = useQuery({
    queryKey: ["gl-heads-for-activity"],
    queryFn: getLedgerOptions,
  });

  // Activity Master is engineering-side (services), so only SAC-flagged
  // HSN Master rows are offered here — plain HSN (goods) codes are hidden.
  const hsnOptions: { code: string; desc: string }[] = Array.isArray(hsnRaw)
    ? (hsnRaw as any[])
        .filter((h) => h.HIsSAC === true)
        .map((h) => ({
          code: String(h.HCode ?? ""),
          desc: String(h.HShortDescription ?? h.HDescription ?? ""),
        }))
        .filter((h) => h.code !== "")
    : [];

  const dbItems: DbActivity[] = Array.isArray(dbData) ? dbData : [];
  const groups = dbItems.filter((i) => i.activity_type === 0);
  const activityItems = dbItems.filter((i) => i.activity_type === 1);
  const ungrouped = activityItems.filter(
    (a) => !a.group_id || !groups.find((g) => g.id === a.group_id),
  );

  const groupOptions = groups.map((g) => ({
    value: String(g.id),
    label: g.activity_name,
  }));

  const mappedData: RecordWithId[] = dbItems.map((item) => {
    const group = groups.find((g) => g.id === item.group_id);
    return {
      _id: String(item.id),
      activityName: item.activity_name || "",
      shortDesc: item.short_description || "",
      activityType: item.activity_type === 0 ? "Group" : "Activity",
      groupId: group?.activity_name || "",
      groupName: group?.activity_name || "",
      belongsTo: item.belongsTo ?? "",
      status: item.is_active,
      hsnCode: item.hsn_code ?? "",
      glHeadId: item.gl_head_id ?? "",
      glHeadName: item.gl_head_name ?? "",
    };
  });

  const refetch = async () => {
    queryClient.removeQueries({ queryKey: ["activities"] });
    await queryClient.fetchQuery({
      queryKey: ["activities"],
      queryFn: getActivities,
    });
  };

  const handleDataEvent = async (event: DataChangeEvent) => {
    if (event.action === "add") {
      const payload = toPayload(event.record, groupOptions);
      const res = await addActivity(payload);
      toast.success("Activity saved!");
      await refetch();
      // Items can only be linked to an Activity (not a Group) — open its
      // detail drawer immediately so the "Add Item" button is right there,
      // instead of making the user hunt for it in the tree below.
      if (payload.activity_type === 1 && res.id) {
        const fresh = await getActivities();
        const created = fresh.find((a) => a.id === res.id);
        if (created) setViewRecord(created);
      }
    }
    if (event.action === "update") {
      await updateActivity(event.id, toPayload(event.record, groupOptions));
      toast.success("Activity updated!");
      await refetch();
    }
    if (event.action === "delete") {
      await deleteActivity(event.id);
      toast.success("Activity deleted!");
      await refetch();
    }
  };

  // Delete, triggered from the grouped tree view — same reasoning as
  // handleEditRequest above: the table (and its own inline delete-confirm)
  // is hidden, so this drives deleteActivity directly instead.
  const handleDeleteRequest = async (item: DbActivity) => {
    const kind = item.activity_type === 0 ? "group" : "activity";
    if (!window.confirm(`Delete this ${kind} — "${item.activity_name}"?`)) return;
    try {
      await handleDataEvent({ action: "delete", id: String(item.id), records: [] });
      if (viewRecord?.id === item.id) setViewRecord(null);
    } catch (err: any) {
      toast.error("Failed to delete: " + (err?.message || "Unknown error"));
    }
  };

  if (isLoading)
    return <div className="p-6 text-muted-foreground">Loading...</div>;
  if (error)
    return <div className="p-6 text-red-500">Failed to load activities.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", moduleBreadcrumb, "Activity Master"]} />
      <CivilWorkDprShell
        title="Activity Master"
        subtitle="Manage Civil Work DPR's activity groups and their individual activities"
        icon={Activity}
      >

      {/* ── Form only (table hidden via hideTable prop) ── */}
      <div>
        <MasterPage
          title="Activity"
          hideTable
          fields={[
            {
              name: "activityName",
              label: "Activity Name",
              type: "text",
              required: true,
            },
            {
              name: "shortDesc",
              label: "Short Description",
              type: "text",
              required: true,
            },
            {
              name: "activityType",
              label: "Activity Type",
              type: "select",
              options: ["Group", "Activity"],
              required: true,
              defaultValue: "Group",
            },
            {
              name: "groupId",
              label: "Belongs To Group",
              type: "select",
              options: groupOptions.map((o) => o.label),
            },
            {
              name: "hsnCode",
              label: "SAC Code",
              type: "custom",
              render: ({ value, onChange, formData }) => {
                const isActivity = formData?.activityType === "Activity";
                return (
                  <div className="flex flex-col gap-1">
                    <select
                      value={(value as string) ?? ""}
                      disabled={!isActivity}
                      onChange={(e) => onChange(e.target.value)}
                      className={`w-full text-sm rounded-lg border px-3 py-2.5 transition focus:outline-none focus:ring-2 focus:ring-primary/30 appearance-none
                        ${
                          !isActivity
                            ? "border-border bg-muted/40 text-muted-foreground cursor-not-allowed opacity-60"
                            : "border-border bg-background text-foreground"
                        }`}
                    >
                      <option value="">
                        {!isActivity
                          ? "N/A — only for Activity type"
                          : "Select SAC Code…"}
                      </option>
                      {isActivity &&
                        hsnOptions.map((h) => (
                          <option key={h.code} value={h.code}>
                            {h.code}
                            {h.desc ? ` — ${h.desc}` : ""}
                          </option>
                        ))}
                    </select>
                    {!isActivity && (
                      <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <Hash size={10} />
                        SAC can only be linked to an Activity, not a Group
                      </p>
                    )}
                  </div>
                );
              },
            },
            {
              name: "glHeadId",
              label: "GL Head",
              type: "custom",
              render: ({ value, onChange, formData }) => {
                const isActivity = formData?.activityType === "Activity";
                return (
                  <div className="flex flex-col gap-1">
                    <select
                      value={(value as string) ?? ""}
                      disabled={!isActivity}
                      onChange={(e) => onChange(e.target.value)}
                      className={`w-full text-sm rounded-lg border px-3 py-2.5 transition focus:outline-none focus:ring-2 focus:ring-primary/30 appearance-none
                        ${
                          !isActivity
                            ? "border-border bg-muted/40 text-muted-foreground cursor-not-allowed opacity-60"
                            : "border-border bg-background text-foreground"
                        }`}
                    >
                      <option value="">
                        {!isActivity
                          ? "N/A — only for Activity type"
                          : "Select GL Head…"}
                      </option>
                      {isActivity &&
                        glHeadOptions.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.code ? `${g.code} — ${g.label}` : g.label}
                          </option>
                        ))}
                    </select>
                    {!isActivity && (
                      <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <Hash size={10} />
                        GL Head can only be linked to an Activity, not a Group
                      </p>
                    )}
                  </div>
                );
              },
            },
            {
              name: "status",
              label: "Status",
              type: "toggle",
              defaultValue: true,
            },
          ]}
          columns={[
            { key: "activityName", label: "Activity Name" },
            { key: "shortDesc", label: "Short Desc", hideOnMobile: true },
            { key: "activityType", label: "Type" },
            { key: "groupName", label: "Group", hideOnMobile: true },
            { key: "hsnCode", label: "SAC", hideOnMobile: true },
            { key: "glHeadName", label: "GL Head", hideOnMobile: true },
            { key: "status", label: "Status" },
          ]}
          initialData={mappedData}
          onDataEvent={handleDataEvent}
          requestEditId={editId}
          requestEditKey={editId ? `${editId}:${editKey}` : null}
        />
      </div>

      {/* ── Grouped Tree View ── */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Layers size={15} className="text-violet-400" />
            <h2 className="text-base font-semibold text-foreground">
              Activities by Group
            </h2>
            <span className="px-2 py-0.5 rounded-md text-[10px] bg-muted text-muted-foreground font-mono">
              {groups.length} groups · {activityItems.length} activities
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Export Button */}
            {rights.canExport && (
            <button
              onClick={() => exportToCSV(dbItems, groups)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border bg-background hover:bg-muted transition-colors text-foreground"
            >
              <Download size={12} />
              Export
            </button>
            )}

            {/* Search */}
            <div className="relative">
              <Search
                size={12}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                type="text"
                value={treeSearch}
                onChange={(e) => setTreeSearch(e.target.value)}
                placeholder="Filter…"
                className="pl-7 pr-3 py-1.5 text-xs bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 w-36"
              />
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 mb-3 px-1">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Layers size={11} className="text-violet-400" /> Group
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Tag size={11} className="text-teal-400" /> Activity (nested under
            its group)
          </div>
        </div>

        <div className="space-y-3">
          {groups.map((group) => (
            <GroupRow
              key={group.id}
              group={group}
              activities={activityItems.filter((a) => a.group_id === group.id)}
              search={treeSearch}
              onView={setViewRecord}
              onEdit={handleEditRequest}
              onDelete={handleDeleteRequest}
              canEdit={rights.canEdit}
              canDelete={rights.canDelete}
            />
          ))}

          {ungrouped.length > 0 && (
            <div className="rounded-xl border border-dashed border-border overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 bg-muted/20">
                <Tag size={13} className="text-muted-foreground" />
                <span className="text-sm font-medium text-muted-foreground">
                  Ungrouped Activities
                </span>
                <span className="px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground font-mono">
                  {ungrouped.length}
                </span>
              </div>
              <div className="divide-y divide-border/50">
                {ungrouped.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/20 group/row"
                  >
                    <Tag size={12} className="text-muted-foreground shrink-0" />
                    <span className="text-sm text-foreground flex-1 truncate">
                      {a.activity_name}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono hidden md:block truncate max-w-[240px]">
                      {a.short_description}
                    </span>
                    <StatusBadge active={a.is_active} />
                    <button
                      onClick={() => setViewRecord(a)}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-sky-500 hover:bg-sky-500/10 shrink-0 opacity-0 group-hover/row:opacity-100 transition-opacity"
                      title="View details"
                    >
                      <Eye size={13} />
                    </button>
                    {rights.canEdit && (
                      <button
                        onClick={() => handleEditRequest(a)}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 shrink-0 opacity-0 group-hover/row:opacity-100 transition-opacity"
                        title="Edit"
                      >
                        <Pencil size={13} />
                      </button>
                    )}
                    {rights.canDelete && (
                      <button
                        onClick={() => handleDeleteRequest(a)}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0 opacity-0 group-hover/row:opacity-100 transition-opacity"
                        title="Delete"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {groups.length === 0 && ungrouped.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
              <Activity size={28} className="opacity-30" />
              <p className="text-sm">No groups or activities yet.</p>
            </div>
          )}
        </div>
      </div>
      </CivilWorkDprShell>

      {/* ── View Detail Drawer ── */}
      {viewRecord && (
        <div className="fixed inset-0 z-[60] flex justify-end">
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={() => setViewRecord(null)}
          />
          <div className="relative w-full max-w-sm bg-card border-l border-border shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                {viewRecord.activity_type === 0 ? (
                  <Layers size={15} className="text-violet-400" />
                ) : (
                  <Tag size={15} className="text-teal-400" />
                )}
                <h3 className="font-heading font-semibold text-sm text-foreground">
                  {viewRecord.activity_type === 0
                    ? "Group Details"
                    : "Activity Details"}
                </h3>
              </div>
              <button
                onClick={() => setViewRecord(null)}
                className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted"
              >
                <XCircle size={15} />
              </button>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading mb-1">
                  {viewRecord.activity_type === 0
                    ? "Group Name"
                    : "Activity Name"}
                </p>
                <p className="text-sm font-medium text-foreground">
                  {viewRecord.activity_name}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading mb-1">
                  Short Description
                </p>
                <p className="text-sm text-foreground">
                  {viewRecord.short_description || (
                    <span className="text-muted-foreground italic">
                      No description
                    </span>
                  )}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading mb-1">
                  Type
                </p>
                <span
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${viewRecord.activity_type === 0 ? "bg-violet-500/10 text-violet-400" : "bg-teal-500/10 text-teal-400"}`}
                >
                  {viewRecord.activity_type === 0 ? (
                    <>
                      <Layers size={10} /> Group
                    </>
                  ) : (
                    <>
                      <Tag size={10} /> Activity
                    </>
                  )}
                </span>
              </div>
              {viewRecord.activity_type === 1 && (
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading mb-1">
                    SAC Code
                  </p>
                  {viewRecord.hsn_code ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-mono bg-blue-500/10 text-blue-400 border border-blue-500/20">
                      <Hash size={10} />
                      {viewRecord.hsn_code}
                    </span>
                  ) : (
                    <span className="text-muted-foreground italic text-sm">
                      Not assigned
                    </span>
                  )}
                </div>
              )}
              {viewRecord.activity_type === 1 && (
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading mb-1">
                    GL Head
                  </p>
                  {viewRecord.gl_head_name ? (
                    <span className="text-sm text-foreground">
                      {viewRecord.gl_head_name}
                    </span>
                  ) : (
                    <span className="text-muted-foreground italic text-sm">
                      Not assigned
                    </span>
                  )}
                </div>
              )}
              {viewRecord.activity_type === 1 && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading">
                      Items
                    </p>
                    {rights.canEdit && (
                      <button
                        onClick={() => setAddItemOpen(true)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border border-primary/30 text-primary hover:bg-primary/10 transition-colors"
                      >
                        <Plus size={11} /> Add Item
                      </button>
                    )}
                  </div>
                  {linkedItems.length === 0 ? (
                    <p className="text-muted-foreground italic text-sm">
                      No items linked yet
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {linkedItems.map((li) => (
                        <div
                          key={li.id}
                          className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-muted/40 border border-border/50"
                        >
                          <Package size={11} className="text-teal-400 shrink-0" />
                          <span className="text-sm text-foreground flex-1 truncate">
                            {li.itemName}
                          </span>
                          {li.uom && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono shrink-0">
                              {li.uom}
                            </span>
                          )}
                          {rights.canEdit && (
                            <button
                              onClick={() => handleRemoveItem(li.id)}
                              className="p-0.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
                              title="Unlink item"
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {viewRecord.activity_type === 1 && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading">
                      Checkpoints
                    </p>
                    {rights.canEdit && (
                      <button
                        onClick={() => setAddCheckpointOpen(true)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border border-primary/30 text-primary hover:bg-primary/10 transition-colors"
                      >
                        <Plus size={11} /> Add Checkpoint
                      </button>
                    )}
                  </div>
                  {checkpointTemplate.length === 0 ? (
                    <p className="text-muted-foreground italic text-sm">
                      No checkpoints tagged yet — every rung assigned this activity in Work
                      Allocation will start with an empty checklist.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {checkpointTemplate.map((cp) => (
                        <div
                          key={cp.linkId}
                          className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-muted/40 border border-border/50"
                        >
                          <Flag size={11} className="text-amber-400 shrink-0" />
                          <span className="text-sm text-foreground flex-1 truncate">
                            {cp.fieldName}
                          </span>
                          {cp.minWaitDays != null && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono shrink-0">
                              {cp.minWaitDays}d wait
                            </span>
                          )}
                          {cp.isDaily && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono shrink-0">
                              Daily
                            </span>
                          )}
                          {rights.canEdit && (
                            <button
                              onClick={() => handleDetachCheckpoint(cp.linkId)}
                              className="p-0.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
                              title="Remove checkpoint"
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading mb-1">
                  Status
                </p>
                <StatusBadge active={viewRecord.is_active} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Item dialog ── */}
      <Dialog
        open={addItemOpen}
        onOpenChange={(open) => {
          setAddItemOpen(open);
          if (!open) {
            setPickedItemIds([]);
            setItemSearch("");
          }
        }}
      >
        <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-5 pt-5 pb-3">
            <DialogTitle className="font-heading text-base">
              Link Items to {viewRecord?.activity_name}
            </DialogTitle>
          </DialogHeader>

          <div className="px-5 pb-3">
            <div className="relative">
              <Search
                size={13}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                type="text"
                autoFocus
                value={itemSearch}
                onChange={(e) => setItemSearch(e.target.value)}
                placeholder="Search items…"
                className="w-full pl-8 pr-3 py-2 text-sm rounded-lg bg-muted border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
          </div>

          {(() => {
            const filteredItems = unlinkedItems.filter((i) =>
              itemSearch
                ? i.M_Name.toLowerCase().includes(itemSearch.toLowerCase())
                : true,
            );
            return (
              <div className="max-h-72 overflow-y-auto px-5 pb-5 space-y-1">
                {unlinkedItems.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic text-center py-6">
                    All items are already linked to this activity.
                  </p>
                ) : filteredItems.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic text-center py-6">
                    No items match "{itemSearch}".
                  </p>
                ) : (
                  filteredItems.map((i) => {
                    const selected = pickedItemIds.includes(i.M_Id);
                    const toggle = () =>
                      setPickedItemIds((prev) =>
                        prev.includes(i.M_Id) ? prev.filter((id) => id !== i.M_Id) : [...prev, i.M_Id],
                      );
                    return (
                      <button
                        key={i.M_Id}
                        type="button"
                        onClick={toggle}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-sm transition-colors ${
                          selected
                            ? "bg-primary/10 border border-primary/40 text-foreground"
                            : "border border-transparent hover:bg-muted text-foreground"
                        }`}
                      >
                        <Checkbox checked={selected} onCheckedChange={toggle} className="shrink-0" />
                        <Package size={13} className="text-teal-400 shrink-0" />
                        <span className="flex-1 truncate">{i.M_Name}</span>
                        {i.M_UOM && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono shrink-0">
                            {i.M_UOM}
                          </span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            );
          })()}

          <DialogFooter className="px-5 py-4 border-t border-border">
            <button
              onClick={() => {
                setAddItemOpen(false);
                setPickedItemIds([]);
                setItemSearch("");
              }}
              className="px-3 py-1.5 rounded-lg text-xs font-heading border border-border text-muted-foreground hover:bg-muted"
            >
              Cancel
            </button>
            <button
              onClick={handleAddItem}
              disabled={pickedItemIds.length === 0}
              className="px-4 py-1.5 rounded-lg text-xs font-heading font-semibold gradient-engineering text-white disabled:opacity-40 transition-all"
            >
              {pickedItemIds.length > 0 ? `Add ${pickedItemIds.length}` : "Add"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Add Checkpoint dialog ── */}
      <Dialog
        open={addCheckpointOpen}
        onOpenChange={(open) => {
          setAddCheckpointOpen(open);
          if (!open) {
            setPickedCheckpointIds([]);
            setCheckpointSearch("");
          }
        }}
      >
        <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-5 pt-5 pb-3">
            <DialogTitle className="font-heading text-base">
              Tag Checkpoints to {viewRecord?.activity_name}
            </DialogTitle>
          </DialogHeader>

          <div className="px-5 pb-3">
            <div className="relative">
              <Search
                size={13}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                type="text"
                autoFocus
                value={checkpointSearch}
                onChange={(e) => setCheckpointSearch(e.target.value)}
                placeholder="Search checkpoints…"
                className="w-full pl-8 pr-3 py-2 text-sm rounded-lg bg-muted border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
          </div>

          {(() => {
            const filteredCheckpoints = unattachedCheckpoints.filter((c) =>
              checkpointSearch
                ? c.fieldName.toLowerCase().includes(checkpointSearch.toLowerCase())
                : true,
            );
            return (
              <div className="max-h-72 overflow-y-auto px-5 pb-5 space-y-1">
                {unattachedCheckpoints.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic text-center py-6">
                    Every checkpoint in Work Checkpoint Master is already tagged to this activity.
                  </p>
                ) : filteredCheckpoints.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic text-center py-6">
                    No checkpoint matches "{checkpointSearch}".
                  </p>
                ) : (
                  filteredCheckpoints.map((c) => {
                    const selected = pickedCheckpointIds.includes(c.id);
                    const toggle = () =>
                      setPickedCheckpointIds((prev) =>
                        prev.includes(c.id) ? prev.filter((id) => id !== c.id) : [...prev, c.id],
                      );
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={toggle}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-sm transition-colors ${
                          selected
                            ? "bg-primary/10 border border-primary/40 text-foreground"
                            : "border border-transparent hover:bg-muted text-foreground"
                        }`}
                      >
                        <Checkbox checked={selected} onCheckedChange={toggle} className="shrink-0" />
                        <Flag size={13} className="text-amber-400 shrink-0" />
                        <span className="flex-1 truncate">{c.fieldName}</span>
                        {c.minWaitDays != null && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono shrink-0">
                            {c.minWaitDays}d wait
                          </span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            );
          })()}

          <DialogFooter className="px-5 py-4 border-t border-border">
            <button
              onClick={() => {
                setAddCheckpointOpen(false);
                setPickedCheckpointIds([]);
                setCheckpointSearch("");
              }}
              className="px-3 py-1.5 rounded-lg text-xs font-heading border border-border text-muted-foreground hover:bg-muted"
            >
              Cancel
            </button>
            <button
              onClick={handleAttachCheckpoint}
              disabled={pickedCheckpointIds.length === 0}
              className="px-4 py-1.5 rounded-lg text-xs font-heading font-semibold gradient-engineering text-white disabled:opacity-40 transition-all"
            >
              {pickedCheckpointIds.length > 0 ? `Add ${pickedCheckpointIds.length}` : "Add"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ActivityMaster;
