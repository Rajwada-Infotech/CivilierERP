import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { HardHat } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { CivilWorkDprShell } from "@/components/civilworkdpr/CivilWorkDprShell";
import {
  MasterPage,
  type DataChangeEvent,
  type RecordWithId,
  type FieldDef,
} from "@/components/MasterPage";
import type { ExportColumn } from "@/lib/export";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  getContractorOptions,
  getContractorAllocations,
  addContractorAllocation,
  updateContractorAllocation,
  deleteContractorAllocation,
} from "@/api/contractorAllocationApi";

// ── Lookups shared with Unit/Room Master's own project→block→unit cascade ──
async function fetchProjectOptions(): Promise<{ value: string; label: string }[]> {
  const res = await fetchWithAuth("/api/unit-master/projects");
  if (!res.ok) throw new Error("Failed to fetch projects");
  const data: { Id: number; Name: string }[] = await res.json().catch(() => []);
  return data.map((p) => ({ value: String(p.Id), label: p.Name }));
}

async function fetchAllBlocks(): Promise<{ Id: number; ProjectId: number; BlockName: string }[]> {
  const res = await fetchWithAuth("/api/block-master");
  if (!res.ok) throw new Error("Failed to fetch blocks");
  return res.json().catch(() => []);
}

async function fetchAllUnits(): Promise<{ Id: number; BlockId: number; UnitName: string }[]> {
  const res = await fetchWithAuth("/api/unit-master");
  if (!res.ok) throw new Error("Failed to fetch units");
  return res.json().catch(() => []);
}

// Civil-work Activities only (activity_type === 1) — same filter
// civilworkdprDashboard.js uses for its own Activities count.
async function fetchActivityOptions(): Promise<{ value: string; label: string }[]> {
  const res = await fetchWithAuth("/api/activity-master");
  if (!res.ok) throw new Error("Failed to fetch activities");
  const data: { id: number; activity_name: string; activity_type: number; is_active: boolean }[] =
    await res.json().catch(() => []);
  return data
    .filter((a) => a.activity_type === 1 && a.is_active !== false)
    .map((a) => ({ value: String(a.id), label: a.activity_name }));
}

const STATUS_OPTIONS = ["Allocated", "In Progress", "Completed", "On Hold"];

// ── Fields ────────────────────────────────────────────────────────────────
// Block is filtered by the selected Project; Unit is filtered by the
// selected Block. Both stay optional — some allocations (e.g. a boundary
// wall or common-area contractor) genuinely aren't tied to one block/unit.
const fields: FieldDef[] = [
  {
    name: "contractorId",
    label: "Contractor",
    type: "select",
    required: true,
    asyncOptions: getContractorOptions as unknown as () => Promise<{ value: string; label: string }[]>,
  },
  {
    name: "activityId",
    label: "Activity",
    type: "select",
    required: true,
    asyncOptions: fetchActivityOptions,
  },
  {
    name: "projectId",
    label: "Project",
    type: "select",
    asyncOptions: fetchProjectOptions,
  },
  {
    name: "blockId",
    label: "Block",
    type: "select",
    optionsProvider: (_data, _currentId, form) => {
      const blocks: { Id: number; ProjectId: number; BlockName: string }[] = (form?.__blocks as any) ?? [];
      const selectedProject = form?.projectId as string | undefined;
      return blocks
        .filter((b) => (selectedProject ? String(b.ProjectId) === selectedProject : true))
        .map((b) => ({ value: String(b.Id), label: b.BlockName }));
    },
  },
  {
    name: "unitId",
    label: "Unit",
    type: "select",
    disabledWhen: (form) => !form?.blockId,
    disabledPlaceholder: "Select a block first",
    optionsProvider: (_data, _currentId, form) => {
      const units: { Id: number; BlockId: number; UnitName: string }[] = (form?.__units as any) ?? [];
      const selectedBlock = form?.blockId as string | undefined;
      if (!selectedBlock) return [];
      return units
        .filter((u) => String(u.BlockId) === selectedBlock)
        .map((u) => ({ value: String(u.Id), label: u.UnitName }));
    },
  },
  { name: "workDescription", label: "Work Description", type: "textarea", fullWidth: true },
  { name: "allocationDate", label: "Allocation Date", type: "date" },
  { name: "startDate", label: "Start Date", type: "date" },
  { name: "expectedCompletionDate", label: "Expected Completion", type: "date" },
  { name: "currentStatus", label: "Status", type: "select", options: STATUS_OPTIONS, defaultValue: "Allocated" },
  { name: "siteLocation", label: "Site Location (free text)", type: "text" },
  { name: "remarks", label: "Remarks", type: "textarea", fullWidth: true },
];

const columns = [
  { key: "contractorName", label: "Contractor" },
  { key: "activityName", label: "Activity" },
  { key: "projectName", label: "Project" },
  { key: "blockName", label: "Block" },
  { key: "unitName", label: "Unit" },
  { key: "currentStatus", label: "Status" },
  { key: "approvalStatus", label: "Approval" },
];

const exportColumns: ExportColumn[] = [
  { header: "Contractor", accessor: "contractorName" },
  { header: "Activity", accessor: "activityName" },
  { header: "Project", accessor: "projectName" },
  { header: "Block", accessor: "blockName" },
  { header: "Unit", accessor: "unitName" },
  { header: "Status", accessor: "currentStatus" },
  { header: "Approval", accessor: "approvalStatus" },
  { header: "Allocation Date", accessor: "allocationDate" },
  { header: "Start Date", accessor: "startDate" },
];

