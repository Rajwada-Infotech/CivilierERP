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

const API = "/api/block-master";

async function fetchBlocks(): Promise<any[]> {
  const res = await fetchWithAuth(API);
  if (!res.ok) throw new Error("Failed to fetch blocks");
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
const fields: FieldDef[] = [
  {
    name: "projectId",
    label: "Project",
    type: "select",
    required: true,
    asyncOptions: fetchProjectOptions,
  },
  {
    name: "blockName",
    label: "Block Name",
    type: "text",
    required: true,
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
  { key: "blockName", label: "Block Name" },
  { key: "status", label: "Status" },
];

const exportColumns: ExportColumn[] = [
  { header: "Project", accessor: "projectName" },
  { header: "Block Name", accessor: "blockName" },
  { header: "Status", accessor: "status" },
];

// ── Component ─────────────────────────────────────────────────────────────────
const BlockMaster: React.FC = () => {
  const queryClient = useQueryClient();

  const {
    data: blocks,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["block-master"],
    queryFn: fetchBlocks,
    staleTime: 5 * 60 * 1000,
  });

  const mappedData: RecordWithId[] = React.useMemo(() => {
    if (!Array.isArray(blocks)) return [];
    return blocks.map((item) => ({
      _id: String(item.Id),
      projectId: String(item.ProjectId),
      projectName: item.ProjectName ?? "",
      blockName: item.BlockName ?? "",
      isActive: Boolean(item.IsActive),
      // MasterPage's built-in Active/Inactive pill only kicks in for a
      // column keyed "status" — alias it here instead of showing the raw
      // isActive boolean as literal "true"/"false" text.
      status: Boolean(item.IsActive),
      lockBookingNo: item.LockBookingNo ?? null,
      lockHoldId: item.LockHoldId ?? null,
    }));
  }, [blocks]);

  const toPayload = (r: Record<string, any>) => ({
    ProjectId: parseInt(r.projectId),
    BlockName: r.blockName?.trim() || null,
    IsActive: r.isActive !== false,
  });

  const handleDataEvent = async (event: DataChangeEvent) => {
    if (event.action === "add") {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPayload(event.record)),
      });
      if (!res.ok)
        throw new Error((await res.json()).error || "Failed to add block");
      toast.success("Block added!");
    }
    if (event.action === "update") {
      const res = await fetchWithAuth(`${API}/${event.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPayload(event.record)),
      });
      if (!res.ok)
        throw new Error((await res.json()).error || "Failed to update block");
      toast.success("Block updated!");
    }
    if (event.action === "delete") {
      const res = await fetchWithAuth(`${API}/${event.id}`, {
        method: "DELETE",
      });
      if (!res.ok)
        throw new Error((await res.json()).error || "Failed to delete block");
      toast.success("Block deleted!");
    }
    await queryClient.invalidateQueries({ queryKey: ["block-master"] });
  };

  if (isLoading)
    return <div className="p-6 text-muted-foreground">Loading blocks...</div>;
  if (error)
    return <div className="p-6 text-red-500">Failed to load blocks.</div>;

  return (
    <>
      <Breadcrumbs
        items={["Dashboard", "Follow-Up", "Setup", "Block Master"]}
      />
      <FollowupShell title="Block Master">
      <MasterPage
        title="Block"
        fields={fields}
        columns={columns}
        initialData={mappedData}
        onDataEvent={handleDataEvent}
        // A Block with a Booked or OnHold Unit under it can't be deleted —
        // matches the server-side guard in blockMaster.js exactly. Editing
        // stays open (unlike Unit Master) since a rename/reassign here is
        // live-joined project-wide rather than locked to this one row.
        isDeleteLocked={(row) =>
          row.lockBookingNo
            ? `Has a Unit booked (${row.lockBookingNo as string})`
            : row.lockHoldId
              ? "Has a Unit on hold"
              : null
        }
        exportConfig={{
          title: "Block Master",
          filename: "block-master",
          columns: exportColumns,
        }}
        viewConfig={{
          title: "Block Details",
          fields: [
            { key: "projectName", label: "Project" },
            { key: "blockName", label: "Block Name" },
            { key: "status", label: "Status" },
          ],
        }}
        onPrint={(row) => {
          const win = window.open("", "_blank", "width=600,height=400");
          if (!win) return;
          win.document.write(safeHtml`
            <html><head><title>Block — ${row.blockName}</title>
            <style>body{font-family:sans-serif;padding:24px;color:#111}h2{margin-bottom:16px}table{border-collapse:collapse;width:100%}td{padding:6px 12px;border:1px solid #ddd;font-size:13px}td:first-child{font-weight:600;width:40%;background:#f5f5f5}</style>
            </head><body><h2>Block Card</h2><table>
              <tr><td>Project</td><td>${row.projectName || "—"}</td></tr>
              <tr><td>Block Name</td><td>${row.blockName || "—"}</td></tr>
              <tr><td>Status</td><td>${row.status ? "Active" : "Inactive"}</td></tr>
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

export default BlockMaster;