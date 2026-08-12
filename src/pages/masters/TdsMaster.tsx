import { fetchWithAuth } from "@/lib/fetchWithAuth";
import React, { useRef, useState } from "react";
import { usePageRights } from "@/hooks/usePageRights";
import { FileText, Download, Upload, Check, X, Loader2, AlertTriangle } from "lucide-react";
import { FinanceShell } from "@/components/finance/FinanceShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { GLAccountSelect } from "@/components/finance/GLAccountSelect";
import {
  MasterPage,
  type DataChangeEvent,
  type RecordWithId,
} from "@/components/MasterPage";
import { exportToCsv, parseCsv, type ExportColumn } from "@/lib/export";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ─── API ──────────────────────────────────────────────────────────────────────
const BASE = "/api/tds-master";

const getTds = () => fetchWithAuth(BASE).then((r) => r.json().catch(() => ({})));
const addTds = (data: object) =>
  fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }).then((r) => r.json().catch(() => ({})));
const updateTds = (id: string, data: object) =>
  fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }).then((r) => r.json().catch(() => ({})));
const deleteTds = (id: string) =>
  fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" }).then((r) => r.json().catch(() => ({})));

// ─── Types ────────────────────────────────────────────────────────────────────
interface DbTds {
  TDSId: number;
  Nature: string | null;
  Name: string | null;
  Percentage: number | null;
  Status: boolean;
  // GLHeadId (migration 313) — the GL ledger invoice posting debits for
  // this TDS Nature's own leg (Dr TDS Nature A/c). Posting a TDS-deducted
  // invoice fails with "TDS Nature system ledger not configured" until
  // every Nature actually in use here has one linked.
  GLHeadId: number | null;
  GLHeadName?: string | null;
  GLHeadCode?: string | null;
}

// ─── Payload ──────────────────────────────────────────────────────────────────
const toPayload = (r: Record<string, unknown>) => ({
  Nature: (r.nature as string) || null,
  Name: (r.name as string) || null,
  Percentage: r.percentage ? Number(r.percentage) : 0,
  Status: r.status !== false,
  GLHeadId: r.glHeadId ? Number(r.glHeadId) : null,
});

// ─── CSV template column mapping ─────────────────────────────────────────────
// Single source of truth — same headers for download and import.
const CSV_HEADERS = {
  nature: "Nature",
  name: "Name",
  percentage: "Percentage (%)",
  status: "Status (Active/Inactive)",
} as const;

const TDS_CSV_TEMPLATE_COLUMNS: ExportColumn[] = [
  { header: CSV_HEADERS.nature, accessor: "nature" },
  { header: CSV_HEADERS.name, accessor: "name" },
  { header: CSV_HEADERS.percentage, accessor: "percentage" },
  { header: CSV_HEADERS.status, accessor: "status" },
];

interface ImportRowResult {
  row: number;
  name: string;
  status: "success" | "error";
  message?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────
const TdsMaster: React.FC = () => {
  const rights = usePageRights("tds-master");
  const queryClient = useQueryClient();
  // CSV import state
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState<ImportRowResult[] | null>(
    null,
  );

  const {
    data: dbData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["tds"],
    queryFn: getTds,
    staleTime: 5 * 60 * 1000,
  });

  const dbItems: DbTds[] = Array.isArray(dbData) ? dbData : [];

  const mappedData: RecordWithId[] = dbItems.map((item) => ({
    _id: String(item.TDSId),
    nature: item.Nature || "",
    name: item.Name || "",
    percentage: item.Percentage ?? "",
    status: item.Status,
    glHeadId: item.GLHeadId ?? null,
    glHeadLabel: item.GLHeadName
      ? `${item.GLHeadName}${item.GLHeadCode ? ` (${item.GLHeadCode})` : ""}`
      : null,
  }));

  const handleDataEvent = async (event: DataChangeEvent) => {
    if (event.action === "add") {
      try {
        await addTds(toPayload(event.record));
        toast.success("TDS saved!");
        await queryClient.invalidateQueries({ queryKey: ["tds"] });
      } catch (err: any) {
        toast.error("Save failed: " + err.message);
      }
    }
    if (event.action === "update") {
      try {
        await updateTds(event.id, toPayload(event.record));
        toast.success("TDS updated!");
        await queryClient.invalidateQueries({ queryKey: ["tds"] });
      } catch (err: any) {
        toast.error("Update failed: " + err.message);
      }
    }
    if (event.action === "delete") {
      try {
        await deleteTds(event.id);
        toast.success("TDS deleted!");
        await queryClient.invalidateQueries({ queryKey: ["tds"] });
      } catch (err: any) {
        toast.error("Delete failed: " + err.message);
      }
    }
  };

