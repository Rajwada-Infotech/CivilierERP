import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Calendar } from "iconsax-react";
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
import { getFinYears } from "@/api/finYearApi";
import {
  getHolidays,
  addHoliday,
  updateHoliday,
  deleteHoliday,
  type HolidayRow,
} from "@/api/holidayMasterApi";

const mapRow = (r: HolidayRow): RecordWithId => ({
  _id: String(r.HolidayId),
  holidayName: r.HolidayName,
  holidayDate: r.HolidayDate ? r.HolidayDate.slice(0, 10) : "",
  finYearId: r.FinYearId ? String(r.FinYearId) : "",
  finYearName: r.FinYearName || "-",
  isActive: Boolean(r.IsActive),
});

const columns: ColumnDef[] = [
  { key: "holidayName", label: "Holiday Name" },
  { key: "holidayDate", label: "Date" },
  { key: "finYearName", label: "Fin Year", sortable: false },
  { key: "isActive", label: "Status" },
];

const exportColumns: ExportColumn[] = [
  { header: "Holiday Name", accessor: "holidayName" },
  { header: "Date", accessor: "holidayDate" },
  { header: "Fin Year", accessor: "finYearName" },
  { header: "Status", accessor: "isActive" },
];

const HolidayMaster: React.FC = () => {
  const rights = usePageRights("holiday-master");
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["holiday-master"],
    queryFn: getHolidays,
    staleTime: 60 * 1000,
  });

  const { data: finYearData } = useQuery({
    queryKey: ["fin-year-options"],
    queryFn: getFinYears,
    staleTime: 5 * 60 * 1000,
  });

  const finYearOptions = (Array.isArray(finYearData) ? finYearData : []).map((fy: any) => ({
    value: String(fy.FId),
    label: fy.FName,
  }));

  const rows: HolidayRow[] = Array.isArray(data) ? data : [];
  const mappedData: RecordWithId[] = rows.map(mapRow);

  const fields: FieldDef[] = [
    { name: "holidayName", label: "Holiday Name", type: "text", required: true },
    { name: "holidayDate", label: "Date", type: "date", required: true },
    { name: "finYearId", label: "Fin Year", type: "select", asyncOptions: async () => finYearOptions, defaultToFirstOption: true },
    { name: "isActive", label: "Status", type: "toggle", defaultValue: true },
  ];

  const toPayload = (r: Record<string, any>) => ({
    HolidayName: r.holidayName?.trim() || "",
    HolidayDate: r.holidayDate || "",
    FinYearId: r.finYearId ? Number(r.finYearId) : null,
    IsActive: r.isActive !== false,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["holiday-master"] });

  const handleDataEvent = async (event: DataChangeEvent) => {
    try {
      if (event.action === "add") {
        await addHoliday(toPayload(event.record));
        toast.success("Holiday added!");
      }
      if (event.action === "update") {
        await updateHoliday(Number(event.id), toPayload(event.record));
        toast.success("Holiday updated!");
      }
      if (event.action === "delete") {
        const res = await deleteHoliday(Number(event.id));
        toast.success(res?.message || "Holiday deleted!");
      }
      await refresh();
    } catch (err: any) {
      toast.error(err.message || "Operation failed");
    }
  };

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading holidays...</div>;
  if (error) return <div className="p-6 text-red-500">Failed to load holidays.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "HR and Payroll", "Setup", "Holiday Master"]} />
      <HrPayrollShell title="Holiday Master" subtitle="Company holidays by financial year" icon={Calendar}>
        <MasterPage
          title="Holiday"
          canCreate={rights.canCreate}
          canEdit={rights.canEdit}
          canDelete={rights.canDelete}
          fields={fields}
          columns={columns}
          initialData={mappedData}
          onDataEvent={handleDataEvent}
          exportConfig={{
            title: "Holiday Master",
            filename: "holiday-master",
            columns: exportColumns,
          }}
          viewConfig={{
            title: "Holiday Details",
            fields: [
              { key: "holidayName", label: "Holiday Name" },
              { key: "holidayDate", label: "Date" },
              { key: "finYearName", label: "Fin Year" },
              { key: "isActive", label: "Status" },
            ],
          }}
        />
      </HrPayrollShell>
    </>
  );
};

export default HolidayMaster;
