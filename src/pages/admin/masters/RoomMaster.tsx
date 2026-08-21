import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { safeHtml } from "@/utils/escapeHtml";
import { FollowupShell } from "@/components/followup/FollowupShell";
import {
  MasterPage,
  type DataChangeEvent,
  type RecordWithId,
  type FieldDef,
} from "@/components/MasterPage";
import type { ExportColumn } from "@/lib/export";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

const API = "/api/room-master";

// ── API helpers ────────────────────────────────────────────────────────────────
async function fetchRooms(): Promise<any[]> {
  const res = await fetchWithAuth(API);
  if (!res.ok) throw new Error("Failed to fetch rooms");
  return res.json().catch(() => ({}));
}

async function fetchProjectOptions(): Promise<
  { value: string; label: string }[]
> {
  const res = await fetchWithAuth(`${API}/projects`);
  if (!res.ok) throw new Error("Failed to fetch projects");
  const data: { Id: number; Name: string }[] = await res.json().catch(() => ({}));
  return data.map((p) => ({ value: String(p.Id), label: p.Name }));
}

// ── Fields ────────────────────────────────────────────────────────────────────
// Unit is filtered by the selected project. Block is never chosen directly —
// it's whichever block the selected unit belongs to, shown read-only.
const fields: FieldDef[] = [
  {
    name: "projectId",
    label: "Project",
    type: "select",
    required: true,
    asyncOptions: fetchProjectOptions,
  },
  {
    name: "unitId",
    label: "Unit",
    type: "select",
    required: true,
    optionsProvider: (_data, _currentId, form) => {
      const units: { Id: number; Name: string; ProjectId: number }[] =
        (form?.__units as any) ?? [];
      const selectedProject = form?.projectId as string | undefined;
      return units
        .filter((u) =>
          selectedProject ? String(u.ProjectId) === selectedProject : true,
        )
        .map((u) => ({ value: String(u.Id), label: u.Name }));
    },
  },
  {
    name: "blockNameDisplay",
    label: "Block",
    type: "custom",
    render: ({ formData }) => {
      const units: { Id: number; BlockName: string | null }[] =
        (formData?.__units as any) ?? [];
      const selectedUnit = formData?.unitId as string | undefined;
      const unit = units.find((u) => String(u.Id) === selectedUnit);
      return (
        <div className="text-sm text-foreground bg-muted/40 border border-border rounded-lg px-3 py-2">
          {unit?.BlockName || (
            <span className="text-muted-foreground italic">
              Select a unit to see its block
            </span>
          )}
        </div>
      );
    },
  },
  {
    name: "roomName",
    label: "Room Name",
    type: "text",
    required: true,
  },
  {
    name: "floor",
    label: "Floor",
    type: "text",
  },
  {
    name: "isActive",
    label: "Status",
    type: "toggle",
    defaultValue: true,
  },
];

const columns = [
  { key: "projectName", label: "Project" },
  { key: "blockName", label: "Block" },
  { key: "unitName", label: "Unit" },
  { key: "roomName", label: "Room Name" },
  { key: "floor", label: "Floor" },
  { key: "isActive", label: "Status" },
];

const exportColumns: ExportColumn[] = [
  { header: "Project", accessor: "projectName" },
  { header: "Block", accessor: "blockName" },
  { header: "Unit", accessor: "unitName" },
  { header: "Room Name", accessor: "roomName" },
  { header: "Floor", accessor: "floor" },
  { header: "Status", accessor: "isActive" },
];

