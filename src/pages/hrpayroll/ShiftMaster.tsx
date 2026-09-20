import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Clock } from "iconsax-react";
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
import { getShifts, addShift, updateShift, deleteShift, type ShiftRow } from "@/api/shiftMasterApi";

const WEEK_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Native time picker for the "custom" FieldDef slot — matches MasterPage's
// own inputBase styling since there's no built-in "time" field type.
const TimeField: React.FC<{
  value: unknown;
  onChange: (v: unknown) => void;
  error: boolean;
}> = ({ value, onChange, error }) => (
  <input
    type="time"
    value={(value as string) || ""}
    onChange={(e) => onChange(e.target.value)}
    className={`w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer ${error ? "border-destructive" : "border-border"}`}
  />
);

function to12Hour(hhmm: string): string {
  if (!hhmm) return "-";
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

const mapRow = (r: ShiftRow): RecordWithId => ({
  _id: String(r.ShiftId),
  shiftName: r.ShiftName,
  shiftCode: r.ShiftCode,
  inTime: r.InTime,
  outTime: r.OutTime,
  inTimeDisplay: to12Hour(r.InTime),
  outTimeDisplay: to12Hour(r.OutTime),
  weekOff: r.WeekOff || "",
  isActive: Boolean(r.IsActive),
});

const columns: ColumnDef[] = [
  { key: "shiftName", label: "Shift Name" },
  { key: "shiftCode", label: "Shift Code" },
  { key: "inTimeDisplay", label: "In Time", sortable: false },
  { key: "outTimeDisplay", label: "Out Time", sortable: false },
  { key: "weekOff", label: "Week Off" },
  { key: "isActive", label: "Status" },
];

const exportColumns: ExportColumn[] = [
  { header: "Shift Name", accessor: "shiftName" },
  { header: "Shift Code", accessor: "shiftCode" },
  { header: "In Time", accessor: "inTimeDisplay" },
  { header: "Out Time", accessor: "outTimeDisplay" },
  { header: "Week Off", accessor: "weekOff" },
  { header: "Status", accessor: "isActive" },
];

const ShiftMaster: React.FC = () => {
  const rights = usePageRights("shift-master");
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["shift-master"],
    queryFn: getShifts,
    staleTime: 60 * 1000,
  });

  const rows: ShiftRow[] = Array.isArray(data) ? data : [];
  const mappedData: RecordWithId[] = rows.map(mapRow);

  const fields: FieldDef[] = [
    { name: "shiftName", label: "Shift Name", type: "text", required: true },
    { name: "shiftCode", label: "Shift Code", type: "text", required: true, uppercase: true },
    {
      name: "inTime",
      label: "In Time",
      type: "custom",
      required: true,
      render: (p) => <TimeField value={p.value} onChange={p.onChange} error={p.error} />,
    },
    {
      name: "outTime",
      label: "Out Time",
      type: "custom",
      required: true,
      render: (p) => <TimeField value={p.value} onChange={p.onChange} error={p.error} />,
    },
    { name: "weekOff", label: "Week Off", type: "select", options: WEEK_DAYS },
    { name: "isActive", label: "Status", type: "toggle", defaultValue: true },
  ];

  const toPayload = (r: Record<string, any>) => ({
    ShiftName: r.shiftName?.trim() || "",
    ShiftCode: r.shiftCode?.trim() || "",
    InTime: r.inTime || "",
    OutTime: r.outTime || "",
    WeekOff: r.weekOff || null,
    IsActive: r.isActive !== false,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["shift-master"] });

  const handleDataEvent = async (event: DataChangeEvent) => {
    try {
      if (event.action === "add") {
        await addShift(toPayload(event.record));
        toast.success("Shift added!");
      }
      if (event.action === "update") {
        await updateShift(Number(event.id), toPayload(event.record));
        toast.success("Shift updated!");
      }
      if (event.action === "delete") {
        const res = await deleteShift(Number(event.id));
        toast.success(res?.message || "Shift deleted!");
      }
      await refresh();
    } catch (err: any) {
      toast.error(err.message || "Operation failed");
    }
  };

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading shifts...</div>;
  if (error) return <div className="p-6 text-red-500">Failed to load shifts.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "HR and Payroll", "Setup", "Shift Master"]} />
      <HrPayrollShell title="Shift Master" subtitle="Work shifts, timings & weekly off" icon={Clock}>
        <MasterPage
          title="Shift"
          canCreate={rights.canCreate}
          canEdit={rights.canEdit}
          canDelete={rights.canDelete}
          fields={fields}
          columns={columns}
          initialData={mappedData}
          onDataEvent={handleDataEvent}
          exportConfig={{
            title: "Shift Master",
            filename: "shift-master",
            columns: exportColumns,
          }}
          viewConfig={{
            title: "Shift Details",
            fields: [
              { key: "shiftName", label: "Shift Name" },
              { key: "shiftCode", label: "Shift Code" },
              { key: "inTimeDisplay", label: "In Time" },
              { key: "outTimeDisplay", label: "Out Time" },
              { key: "weekOff", label: "Week Off" },
              { key: "isActive", label: "Status" },
            ],
          }}
        />
      </HrPayrollShell>
    </>
  );
};

export default ShiftMaster;
