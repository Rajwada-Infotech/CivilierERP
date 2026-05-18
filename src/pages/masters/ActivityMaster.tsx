import React, { useState } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
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
}: {
  group: DbActivity;
  activities: DbActivity[];
  search: string;
  onView: (item: DbActivity) => void;
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
const ActivityMaster: React.FC = () => {
  const queryClient = useQueryClient();
  const [treeSearch, setTreeSearch] = useState("");
  const [viewRecord, setViewRecord] = useState<DbActivity | null>(null);

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

  // HSN master for the dropdown
  const { data: hsnRaw = [] } = useQuery({
    queryKey: ["hsn-master"],
    queryFn: getHsn,
  });

  const hsnOptions: { code: string; desc: string }[] = Array.isArray(hsnRaw)
    ? (hsnRaw as any[])
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
      try {
        await addActivity(toPayload(event.record, groupOptions));
        toast.success("Activity saved!");
        await refetch();
      } catch (err: any) {
        toast.error("Save failed: " + err.message);
      }
    }
    if (event.action === "update") {
      try {
        await updateActivity(event.id, toPayload(event.record, groupOptions));
        toast.success("Activity updated!");
        await refetch();
      } catch (err: any) {
        toast.error("Update failed: " + err.message);
      }
    }
    if (event.action === "delete") {
      try {
        await deleteActivity(event.id);
        toast.success("Activity deleted!");
        await refetch();
      } catch (err: any) {
        toast.error("Delete failed: " + err.message);
      }
    }
  };

  if (isLoading)
    return <div className="p-6 text-muted-foreground">Loading...</div>;
  if (error)
    return <div className="p-6 text-red-500">Failed to load activities.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Material", "Activity Master"]} />
      <div className="flex items-center gap-3 mb-4">
        <Activity className="w-5 h-5 text-primary" />
        <h1 className="text-xl font-heading font-bold text-foreground">
          Activity Master
        </h1>
      </div>

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
              label: "HSN Code",
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
                          : "Select HSN Code…"}
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
                        HSN can only be linked to an Activity, not a Group
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
            { key: "hsnCode", label: "HSN", hideOnMobile: true },
            { key: "status", label: "Status" },
          ]}
          initialData={mappedData}
          onDataEvent={handleDataEvent}
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
            <button
              onClick={() => exportToCSV(dbItems, groups)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border bg-background hover:bg-muted transition-colors text-foreground"
            >
              <Download size={12} />
              Export
            </button>

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
      {/* ── View Detail Drawer ── */}
      {viewRecord && (
        <div className="fixed inset-0 z-50 flex justify-end">
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
                    HSN Code
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
    </>
  );
};

export default ActivityMaster;
