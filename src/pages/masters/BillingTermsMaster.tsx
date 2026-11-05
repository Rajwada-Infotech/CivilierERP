import React, { useEffect, useRef, useState } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import {
  MasterPage,
  type FieldDef,
  type ColumnDef,
  type DataChangeEvent,
} from "@/components/MasterPage";
import { exportToCsv, parseCsv, type ExportColumn } from "@/lib/export";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { Loader2, Download, Upload, Check, X } from "lucide-react";
import { toast } from "sonner";
import {
  useBillingTerms,
  mapDbRow,
  type BillingTerm,
} from "@/contexts/BillingTermsContext";
import {
  getBillingTerms,
  addBillingTerm,
  updateBillingTerm,
  deleteBillingTerm,
  type BillingTermRow,
} from "@/api/billingTermsMasterApi";
import { usePageRights } from "@/hooks/usePageRights";

// ─── CSV template / import column mapping ─────────────────────────────────────
// Single source of truth for both the downloadable template and the importer,
// so the headers a user downloads are exactly the headers the importer reads.
const CSV_HEADERS = {
  name: "Term Name",
  calculationType: "Calculation Type (Before GST/After GST)",
  deductionType: "Type (Addition/Deduction)",
  description: "Remarks",
  isActive: "Status (Active/Inactive)",
} as const;

const BILLING_TERM_CSV_TEMPLATE_COLUMNS: ExportColumn[] = [
  { header: CSV_HEADERS.name, accessor: "Name" },
  { header: CSV_HEADERS.calculationType, accessor: "CalculationType" },
  { header: CSV_HEADERS.deductionType, accessor: "DeductionType" },
  { header: CSV_HEADERS.description, accessor: "Description" },
  { header: CSV_HEADERS.isActive, accessor: "IsActive" },
];

interface ImportRowResult {
  row: number;
  name: string;
  status: "success" | "error";
  message?: string;
}

// ─── Map DB row → context shape ───────────────────────────────────────────────
// The shared store's own conversion (the invoice billing reads these terms), plus the raw
// DB column names MasterPage's form fields edit (Name, CalculationType, DeductionType, IsActive).
// The raw values are taken from the converted term so form and billing never disagree.
const mapRow = (row: BillingTermRow): BillingTerm & Record<string, unknown> => {
  const term = mapDbRow(row);
  return {
    ...term,
    id: term._id,
    Name: term.name,
    Description: term.description,
    CalculationType: term.appliedOn === "post-gst" ? "After GST" : "Before GST",
    DeductionType: term.deductionType,
    IsActive: term.status,
  };
};

