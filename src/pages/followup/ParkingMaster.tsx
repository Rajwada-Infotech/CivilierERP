import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
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

const API = "/api/parking-master";
const PARKING_TYPES = ["Open", "Covered", "Stack", "Basement"];

async function fetchParkingRates(): Promise<any[]> {
  const res = await fetchWithAuth(API);
  if (!res.ok) throw new Error("Failed to fetch parking rates");
  return res.json().catch(() => ({}));
}

async function fetchProjectOptions(): Promise<{ value: string; label: string }[]> {
  const res = await fetchWithAuth("/api/unit-master/projects");
  if (!res.ok) throw new Error("Failed to fetch projects");
  const data: { Id: number; Name: string }[] = await res.json().catch(() => ({}));
  return data.map((p) => ({ value: String(p.Id), label: p.Name }));
}

// ── Fields — Block is optional: leaving it unset makes the rate apply to
// every block in the project (a block-specific rate overrides it).
const fields: FieldDef[] = [
  {
    name: "projectId",
    label: "Project",
    type: "select",
    required: true,
    asyncOptions: fetchProjectOptions,
  },
  {
    name: "blockId",
    label: "Block (leave blank = applies to whole project)",
    type: "select",
    optionsProvider: (_data, _currentId, form) => {
      const blocks: { Id: number; Name: string; ProjectId: number }[] = (form?.__blocks as any) ?? [];
      const selectedProject = form?.projectId as string | undefined;
      return blocks
        .filter((b) => (selectedProject ? String(b.ProjectId) === selectedProject : true))
        .map((b) => ({ value: String(b.Id), label: b.Name }));
    },
  },
  {
    name: "parkingType",
    label: "Parking Type",
    type: "select",
    required: true,
    defaultValue: "Open",
    options: PARKING_TYPES,
  },
  {
    name: "charge",
    label: "Charge (₹)",
    type: "number",
    required: true,
  },
  {
    name: "gstRate",
    label: "GST Rate (%)",
    type: "number",
    defaultValue: "18",
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
  { key: "parkingType", label: "Type" },
  { key: "charge", label: "Charge (₹)" },
  { key: "gstRate", label: "GST %" },
  { key: "status", label: "Status" },
];

const exportColumns: ExportColumn[] = [
  { header: "Project", accessor: "projectName" },
  { header: "Block", accessor: "blockName" },
  { header: "Type", accessor: "parkingType" },
  { header: "Charge", accessor: "charge" },
  { header: "GST %", accessor: "gstRate" },
  { header: "Status", accessor: "status" },
];

const ParkingMaster: React.FC = () => {
  const queryClient = useQueryClient();

  const { data: rates, isLoading, error } = useQuery({
    queryKey: ["parking-master"],
    queryFn: fetchParkingRates,
    staleTime: 5 * 60 * 1000,
  });

  const { data: allBlocks = [] } = useQuery<{ Id: number; Name: string; ProjectId: number }[]>({
    queryKey: ["parking-master-blocks"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/unit-master/blocks");
      if (!res.ok) throw new Error("Failed to fetch blocks");
      return res.json().catch(() => ({}));
    },
    staleTime: 5 * 60 * 1000,
  });

  const mappedData: RecordWithId[] = React.useMemo(() => {
    if (!Array.isArray(rates)) return [];
    return rates.map((item) => ({
      _id: String(item.Id),
      projectId: String(item.ProjectId),
      projectName: item.ProjectName ?? "",
      blockId: item.BlockId ? String(item.BlockId) : "",
      blockName: item.BlockName ?? "All blocks",
      parkingType: item.ParkingType ?? "Open",
      charge: item.Charge != null ? String(item.Charge) : "",
      gstRate: item.GstRate != null ? String(item.GstRate) : "18",
      isActive: Boolean(item.IsActive),
      // MasterPage's built-in Active/Inactive pill only kicks in for a
      // column keyed "status" — alias it here instead of showing the raw
      // isActive boolean as literal "true"/"false" text (same fix already
      // applied in BlockMaster.tsx).
      status: Boolean(item.IsActive),
      inUse: Boolean(item.InUse),
    }));
  }, [rates]);

  const blocksPatch = React.useMemo(() => ({ __blocks: allBlocks }), [allBlocks]);

  const toPayload = (r: Record<string, any>) => ({
    ProjectId: parseInt(r.projectId),
    BlockId: r.blockId ? parseInt(r.blockId) : null,
    ParkingType: r.parkingType || "Open",
    Charge: parseFloat(r.charge),
    GstRate: r.gstRate !== "" ? parseFloat(r.gstRate) : 18,
    IsActive: r.isActive !== false,
  });

  // No internal try/catch here — same fix as Block/Unit Master: swallowing
  // the error here would let a 409 (duplicate rate, or in-use on delete)
  // get reported to the user as a success.
  const handleDataEvent = async (event: DataChangeEvent) => {
    if (event.action === "add") {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPayload(event.record)),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to add parking rate");
      toast.success("Parking rate added!");
    }
    if (event.action === "update") {
      const res = await fetchWithAuth(`${API}/${event.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPayload(event.record)),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to update parking rate");
      toast.success("Parking rate updated!");
    }
    if (event.action === "delete") {
      const res = await fetchWithAuth(`${API}/${event.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to delete parking rate");
      toast.success("Parking rate deleted!");
    }
    await queryClient.invalidateQueries({ queryKey: ["parking-master"] });
  };

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading parking rates...</div>;
  if (error) return <div className="p-6 text-red-500">Failed to load parking rates.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Follow-Up", "Setup", "Parking Master"]} />
      <FollowupShell title="Parking Master">
        <MasterPage
          title="Parking Rate"
          fields={fields}
          columns={columns}
          initialData={mappedData}
          onDataEvent={handleDataEvent}
          externalFormPatch={blocksPatch}
          externalFormPatchKey={allBlocks.length}
          onFieldChange={(form, fieldName) => {
            if (fieldName === "projectId") {
              return { ...form, blockId: "" };
            }
            return form;
          }}
          // A rate that's ever been allotted to a booking can't be
          // deleted — matches the server-side guard in parkingMaster.js
          // exactly. Editing stays open (same as Block Master) since a
          // correction here is looked up live, not snapshotted.
          isDeleteLocked={(row) =>
            row.inUse ? "Already allotted to one or more bookings" : null
          }
          exportConfig={{
            title: "Parking Master",
            filename: "parking-master",
            columns: exportColumns,
          }}
          viewConfig={{
            title: "Parking Rate Details",
            fields: [
              { key: "projectName", label: "Project" },
              { key: "blockName", label: "Block" },
              { key: "parkingType", label: "Type" },
              { key: "charge", label: "Charge (₹)" },
              { key: "gstRate", label: "GST %" },
              { key: "status", label: "Status" },
            ],
          }}
          onPrint={(row) => {
            const win = window.open("", "_blank", "width=600,height=400");
            if (!win) return;
            win.document.write(safeHtml`
              <html><head><title>Parking Rate — ${row.parkingType}</title>
              <style>body{font-family:sans-serif;padding:24px;color:#111}h2{margin-bottom:16px}table{border-collapse:collapse;width:100%}td{padding:6px 12px;border:1px solid #ddd;font-size:13px}td:first-child{font-weight:600;width:40%;background:#f5f5f5}</style>
              </head><body><h2>Parking Rate</h2><table>
                <tr><td>Project</td><td>${row.projectName || "—"}</td></tr>
                <tr><td>Block</td><td>${row.blockName || "All blocks"}</td></tr>
                <tr><td>Type</td><td>${row.parkingType || "—"}</td></tr>
                <tr><td>Charge</td><td>₹${row.charge || "0"}</td></tr>
                <tr><td>GST %</td><td>${row.gstRate || "0"}%</td></tr>
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

export default ParkingMaster;