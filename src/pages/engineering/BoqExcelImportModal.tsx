// "Excel Import" section of the BOQ page: download the template, choose the filled
// workbook, see every problem (or a summary) before anything is created, then import.
// All checking lives in boqExcel.ts; the BOQ is created through the same
// POST /api/boq the manual form uses.
import { useRef, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload, X } from "lucide-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  downloadBoqTemplate,
  parseBoqWorkbook,
  type BoqImportMasters,
  type BoqImportResult,
} from "./boqExcel";

const money = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n || 0);

interface Props {
  masters: BoqImportMasters;
  onClose: () => void;
  onImported: () => void;
}

export const BoqExcelImportModal: React.FC<Props> = ({ masters, onClose, onImported }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [checking, setChecking] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<BoqImportResult | null>(null);

  const mastersReady = masters.companies.length > 0 && masters.uoms.length > 0;

  const handleTemplate = async () => {
    try {
      await downloadBoqTemplate(masters);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not create the template");
    }
  };

  const handleFile = async (f: File | null) => {
    setFile(f);
    setResult(null);
    if (!f) return;
    if (!/\.xlsx$/i.test(f.name)) {
      setResult({
        issues: [{ sheet: "File", row: 0, message: "Please choose an .xlsx file (use the downloaded template)." }],
        payload: null,
        summary: null,
      });
      return;
    }
    setChecking(true);
    try {
      setResult(await parseBoqWorkbook(f, masters));
    } catch (e: any) {
      setResult({ issues: [{ sheet: "File", row: 0, message: e?.message ?? "Could not read the file." }], payload: null, summary: null });
    } finally {
      setChecking(false);
    }
  };

  const handleImport = async () => {
    if (!result?.payload) return;
    setImporting(true);
    try {
      const res = await fetchWithAuth("/api/boq", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result.payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      toast.success("BOQ imported from Excel");
      onImported();
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Import failed — nothing was created");
    } finally {
      setImporting(false);
    }
  };

  const issues = result?.issues ?? [];
  const summary = result?.summary ?? null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-xl border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <div className="flex items-center gap-2">
            <FileSpreadsheet size={16} className="text-primary" />
            <h2 className="text-sm font-semibold">Excel Import — Bill of Quantities</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* 1. Template */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">1 · Download the template</h3>
            <p className="text-xs text-muted-foreground">
              The workbook has the BOQ header, Activities and Items sheets with every required field, dropdowns from your masters, and
              an Instructions sheet. One workbook creates one BOQ.
            </p>
            <button
              onClick={handleTemplate}
              disabled={!mastersReady}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted disabled:opacity-50"
            >
              <Download size={13} /> Download Excel Template
            </button>
            {!mastersReady && <p className="text-[11px] text-amber-600">Masters are still loading — try again in a moment.</p>}
          </section>

          {/* 2. Upload */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">2 · Choose the filled file</h3>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => {
                handleFile(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={() => inputRef.current?.click()}
                disabled={checking || importing}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted disabled:opacity-50"
              >
                <Upload size={13} /> {file ? "Choose a different file" : "Choose Excel File"}
              </button>
              {file && <span className="text-xs text-muted-foreground truncate max-w-[320px]">{file.name}</span>}
              {checking && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Loader2 size={12} className="animate-spin" /> Checking…
                </span>
              )}
            </div>
          </section>

          {/* Result */}
          {result && issues.length > 0 && (
            <section className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/20 dark:border-red-900 p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-red-700 dark:text-red-400 mb-2">
                <AlertCircle size={14} />
                {issues.length >= 200 ? "200+" : issues.length} problem{issues.length > 1 ? "s" : ""} found — nothing was created. Fix the
                file and choose it again.
              </p>
              <ul className="max-h-56 overflow-y-auto space-y-1 text-xs text-red-800 dark:text-red-300">
                {issues.map((i, k) => (
                  <li key={k}>
                    <span className="font-semibold">
                      {i.sheet}
                      {i.row > 0 ? ` · row ${i.row}` : ""}:
                    </span>{" "}
                    {i.message}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {summary && issues.length === 0 && (
            <section className="rounded-lg border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-900 p-3 space-y-2">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 size={14} /> File is valid — ready to import
              </p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <dt className="text-muted-foreground">Company</dt>
                <dd className="font-medium">{summary.company}</dd>
                <dt className="text-muted-foreground">Project</dt>
                <dd className="font-medium">{summary.project}</dd>
                <dt className="text-muted-foreground">Document Type</dt>
                <dd className="font-medium">{summary.docType}</dd>
                <dt className="text-muted-foreground">Financial Year · Date</dt>
                <dd className="font-medium">
                  {summary.finYear} · {summary.date}
                </dd>
                <dt className="text-muted-foreground">Activities</dt>
                <dd className="font-medium">
                  {summary.activityCount} · {money(summary.activitiesTotal)}
                </dd>
                <dt className="text-muted-foreground">Items</dt>
                <dd className="font-medium">
                  {summary.itemCount} · {money(summary.itemsTotal)}
                </dd>
              </dl>
              <p className="text-[11px] text-muted-foreground">
                It will be created as a Draft BOQ with an auto-generated number — open it from the list to review or submit it.
              </p>
            </section>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
          <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted">
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={!result?.payload || importing || checking}
            className="gradient-engineering inline-flex items-center gap-1.5 text-white text-xs font-semibold px-4 py-1.5 rounded-lg disabled:opacity-50"
          >
            {importing ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Import
          </button>
        </div>
      </div>
    </div>
  );
};
