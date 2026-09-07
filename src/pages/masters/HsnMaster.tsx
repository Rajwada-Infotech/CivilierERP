import { fetchWithAuth } from "@/lib/fetchWithAuth";
import React, { useRef, useState } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MaterialShell } from "@/components/material/MaterialShell";
import {
  MasterPage,
  type DataChangeEvent,
  type RecordWithId,
} from "@/components/MasterPage";
import { exportToCsv, parseCsv, type ExportColumn } from "@/lib/export";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Hash, Download, Upload, Loader2, Check, X } from "lucide-react";
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

const getHsn = () => fetchWithAuth(BASE).then((r) => r.json().catch(() => ({})));
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

  const handleDataEvent = async (event: DataChangeEvent) => {
    if (event.action === "add") {
      try {
        await addHsn(toPayload(event.record));
        toast.success("HSN saved!");
        await queryClient.invalidateQueries({ queryKey: ["hsn"] });
      } catch (err: any) {
        toast.error("Save failed: " + err.message);
      }
    }
    if (event.action === "update") {
      try {
        await updateHsn(event.id, toPayload(event.record));
        toast.success("HSN updated!");
        await queryClient.invalidateQueries({ queryKey: ["hsn"] });
      } catch (err: any) {
        toast.error("Update failed: " + err.message);
      }
    }
    if (event.action === "delete") {
      try {
        await deleteHsn(event.id);
        toast.success("HSN deleted!");
        await queryClient.invalidateQueries({ queryKey: ["hsn"] });
      } catch (err: any) {
        toast.error("Delete failed: " + err.message);
      }
    }
  };

  const columnRenderers: Record<string, (value: unknown) => React.ReactNode> = {
    status: (value) => (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${value ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600" : "bg-red-500/10 border-red-500/20 text-red-600"}`}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full mr-1.5 ${value ? "bg-emerald-500" : "bg-red-500"}`}
        />
        {value ? "Active" : "Inactive"}
      </span>
    ),
    igstRate: (value) =>
      value !== "" ? (
        <span className="font-mono text-sm">{Number(value)}%</span>
      ) : (
        "—"
      ),
    cgstRate: (value) =>
      value !== "" ? (
        <span className="font-mono text-sm">{Number(value)}%</span>
      ) : (
        "—"
      ),
    sgstRate: (value) =>
      value !== "" ? (
        <span className="font-mono text-sm">{Number(value)}%</span>
      ) : (
        "—"
      ),
    isSac: (value) =>
      value ? (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border bg-violet-500/10 border-violet-500/20 text-violet-600">
          SAC
        </span>
      ) : (
        <span className="text-muted-foreground text-xs">—</span>
      ),
  };

  if (isLoading)
    return <div className="p-6 text-muted-foreground">Loading...</div>;
  if (error)
    return <div className="p-6 text-red-500">Failed to load HSN records.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Material Module", "HSN Master"]} />
      <MaterialShell
        title="HSN Master"
        subtitle="HSN codes and GST rate configuration"
        icon={Hash}
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
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
            >
              <Download size={13} />
              <span className="hidden sm:inline">Download Template</span>
            </button>
            <button
              onClick={handleImportClick}
              disabled={importing}
              title="Import HSN codes from a filled-in CSV"
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
                    <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                      {isSac ? "SAC Code" : "HSN Code"}
                      <span className="text-destructive ml-0.5">*</span>
                    </label>
                    <input
                      type="text"
                      value={(value as string) || ""}
                      onChange={(e) => onChange(e.target.value.toUpperCase())}
                      placeholder={isSac ? "Enter SAC code…" : "Enter HSN code…"}
                      className={`w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground ${error ? "border-destructive" : "border-border"}`}
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
          exportConfig={rights.canExport ? {
            title: "HSN Master",
            filename: "hsn-master",
            columns: [
              { header: "HSN Code", accessor: "code" },
              { header: "Short Desc", accessor: "shortDesc" },
              { header: "IGST %", accessor: "igstRate" },
              { header: "CGST %", accessor: "cgstRate" },
              { header: "SGST %", accessor: "sgstRate" },
              { header: "Is SAC Code", accessor: "isSac" },
              { header: "Status", accessor: "status" },
            ],
          } : undefined}
        />

        {/* Import Results Modal */}
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
                      className={`flex items-start gap-2 px-3 py-2 text-sm ${
                        r.status === "error" ? "bg-destructive/5" : ""
                      }`}
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
      </MaterialShell>
    </>
  );
};

export default HsnMaster;
