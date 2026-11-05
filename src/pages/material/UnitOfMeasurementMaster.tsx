import React, { useRef, useState } from "react";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import {
  MasterPage,
  type ColumnDef,
  type FieldDef,
  type DataChangeEvent,
} from "@/components/MasterPage";
import { exportToCsv, parseCsv, type ExportColumn } from "@/lib/export";
import { Download, Upload, Loader2, Check, X } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getUomList, addUom, updateUom, deleteUom } from "@/api/uomApi";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface DbUOM {
  Id: number;
  UOMName: string;
  UOMCode: string;
  Symbol: string | null;
  Remarks: string | null;
  IsActive: boolean;
  CreatedAt: string | null;
}

const FIELDS: FieldDef[] = [
  {
    name: "code",
    label: "Unit Code",
    type: "text",
    required: true,
    uppercase: true,
  },
  {
    name: "name",
    label: "Unit Name",
    type: "text",
    required: true,
  },
  {
    name: "symbol",
    label: "Symbol",
    type: "text",
    required: true,
  },
  {
    name: "remarks",
    label: "Remarks",
    type: "textarea",
    fullWidth: true,
  },
  {
    name: "status",
    label: "Active",
    type: "toggle",
    defaultValue: true,
  },
];

const COLUMNS: ColumnDef[] = [
  { key: "code", label: "Code" },
  { key: "name", label: "Name" },
  { key: "symbol", label: "Symbol" },
  { key: "status", label: "Status" },
];

const toPayload = (record: Record<string, unknown>) => ({
  UOMCode: record.code as string,
  UOMName: record.name as string,
  Symbol: record.symbol as string,
  Remarks: (record.remarks as string) || null,
  IsActive: record.status !== false,
});

// ── CSV template / import column mapping ─────────────────────────────────────
// Single source of truth for both the downloadable template and the importer,
// so the headers a user downloads are exactly the headers the importer reads.
const CSV_HEADERS = {
  code: "Unit Code",
  name: "Unit Name",
  symbol: "Symbol",
  remarks: "Remarks",
  status: "Active (Yes/No)",
} as const;

const UOM_CSV_TEMPLATE_COLUMNS: ExportColumn[] = [
  { header: CSV_HEADERS.code, accessor: "code" },
  { header: CSV_HEADERS.name, accessor: "name" },
  { header: CSV_HEADERS.symbol, accessor: "symbol" },
  { header: CSV_HEADERS.remarks, accessor: "remarks" },
  { header: CSV_HEADERS.status, accessor: "status" },
];

interface ImportRowResult {
  row: number;
  name: string;
  status: "success" | "error";
  message?: string;
}

const columnRenderers = {
  code: (value: unknown) => (
    <span className="font-heading text-xs font-semibold tracking-wide text-foreground">{String(value ?? "")}</span>
  ),
  symbol: (value: unknown) => (
    <span className="inline-flex items-center font-heading text-[0.625rem] font-semibold px-1.5 py-0.5 border border-foreground/40 text-foreground">
      {String(value ?? "")}
    </span>
  ),
  status: (value: unknown) => <SheetMark text={value ? "Active" : "Inactive"} tone={value ? "done" : "waiting"} />,
};

const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const KEY_INK = `${KEY} bg-foreground text-card border border-foreground`;
const KEY_LINE = `${KEY} border border-foreground text-foreground hover:bg-primary/10`;