// ── Component ─────────────────────────────────────────────────────────────────
const RoomMaster: React.FC = () => {
  usePageRights("room-master");
  const queryClient = useQueryClient();

  const {
    data: rooms,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["room-master"],
    queryFn: fetchRooms,
    staleTime: 5 * 60 * 1000,
  });

  // Fetch all units once — passed into form as __units so optionsProvider /
  // the read-only block display can filter & look up by id.
  const { data: allUnits = [] } = useQuery<
    { Id: number; Name: string; ProjectId: number; BlockId: number; BlockName: string | null }[]
  >({
    queryKey: ["room-master-units"],
    queryFn: async () => {
      const res = await fetchWithAuth(`${API}/units`);
      if (!res.ok) throw new Error("Failed to fetch units");
      return res.json().catch(() => ({}));
    },
    staleTime: 5 * 60 * 1000,
  });

  // Backend → frontend shape; also inject __units so optionsProvider/render can see them
  const mappedData: RecordWithId[] = React.useMemo(() => {
    if (!Array.isArray(rooms)) return [];
    return rooms.map((item) => ({
      _id: String(item.Id),
      projectId: String(item.ProjectId),
      projectName: item.ProjectName ?? "",
      blockId: String(item.BlockId),
      blockName: item.BlockName ?? "",
      unitId: String(item.UnitId),
      unitName: item.UnitName ?? "",
      roomName: item.RoomName ?? "",
      floor: item.Floor ?? "",
      isActive: Boolean(item.IsActive),
    }));
  }, [rooms]);

  // externalFormPatch injects __units into the form so optionsProvider/render can filter/look up
  const unitsPatch = React.useMemo(() => ({ __units: allUnits }), [allUnits]);

  const toPayload = (r: Record<string, any>) => ({
    ProjectId: parseInt(r.projectId),
    UnitId: parseInt(r.unitId),
    RoomName: r.roomName?.trim() || null,
    Floor: r.floor?.trim() || null,
    IsActive: r.isActive !== false,
  });

  const handleDataEvent = async (event: DataChangeEvent) => {
    try {
      if (event.action === "add") {
        const res = await fetchWithAuth(API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(toPayload(event.record)),
        });
        if (!res.ok)
          throw new Error((await res.json()).error || "Failed to add room");
        toast.success("Room added!");
      }
      if (event.action === "update") {
        const res = await fetchWithAuth(`${API}/${event.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(toPayload(event.record)),
        });
        if (!res.ok)
          throw new Error((await res.json()).error || "Failed to update room");
        toast.success("Room updated!");
      }
      if (event.action === "delete") {
        const res = await fetchWithAuth(`${API}/${event.id}`, {
          method: "DELETE",
        });
        if (!res.ok)
          throw new Error((await res.json()).error || "Failed to delete room");
        toast.success("Room deleted!");
      }
      await queryClient.invalidateQueries({ queryKey: ["room-master"] });
    } catch (err: any) {
      toast.error(err.message || "Operation failed");
    }
  };

  if (isLoading)
    return <div className="p-6 text-muted-foreground">Loading rooms...</div>;
  if (error)
    return <div className="p-6 text-red-500">Failed to load rooms.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Follow-Up", "Setup", "Room Master"]} />
      <FollowupShell title="Room Master">
      <MasterPage
        title="Room"
        fields={fields}
        columns={columns}
        initialData={mappedData}
        onDataEvent={handleDataEvent}
        // Inject __units + reset unitId when project changes
        externalFormPatch={unitsPatch}
        externalFormPatchKey={allUnits.length}
        onFieldChange={(form, fieldName) => {
          if (fieldName === "projectId") {
            return { ...form, unitId: "" };
          }
          return form;
        }}
        exportConfig={{
          title: "Room Master",
          filename: "room-master",
          columns: exportColumns,
        }}
        viewConfig={{
          title: "Room Details",
          fields: [
            { key: "projectName", label: "Project" },
            { key: "blockName", label: "Block" },
            { key: "unitName", label: "Unit" },
            { key: "roomName", label: "Room Name" },
            { key: "floor", label: "Floor" },
            { key: "isActive", label: "Status" },
          ],
        }}
        onPrint={(row) => {
          const win = window.open("", "_blank", "width=600,height=400");
          if (!win) return;
          win.document.write(safeHtml`
            <html><head><title>Room — ${row.roomName}</title>
            <style>body{font-family:sans-serif;padding:24px;color:#111}h2{margin-bottom:16px}table{border-collapse:collapse;width:100%}td{padding:6px 12px;border:1px solid #ddd;font-size:13px}td:first-child{font-weight:600;width:40%;background:#f5f5f5}</style>
            </head><body><h2>Room Card</h2><table>
              <tr><td>Project</td><td>${row.projectName || "—"}</td></tr>
              <tr><td>Block</td><td>${row.blockName || "—"}</td></tr>
              <tr><td>Unit</td><td>${row.unitName || "—"}</td></tr>
              <tr><td>Room Name</td><td>${row.roomName || "—"}</td></tr>
              <tr><td>Floor</td><td>${row.floor || "—"}</td></tr>
              <tr><td>Status</td><td>${row.isActive ? "Active" : "Inactive"}</td></tr>
            </table></body></html>
          `);
          win.document.close();
          win.print();
        }}
      />
      </FollowupShell>
    </>
  );
};

export default RoomMaster;
