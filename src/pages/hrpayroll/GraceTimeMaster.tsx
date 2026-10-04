import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Timer1 } from "iconsax-react";
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
import {
  getGraceTimes,
  addGraceTime,
  updateGraceTime,
  deleteGraceTime,
  type GraceTimeRow,
} from "@/api/graceTimeMasterApi";

const mapRow = (r: GraceTimeRow): RecordWithId => ({
  _id: String(r.GraceId),
  graceName: r.GraceName,
  graceCode: r.GraceCode,
  timeMinutes: r.TimeMinutes,
  reasonRemarks: r.ReasonRemarks || "",
  isActive: Boolean(r.IsActive),
});

const columns: ColumnDef[] = [
  { key: "graceName", label: "Grace Name" },
  { key: "graceCode", label: "Grace Code" },
  { key: "timeMinutes", label: "Time (Minutes)" },
  { key: "reasonRemarks", label: "Reason / Remarks", hideOnMobile: true, sortable: false },
  { key: "isActive", label: "Status" },
];

const exportColumns: ExportColumn[] = [
  { header: "Grace Name", accessor: "graceName" },
  { header: "Grace Code", accessor: "graceCode" },
  { header: "Time (Minutes)", accessor: "timeMinutes" },
  { header: "Reason / Remarks", accessor: "reasonRemarks" },
  { header: "Status", accessor: "isActive" },
];

const GraceTimeMaster: React.FC = () => {
  const rights = usePageRights("grace-time-master");
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["grace-time-master"],
    queryFn: getGraceTimes,
    staleTime: 60 * 1000,
  });

  const rows: GraceTimeRow[] = Array.isArray(data) ? data : [];
  const mappedData: RecordWithId[] = rows.map(mapRow);

  const fields: FieldDef[] = [
    { name: "graceName", label: "Grace Name", type: "text", required: true },
    { name: "graceCode", label: "Grace Code", type: "text", required: true, uppercase: true },
    { name: "timeMinutes", label: "Time (Minutes)", type: "number", required: true },
    { name: "reasonRemarks", label: "Reason / Remarks", type: "textarea", fullWidth: true },
    { name: "isActive", label: "Status", type: "toggle", defaultValue: true },
  ];

  const toPayload = (r: Record<string, any>) => ({
    GraceName: r.graceName?.trim() || "",
    GraceCode: r.graceCode?.trim() || "",
    TimeMinutes: r.timeMinutes !== "" && r.timeMinutes != null ? Number(r.timeMinutes) : null,
    ReasonRemarks: r.reasonRemarks?.trim() || null,
    IsActive: r.isActive !== false,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["grace-time-master"] });

  const handleDataEvent = async (event: DataChangeEvent) => {
    try {
      if (event.action === "add") {
        await addGraceTime(toPayload(event.record) as any);
        toast.success("Grace time added!");
      }
      if (event.action === "update") {
        await updateGraceTime(Number(event.id), toPayload(event.record) as any);
        toast.success("Grace time updated!");
      }
      if (event.action === "delete") {
        const res = await deleteGraceTime(Number(event.id));
        toast.success(res?.message || "Grace time deleted!");
      }
      await refresh();
    } catch (err: any) {
      toast.error(err.message || "Operation failed");
    }
  };

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading grace time rules...</div>;
  if (error) return <div className="p-6 text-red-500">Failed to load grace time rules.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "HR and Payroll", "Setup", "Grace Time Master"]} />
      <HrPayrollShell title="Grace Time Master" subtitle="Late-attendance grace period rules" icon={Timer1}>
        <MasterPage
          title="Grace Time"
          canCreate={rights.canCreate}
          canEdit={rights.canEdit}
          canDelete={rights.canDelete}
          fields={fields}
          columns={columns}
          initialData={mappedData}
          onDataEvent={handleDataEvent}
          exportConfig={{
            title: "Grace Time Master",
            filename: "grace-time-master",
            columns: exportColumns,
          }}
          viewConfig={{
            title: "Grace Time Details",
            fields: [
              { key: "graceName", label: "Grace Name" },
              { key: "graceCode", label: "Grace Code" },
              { key: "timeMinutes", label: "Time (Minutes)" },
              { key: "reasonRemarks", label: "Reason / Remarks" },
              { key: "isActive", label: "Status" },
            ],
          }}
        />
      </HrPayrollShell>
    </>
  );
};

export default GraceTimeMaster;
