import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarTick, Calendar1, Timer1 } from "iconsax-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { HrPayrollShell, HR_GRADIENT } from "@/components/hrpayroll/HrPayrollShell";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { HrSkeleton } from "@/components/hrpayroll/HrUi";
import { MasterPage, type FieldDef, type ColumnDef, type DataChangeEvent, type RecordWithId } from "@/components/MasterPage";
import { getEmployeeOptions } from "@/api/employeeMasterApi";
import {
  getAttendanceRecords,
  addAttendanceRecord,
  updateAttendanceRecord,
  deleteAttendanceRecord,
  type AttendanceRow,
  type AttendanceStatus,
} from "@/api/attendanceRecordApi";
import {
  getLeaveRecords,
  addLeaveRecord,
  updateLeaveRecord,
  deleteLeaveRecord,
  type LeaveRow,
  type LeaveType,
  type LeaveStatus,
} from "@/api/leaveRecordApi";
import {
  getOvertimeRecords,
  addOvertimeRecord,
  updateOvertimeRecord,
  deleteOvertimeRecord,
  type OvertimeRow,
  type OvertimeStatus,
} from "@/api/overtimeRecordApi";

const ATTENDANCE_STATUSES: AttendanceStatus[] = ["Present", "Absent", "Half Day", "On Leave", "Holiday", "Week Off"];
const LEAVE_TYPES: LeaveType[] = ["Casual", "Sick", "Earned", "Unpaid"];
const APPROVAL_STATUSES: LeaveStatus[] | OvertimeStatus[] = ["Pending", "Approved", "Rejected"];

const employeeSelectField = (name: string): FieldDef => ({
  name,
  label: "Employee",
  type: "select",
  required: true,
  // Self-fetching rather than reading from a separate useQuery here --
  // MasterPage calls asyncOptions() exactly once on mount, so relying on
  // an outer query's `data` risks a race where it hasn't resolved yet.
  asyncOptions: async () => {
    const list = await getEmployeeOptions();
    return (Array.isArray(list) ? list : []).map((e) => ({
      value: String(e.id),
      label: `${e.label} (${e.code})`,
    }));
  },
});

// ─── Attendance ─────────────────────────────────────────────────────────────

const mapAttendance = (r: AttendanceRow): RecordWithId => ({
  _id: String(r.AttendanceId),
  employeeId: String(r.EmployeeId),
  employeeName: r.EmployeeName,
  employeeCode: r.EmployeeCode,
  attendanceDate: r.AttendanceDate ? r.AttendanceDate.slice(0, 10) : "",
  status: r.Status,
  checkIn: r.CheckIn || "",
  checkOut: r.CheckOut || "",
  remarks: r.Remarks || "",
  isActive: r.IsActive,
});

const attendanceFields: FieldDef[] = [
  employeeSelectField("employeeId"),
  { name: "attendanceDate", label: "Date", type: "date", required: true },
  { name: "status", label: "Status", type: "select", required: true, options: ATTENDANCE_STATUSES },
  { name: "checkIn", label: "Check In", type: "text", placeholder: "e.g. 09:30" },
  { name: "checkOut", label: "Check Out", type: "text", placeholder: "e.g. 18:30" },
  { name: "remarks", label: "Remarks", type: "textarea", fullWidth: true },
  { name: "isActive", label: "Active", type: "toggle", defaultValue: true },
];

const attendanceColumns: ColumnDef[] = [
  { key: "employeeName", label: "Employee" },
  { key: "attendanceDate", label: "Date" },
  { key: "status", label: "Status" },
  { key: "checkIn", label: "Check In", hideOnMobile: true, sortable: false },
  { key: "checkOut", label: "Check Out", hideOnMobile: true, sortable: false },
  { key: "isActive", label: "Active" },
];

const attendanceToPayload = (r: Record<string, any>) => ({
  EmployeeId: Number(r.employeeId),
  AttendanceDate: r.attendanceDate,
  Status: r.status,
  CheckIn: r.checkIn?.trim() || null,
  CheckOut: r.checkOut?.trim() || null,
  Remarks: r.remarks?.trim() || null,
  IsActive: r.isActive !== false,
});

// ─── Leave ──────────────────────────────────────────────────────────────────

const mapLeave = (r: LeaveRow): RecordWithId => ({
  _id: String(r.LeaveId),
  employeeId: String(r.EmployeeId),
  employeeName: r.EmployeeName,
  employeeCode: r.EmployeeCode,
  leaveType: r.LeaveType,
  fromDate: r.FromDate ? r.FromDate.slice(0, 10) : "",
  toDate: r.ToDate ? r.ToDate.slice(0, 10) : "",
  totalDays: r.TotalDays,
  reason: r.Reason || "",
  status: r.Status,
  isActive: r.IsActive,
});

