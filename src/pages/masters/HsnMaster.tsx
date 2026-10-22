import { fetchWithAuth } from "@/lib/fetchWithAuth";
import React, { useRef, useState } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import {
  MasterPage,
  type DataChangeEvent,
  type RecordWithId,
} from "@/components/MasterPage";
import { exportToCsv, parseCsv, type ExportColumn } from "@/lib/export";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Upload, Loader2, Check, X } from "lucide-react";
import { usePageRights } from "@/hooks/usePageRights";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ─── API ──────────────────────────────────────────────────────────────────────
const BASE = "/api/hsn";

// None of these checked r.ok — a failed request (e.g. the 500 CreatedBy
// crash) still resolved its .json() error body as a normal success value,
// so handleDataEvent's try/catch below never caught anything and showed
// "HSN saved!" even when the save had actually failed server-side.
async function readError(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => null);
  return new Error(body?.error || body?.message || fallback);
}

const getHsn = async () => {
  const res = await fetchWithAuth(BASE);
  if (!res.ok) throw await readError(res, "Failed to load HSN codes");
  return res.json().catch(() => []);
};
const addHsn = async (data: object) => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw await readError(res, "Failed to save HSN");
  return res.json().catch(() => ({}));
};
const updateHsn = async (id: string, data: object) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw await readError(res, "Failed to update HSN");
  return res.json().catch(() => ({}));
};
const deleteHsn = async (id: string) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await readError(res, "Failed to delete HSN");
  return res.json().catch(() => ({}));
};

// ─── Types ────────────────────────────────────────────────────────────────────
interface DbHsn {
  HId: number;
  HCode: string;
  HDescription: string;
  HShortDescription: string | null;
  HCGST: number | null;
  HSGST: number | null;
  HIGST: number | null;
  HStatus: boolean;
  HIsSAC: boolean;
}

// ─── Payload ──────────────────────────────────────────────────────────────────
const toPayload = (r: Record<string, unknown>) => ({
  HCode: (r.code as string) || null,
  HDescription: (r.description as string) || null,
  HShortDescription: (r.shortDesc as string) || null,
  HCGST: r.cgstRate ? Number(r.cgstRate) : 0,
  HSGST: r.sgstRate ? Number(r.sgstRate) : 0,
  HIGST: r.igstRate ? Number(r.igstRate) : 0,
  HStatus: r.status !== false,
  HIsSAC: r.isSac === true,
});

// ── CSV template / import column mapping ─────────────────────────────────────
// Single source of truth for both the downloadable template and the importer,
// so the headers a user downloads are exactly the headers the importer reads.
const CSV_HEADERS = {
  code: "HSN Code",
  shortDesc: "Short Description",
  description: "Full Description",
  cgst: "CGST Rate (%)",
  sgst: "SGST Rate (%)",
  igst: "IGST Rate (%)",
  status: "Status (Active/Inactive)",
  isSac: "Is SAC Code (Yes/No)",
} as const;

const HSN_CSV_TEMPLATE_COLUMNS: ExportColumn[] = [
  { header: CSV_HEADERS.code, accessor: "code" },
  { header: CSV_HEADERS.shortDesc, accessor: "shortDesc" },
  { header: CSV_HEADERS.description, accessor: "description" },
  { header: CSV_HEADERS.cgst, accessor: "cgst" },
  { header: CSV_HEADERS.sgst, accessor: "sgst" },
  { header: CSV_HEADERS.igst, accessor: "igst" },
  { header: CSV_HEADERS.status, accessor: "status" },
  { header: CSV_HEADERS.isSac, accessor: "isSac" },
];

interface ImportRowResult {
  row: number;
  code: string;
  status: "success" | "error";
  message?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────
const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const KEY_INK = `${KEY} bg-foreground text-card border border-foreground`;
const KEY_LINE = `${KEY} border border-foreground text-foreground hover:bg-primary/10`;

const HsnMaster: React.FC = () => {
  const queryClient = useQueryClient();
  const rights = usePageRights("hsn-master");

  const {
    data: dbData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["hsn"],
    queryFn: getHsn,
    staleTime: 5 * 60 * 1000,
  });

  const dbItems: DbHsn[] = Array.isArray(dbData) ? dbData : [];

  const mappedData: RecordWithId[] = dbItems.map((item) => ({
    // HCode is deliberately not unique (multiple descriptions can share one
    // HSN code) — HId (identity PK) is the row's real, stable identity.
    _id: String(item.HId),
    code: item.HCode || "",
    description: item.HDescription || "",
    shortDesc: item.HShortDescription || "",
    cgstRate: item.HCGST ?? "",
    sgstRate: item.HSGST ?? "",
    igstRate: item.HIGST ?? "",
    status: item.HStatus,
    isSac: item.HIsSAC ?? false,
  }));

  // CSV import
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState<ImportRowResult[] | null>(
    null,
  );

