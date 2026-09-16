import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MoneyChange } from "iconsax-react";
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
import { getLedgerOptions } from "@/api/generalLedgerApi";
import {
  getDeductionAdditions,
  addDeductionAddition,
  updateDeductionAddition,
  deleteDeductionAddition,
  type DeductionAdditionRow,
} from "@/api/deductionAdditionMasterApi";

const mapRow = (r: DeductionAdditionRow): RecordWithId => ({
  _id: String(r.Id),
  name: r.Name,
  code: r.Code,
  ledgerId: r.LedgerId ? String(r.LedgerId) : "",
  ledgerName: r.LedgerName || "-",
  isActive: Boolean(r.IsActive),
});

const columns: ColumnDef[] = [
  { key: "name", label: "Name" },
  { key: "code", label: "Code" },
  { key: "ledgerName", label: "General Ledger", sortable: false },
  { key: "isActive", label: "Status" },
];

const exportColumns: ExportColumn[] = [
  { header: "Name", accessor: "name" },
  { header: "Code", accessor: "code" },
  { header: "General Ledger", accessor: "ledgerName" },
  { header: "Status", accessor: "isActive" },
];

const DeductionAdditionMaster: React.FC = () => {
  const rights = usePageRights("deduction-addition-master");
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["deduction-addition-master"],
    queryFn: getDeductionAdditions,
    staleTime: 60 * 1000,
  });

  const rows: DeductionAdditionRow[] = Array.isArray(data) ? data : [];
  const mappedData: RecordWithId[] = rows.map(mapRow);

  // Self-fetching rather than reading from a separate useQuery here --
  // MasterPage calls asyncOptions() exactly once on mount, so relying on an
  // outer query's `data` risks a race where that query hasn't resolved yet
  // and an empty options list gets cached for the rest of the page's life.
  const fields: FieldDef[] = [
    { name: "name", label: "Name", type: "text", required: true },
    { name: "code", label: "Code", type: "text", required: true, uppercase: true },
    {
      name: "ledgerId",
      label: "General Ledger",
      type: "select",
      asyncOptions: async () => {
        const list = await getLedgerOptions();
        return (Array.isArray(list) ? list : []).map((l) => ({
          value: String(l.id),
          label: l.label,
        }));
      },
    },
    { name: "isActive", label: "Status", type: "toggle", defaultValue: true },
  ];

  const toPayload = (r: Record<string, any>) => ({
    Name: r.name?.trim() || "",
    Code: r.code?.trim() || "",
    LedgerId: r.ledgerId ? Number(r.ledgerId) : null,
    IsActive: r.isActive !== false,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["deduction-addition-master"] });

  const handleDataEvent = async (event: DataChangeEvent) => {
    try {
      if (event.action === "add") {
        await addDeductionAddition(toPayload(event.record));
        toast.success("Deduction/Addition added!");
      }
      if (event.action === "update") {
        await updateDeductionAddition(Number(event.id), toPayload(event.record));
        toast.success("Deduction/Addition updated!");
      }
      if (event.action === "delete") {
        const res = await deleteDeductionAddition(Number(event.id));
        toast.success(res?.message || "Deduction/Addition deleted!");
      }
      await refresh();
    } catch (err: any) {
      toast.error(err.message || "Operation failed");
    }
  };

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading deductions & additions...</div>;
  if (error) return <div className="p-6 text-red-500">Failed to load Deduction and Addition Master.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "HR and Payroll", "Setup", "Deduction and Addition Master"]} />
      <HrPayrollShell title="Deduction and Addition Master" subtitle="Salary components mapped to a General Ledger account" icon={MoneyChange}>
        <MasterPage
          title="Deduction/Addition"
          canCreate={rights.canCreate}
          canEdit={rights.canEdit}
          canDelete={rights.canDelete}
          fields={fields}
          columns={columns}
          initialData={mappedData}
          onDataEvent={handleDataEvent}
          exportConfig={{
            title: "Deduction and Addition Master",
            filename: "deduction-addition-master",
            columns: exportColumns,
          }}
          viewConfig={{
            title: "Deduction/Addition Details",
            fields: [
              { key: "name", label: "Name" },
              { key: "code", label: "Code" },
              { key: "ledgerName", label: "General Ledger" },
              { key: "isActive", label: "Status" },
            ],
          }}
        />
      </HrPayrollShell>
    </>
  );
};

export default DeductionAdditionMaster;
