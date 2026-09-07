import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { safeHtml } from "@/utils/escapeHtml";
import { FollowupShell } from "@/components/followup/FollowupShell";
import { StatusBadge } from "@/components/StatusBadge";
import {
  MasterPage,
  type DataChangeEvent,
  type RecordWithId,
  type FieldDef,
} from "@/components/MasterPage";
import type { ExportColumn } from "@/lib/export";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

const API = "/api/parking-slot-master";
const DROPDOWN_API = "/api/business/dropdown";
const PARKING_TYPES = ["Open", "Covered", "Stack", "Basement"];

async function fetchSlots(): Promise<any[]> {
  const res = await fetchWithAuth(API);
  if (!res.ok) throw new Error("Failed to fetch parking slots");
  return res.json().catch(() => ({}));
}

// Real, individually numbered parking inventory — distinct from Parking
// Master (which is only the pricing rate). This is what the Parking Matrix
// renders and what a sale actually allots against.
// Company -> Project -> Block, each strictly gated behind its parent
// (disabledWhen in MasterPage.tsx) so this can never fall back to showing
// every row unfiltered.
const fields: FieldDef[] = [
  {
    name: "companyId",
    label: "Company",
    type: "select",
    required: true,
    optionsProvider: (_data, _currentId, form) => {
      const companies: { id: number; name: string }[] = (form?.__companies as any) ?? [];
      return companies.map((c) => ({ value: String(c.id), label: c.name }));
    },
  },
  {
    name: "projectId",
    label: "Project",
    type: "select",
    required: true,
    disabledWhen: (form) => !form?.companyId,
    disabledPlaceholder: "Select a Company first",
    optionsProvider: (_data, _currentId, form) => {
      const projects: { id: number; name: string; company_id: number }[] = (form?.__projects as any) ?? [];
      const selectedCompany = form?.companyId as string | undefined;
      if (!selectedCompany) return [];
      return projects
        .filter((p) => String(p.company_id) === selectedCompany)
        .map((p) => ({ value: String(p.id), label: p.name }));
    },
  },
  {
    name: "blockId",
    label: "Block",
    type: "select",
    disabledWhen: (form) => !form?.projectId,
    disabledPlaceholder: "Select a Project first",
    optionsProvider: (_data, _currentId, form) => {
      const blocks: { Id: number; Name: string; ProjectId: number }[] = (form?.__blocks as any) ?? [];
      const selectedProject = form?.projectId as string | undefined;
      if (!selectedProject) return [];
      return blocks
        .filter((b) => String(b.ProjectId) === selectedProject)
        .map((b) => ({ value: String(b.Id), label: b.Name }));
    },
  },
  {
    name: "slotNo",
    label: "Slot No.",
    type: "text",
    required: true,
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
    name: "isActive",
    label: "Status",
    type: "toggle",
    defaultValue: true,
  },
];

const columns = [
  { key: "projectName", label: "Project" },
  { key: "blockName", label: "Block" },
  { key: "slotNo", label: "Slot No." },
  { key: "parkingType", label: "Type" },
  { key: "status", label: "Status", sortable: false },
];

const exportColumns: ExportColumn[] = [
  { header: "Project", accessor: "projectName" },
  { header: "Block", accessor: "blockName" },
  { header: "Slot No.", accessor: "slotNo" },
  { header: "Type", accessor: "parkingType" },
  { header: "Status", accessor: "status" },
];

// Same precedence parkingMatrix.js uses server-side (Blocked > Booked >
// OnHold > Available), computed from the exact lock fields the GET route
// now returns — so this can never drift from what the matrix shows.
function computeStatus(item: {
  isActive: boolean;
  lockAllotmentId: number | null;
  lockHoldId: number | null;
}): string {
  if (!item.isActive) return "Blocked";
  if (item.lockAllotmentId) return "Booked";
  if (item.lockHoldId) return "On Hold";
  return "Available";
}

