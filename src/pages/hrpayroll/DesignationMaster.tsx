import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UserSquare } from "iconsax-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { HrPayrollShell } from "@/components/hrpayroll/HrPayrollShell";
import {
  MasterPage,
  type DataChangeEvent,
  type RecordWithId,
  type FieldDef,
  type ColumnDef,
} from "@/components/MasterPage";
import type { ExportColumn } from "@/lib/export";
import { getDepartmentOptions } from "@/api/departmentMasterApi";
import {
  getDesignations,
  addDesignation,
  updateDesignation,
  deleteDesignation,
  type DesignationRow,
} from "@/api/designationMasterApi";

const mapRow = (r: DesignationRow): RecordWithId => ({
  _id: String(r.Id),
  designationName: r.DesignationName,
  designationCode: r.DesignationCode,
  departmentId: r.DepartmentId ? String(r.DepartmentId) : "",
  departmentName: r.DepartmentName || "-",
  isActive: Boolean(r.IsActive),
});

const columns: ColumnDef[] = [
  { key: "designationName", label: "Designation Name" },
  { key: "designationCode", label: "DG Code" },
  { key: "departmentName", label: "Department", sortable: false },
  { key: "isActive", label: "Status" },
];

const exportColumns: ExportColumn[] = [
  { header: "Designation Name", accessor: "designationName" },
  { header: "DG Code", accessor: "designationCode" },
  { header: "Department", accessor: "departmentName" },
  { header: "Status", accessor: "isActive" },
];

const DesignationMaster: React.FC = () => {
  const rights = usePageRights("designation-master");
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["designation-master"],
    queryFn: getDesignations,
    staleTime: 60 * 1000,
  });

  const { data: departmentData } = useQuery({
    queryKey: ["department-master"],
    queryFn: getDepartmentOptions,
    staleTime: 5 * 60 * 1000,
  });

  const departmentOptions = (Array.isArray(departmentData) ? departmentData : []).map((d) => ({
    value: String(d.Id),
    label: d.DepartmentName,
  }));

  const rows: DesignationRow[] = Array.isArray(data) ? data : [];
  const mappedData: RecordWithId[] = rows.map(mapRow);

  const fields: FieldDef[] = [
    { name: "designationName", label: "Designation Name", type: "text", required: true },
    { name: "designationCode", label: "DG Code", type: "text", required: true, uppercase: true },
    { name: "departmentId", label: "Department", type: "select", asyncOptions: async () => departmentOptions },
    { name: "isActive", label: "Status", type: "toggle", defaultValue: true },
  ];

  const toPayload = (r: Record<string, any>) => ({
    DesignationName: r.designationName?.trim() || "",
    DesignationCode: r.designationCode?.trim() || "",
    DepartmentId: r.departmentId ? Number(r.departmentId) : null,
    IsActive: r.isActive !== false,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["designation-master"] });

  const handleDataEvent = async (event: DataChangeEvent) => {
    try {
      if (event.action === "add") {
        await addDesignation(toPayload(event.record));
        toast.success("Designation added!");
      }
      if (event.action === "update") {
        await updateDesignation(Number(event.id), toPayload(event.record));
        toast.success("Designation updated!");
      }
      if (event.action === "delete") {
        const res = await deleteDesignation(Number(event.id));
        toast.success(res?.message || "Designation deleted!");
      }
      await refresh();
    } catch (err: any) {
      toast.error(err.message || "Operation failed");
    }
  };

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading designations...</div>;
  if (error) return <div className="p-6 text-red-500">Failed to load designations.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "HR and Payroll", "Setup", "Designation Master"]} />
      <HrPayrollShell title="Designation Master" subtitle="Designations, DG codes & department mapping" icon={UserSquare}>
        <MasterPage
          title="Designation"
          canCreate={rights.canCreate}
          canEdit={rights.canEdit}
          canDelete={rights.canDelete}
          fields={fields}
          columns={columns}
          initialData={mappedData}
          onDataEvent={handleDataEvent}
          exportConfig={{
            title: "Designation Master",
            filename: "designation-master",
            columns: exportColumns,
          }}
          viewConfig={{
            title: "Designation Details",
            fields: [
              { key: "designationName", label: "Designation Name" },
              { key: "designationCode", label: "DG Code" },
              { key: "departmentName", label: "Department" },
              { key: "isActive", label: "Status" },
            ],
          }}
        />
      </HrPayrollShell>
    </>
  );
};

export default DesignationMaster;