export default function UnitOfMeasurementMaster() {
  const rights = usePageRights("unit-of-measurement");
  const queryClient = useQueryClient();

  const {
    data: dbData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["uom-master"],
    queryFn: getUomList,
    staleTime: 5 * 60 * 1000,
  });

  const dbItems: DbUOM[] = Array.isArray(dbData) ? dbData : [];

  const mappedData = dbItems.map((item) => ({
    _id: String(item.Id),
    code: item.UOMCode || "",
    name: item.UOMName || "",
    symbol: item.Symbol || "",
    remarks: item.Remarks || "",
    status: Boolean(item.IsActive),
  }));

  // CSV import
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState<ImportRowResult[] | null>(
    null,
  );

  // ── CSV template download ───────────────────────────────────────────────────
  const handleDownloadTemplate = () => {
    exportToCsv([], UOM_CSV_TEMPLATE_COLUMNS, "uom-master-template");
    toast.success("Template downloaded — fill it in and use Import.");
  };

  // ── CSV import ───────────────────────────────────────────────────────────────
  const handleImportClick = () => {
    importFileInputRef.current?.click();
  };

  const handleImportFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    // Allow picking the same filename again later.
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

      // Sequential, not Promise.all — keeps row order in the result list
      // predictable and avoids hammering the API with N parallel inserts.
      for (let i = 0; i < rows.length; i++) {
        const raw = rows[i];
        const rowNum = i + 2; // +1 for header row, +1 for 1-based numbering
        const nameForLog = raw[CSV_HEADERS.name] || "(blank)";

        try {
          const code = (raw[CSV_HEADERS.code] || "").trim().toUpperCase();
          const name = (raw[CSV_HEADERS.name] || "").trim();
          const symbol = (raw[CSV_HEADERS.symbol] || "").trim();
          const remarks = (raw[CSV_HEADERS.remarks] || "").trim();
          const statusRaw = (raw[CSV_HEADERS.status] || "")
            .trim()
            .toLowerCase();

          if (!code) throw new Error("Unit Code is required");
          if (!name) throw new Error("Unit Name is required");
          if (!symbol) throw new Error("Symbol is required");

          // Active defaults to Yes when left blank, matching the form's default.
          const isActive =
            statusRaw === "" ||
            statusRaw === "yes" ||
            statusRaw === "true" ||
            statusRaw === "1"
              ? true
              : statusRaw === "no" || statusRaw === "false" || statusRaw === "0"
                ? false
                : null;
          if (isActive === null)
            throw new Error(
              `Active must be "Yes" or "No" (got "${raw[CSV_HEADERS.status]}")`,
            );

          await addUom(
            toPayload({ code, name, symbol, remarks, status: isActive }),
          );
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
        await queryClient.invalidateQueries({ queryKey: ["uom-master"] });
      }
      if (errorCount === 0) {
        toast.success(
          `Imported ${successCount} unit${successCount === 1 ? "" : "s"} ✓`,
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

  const handleDataEvent = async (event: DataChangeEvent) => {
    if (event.action === "add") {
      await addUom(toPayload(event.record));
      await queryClient.invalidateQueries({ queryKey: ["uom-master"] });
    }

    if (event.action === "update") {
      await updateUom(Number(event.id), toPayload(event.record));
      await queryClient.invalidateQueries({ queryKey: ["uom-master"] });
    }

    if (event.action === "delete") {
      await deleteUom(Number(event.id));
      await queryClient.invalidateQueries({ queryKey: ["uom-master"] });
    }
  };

  if (isLoading)
    return <div className="p-6 text-muted-foreground">Loading...</div>;

  if (error)
    return (
      <div className="p-6 text-sm text-destructive">
        Failed to load UOM data. Check your backend connection.
      </div>
    );

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Material", "Unit of Measurement"]} />
      <SheetShell
        eyebrow="CivilierERP · Masters"
        title="Units of measurement"
        subtitle="The units items are bought, stocked and issued in, each with a code and a symbol."
        action={
          rights.canCreate ? (
          <div className="flex items-center gap-2">
            <input
              ref={importFileInputRef}
              type="file"
              accept=".csv"
              onChange={handleImportFileChange}
              className="hidden"
            />
            <button
              onClick={handleDownloadTemplate}
              title="Download a blank CSV with all UOM fields"
              className={`${KEY_LINE} h-9 px-3`}
            >
              <Download size={13} />
              <span className="hidden sm:inline">Template</span>
            </button>
            <button
              onClick={handleImportClick}
              disabled={importing}
              title="Import units from a filled-in CSV"
              className={`${KEY_LINE} h-9 px-3`}
            >
              {importing ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Upload size={13} />
              )}
              <span className="hidden sm:inline">
                {importing ? "Importing…" : "Import CSV"}
              </span>
            </button>
          </div>
          ) : undefined
        }
      >
        <MasterPage
          title="Unit of Measurement"
          fields={FIELDS}
          columns={COLUMNS}
          initialData={mappedData}
          columnRenderers={columnRenderers}
          onDataEvent={handleDataEvent}
          exportConfig={{
            title: "Unit of Measurement Master",
            filename: "uom-master",
            columns: [
              { header: "Code", accessor: "code" },
              { header: "Name", accessor: "name" },
              { header: "Symbol", accessor: "symbol" },
              { header: "Status", accessor: (r) => (r.status ? "Active" : "Inactive") },
            ],
          }}
          canCreate={rights.canCreate}
          canEdit={rights.canEdit}
          canDelete={rights.canDelete}
          canExport={rights.canExport}
        />

        {/* Import Results Modal */}
        <Dialog
          open={!!importResults}
          onOpenChange={(open) => !open && setImportResults(null)}
        >
          <DialogContent className="sheet-frame max-w-lg p-0 gap-0" style={{ margin: 0 }}>
            <DialogHeader className="px-5 pt-5 pb-4" style={{ borderBottom: "1px solid hsl(var(--foreground))" }}>
              <p className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Units of measurement</p>
              <DialogTitle className="font-heading text-lg font-bold tracking-tight mt-1">Import results</DialogTitle>
            </DialogHeader>
            {importResults && (
              <div className="space-y-3 px-5 pt-4">
                <div className="flex items-center gap-3 text-sm">
                  <span className="flex items-center gap-1.5 text-foreground">
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
                <div className="max-h-72 overflow-y-auto border border-foreground divide-y divide-foreground/10">
                  {importResults.map((r, i) => (
                    <div
                      key={i}
                      className={`flex items-start gap-2 px-3 py-2 text-sm ${
                        r.status === "error" ? "bg-destructive/5" : ""
                      }`}
                    >
                      {r.status === "success" ? (
                        <Check
                          size={14}
                          className="text-foreground shrink-0 mt-0.5"
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
            <div className="flex justify-end gap-2 px-5 py-4">
              <button
                onClick={() => setImportResults(null)}
                className={`${KEY_INK} h-9 px-4`}
              >
                Close
              </button>
            </div>
          </DialogContent>
        </Dialog>
      </SheetShell>
    </>
  );
}
