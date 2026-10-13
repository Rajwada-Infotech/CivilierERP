import { fetchWithAuth } from "@/lib/fetchWithAuth";
import React, { useRef, useState } from "react";
import { usePageRights } from "@/hooks/usePageRights";
import { Download, Upload, Check, X, Loader2 } from "lucide-react";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
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
      await addTds(toPayload(event.record));
      toast.success("TDS saved!");
      await queryClient.invalidateQueries({ queryKey: ["tds"] });
    }
    if (event.action === "update") {
      await updateTds(event.id, toPayload(event.record));
      toast.success("TDS updated!");
      await queryClient.invalidateQueries({ queryKey: ["tds"] });
    }
    if (event.action === "delete") {
      await deleteTds(event.id);
      toast.success("TDS deleted!");
      await queryClient.invalidateQueries({ queryKey: ["tds"] });
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

  const FIG = "font-heading text-[0.6875rem] font-semibold tabular-nums text-foreground";
  const columnRenderers: Record<string, (value: unknown) => React.ReactNode> = {
    status: (value) => <SheetMark text={value ? "Active" : "Inactive"} tone={value ? "done" : "none"} />,
    percentage: (value) => <span className={FIG}>{value !== "" ? `${value}%` : "—"}</span>,
    nature: (value) => <span className={FIG}>{String(value || "—")}</span>,
    // A nature with no ledger linked cannot be posted against, so it is marked in red.
    glHeadLabel: (value) =>
      value ? (
        <span className="text-sm text-foreground">{String(value)}</span>
      ) : (
        <SheetMark text="Not linked: invoice posting will fail" tone="stopped" />
      ),
  };
  const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
  const RULE = "1px solid hsl(var(--foreground))";
  const unlinked = dbItems.filter((d) => !d.GLHeadId).length;

  if (isLoading)
    return <div className="p-6 text-muted-foreground">Loading...</div>;
  if (error)
    return <div className="p-6 text-destructive">Failed to load TDS records.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Masters", "TDS Master"]} />
      <SheetShell
        eyebrow="CivilierERP · Masters"
        title="TDS rates"
        subtitle="Each nature of tax deducted at source: its rate, and the ledger its deduction is posted to."
        action={
          <div className="flex items-center gap-2 flex-wrap">
            <input
              ref={importFileInputRef}
              type="file"
              accept=".csv"
              onChange={handleImportFileChange}
              className="hidden"
            />
            <button
              onClick={handleDownloadTemplate}
              title="Download a blank CSV with all TDS Master fields"
              className={`${KEY} px-3 py-2 border border-foreground text-foreground hover:bg-primary/10`}
            >
              <Download size={13} />
              <span className="hidden sm:inline">Template</span>
            </button>
            <button
              onClick={handleImportClick}
              disabled={importing}
              title="Import TDS rates from a filled-in CSV"
              className={`${KEY} px-3 py-2 border border-foreground bg-foreground text-card`}
            >
              {importing ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
              <span className="hidden sm:inline">{importing ? "Importing…" : "Import CSV"}</span>
            </button>
          </div>
        }
      >
        <div className="bg-card" style={{ border: RULE }}>
          <div className="statrow" style={{ padding: "16px 16px 18px" }}>
            {[
              { label: "TDS rates", value: dbItems.length, note: "in all", red: false },
              { label: "Active", value: dbItems.filter((d) => d.Status).length, note: "available on invoices", red: false },
              { label: "No ledger linked", value: unlinked, note: unlinked > 0 ? "invoice posting will fail for these" : "every nature has its ledger", red: unlinked > 0 },
            ].map((x) => (
              <div key={x.label}>
                <p className="label" style={x.red ? { color: "var(--red)" } : undefined}>{x.label}</p>
                <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9, color: x.red ? "var(--red)" : undefined }}>{x.value}</p>
                <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
              </div>
            ))}
          </div>
        </div>

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
          <DialogContent className="sheet-frame max-w-lg" style={{ margin: 0 }}>
            <DialogHeader>
              <div className="pb-3" style={{ borderBottom: RULE }}>
                <p className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">TDS rates · CSV import</p>
                <DialogTitle className="font-heading text-lg font-bold tracking-tight mt-1">Import results</DialogTitle>
              </div>
            </DialogHeader>
            {importResults && (
              <div className="space-y-3 pt-1">
                <div className="flex items-center gap-4 flex-wrap">
                  <SheetMark text={`${importResults.filter((r) => r.status === "success").length} imported`} tone="done" />
                  {importResults.some((r) => r.status === "error") && (
                    <SheetMark text={`${importResults.filter((r) => r.status === "error").length} failed`} tone="stopped" />
                  )}
                </div>
                <div className="max-h-72 overflow-y-auto" style={{ border: RULE }}>
                  {importResults.map((r, i) => (
                    <div key={i} className="flex items-start gap-3 px-3 py-2 text-sm" style={i ? { borderTop: "1px solid hsl(var(--border) / 0.7)" } : undefined}>
                      <span className="font-heading text-[0.625rem] font-semibold tabular-nums text-muted-foreground shrink-0 mt-1 w-12">Row {r.row}</span>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate text-foreground">{r.name}</p>
                        {r.message && <p className="text-xs text-destructive mt-0.5">{r.message}</p>}
                      </div>
                      {r.status === "success" ? <Check size={14} className="text-foreground shrink-0 mt-0.5" /> : <X size={14} className="text-destructive shrink-0 mt-0.5" />}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-3 mt-2" style={{ borderTop: RULE }}>
              <button onClick={() => setImportResults(null)} className={`${KEY} h-9 px-4 bg-foreground text-card border border-foreground`}>
                Close
              </button>
            </div>
          </DialogContent>
        </Dialog>
      </SheetShell>
    </>
  );
};

export default TdsMaster;