const ContractorRegister: React.FC = () => {
  const rights = usePageRights("civilworkdpr-contractor-register");
  const queryClient = useQueryClient();

  const { data: allocations, isLoading, error } = useQuery({
    queryKey: ["contractor-register"],
    queryFn: getContractorAllocations,
    staleTime: 5 * 60 * 1000,
  });

  // Fetched once, injected into the form so blockId/unitId's optionsProvider
  // can filter by whatever the user picks above them — same pattern
  // RoomMaster.tsx uses for its project→unit cascade.
  const { data: allBlocks = [] } = useQuery({
    queryKey: ["contractor-register-blocks"],
    queryFn: fetchAllBlocks,
    staleTime: 5 * 60 * 1000,
  });
  const { data: allUnits = [] } = useQuery({
    queryKey: ["contractor-register-units"],
    queryFn: fetchAllUnits,
    staleTime: 5 * 60 * 1000,
  });

  const mappedData: RecordWithId[] = React.useMemo(() => {
    if (!Array.isArray(allocations)) return [];
    return allocations.map((a) => ({
      _id: String(a.id),
      contractorId: String(a.contractorId),
      contractorName: a.contractorName ?? "",
      activityId: String(a.activityId),
      activityName: a.activityName ?? "",
      projectId: a.projectId != null ? String(a.projectId) : "",
      projectName: a.projectName ?? "",
      blockId: a.blockId != null ? String(a.blockId) : "",
      blockName: a.blockName ?? "",
      unitId: a.unitId != null ? String(a.unitId) : "",
      unitName: a.unitName ?? "",
      workDescription: a.workDescription ?? "",
      allocationDate: a.allocationDate ?? "",
      startDate: a.startDate ?? "",
      expectedCompletionDate: a.expectedCompletionDate ?? "",
      currentStatus: a.currentStatus ?? "Allocated",
      siteLocation: a.siteLocation ?? "",
      remarks: a.remarks ?? "",
      approvalStatus: a.approvalStatus ?? "Pending",
    }));
  }, [allocations]);

  const cascadePatch = React.useMemo(() => ({ __blocks: allBlocks, __units: allUnits }), [allBlocks, allUnits]);

  const toPayload = (r: Record<string, any>) => ({
    contractorId: parseInt(r.contractorId),
    activityId: parseInt(r.activityId),
    projectId: r.projectId ? parseInt(r.projectId) : null,
    blockId: r.blockId ? parseInt(r.blockId) : null,
    unitId: r.unitId ? parseInt(r.unitId) : null,
    workDescription: r.workDescription || null,
    allocationDate: r.allocationDate || null,
    startDate: r.startDate || null,
    expectedCompletionDate: r.expectedCompletionDate || null,
    currentStatus: r.currentStatus || "Allocated",
    siteLocation: r.siteLocation || null,
    remarks: r.remarks || null,
  });

  const handleDataEvent = async (event: DataChangeEvent) => {
    if (event.action === "add") {
      await addContractorAllocation(toPayload(event.record));
      toast.success("Contractor allocation created!");
    }
    if (event.action === "update") {
      await updateContractorAllocation(parseInt(event.id), toPayload(event.record));
      toast.success("Contractor allocation updated!");
    }
    if (event.action === "delete") {
      await deleteContractorAllocation(parseInt(event.id));
      toast.success("Contractor allocation deleted!");
    }
    await queryClient.invalidateQueries({ queryKey: ["contractor-register"] });
  };

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading contractor register...</div>;
  if (error) return <div className="p-6 text-red-500">Failed to load contractor register.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Civil Work DPR", "Contractor Register"]} />
      <CivilWorkDprShell title="Contractor Register" icon={HardHat}>
        <MasterPage
          title="Allocation"
          canCreate={rights.canCreate}
          canEdit={rights.canEdit}
          canDelete={rights.canDelete}
          fields={fields}
          columns={columns}
          initialData={mappedData}
          onDataEvent={handleDataEvent}
          externalFormPatch={cascadePatch}
          externalFormPatchKey={allBlocks.length + allUnits.length}
          onFieldChange={(form, fieldName) => {
            if (fieldName === "projectId") return { ...form, blockId: "", unitId: "" };
            if (fieldName === "blockId") return { ...form, unitId: "" };
            return form;
          }}
          exportConfig={{
            title: "Contractor Register",
            filename: "contractor-register",
            columns: exportColumns,
          }}
          viewConfig={{
            title: "Allocation Details",
            fields: [
              { key: "contractorName", label: "Contractor" },
              { key: "activityName", label: "Activity" },
              { key: "projectName", label: "Project" },
              { key: "blockName", label: "Block" },
              { key: "unitName", label: "Unit" },
              { key: "workDescription", label: "Work Description" },
              { key: "allocationDate", label: "Allocation Date" },
              { key: "startDate", label: "Start Date" },
              { key: "expectedCompletionDate", label: "Expected Completion" },
              { key: "currentStatus", label: "Status" },
              { key: "approvalStatus", label: "Approval Status" },
              { key: "siteLocation", label: "Site Location" },
              { key: "remarks", label: "Remarks" },
            ],
          }}
        />
      </CivilWorkDprShell>
    </>
  );
};

export default ContractorRegister;