  // ── CSV template download ───────────────────────────────────────────────────
  const handleDownloadTemplate = () => {
    exportToCsv([], HSN_CSV_TEMPLATE_COLUMNS, "hsn-master-template");
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
        const codeForLog = raw[CSV_HEADERS.code] || "(blank)";

        try {
          const code = (raw[CSV_HEADERS.code] || "").trim().toUpperCase();
          const shortDesc = (raw[CSV_HEADERS.shortDesc] || "").trim();
          const description = (raw[CSV_HEADERS.description] || "").trim();
          const cgstRaw = (raw[CSV_HEADERS.cgst] || "").trim();
          const sgstRaw = (raw[CSV_HEADERS.sgst] || "").trim();
          const igstRaw = (raw[CSV_HEADERS.igst] || "").trim();
          const statusRaw = (raw[CSV_HEADERS.status] || "")
            .trim()
            .toLowerCase();

          if (!code) throw new Error("HSN Code is required");
          if (!shortDesc) throw new Error("Short Description is required");

          const parseRate = (label: string, raw: string): number => {
            if (!raw) return 0;
            const n = Number(raw);
            if (Number.isNaN(n))
              throw new Error(`${label} must be a number (got "${raw}")`);
            return n;
          };
          const cgstRate = parseRate("CGST Rate", cgstRaw);
          const sgstRate = parseRate("SGST Rate", sgstRaw);
          const igstRate = parseRate("IGST Rate", igstRaw);
          if (Math.abs(cgstRate - sgstRate) > 0.001)
            throw new Error(`CGST (${cgstRate}%) and SGST (${sgstRate}%) must be the same`);
          if (Math.abs(cgstRate + sgstRate - igstRate) > 0.001)
            throw new Error(`IGST must equal CGST + SGST (${cgstRate + sgstRate}%), not ${igstRate}%`);

          // Status defaults to Active when left blank, matching the form's default.
          const isActive =
            statusRaw === "" ||
            statusRaw === "active" ||
            statusRaw === "yes" ||
            statusRaw === "true"
              ? true
              : statusRaw === "inactive" ||
                  statusRaw === "no" ||
                  statusRaw === "false"
                ? false
                : null;
          if (isActive === null)
            throw new Error(
              `Status must be "Active" or "Inactive" (got "${raw[CSV_HEADERS.status]}")`,
            );

          const isSacRaw = (raw[CSV_HEADERS.isSac] || "").trim().toLowerCase();
          const isSac = isSacRaw === "yes" || isSacRaw === "true";

          await addHsn(
            toPayload({
              code,
              shortDesc,
              description,
              cgstRate,
              sgstRate,
              igstRate,
              status: isActive,
              isSac,
            }),
          );
          results.push({ row: rowNum, code, status: "success" });
        } catch (err: any) {
          results.push({
            row: rowNum,
            code: codeForLog,
            status: "error",
            message: err?.message || "Unknown error",
          });
        }
      }

      setImportResults(results);
      const successCount = results.filter((r) => r.status === "success").length;
      const errorCount = results.length - successCount;

