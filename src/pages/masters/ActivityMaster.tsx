import { fetchWithAuth } from "@/lib/fetchWithAuth";
import React from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  MasterPage,
  type DataChangeEvent,
  type RecordWithId,
} from "@/components/MasterPage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Activity, Layers, Tag } from "lucide-react";

// ─── API ──────────────────────────────────────────────────────────────────────
const BASE = "/api/activity-master";

const getActivities = () =>
  fetchWithAuth(BASE).then((r) => r.json());
const addActivity = (data: object) =>
  fetchWithAuth(BASE, {
    method: "POST",
    body: JSON.stringify(data),
  }).then((r) => r.json());
const updateActivity = (id: string, data: object) =>
  fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  }).then((r) => r.json());
const deleteActivity = (id: string) =>
  fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" }).then(
    (r) => r.json(),
  );

// ─── Types ────────────────────────────────────────────────────────────────────
interface DbActivity {
  id: number;
  activity_name: string;
  short_description: string | null;
  activity_type: number | null; // 1 = Group, 2 = Activity
  group_id: number | null;
  is_active: boolean;
}

// ─── Payload ──────────────────────────────────────────────────────────────────
const toPayload = (r: Record<string, unknown>) => ({
  activity_name: (r.activityName as string) || null,
  short_description: (r.shortDesc as string) || null,
  activity_type: r.activityType === "Group" ? 1 : 2,
  group_id: r.groupId ? Number(r.groupId) : null,
  is_active: r.status !== false,
});

// ─── Component ────────────────────────────────────────────────────────────────
const ActivityMaster: React.FC = () => {
  const queryClient = useQueryClient();

  const {
    data: dbData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["activities"],
    queryFn: getActivities,
  });

  const dbItems: DbActivity[] = Array.isArray(dbData) ? dbData : [];

  // Groups for dropdown
  const groups = dbItems.filter((i) => i.activity_type === 1);

  const mappedData: RecordWithId[] = dbItems.map((item) => {
    const group = groups.find((g) => g.id === item.group_id);
    return {
      _id: String(item.id),
      activityName: item.activity_name || "",
      shortDesc: item.short_description || "",
      activityType: item.activity_type === 1 ? "Group" : "Activity",
      groupId: item.group_id ? String(item.group_id) : "",
      groupName: group?.activity_name || "",
      status: item.is_active,
    };
  });

  const groupOptions = groups.map((g) => ({
    value: String(g.id),
    label: g.activity_name,
  }));

  const handleDataEvent = async (event: DataChangeEvent) => {
    if (event.action === "add") {
      try {
        await addActivity(toPayload(event.record));
        toast.success("Activity saved!");
        await queryClient.invalidateQueries({ queryKey: ["activities"] });
      } catch (err: any) {
        toast.error("Save failed: " + err.message);
      }
    }
    if (event.action === "update") {
      try {
        await updateActivity(event.id, toPayload(event.record));
        toast.success("Activity updated!");
        await queryClient.invalidateQueries({ queryKey: ["activities"] });
      } catch (err: any) {
        toast.error("Update failed: " + err.message);
      }
    }
    if (event.action === "delete") {
      try {
        await deleteActivity(event.id);
        toast.success("Activity deleted!");
        await queryClient.invalidateQueries({ queryKey: ["activities"] });
      } catch (err: any) {
        toast.error("Delete failed: " + err.message);
      }
    }
  };

  const columnRenderers: Record<
    string,
    (value: unknown, row: RecordWithId) => React.ReactNode
  > = {
    activityType: (value) => {
      const isGroup = value === "Group";
      return (
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-heading border ${isGroup ? "bg-violet-500/10 border-violet-500/20 text-violet-600" : "bg-teal-500/10 border-teal-500/20 text-teal-600"}`}
        >
          {isGroup ? <Layers size={10} /> : <Tag size={10} />}
          {String(value || "—")}
        </span>
      );
    },
    status: (value) => (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${value ? "bg-green-500/10 border-green-500/20 text-green-600" : "bg-red-500/10 border-red-500/20 text-red-600"}`}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full mr-1.5 ${value ? "bg-green-500" : "bg-red-500"}`}
        />
        {value ? "Active" : "Inactive"}
      </span>
    ),
    shortDesc: (value) => (
      <span className="font-mono text-xs tracking-wide text-muted-foreground">
        {String(value || "—")}
      </span>
    ),
    groupName: (value, row) => {
      if (row.activityType !== "Activity")
        return <span className="text-muted-foreground text-xs">—</span>;
      return (
        <span className="inline-flex items-center gap-1 text-xs text-violet-600">
          <Layers size={11} />
          {String(value || "—")}
        </span>
      );
    },
  };

  if (isLoading)
    return <div className="p-6 text-muted-foreground">Loading...</div>;
  if (error)
    return <div className="p-6 text-red-500">Failed to load activities.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance Module", "Activity Master"]} />
      <div className="flex items-center gap-3 mb-4">
        <Activity className="w-5 h-5 text-primary" />
        <h1 className="text-xl font-heading font-bold text-foreground">
          Activity Master
        </h1>
      </div>
      <MasterPage
        title="Activity"
        fields={[
          {
            name: "activityName",
            label: "Activity Name",
            type: "text",
            required: true,
          },
          {
            name: "shortDesc",
            label: "Short Desc",
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
          { key: "status", label: "Status" },
        ]}
        columnRenderers={columnRenderers}
        initialData={mappedData}
        onDataEvent={handleDataEvent}
      />
    </>
  );
};

export default ActivityMaster;
