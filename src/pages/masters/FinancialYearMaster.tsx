import React from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MasterPage, FieldDef, ColumnDef } from "@/components/MasterPage";
import { useFinYear } from "@/contexts/FinYearContext";
import { Calendar as CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import DatePicker from "./FinancialYearPopoverCalendar";

// ---------------------------------------------------------------------------
// Table column definitions
// ---------------------------------------------------------------------------
const columns: ColumnDef[] = [
  { key: "year",      label: "Financial Year" },
  { key: "startDate", label: "Start Date"      },
  { key: "endDate",   label: "End Date"        },
  { key: "status",    label: "Status"          },
  { key: "locked",    label: "Locked"          },
];

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------
const FinancialYearMaster = () => {

  const { finYears, addFinYear, updateFinYear, deleteFinYear } = useFinYear();

  // Local state for the two date-picker fields
  const [startDate, setStartDate] = React.useState<Date | undefined>(undefined);
  const [endDate,   setEndDate]   = React.useState<Date | undefined>(undefined);

  // ---- form field state (controlled) ----------------------------------------
  const [year,   setYear]   = React.useState("");
  const [status, setStatus] = React.useState<"Active" | "Closed">("Active");
  const [locked, setLocked] = React.useState(false);

  // ---- helpers ---------------------------------------------------------------
  const resetForm = () => {
    setYear("");
    setStartDate(undefined);
    setEndDate(undefined);
    setStatus("Active");
    setLocked(false);
  };

  const handleAdd = () => {
    if (!year.trim() || !startDate || !endDate) return;
    addFinYear({
      year,
      startDate: format(startDate, "yyyy-MM-dd"),
      endDate:   format(endDate,   "yyyy-MM-dd"),
      status,
      locked,
    });
    resetForm();
  };

  const handleUpdate = (id: string, updates: Record<string, unknown>) => {
    updateFinYear(id, {
      year:      updates.year      as string,
      startDate: startDate ? format(startDate, "yyyy-MM-dd") : (updates.startDate as string),
      endDate:   endDate   ? format(endDate,   "yyyy-MM-dd") : (updates.endDate   as string),
      status:    updates.status    as "Active" | "Closed",
      locked:    Boolean(updates.locked),
    });
  };

  // ---- MasterPage field definitions (kept minimal – dates handled manually) --
  const fields: FieldDef[] = [
    { name: "year",   label: "Financial Year", type: "text",   required: true },
    {
      name: "status", label: "Status",         type: "select",
      options: ["Active", "Closed"],
      required: true,
      defaultValue: "Active",
    },
    { name: "locked", label: "Locked", type: "toggle", defaultValue: false },
  ];

  // ---------------------------------------------------------------------------
  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance Module", "Financial Year Master"]} />

      {/* Page header */}
      <div className="flex items-center gap-3 mb-6">
        <CalendarIcon className="w-6 h-6 text-amber-500" />
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">
            Financial Year Master
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage financial years, their status, and locking
          </p>
        </div>
      </div>

      {/* Two-column top section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">

        {/* ── Add New Financial Year card ── */}
        <div className="bg-card border rounded-xl p-6 shadow-sm">
          <h3 className="text-lg font-heading font-semibold mb-4 flex items-center gap-2">
            <CalendarIcon className="w-5 h-5 text-amber-500" />
            Add New Financial Year
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Financial Year text */}
            <div>
              <label className="block text-sm font-semibold text-foreground mb-2">
                Financial Year *
              </label>
              <input
                type="text"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                placeholder="e.g. 2024-25"
                className="w-full px-4 py-2 border border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent bg-background text-foreground"
              />
            </div>

            {/* Start Date picker */}
            <div>
              <label className="block text-sm font-semibold text-foreground mb-2">
                Start Date *
              </label>
              <DatePicker
                value={startDate}
                onChange={setStartDate}
                placeholder="Pick a start date"
              />
            </div>

            {/* End Date picker */}
            <div>
              <label className="block text-sm font-semibold text-foreground mb-2">
                End Date *
              </label>
              <DatePicker
                value={endDate}
                onChange={setEndDate}
                placeholder="Pick an end date"
              />
            </div>

            {/* Status select */}
            <div>
              <label className="block text-sm font-semibold text-foreground mb-2">
                Status *
              </label>
              <select
                aria-label="Status"
                value={status}
                onChange={(e) => setStatus(e.target.value as "Active" | "Closed")}
                className="w-full px-4 py-2 border border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent bg-background text-foreground"
              >
                <option value="Active">Active</option>
                <option value="Closed">Closed</option>
              </select>
            </div>

            {/* Locked toggle + submit */}
            <div className="md:col-span-2 flex items-center gap-4 pt-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={locked}
                  onChange={(e) => setLocked(e.target.checked)}
                  className="w-4 h-4 rounded"
                />
                Locked
              </label>
              <button
                onClick={handleAdd}
                disabled={!year.trim() || !startDate || !endDate}
                className="ml-auto px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add Financial Year
              </button>
            </div>
          </div>
        </div>

        {/* ── Active Years summary card ── */}
        <div className="bg-card border rounded-xl p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <CalendarIcon className="w-5 h-5 text-amber-500" />
            <h3 className="text-lg font-heading font-semibold">Active Years</h3>
            <span className="ml-auto px-2 py-0.5 bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 text-xs rounded-full font-semibold">
              {finYears.filter((fy) => fy.status === "Active").length}
            </span>
          </div>

          <div className="space-y-3">
            {finYears.filter((fy) => fy.status === "Active").length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">
                No active financial years yet.
              </p>
            )}

            {finYears
              .filter((fy) => fy.status === "Active")
              .map((fy) => (
                <div
                  key={fy.id}
                  className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                >
                  <div>
                    <div className="font-semibold text-foreground">{fy.year}</div>
                    <div className="text-xs text-muted-foreground">
                      {fy.startDate} – {fy.endDate}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {fy.locked ? (
                      <span className="px-2 py-1 bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300 text-xs rounded-full font-semibold">
                        🔒 Locked
                      </span>
                    ) : (
                      <button
                        onClick={() => updateFinYear(fy.id, { ...fy, locked: true })}
                        className="text-xs px-3 py-1 bg-primary text-primary-foreground rounded-full hover:bg-primary/90 transition-colors"
                      >
                        Lock
                      </button>
                    )}
                    <button
                      onClick={() => deleteFinYear(fy.id)}
                      className="p-1.5 rounded-lg text-destructive hover:bg-destructive/10 transition-colors"
                      title="Delete"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* ── Full data table via MasterPage ── */}
      <MasterPage
        title="Financial Year"
        fields={fields}
        columns={columns}
        initialData={finYears.map((fy) => ({ ...fy, _tempId: fy.id }))}
        onDataChange={(updatedRecords) => {
          // Sync MasterPage local changes back to context via actions
          updatedRecords.forEach((record) => {
            if ('_tempId' in record) {
              const id = record._tempId as string;
              const { _tempId, ...cleanRecord } = record;
              updateFinYear(id, cleanRecord as Record<string, unknown>);
            }
          });
        }}
      />
    </>
  );
};

export default FinancialYearMaster;