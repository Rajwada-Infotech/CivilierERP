import React from "react";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
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
      await addFinYear(toPayload(event.record));
      toast.success("Financial year saved!");
      await queryClient.invalidateQueries({ queryKey: ["fin-years"] });
    }
    if (event.action === "update") {
      await updateFinYear(event.id, toPayload(event.record));
      toast.success("Financial year updated!");
      await queryClient.invalidateQueries({ queryKey: ["fin-years"] });
    }
    if (event.action === "delete") {
      await deleteFinYear(event.id);
      toast.success("Financial year deleted!");
      await queryClient.invalidateQueries({ queryKey: ["fin-years"] });
    }
  };

  const fmtDay = (value: unknown) => {
    const d = value ? new Date(String(value)) : null;
    return d && !Number.isNaN(d.getTime())
      ? d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
      : "—";
  };
  const columnRenderers: Record<string, (value: unknown) => React.ReactNode> = {
    year: (value) => <span className="font-heading text-[0.75rem] font-semibold tabular-nums text-foreground">{String(value ?? "") || "—"}</span>,
    startDate: (value) => <span className="tabular-nums text-foreground">{fmtDay(value)}</span>,
    endDate: (value) => <span className="tabular-nums text-foreground">{fmtDay(value)}</span>,
    status: (value) => <SheetMark text={String(value)} tone={value === "Active" ? "done" : "none"} />,
    locked: (value) => <SheetMark text={value ? "Locked" : "Open"} tone={value ? "waiting" : "none"} />,
  };

  if (isLoading)
    return <div className="p-6 text-muted-foreground">Loading...</div>;
  if (error)
    return (
      <div className="p-6 text-destructive">Failed to load financial years.</div>
    );

  return (
    <>
      <Breadcrumbs
        items={["Dashboard", "Finance Module", "Financial Year Master"]}
      />
      <SheetShell
        eyebrow="CivilierERP · Masters"
        title="Financial years"
        subtitle="Each year's start and end dates, whether it is active, and whether it is locked against further posting."
      >
        <div className="bg-card" style={{ border: "1px solid hsl(var(--foreground))" }}>
          <div className="statrow" style={{ padding: "16px 16px 18px" }}>
            {[
              { label: "Years", value: dbItems.length, note: "in all" },
              { label: "Active", value: dbItems.filter((y) => y.FStatus).length, note: "open for entries" },
              { label: "Locked", value: dbItems.filter((y) => y.FisLocked).length, note: "closed to posting" },
            ].map((x) => (
              <div key={x.label}>
                <p className="label">{x.label}</p>
                <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{x.value}</p>
                <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
              </div>
            ))}
          </div>
        </div>

        <MasterPage
          canCreate={rights.canCreate}
          canEdit={rights.canEdit}
          canDelete={rights.canDelete}
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
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${isActive ? "bg-foreground" : "bg-muted-foreground/30"}`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-card transition-transform ${
                          isActive ? "translate-x-4" : "translate-x-0.5"
                        }`}
                      />
                    </button>
                    <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Status —{" "}
                      <span className="text-foreground">
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
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${isLocked ? "bg-foreground" : "bg-muted-foreground/30"}`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-card transition-transform ${
                          isLocked ? "translate-x-4" : "translate-x-0.5"
                        }`}
                      />
                    </button>
                    <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Locked —{" "}
                      <span className="text-foreground">
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
      </SheetShell>
    </>
  );
};

export default FinancialYearMaster;