import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MoneyRecive } from "iconsax-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { HrPayrollShell } from "@/components/hrpayroll/HrPayrollShell";
import { MasterPage, type FieldDef, type ColumnDef, type DataChangeEvent, type RecordWithId } from "@/components/MasterPage";
import { getEmployeeOptions } from "@/api/employeeMasterApi";
import {
  getIncentiveRecords,
  addIncentiveRecord,
  updateIncentiveRecord,
  deleteIncentiveRecord,
  type IncentiveRow,
  type IncentiveType,
  type IncentiveStatus,
} from "@/api/incentiveRecordApi";

const INCENTIVE_TYPES: IncentiveType[] = ["Performance", "Sales", "Festival", "Referral", "Retention", "Other"];
const STATUSES: IncentiveStatus[] = ["Pending", "Approved", "Rejected", "Paid"];

const mapRow = (r: IncentiveRow): RecordWithId => ({
  _id: String(r.IncentiveId),
  documentNo: r.DocumentNo,
  employeeId: String(r.EmployeeId),
  employeeName: r.EmployeeName,
  employeeCode: r.EmployeeCode,
  incentiveType: r.IncentiveType,
  incentiveDate: r.IncentiveDate ? r.IncentiveDate.slice(0, 10) : "",
  amount: String(r.Amount),
  remarks: r.Remarks || "",
  status: r.Status,
  isActive: r.IsActive,
});

const fields: FieldDef[] = [
  {
    name: "documentNo",
    label: "Document Number",
    type: "custom",
    render: ({ value }) => (
      <div className="w-full px-3 py-2 rounded-lg text-sm font-mono bg-muted/60 border border-border text-muted-foreground">
        {value ? String(value) : "Auto-generated on save"}
      </div>
    ),
  },
  {
    name: "employeeId",
    label: "Employee",
    type: "select",
    required: true,
    // Self-fetching rather than reading from a separate useQuery here --
    // MasterPage calls asyncOptions() exactly once on mount, so relying
    // on an outer query's `data` risks a race where it hasn't resolved.
    asyncOptions: async () => {
      const list = await getEmployeeOptions();
      return (Array.isArray(list) ? list : []).map((e) => ({
        value: String(e.id),
        label: `${e.label} (${e.code})`,
      }));
    },
  },
  { name: "incentiveType", label: "Incentive Type", type: "select", required: true, options: INCENTIVE_TYPES },
  { name: "incentiveDate", label: "Date", type: "date", required: true },
  { name: "amount", label: "Amount", type: "number", required: true },
  { name: "remarks", label: "Remarks", type: "textarea", fullWidth: true },
  { name: "status", label: "Status", type: "select", options: STATUSES, defaultValue: "Pending" },
  { name: "isActive", label: "Active", type: "toggle", defaultValue: true },
];

const columns: ColumnDef[] = [
  { key: "documentNo", label: "Document No" },
  { key: "employeeName", label: "Employee" },
  { key: "incentiveType", label: "Type" },
  { key: "incentiveDate", label: "Date" },
  { key: "amount", label: "Amount" },
  { key: "status", label: "Status" },
];

const toPayload = (r: Record<string, any>) => ({
  EmployeeId: Number(r.employeeId),
  IncentiveType: r.incentiveType,
  IncentiveDate: r.incentiveDate,
  Amount: Number(r.amount),
  Remarks: r.remarks?.trim() || null,
  Status: r.status || "Pending",
  IsActive: r.isActive !== false,
});

const IncentiveMaster: React.FC = () => {
  const rights = usePageRights("incentive");
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["incentive-record"],
    queryFn: getIncentiveRecords,
    staleTime: 60 * 1000,
  });

  const rows = Array.isArray(data) ? data.map(mapRow) : [];

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["incentive-record"] });

  const handleDataEvent = async (event: DataChangeEvent) => {
    try {
      if (event.action === "add") {
        const res = await addIncentiveRecord(toPayload(event.record));
        toast.success(res?.message || "Incentive recorded!");
      }
      if (event.action === "update") {
        await updateIncentiveRecord(Number(event.id), toPayload(event.record));
        toast.success("Incentive updated!");
      }
      if (event.action === "delete") {
        const res = await deleteIncentiveRecord(Number(event.id));
        toast.success(res?.message || "Incentive deleted!");
      }
      await refresh();
    } catch (err: any) {
      toast.error(err.message || "Operation failed");
    }
  };

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading incentives...</div>;
  if (error) return <div className="p-6 text-red-500">Failed to load Incentive.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "HR and Payroll", "Incentive"]} />
      <HrPayrollShell title="Incentive" subtitle="Performance, sales, festival, and other incentive payments per employee" icon={MoneyRecive}>
        <MasterPage
          title="Incentive"
          canCreate={rights.canCreate}
          canEdit={rights.canEdit}
          canDelete={rights.canDelete}
          fields={fields}
          columns={columns}
          initialData={rows}
          onDataEvent={handleDataEvent}
          collapsibleAddForm
        />
      </HrPayrollShell>
    </>
  );
};

export default IncentiveMaster;