  // ── Download template ────────────────────────────────────────────────────────
  const handleDownloadTemplate = () => {
    exportToCsv([], TDS_CSV_TEMPLATE_COLUMNS, "tds-master-template");
    toast.success("Template downloaded — fill it in and use Import.");
  };

  // ── CSV import ───────────────────────────────────────────────────────────────
  const handleImportClick = () => importFileInputRef.current?.click();

  const handleImportFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".csv")) {
      toast.error("Please select a .csv file.");
      return;
    }

    setImporting(true);
    setImportResults(null);
    try {
      const text = await file.text();
      const rows = parseCsv(text);

      if (rows.length === 0) {
        toast.error("The CSV file has no data rows.");
        setImporting(false);
        return;
      }

      const results: ImportRowResult[] = [];

      for (let i = 0; i < rows.length; i++) {
        const raw = rows[i];
        const rowNum = i + 2; // +1 header, +1 for 1-based
        const nameForLog =
          raw[CSV_HEADERS.name] || raw[CSV_HEADERS.nature] || "(blank)";

        try {
          const nature = (raw[CSV_HEADERS.nature] || "").trim().toUpperCase();
          const name = (raw[CSV_HEADERS.name] || "").trim();
          const percentageRaw = (raw[CSV_HEADERS.percentage] || "").trim();
          const statusRaw = (raw[CSV_HEADERS.status] || "")
            .trim()
            .toLowerCase();

          if (!nature) throw new Error("Nature is required");
          if (!name) throw new Error("Name is required");

          const percentage =
            percentageRaw !== "" ? parseFloat(percentageRaw) : 0;
          if (isNaN(percentage))
            throw new Error(
              `Percentage must be a number (got "${percentageRaw}")`,
            );
          if (percentage < 0 || percentage > 100)
            throw new Error(`Percentage must be between 0 and 100`);

          // Status: "active", "1", "yes", "true" → true; "inactive", "0", "no", "false" → false; blank → true
          const status =
            statusRaw === "" ||
            statusRaw === "active" ||
            statusRaw === "1" ||
            statusRaw === "yes" ||
            statusRaw === "true"
              ? true
              : statusRaw === "inactive" ||
                  statusRaw === "0" ||
                  statusRaw === "no" ||
                  statusRaw === "false"
                ? false
                : null;

          if (status === null)
            throw new Error(
              `Status must be "Active" or "Inactive" (got "${raw[CSV_HEADERS.status]}")`,
            );

          await addTds({
            Nature: nature,
            Name: name,
            Percentage: percentage,
            Status: status,
          });
          results.push({ row: rowNum, name, status: "success" });
        } catch (err: any) {
          results.push({
            row: rowNum,
            name: nameForLog,
            status: "error",
            message: err?.message || "Unknown error",
          });
        }
      }

      setImportResults(results);
      const successCount = results.filter((r) => r.status === "success").length;
      const errorCount = results.length - successCount;

      if (successCount > 0) {
        await queryClient.invalidateQueries({ queryKey: ["tds"] });
      }
      if (errorCount === 0) {
        toast.success(
          `Imported ${successCount} TDS rate${successCount === 1 ? "" : "s"} ✓`,
        );
      } else if (successCount === 0) {
        toast.error(
          `Import failed for all ${errorCount} row${errorCount === 1 ? "" : "s"}.`,
        );
      } else {
        toast.warning(
          `Imported ${successCount} of ${results.length} rows — ${errorCount} failed. See details.`,
        );
      }
    } catch (err: any) {
      toast.error(
        "Could not read CSV file: " + (err?.message || "Unknown error"),
      );
    } finally {
      setImporting(false);
    }
  };

  const columnRenderers: Record<string, (value: unknown) => React.ReactNode> = {
    status: (value) => (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${value ? "bg-green-500/10 border-green-500/20 text-green-600" : "bg-red-500/10 border-red-500/20 text-red-600"}`}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full mr-1.5 ${value ? "bg-green-500" : "bg-red-500"}`}
        />
        {value ? "Active" : "Inactive"}
      </span>
    ),
    percentage: (value) => (
      <span className="font-mono text-sm">
        {value !== "" ? `${value}%` : "—"}
      </span>
    ),
    nature: (value) => (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border bg-blue-500/10 border-blue-500/20 text-blue-600">
        {String(value || "—")}
      </span>
    ),
    glHeadLabel: (value) =>
      value ? (
        <span className="text-sm text-foreground">{String(value)}</span>
      ) : (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
          <AlertTriangle size={11} /> Not linked — invoice posting will fail
        </span>
      ),
  };

  if (isLoading)
    return <div className="p-6 text-muted-foreground">Loading...</div>;
  if (error)
    return <div className="p-6 text-red-500">Failed to load TDS records.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Masters", "TDS Master"]} />
      <FinanceShell
        title="TDS Master"
        subtitle="Configure TDS natures, names and rates for tax deduction at source"
        icon={FileText}
        action={
          <div className="flex items-center gap-2">
            {/* Record count chip */}
            <span
              className="text-xs font-heading px-3 py-1.5 rounded-lg"
              style={{
                background: "rgba(99,102,241,0.12)",
                border: "1px solid rgba(99,102,241,0.25)",
                color: "#818cf8",
              }}
            >
              {dbItems.length} TDS Rates
            </span>

            {/* Hidden file input */}
            <input
              ref={importFileInputRef}
              type="file"
              accept=".csv"
              onChange={handleImportFileChange}
              className="hidden"
            />

            {/* Download template */}
            <button
              onClick={handleDownloadTemplate}
              title="Download a blank CSV with all TDS Master fields"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
            >
              <Download size={13} />
              <span className="hidden sm:inline">Download Template</span>
            </button>

            {/* Import CSV */}
            <button
              onClick={handleImportClick}
              disabled={importing}
              title="Import TDS rates from a filled-in CSV"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold gradient-accent text-primary-foreground hover:shadow-lg hover:shadow-primary/20 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {importing ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Upload size={13} />
              )}
              <span className="hidden sm:inline">
                {importing ? "Importing..." : "Import CSV"}
              </span>
            </button>
          </div>
        }
      >
        <MasterPage
          title="TDS"
          fields={[
            {
              name: "nature",
              label: "Nature",
              type: "text",
              required: true,
              uppercase: true,
            },
            { name: "name", label: "Name", type: "text", required: true },
            {
              name: "percentage",
              label: "Percentage (%)",
              type: "number",
              required: true,
            },
            {
              name: "glHeadId",
              label: "GL Head (for invoice posting)",
              type: "custom",
              required: true,
              fullWidth: true,
              render: ({ value, onChange }) => (
                <GLAccountSelect
                  value={value ? Number(value) : null}
                  onChange={(id) => onChange(id)}
                  placeholder="Select the ledger this TDS Nature posts its debit leg to..."
                />
              ),
            },
            {
              name: "status",
              label: "Status",
              type: "toggle",
              defaultValue: true,
              fullWidth: true,
            },
          ]}
          columns={[
            { key: "nature", label: "Nature" },
            { key: "name", label: "Name" },
            { key: "percentage", label: "Rate (%)" },
            { key: "glHeadLabel", label: "GL Head" },
            { key: "status", label: "Status" },
          ]}
          columnRenderers={columnRenderers}
          initialData={mappedData}
          onDataEvent={handleDataEvent}
          exportConfig={
            rights.canExport
              ? {
                  title: "TDS Master",
                  filename: "tds-master",
                  columns: [
                    { header: "Nature", accessor: "nature" },
                    { header: "Name", accessor: "name" },
                    { header: "Rate (%)", accessor: "percentage" },
                    { header: "Status", accessor: "status" },
                  ],
                }
              : undefined
          }
        />

        {/* ── Import Results Modal ─────────────────────────────────────────── */}
        <Dialog
          open={!!importResults}
          onOpenChange={(open) => !open && setImportResults(null)}
        >
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="font-heading text-base">
                Import Results
              </DialogTitle>
            </DialogHeader>
            {importResults && (
              <div className="space-y-3 pt-1">
                <div className="flex items-center gap-3 text-sm">
                  <span className="flex items-center gap-1.5 text-green-600">
                    <Check size={14} />
                    {
                      importResults.filter((r) => r.status === "success").length
                    }{" "}
                    succeeded
                  </span>
                  {importResults.some((r) => r.status === "error") && (
                    <span className="flex items-center gap-1.5 text-destructive">
                      <X size={14} />
                      {
                        importResults.filter((r) => r.status === "error").length
                      }{" "}
                      failed
                    </span>
                  )}
                </div>
                <div className="max-h-72 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                  {importResults.map((r, i) => (
                    <div
                      key={i}
                      className={`flex items-start gap-2 px-3 py-2 text-sm ${r.status === "error" ? "bg-destructive/5" : ""}`}
                    >
                      {r.status === "success" ? (
                        <Check
                          size={14}
                          className="text-green-600 shrink-0 mt-0.5"
                        />
                      ) : (
                        <X
                          size={14}
                          className="text-destructive shrink-0 mt-0.5"
                        />
                      )}
                      <div className="min-w-0">
                        <p className="font-medium truncate">
                          Row {r.row} — {r.name}
                        </p>
                        {r.message && (
                          <p className="text-xs text-destructive">
                            {r.message}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2 border-t border-border mt-2">
              <button
                onClick={() => setImportResults(null)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading bg-primary text-primary-foreground hover:bg-primary/90 transition-all"
              >
                Close
              </button>
            </div>
          </DialogContent>
        </Dialog>
      </FinanceShell>
    </>
  );
};

export default TdsMaster;