const leaveFields: FieldDef[] = [
  employeeSelectField("employeeId"),
  { name: "leaveType", label: "Leave Type", type: "select", required: true, options: LEAVE_TYPES },
  { name: "fromDate", label: "From Date", type: "date", required: true },
  { name: "toDate", label: "To Date", type: "date", required: true },
  { name: "reason", label: "Reason", type: "textarea", fullWidth: true },
  { name: "status", label: "Status", type: "select", options: APPROVAL_STATUSES, defaultValue: "Pending" },
  { name: "isActive", label: "Active", type: "toggle", defaultValue: true },
];

const leaveColumns: ColumnDef[] = [
  { key: "employeeName", label: "Employee" },
  { key: "leaveType", label: "Type" },
  { key: "fromDate", label: "From" },
  { key: "toDate", label: "To" },
  { key: "totalDays", label: "Days", sortable: false },
  { key: "status", label: "Status" },
];

const leaveToPayload = (r: Record<string, any>) => ({
  EmployeeId: Number(r.employeeId),
  LeaveType: r.leaveType,
  FromDate: r.fromDate,
  ToDate: r.toDate,
  Reason: r.reason?.trim() || null,
  Status: r.status || "Pending",
  IsActive: r.isActive !== false,
});

// ─── Overtime ───────────────────────────────────────────────────────────────

const mapOvertime = (r: OvertimeRow): RecordWithId => ({
  _id: String(r.OvertimeId),
  employeeId: String(r.EmployeeId),
  employeeName: r.EmployeeName,
  employeeCode: r.EmployeeCode,
  overtimeDate: r.OvertimeDate ? r.OvertimeDate.slice(0, 10) : "",
  hours: String(r.Hours),
  rateMultiplier: String(r.RateMultiplier),
  remarks: r.Remarks || "",
  status: r.Status,
  isActive: r.IsActive,
});

const overtimeFields: FieldDef[] = [
  employeeSelectField("employeeId"),
  { name: "overtimeDate", label: "Date", type: "date", required: true },
  { name: "hours", label: "Hours", type: "number", required: true },
  { name: "rateMultiplier", label: "Rate Multiplier", type: "number", defaultValue: "1.5" },
  { name: "remarks", label: "Remarks", type: "textarea", fullWidth: true },
  { name: "status", label: "Status", type: "select", options: APPROVAL_STATUSES, defaultValue: "Pending" },
  { name: "isActive", label: "Active", type: "toggle", defaultValue: true },
];

const overtimeColumns: ColumnDef[] = [
  { key: "employeeName", label: "Employee" },
  { key: "overtimeDate", label: "Date" },
  { key: "hours", label: "Hours" },
  { key: "rateMultiplier", label: "Rate", hideOnMobile: true },
  { key: "status", label: "Status" },
];

const overtimeToPayload = (r: Record<string, any>) => ({
  EmployeeId: Number(r.employeeId),
  OvertimeDate: r.overtimeDate,
  Hours: Number(r.hours),
  RateMultiplier: r.rateMultiplier ? Number(r.rateMultiplier) : 1.5,
  Remarks: r.remarks?.trim() || null,
  Status: r.status || "Pending",
  IsActive: r.isActive !== false,
});

// ─── Page ───────────────────────────────────────────────────────────────────

