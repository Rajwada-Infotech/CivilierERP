import React from "react";
import { Calendar } from "lucide-react";
import { FinanceShell } from "@/components/finance/FinanceShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import {
  MasterPage,
  type DataChangeEvent,
  type RecordWithId,
} from "@/components/MasterPage";
import type { ExportColumn } from "@/lib/export";
import {
  useQuery,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getFinYears,
  addFinYear,
  updateFinYear,
  deleteFinYear,
} from "@/api/finYearApi";

// ─── Types ────────────────────────────────────────────────────────────────────
interface DbFinYear {
  FId: number;
  FName: string | null;
  FStartDate: string | null;
  FEndDate: string | null;
  FStatus: boolean;
  FisLocked: boolean;
}

// ─── Payload ──────────────────────────────────────────────────────────────────
const toPayload = (r: Record<string, unknown>) => ({
  fy_label: (r.year as string) || null,
  start_date: (r.startDate as string) || null,
  end_date: (r.endDate as string) || null,
  is_active: r.status !== false && r.status !== "Closed",
  is_locked: r.locked === true || r.locked === "true",
});

// ─── Component ────────────────────────────────────────────────────────────────
const FinancialYearMaster: React.FC = () => {
  const rights = usePageRights("financial-year-master");
  const queryClient = useQueryClient();
  const {
    data: dbData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["fin-years"],
    queryFn: getFinYears,
    staleTime: 5 * 60 * 1000,
    // Keep previous data during background refetch so the list never empties
    // while invalidateQueries is in flight.
    placeholderData: keepPreviousData,
  });

  const dbItems: DbFinYear[] = Array.isArray(dbData) ? dbData : [];

  const mappedData: RecordWithId[] = dbItems.map((item) => ({
    _id: String(item.FId),
    year: item.FName || "",
    startDate: item.FStartDate ? item.FStartDate.split("T")[0] : "",
    endDate: item.FEndDate ? item.FEndDate.split("T")[0] : "",
    status: item.FStatus ? "Active" : "Closed",
    locked: item.FisLocked,
  }));

  const handleDataEvent = async (event: DataChangeEvent) => {
    if (event.action === "add") {
      try {
        await addFinYear(toPayload(event.record));
        toast.success("Financial year saved!");
        await queryClient.invalidateQueries({ queryKey: ["fin-years"] });
      } catch (err: any) {
        toast.error("Save failed: " + err.message);
      }
    }
    if (event.action === "update") {
      try {
        await updateFinYear(event.id, toPayload(event.record));
        toast.success("Financial year updated!");
        await queryClient.invalidateQueries({ queryKey: ["fin-years"] });
      } catch (err: any) {
        toast.error("Update failed: " + err.message);
      }
    }
    if (event.action === "delete") {
      try {
        await deleteFinYear(event.id);
        toast.success("Financial year deleted!");
        await queryClient.invalidateQueries({ queryKey: ["fin-years"] });
      } catch (err: any) {
        toast.error("Delete failed: " + err.message);
      }
    }
  };

  const columnRenderers: Record<string, (value: unknown) => React.ReactNode> = {
    status: (value) => (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${value === "Active" ? "bg-green-500/10 border-green-500/20 text-green-600" : "bg-red-500/10 border-red-500/20 text-red-600"}`}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full mr-1.5 ${value === "Active" ? "bg-green-500" : "bg-red-500"}`}
        />
        {String(value)}
      </span>
    ),
    locked: (value) => (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${value ? "bg-orange-500/10 border-orange-500/20 text-orange-600" : "bg-muted border-border text-muted-foreground"}`}
      >
        {value ? "🔒 Locked" : "Unlocked"}
      </span>
    ),
  };

  if (isLoading)
    return <div className="p-6 text-muted-foreground">Loading...</div>;
  if (error)
    return (
      <div className="p-6 text-red-500">Failed to load financial years.</div>
    );

  return (
    <>
      <Breadcrumbs
        items={["Dashboard", "Finance Module", "Financial Year Master"]}
      />
      <FinanceShell
        title="Financial Year Master"
        subtitle="Manage financial years with start / end dates, status and lock controls"
        icon={Calendar}
        action={
          <span
            className="text-xs font-heading px-3 py-1.5 rounded-lg"
            style={{ background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.25)", color: "#818cf8" }}
          >
            {dbItems.length} Years
          </span>
        }
      >
        <MasterPage
          title="Financial Year"
          fields={[
            {
              name: "year",
              label: "Financial Year",
              type: "text",
              required: true,
              placeholder: "e.g. 2024-25",
            },
            {
              name: "startDate",
              label: "Start Date",
              type: "date",
              required: true,
            },
            { name: "endDate", label: "End Date", type: "date", required: true },
            {
              name: "status",
              label: "Status",
              type: "custom",
              fullWidth: true,
              defaultValue: "Active",
              render: ({ value, onChange }) => {
                const isActive = value !== "Closed";
                return (
                  <div className="flex items-center gap-3 mt-1">
                    <button
                      type="button"
                      onClick={() => onChange(isActive ? "Closed" : "Active")}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 ${
                        isActive ? "bg-emerald-500" : "bg-muted-foreground/30"
                      }`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                          isActive ? "translate-x-4" : "translate-x-0.5"
                        }`}
                      />
                    </button>
                    <span className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider">
                      Status —{" "}
                      <span
                        className={
                          isActive ? "text-emerald-600" : "text-foreground"
                        }
                      >
                        {isActive ? "Active" : "Closed"}
                      </span>
                    </span>
                  </div>
                );
              },
            },
            {
              name: "locked",
              label: "Locked",
              type: "custom",
              fullWidth: true,
              defaultValue: false,
              render: ({ value, onChange }) => {
                const isLocked = !!value;
                return (
                  <div className="flex items-center gap-3 mt-1">
                    <button
                      type="button"
                      onClick={() => onChange(!isLocked)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 ${
                        isLocked ? "bg-orange-500" : "bg-muted-foreground/30"
                      }`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                          isLocked ? "translate-x-4" : "translate-x-0.5"
                        }`}
                      />
                    </button>
                    <span className="text-xs font-heading font-medium text-muted-foreground uppercase tracking-wider">
                      Locked —{" "}
                      <span
                        className={
                          isLocked ? "text-orange-500" : "text-foreground"
                        }
                      >
                        {isLocked ? "Locked" : "Unlocked"}
                      </span>
                    </span>
                  </div>
                );
              },
            },
          ]}
          columns={[
            { key: "year", label: "Financial Year" },
            { key: "startDate", label: "Start Date", hideOnMobile: true },
            { key: "endDate", label: "End Date", hideOnMobile: true },
            { key: "status", label: "Status" },
            { key: "locked", label: "Locked" },
          ]}
          columnRenderers={columnRenderers}
          initialData={mappedData}
          onDataEvent={handleDataEvent}
          exportConfig={{
            title: "Financial Year Master",
            filename: "financial-year-master",
            columns: [
              { header: "Financial Year", accessor: "year" },
              { header: "Start Date", accessor: "startDate" },
              { header: "End Date", accessor: "endDate" },
              { header: "Status", accessor: "status" },
              { header: "Locked", accessor: (r) => (r.locked ? "Yes" : "No") },
            ],
          }}
        />
      </FinanceShell>
    </>
  );
};

export default FinancialYearMaster;