// ─── Segmented toggler: Addition | Deduction ──────────────────────────────────
function DeductionToggler({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const current = (value as string) || "Addition";
  return (
    <div className="flex items-center gap-2 w-fit">
      {(["Addition", "Deduction"] as const).map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={`font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] h-8 px-3 border transition-colors ${
            current === opt ? "bg-foreground text-card border-foreground" : "border-foreground/40 text-muted-foreground hover:text-foreground hover:border-foreground"
          }`}
        >
          {opt === "Addition" ? "+ Addition" : "− Deduction"}
        </button>
      ))}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────
const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const KEY_INK = `${KEY} bg-foreground text-card border border-foreground`;
const KEY_LINE = `${KEY} border border-foreground text-foreground hover:bg-primary/10`;

const BillingTermsMaster: React.FC = () => {
  const rights = usePageRights("billing-terms");
  const { billingTerms, setBillingTerms } = useBillingTerms();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getBillingTerms()
      .then((rows) => setBillingTerms(rows.map(mapRow)))
      .catch(() => toast.error("Failed to load billing terms"))
      .finally(() => setLoading(false));
  }, []);

  const refetch = async () => {
    const fresh = await getBillingTerms();
    setBillingTerms(fresh.map(mapRow));
  };

  // ── CSV import/export state ─────────────────────────────────────────────────
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState<ImportRowResult[] | null>(
    null,
  );

  const handleDownloadTemplate = () => {
    exportToCsv(
      [],
      BILLING_TERM_CSV_TEMPLATE_COLUMNS,
      "billing-terms-template",
    );
    toast.success("Template downloaded — fill it in and use Import.");
  };

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
          const name = (raw[CSV_HEADERS.name] || "").trim();
          const description = (raw[CSV_HEADERS.description] || "").trim();
          const calcRaw = (raw[CSV_HEADERS.calculationType] || "")
            .trim()
            .toLowerCase();
          const deductionRaw = (raw[CSV_HEADERS.deductionType] || "")
            .trim()
            .toLowerCase();
          const statusRaw = (raw[CSV_HEADERS.isActive] || "")
            .trim()
            .toLowerCase();

          if (!name) throw new Error("Term Name is required");

          // Calculation Type defaults to "Before GST" when left blank,
          // matching the form's default.
          const calculationType =
            calcRaw === "" || calcRaw === "before gst"
              ? "Before GST"
              : calcRaw === "after gst"
                ? "After GST"
                : null;
          if (calculationType === null)
            throw new Error(
              `Calculation Type must be "Before GST" or "After GST" (got "${raw[CSV_HEADERS.calculationType]}")`,
            );

          // Type defaults to "Addition" when left blank, matching the form's default.
          const deductionType =
            deductionRaw === "" || deductionRaw === "addition"
              ? "Addition"
              : deductionRaw === "deduction"
                ? "Deduction"
                : null;
          if (deductionType === null)
            throw new Error(
              `Type must be "Addition" or "Deduction" (got "${raw[CSV_HEADERS.deductionType]}")`,
            );

          // Status defaults to Active when left blank, matching the form's default.
          const isActive =
            statusRaw === "" || statusRaw === "active"
              ? true
              : statusRaw === "inactive"
                ? false
                : null;
          if (isActive === null)
            throw new Error(
              `Status must be "Active" or "Inactive" (got "${raw[CSV_HEADERS.isActive]}")`,
            );

          await addBillingTerm({
            Name: name,
            Description: description,
            CalculationType: calculationType,
            DeductionType: deductionType,
            IsActive: isActive,
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
        await refetch();
      }
      if (errorCount === 0) {
        toast.success(
          `Imported ${successCount} billing term${successCount === 1 ? "" : "s"} ✓`,
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

  const fields: FieldDef[] = [
    {
      name: "Name",
      label: "Term Name",
      type: "text",
      required: true,
    },
    {
      name: "CalculationType",
      label: "Calculation Type",
      type: "select",
      required: true,
      defaultValue: "Before GST",
      options: ["Before GST", "After GST"],
    },
    {
      name: "DeductionType",
      label: "Type",
      type: "custom",
      defaultValue: "Addition",
      render: ({ value, onChange }) => {
        return <DeductionToggler value={value} onChange={onChange} />;
      },
    },
    {
      name: "Description",
      label: "Description",
      type: "textarea",
      fullWidth: true,
    },
    {
      name: "IsActive",
      label: "Status",
      type: "toggle",
      defaultValue: true,
    },
  ];

  const columns: ColumnDef[] = [
    { key: "name", label: "Term Name" },
    { key: "CalculationType", label: "Calculation Type" },
    { key: "DeductionType", label: "Type" },
    { key: "description", label: "Remarks" },
    { key: "status", label: "Status" },
  ];

  const columnRenderers = {
    status: (value: unknown) => <SheetMark text={value ? "Active" : "Inactive"} tone={value ? "done" : "waiting"} />,
    DeductionType: (value: unknown) => (
      <span className="inline-flex items-center font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] px-1.5 py-0.5 border border-foreground/40 text-foreground whitespace-nowrap">
        {value === "Addition" ? "+ Addition" : "− Deduction"}
      </span>
    ),
    CalculationType: (value: unknown) => <span className="text-xs text-muted-foreground">{String(value ?? "")}</span>,
    description: (value: unknown) => (
      <span className="text-xs text-muted-foreground truncate max-w-[200px] block">{value ? String(value) : "—"}</span>
    ),
  };


  const handleDataEvent = async (event: DataChangeEvent) => {
    if (event.action === "add") {
      const record = event.record as Record<string, unknown>;
      const calcType = String(record.CalculationType ?? "Before GST");
      await addBillingTerm({
        Name: String(record.Name ?? ""),
        Description: String(record.Description ?? ""),
        CalculationType: calcType,
        DeductionType: String(record.DeductionType ?? "Addition"),
        IsActive:
          record.IsActive !== undefined ? Boolean(record.IsActive) : true,
      });
      await refetch();
    } else if (event.action === "update") {
      const record = event.record as Record<string, unknown>;
      const calcType = String(record["CalculationType"] ?? "Before GST");
      await updateBillingTerm(Number(event.id), {
        Name: String(record["Name"] ?? ""),
        Description: String(record["Description"] ?? ""),
        CalculationType: calcType,
        DeductionType: String(record["DeductionType"] ?? "Addition"),
        IsActive:
          record["IsActive"] !== undefined
            ? Boolean(record["IsActive"])
            : true,
      });
      await refetch();
    } else if (event.action === "delete") {
      await deleteBillingTerm(Number(event.id));
      await refetch();
    }
  };

  return (
    <>
      <Breadcrumbs items={["Masters", "Billing Terms"]} />
      <SheetShell
        eyebrow="CivilierERP · Masters"
        title="Billing terms"
        subtitle="Additions and deductions applied on invoices, each before or after GST."
        action={
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
              title="Download a blank CSV with all billing term fields"
              className={`${KEY_LINE} h-9 px-3`}
            >
              <Download size={13} />
              <span className="hidden sm:inline">Template</span>
            </button>
            {rights.canCreate && (
              <button
                onClick={handleImportClick}
                disabled={importing}
                title="Import billing terms from a filled-in CSV"
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
            )}
          </div>
        }
      >
        {loading ? (
          <div className="flex items-center justify-center py-20 gap-2 text-muted-foreground">
            <Loader2 size={18} className="animate-spin" />
            <span className="text-sm font-heading">Loading billing terms…</span>
          </div>
        ) : (
          <MasterPage
            title="Billing Term"
            fields={fields}
            columns={columns}
            columnRenderers={columnRenderers}
            initialData={billingTerms as unknown as Record<string, unknown>[]}
            onDataEvent={handleDataEvent}
            exportConfig={rights.canExport ? {
              title: "Billing Terms Master",
              filename: "billing-terms-master",
              columns: [
                { header: "Term Name", accessor: "Name" },
                { header: "Calculation Type", accessor: "CalculationType" },
                { header: "Type", accessor: "DeductionType" },
                { header: "Remarks", accessor: "Description" },
                {
                  header: "Status",
                  accessor: (r) => (r.IsActive ? "Active" : "Inactive"),
                },
              ],
            } : undefined}
            canCreate={rights.canCreate}
            canEdit={rights.canEdit}
            canDelete={rights.canDelete}
          />
        )}

        {/* Import Results Modal */}
        <Dialog
          open={!!importResults}
          onOpenChange={(open) => !open && setImportResults(null)}
        >
          <DialogContent className="sheet-frame max-w-lg p-0 gap-0" style={{ margin: 0 }}>
            <DialogHeader className="px-5 pt-5 pb-4" style={{ borderBottom: "1px solid hsl(var(--foreground))" }}>
              <p className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Billing terms</p>
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
};

export default BillingTermsMaster;