const AttendanceLeaveOvertime: React.FC = () => {
  const rights = usePageRights("attendance-leave-overtime");
  const queryClient = useQueryClient();

  const { data: attendanceData, isLoading: attendanceLoading } = useQuery({
    queryKey: ["attendance-record"],
    queryFn: getAttendanceRecords,
    staleTime: 60 * 1000,
  });
  const { data: leaveData, isLoading: leaveLoading } = useQuery({
    queryKey: ["leave-record"],
    queryFn: getLeaveRecords,
    staleTime: 60 * 1000,
  });
  const { data: overtimeData, isLoading: overtimeLoading } = useQuery({
    queryKey: ["overtime-record"],
    queryFn: getOvertimeRecords,
    staleTime: 60 * 1000,
  });

  const attendanceRows = Array.isArray(attendanceData) ? attendanceData.map(mapAttendance) : [];
  const leaveRows = Array.isArray(leaveData) ? leaveData.map(mapLeave) : [];
  const overtimeRows = Array.isArray(overtimeData) ? overtimeData.map(mapOvertime) : [];

  const handleAttendanceEvent = async (event: DataChangeEvent) => {
    try {
      if (event.action === "add") {
        await addAttendanceRecord(attendanceToPayload(event.record));
        toast.success("Attendance recorded!");
      }
      if (event.action === "update") {
        await updateAttendanceRecord(Number(event.id), attendanceToPayload(event.record));
        toast.success("Attendance updated!");
      }
      if (event.action === "delete") {
        const res = await deleteAttendanceRecord(Number(event.id));
        toast.success(res?.message || "Attendance deleted!");
      }
      await queryClient.invalidateQueries({ queryKey: ["attendance-record"] });
    } catch (err: any) {
      toast.error(err.message || "Operation failed");
    }
  };

  const handleLeaveEvent = async (event: DataChangeEvent) => {
    try {
      if (event.action === "add") {
        await addLeaveRecord(leaveToPayload(event.record));
        toast.success("Leave recorded!");
      }
      if (event.action === "update") {
        await updateLeaveRecord(Number(event.id), leaveToPayload(event.record));
        toast.success("Leave updated!");
      }
      if (event.action === "delete") {
        const res = await deleteLeaveRecord(Number(event.id));
        toast.success(res?.message || "Leave deleted!");
      }
      await queryClient.invalidateQueries({ queryKey: ["leave-record"] });
    } catch (err: any) {
      toast.error(err.message || "Operation failed");
    }
  };

  const handleOvertimeEvent = async (event: DataChangeEvent) => {
    try {
      if (event.action === "add") {
        await addOvertimeRecord(overtimeToPayload(event.record));
        toast.success("Overtime recorded!");
      }
      if (event.action === "update") {
        await updateOvertimeRecord(Number(event.id), overtimeToPayload(event.record));
        toast.success("Overtime updated!");
      }
      if (event.action === "delete") {
        const res = await deleteOvertimeRecord(Number(event.id));
        toast.success(res?.message || "Overtime deleted!");
      }
      await queryClient.invalidateQueries({ queryKey: ["overtime-record"] });
    } catch (err: any) {
      toast.error(err.message || "Operation failed");
    }
  };

  return (
    <>
      <Breadcrumbs items={["Dashboard", "HR and Payroll", "Attendance / Leave / Overtime"]} />
      <HrPayrollShell title="Attendance / Leave / Overtime" subtitle="Daily attendance, leave requests, and overtime hours per employee" icon={CalendarTick}>
        <Tabs defaultValue="attendance">
          {/* Big tab cards: what each list is + how many records it has */}
          <TabsList className="!h-auto !bg-transparent !p-0 grid w-full grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
            {([
              ["attendance", "Attendance", "Daily check-in / check-out", attendanceRows.length, CalendarTick],
              ["leave", "Leave", "Leave requests & days", leaveRows.length, Calendar1],
              ["overtime", "Overtime", "Extra hours per employee", overtimeRows.length, Timer1],
            ] as const).map(([v, label, hint, n, Icon]) => (
              <TabsTrigger
                key={v}
                value={v}
                className="group !justify-start gap-3 rounded-2xl border border-border bg-card/80 px-4 py-3.5 text-left shadow-sm transition-all data-[state=active]:!shadow-md data-[state=active]:border-transparent hr-tab-card"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white shadow-sm" style={{ background: HR_GRADIENT }}><Icon size={18} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-heading font-semibold text-foreground">{label}</span>
                  <span className="block text-[0.6875rem] text-muted-foreground truncate">{hint}</span>
                </span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-bold tabular-nums text-foreground">{n}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="attendance">
            {attendanceLoading ? (
              <HrSkeleton />
            ) : (
              <MasterPage
                title="Attendance"
                canCreate={rights.canCreate}
                canEdit={rights.canEdit}
                canDelete={rights.canDelete}
                fields={attendanceFields}
                columns={attendanceColumns}
                initialData={attendanceRows}
                onDataEvent={handleAttendanceEvent}
                collapsibleAddForm
              />
            )}
          </TabsContent>

          <TabsContent value="leave">
            {leaveLoading ? (
              <HrSkeleton />
            ) : (
              <MasterPage
                title="Leave"
                canCreate={rights.canCreate}
                canEdit={rights.canEdit}
                canDelete={rights.canDelete}
                fields={leaveFields}
                columns={leaveColumns}
                initialData={leaveRows}
                onDataEvent={handleLeaveEvent}
                collapsibleAddForm
              />
            )}
          </TabsContent>

          <TabsContent value="overtime">
            {overtimeLoading ? (
              <HrSkeleton />
            ) : (
              <MasterPage
                title="Overtime"
                canCreate={rights.canCreate}
                canEdit={rights.canEdit}
                canDelete={rights.canDelete}
                fields={overtimeFields}
                columns={overtimeColumns}
                initialData={overtimeRows}
                onDataEvent={handleOvertimeEvent}
                collapsibleAddForm
              />
            )}
          </TabsContent>
        </Tabs>
      </HrPayrollShell>
    </>
  );
};

export default AttendanceLeaveOvertime;