const ParkingSlotMaster: React.FC = () => {
  const rights = usePageRights("followup-parking-slot-master");
  const queryClient = useQueryClient();

  const { data: slots, isLoading, error } = useQuery({
    queryKey: ["parking-slot-master"],
    queryFn: fetchSlots,
    staleTime: 5 * 60 * 1000,
  });

  const { data: allBlocks = [] } = useQuery<{ Id: number; Name: string; ProjectId: number }[]>({
    queryKey: ["parking-slot-master-blocks"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/unit-master/blocks");
      if (!res.ok) throw new Error("Failed to fetch blocks");
      return res.json().catch(() => ({}));
    },
    staleTime: 5 * 60 * 1000,
  });

  // Company -> Project source data for the two new cascade fields above.
  // Same shared dropdown endpoint every other Company->Project chain in the
  // app (BlockMaster.tsx, UnitMaster.tsx, CrmApplication.tsx) already uses.
  const { data: dropdownData } = useQuery<{
    companies: { id: number; name: string }[];
    projects: { id: number; name: string; company_id: number }[];
  }>({
    queryKey: ["business-dropdown"],
    queryFn: async () => {
      const res = await fetchWithAuth(DROPDOWN_API);
      if (!res.ok) throw new Error("Failed to fetch company/project dropdown");
      return res.json().catch(() => ({ companies: [], projects: [] }));
    },
    staleTime: 5 * 60 * 1000,
  });
  const companies = dropdownData?.companies ?? [];
  const projectsList = dropdownData?.projects ?? [];

  const mappedData: RecordWithId[] = React.useMemo(() => {
    if (!Array.isArray(slots)) return [];
    return slots.map((item) => {
      const isActive = Boolean(item.IsActive);
      const lockAllotmentId = item.LockAllotmentId ?? null;
      const lockBookingNo = item.LockBookingNo ?? null;
      const lockHoldId = item.LockHoldId ?? null;
      // A slot's own row only carries ProjectId — the Company shown/edited
      // here is derived from the Project's own company_id so an existing
      // slot reopens with the correct Company already selected.
      const project = projectsList.find((p) => p.id === item.ProjectId);
      return {
        _id: String(item.Id),
        companyId: project ? String(project.company_id) : "",
        projectId: String(item.ProjectId),
        projectName: item.ProjectName ?? "",
        blockId: item.BlockId ? String(item.BlockId) : "",
        blockName: item.BlockName ?? "",
        slotNo: item.SlotNo ?? "",
        parkingType: item.ParkingType ?? "Open",
        isActive,
        lockAllotmentId,
        lockBookingNo,
        lockHoldId,
        status: computeStatus({ isActive, lockAllotmentId, lockHoldId }),
      };
    });
  }, [slots, projectsList]);

  const blocksPatch = React.useMemo(
    () => ({ __blocks: allBlocks, __companies: companies, __projects: projectsList }),
    [allBlocks, companies, projectsList],
  );

  const toPayload = (r: Record<string, any>) => ({
    ProjectId: parseInt(r.projectId),
    BlockId: r.blockId ? parseInt(r.blockId) : null,
    SlotNo: r.slotNo?.trim() || null,
    ParkingType: r.parkingType || "Open",
    IsActive: r.isActive !== false,
  });

  // No internal try/catch here — a thrown error must propagate up to
  // MasterPage's own handleSave/handleDelete catch, or a server-side
  // rejection (409 duplicate, 409 locked) gets reported as a success and
  // leaves a phantom row in the table.
  const handleDataEvent = async (event: DataChangeEvent) => {
    if (event.action === "add") {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPayload(event.record)),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to add parking slot");
      toast.success("Parking slot added!");
    }
    if (event.action === "update") {
      const res = await fetchWithAuth(`${API}/${event.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPayload(event.record)),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to update parking slot");
      toast.success("Parking slot updated!");
    }
    if (event.action === "delete") {
      const res = await fetchWithAuth(`${API}/${event.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to delete parking slot");
      toast.success("Parking slot deleted!");
    }
    await queryClient.invalidateQueries({ queryKey: ["parking-slot-master"] });
  };

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading parking slots...</div>;
  if (error) return <div className="p-6 text-red-500">Failed to load parking slots.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Follow-Up", "Setup", "Parking Slot Master"]} />
      <FollowupShell title="Parking Slot Master">
        <MasterPage
          title="Parking Slot"
          canCreate={rights.canCreate}
          canEdit={rights.canEdit}
          canDelete={rights.canDelete}
          fields={fields}
          columns={columns}
          columnRenderers={{
            status: (value) => <StatusBadge status={value as string} />,
          }}
          initialData={mappedData}
          onDataEvent={handleDataEvent}
          externalFormPatch={blocksPatch}
          externalFormPatchKey={`${allBlocks.length}:${companies.length}:${projectsList.length}`}
          onFieldChange={(form, fieldName) => {
            if (fieldName === "companyId") {
              return { ...form, projectId: "", blockId: "" };
            }
            if (fieldName === "projectId") {
              return { ...form, blockId: "" };
            }
            return form;
          }}
          // A Booked or OnHold slot can't be edited OR deleted — it's an
          // individual inventory item, same treatment as Unit Master.
          isRowLocked={(row) =>
            row.lockAllotmentId
              ? row.lockBookingNo
                ? `Booked (${row.lockBookingNo as string})`
                : "Currently allotted"
              : row.lockHoldId
                ? "Currently on hold"
                : null
          }
          exportConfig={{
            title: "Parking Slot Master",
            filename: "parking-slot-master",
            columns: exportColumns,
          }}
          viewConfig={{
            title: "Parking Slot Details",
            fields: [
              { key: "projectName", label: "Project" },
              { key: "blockName", label: "Block" },
              { key: "slotNo", label: "Slot No." },
              { key: "parkingType", label: "Type" },
              { key: "status", label: "Status" },
            ],
          }}
          onPrint={(row) => {
            const win = window.open("", "_blank", "width=600,height=400");
            if (!win) return;
            win.document.write(safeHtml`
              <html><head><title>Parking Slot — ${row.slotNo}</title>
              <style>body{font-family:sans-serif;padding:24px;color:#111}h2{margin-bottom:16px}table{border-collapse:collapse;width:100%}td{padding:6px 12px;border:1px solid #ddd;font-size:13px}td:first-child{font-weight:600;width:40%;background:#f5f5f5}</style>
              </head><body><h2>Parking Slot</h2><table>
                <tr><td>Project</td><td>${row.projectName || "—"}</td></tr>
                <tr><td>Block</td><td>${row.blockName || "—"}</td></tr>
                <tr><td>Slot No.</td><td>${row.slotNo || "—"}</td></tr>
                <tr><td>Type</td><td>${row.parkingType || "—"}</td></tr>
                <tr><td>Status</td><td>${row.status}</td></tr>
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

export default ParkingSlotMaster;