      if (successCount > 0) {
        await queryClient.invalidateQueries({ queryKey: ["hsn"] });
      }
      if (errorCount === 0) {
        toast.success(
          `Imported ${successCount} HSN code${successCount === 1 ? "" : "s"} ✓`,
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

  // Other pages hold the same HSN list under their own keys (activities, fixed assets); refresh them all.
  const refreshHsnEverywhere = () => {
    for (const key of ["hsn", "hsn-master", "hsn-sac-codes"]) queryClient.invalidateQueries({ queryKey: [key] });
  };

  // GST splits evenly: CGST = SGST, and together they make IGST. Items copy these rates, so a mismatch
  // here would put wrong tax on every bill that uses the code.
  const checkGstRates = (form: Record<string, unknown>) => {
    const n = (v: unknown) => (v === "" || v == null ? 0 : Number(v));
    const c = n(form.cgstRate), s = n(form.sgstRate), i = n(form.igstRate);
    if ([c, s, i].some((x) => !Number.isFinite(x) || x < 0 || x > 100)) {
      toast.error("GST rates must be between 0 and 100.");
      return null;
    }
    if (Math.abs(c - s) > 0.001) {
      toast.error(`CGST (${c}%) and SGST (${s}%) must be the same.`);
      return null;
    }
    if (Math.abs(c + s - i) > 0.001) {
      toast.error(`IGST must equal CGST + SGST (${c + s}%), not ${i}%.`);
      return null;
    }
    return form;
  };

  const handleDataEvent = async (event: DataChangeEvent) => {
    if (event.action === "add") {
      await addHsn(toPayload(event.record));
      refreshHsnEverywhere();
    }
    if (event.action === "update") {
      await updateHsn(event.id, toPayload(event.record));
      refreshHsnEverywhere();
    }
    if (event.action === "delete") {
      await deleteHsn(event.id);
      refreshHsnEverywhere();
    }
  };

  const pct = (value: unknown) =>
    value !== "" && value != null ? <span className="font-heading text-xs tabular-nums">{Number(value)}%</span> : <span className="text-muted-foreground text-xs">—</span>;
  const columnRenderers: Record<string, (value: unknown) => React.ReactNode> = {
    code: (value) => <span className="font-heading text-xs font-semibold tracking-wide text-foreground">{String(value ?? "")}</span>,
    status: (value) => <SheetMark text={value ? "Active" : "Inactive"} tone={value ? "done" : "waiting"} />,
    igstRate: pct,
    cgstRate: pct,
    sgstRate: pct,
    isSac: (value) =>
      value ? (
        <span className="inline-flex items-center font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] px-1.5 py-0.5 border border-foreground text-foreground">SAC</span>
      ) : (
        <span className="text-muted-foreground text-xs">—</span>
      ),
  };


  if (isLoading)
    return <div className="p-6 text-muted-foreground">Loading...</div>;
  if (error)
    return <div className="p-6 text-sm text-destructive">Failed to load HSN codes.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Material Module", "HSN Master"]} />
      <SheetShell
        eyebrow="CivilierERP · Masters"
        title="HSN / SAC codes"
        subtitle="Goods (HSN) and services (SAC) codes with their GST rates; items take their tax rates from here."
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
              title="Download a blank CSV with all HSN fields"
              className={`${KEY_LINE} h-9 px-3`}
            >
              <Download size={13} />
              <span className="hidden sm:inline">Template</span>
            </button>
            {rights.canCreate && (
              <button
                onClick={handleImportClick}
                disabled={importing}
                title="Import HSN codes from a filled-in CSV"
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
        <MasterPage
          canCreate={rights.canCreate}
          canEdit={rights.canEdit}
          canDelete={rights.canDelete}
          title="HSN"
          fields={[
            {
              name: "code",
              label: "",
              type: "custom",
              required: true,
              uppercase: true,
              render: ({ value, onChange, error, formData }) => {
                const isSac = !!formData.isSac;
                return (
                  <div>
                    <label className="block font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-1.5">
                      {isSac ? "SAC Code" : "HSN Code"}
                      <span className="text-destructive ml-0.5">*</span>
                    </label>
                    <input
                      type="text"
                      value={(value as string) || ""}
                      onChange={(e) => onChange(e.target.value.toUpperCase())}
                      placeholder={isSac ? "Enter SAC code…" : "Enter HSN code…"}
                      className={`w-full px-3 py-2 text-sm font-body bg-card border transition-colors focus:outline-none focus:border-foreground text-foreground ${error ? "border-destructive" : "border-foreground/40"}`}
                    />
                  </div>
                );
              },
            },
            {
              name: "shortDesc",
              label: "Short Description",
              type: "text",
              required: true,
            },
            {
              name: "description",
              label: "Full Description",
              type: "textarea",
              fullWidth: true,
            },
            { name: "igstRate", label: "IGST Rate (%)", type: "number" },
            { name: "cgstRate", label: "CGST Rate (%)", type: "number" },
            { name: "sgstRate", label: "SGST Rate (%)", type: "number" },
            {
              name: "isSac",
              label: "Is SAC Code",
              type: "toggle",
              defaultValue: false,
            },
            {
              name: "status",
              label: "Status",
              type: "toggle",
              defaultValue: true,
            },
          ]}
          columns={[
            { key: "code", label: "HSN Code" },
            { key: "shortDesc", label: "Short Desc" },
            { key: "igstRate", label: "IGST %", hideOnMobile: true },
            { key: "cgstRate", label: "CGST %", hideOnMobile: true },
            { key: "sgstRate", label: "SGST %", hideOnMobile: true },
            { key: "isSac", label: "SAC", hideOnMobile: true },
            { key: "status", label: "Status" },
          ]}
          columnRenderers={columnRenderers}
          initialData={mappedData}
          onDataEvent={handleDataEvent}
          onCustomSave={checkGstRates}
          exportConfig={rights.canExport ? {
            title: "HSN Master",
            filename: "hsn-master",
            columns: [
              { header: "HSN Code", accessor: "code" },
              { header: "Short Desc", accessor: "shortDesc" },
              { header: "IGST %", accessor: "igstRate" },
              { header: "CGST %", accessor: "cgstRate" },
              { header: "SGST %", accessor: "sgstRate" },
              { header: "Is SAC Code", accessor: (r) => (r.isSac ? "Yes" : "No") },
              { header: "Status", accessor: (r) => (r.status ? "Active" : "Inactive") },
            ],
          } : undefined}
        />

        {/* Import Results Modal */}
        <Dialog
          open={!!importResults}
          onOpenChange={(open) => !open && setImportResults(null)}
        >
          <DialogContent className="sheet-frame max-w-lg p-0 gap-0" style={{ margin: 0 }}>
            <DialogHeader className="px-5 pt-5 pb-4" style={{ borderBottom: "1px solid hsl(var(--foreground))" }}>
              <p className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">HSN / SAC codes</p>
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
                          Row {r.row} — {r.code}
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

export default HsnMaster;
