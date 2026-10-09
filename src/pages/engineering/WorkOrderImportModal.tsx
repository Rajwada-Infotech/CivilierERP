// "Download Template" + "Import Work Order" for Work Orders without a BOQ.
// The workbook is validated up front by woExcel.ts; Import then creates each Work Order exactly the
// way the Work Order form does (POST the header → POST save-full with activities & materials),
// and removes the header again if its save-full fails, so no half-filled Work Order is left behind.
import { useRef, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload, X, XCircle } from "lucide-react";
import {
  createWorkOrder, deleteWorkOrder, fetchActivities, fetchActivityGroups, fetchCompanies, fetchContractors,
  fetchItems, fetchProjects, fetchSuppliers, getWorkOrders, saveFullWorkOrder, type WorkOrderFullPayload,
} from "@/api/workOrderApi";
import { fetchDocTypes } from "@/pages/material/ExpenseBooking/DocNumberPreview";
import { getHsn } from "@/api/hsnApi";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useFinYear } from "@/contexts/FinYearContext";
import { downloadWoTemplate, parseWoWorkbook, type WoImportMasters, type WoImportResult, type WoPlan } from "./woExcel";

const money = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n || 0);

type FinYears = WoImportMasters["finYears"];

/** The same masters the Work Order form loads. */
async function loadMasters(finYears: FinYears): Promise<WoImportMasters> {
  const [companies, projects, contractors, suppliers, groups, activities, uomRows, items, hsn, types, existing] = await Promise.all([
    fetchCompanies(), fetchProjects(), fetchContractors(), fetchSuppliers(), fetchActivityGroups(), fetchActivities(),
    fetchWithAuth("/api/uom-master").then((r) => (r.ok ? r.json() : [])),
    fetchItems(), getHsn().catch(() => []), fetchDocTypes("WO"), getWorkOrders().catch(() => []),
  ]);
  return {
    companies,
    projects,
    contractors,
    suppliers,
    groups,
    activities,
    uoms: (Array.isArray(uomRows) ? uomRows : [])
      .filter((u: any) => u.IsActive !== false)
      .map((u: any) => ({ id: u.Id, name: u.UOMName, uomCode: u.UOMCode ?? "" })),
    items: items.map((i) => ({ id: i.id, name: i.name, gstRate: i.gstRate, uomName: i.uomName })),
    // Work Orders are services: only SAC-flagged HSN rows are offered, like on the form.
    sacCodes: (Array.isArray(hsn) ? hsn : [])
      .filter((h: any) => h.HIsSAC === true)
      .map((h: any) => ({ code: h.HCode, shortDesc: h.HShortDescription || h.HCode, igstRate: h.HIGST ?? 0, cgstRate: h.HCGST ?? 0, sgstRate: h.HSGST ?? 0 })),
    docTypes: types
      .filter((d) => {
        const l = d.DocNoPrefix ?? d.FullPrefix ?? d.Prefix;
        return !l.startsWith("ExB-") && !l.startsWith("WO-PO") && !l.startsWith("WO_PO");
      })
      .map((d) => ({ id: d.TypeOfDocId, label: d.ProjectCode && d.ModuleCode ? `${d.ProjectCode}-${d.ModuleCode}` : (d.DocNoPrefix ?? d.FullPrefix ?? d.Prefix) })),
    finYears,
    existing: Array.isArray(existing) ? existing : [],
  };
}

type Outcome = { ref: string; ok: boolean; docNo?: string; message?: string };

function ImportDialog({ finYears, onClose, onImported }: { finYears: FinYears; onClose: () => void; onImported: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [checking, setChecking] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<WoImportResult | null>(null);
  const [outcomes, setOutcomes] = useState<Outcome[] | null>(null);

  const choose = async (f: File | null) => {
    setFile(f);
    setResult(null);
    setOutcomes(null);
    if (!f) return;
    if (!/\.xlsx$/i.test(f.name)) {
      setResult({ issues: [{ sheet: "File", row: 0, message: "Please choose an .xlsx file (use the downloaded template)." }], plans: [] });
      return;
    }
    setChecking(true);
    try {
      // Masters are re-read at the moment of checking so the file is judged against current data.
      setResult(await parseWoWorkbook(f, await loadMasters(finYears)));
    } catch (e: any) {
      setResult({ issues: [{ sheet: "File", row: 0, message: e?.message ?? "Could not read the file." }], plans: [] });
    } finally {
      setChecking(false);
    }
  };

  const createOne = async (plan: WoPlan): Promise<Outcome> => {
    let id: number | null = null;
    try {
      const created = await createWorkOrder(plan.createBody);
      id = created.Id as number;
      const docNo: string = created.DocumentNumber || created.DocNo || plan.manualDocNumber || "";
      try {
        await saveFullWorkOrder(id, {
          header: { ...plan.fullHeader, DocNo: docNo || null } as WorkOrderFullPayload["header"],
          activities: plan.activities as unknown as WorkOrderFullPayload["activities"],
        });
      } catch (e) {
        // Never leave a header without its activities behind.
        await deleteWorkOrder(id).catch(() => undefined);
        throw e;
      }
      return { ref: plan.ref, ok: true, docNo };
    } catch (e: any) {
      return { ref: plan.ref, ok: false, message: e?.message ?? "Failed to create" };
    }
  };

  const run = async () => {
    if (!result?.plans.length) return;
    setImporting(true);
    const done: Outcome[] = [];
    for (const plan of result.plans) {
      done.push(await createOne(plan));
      setOutcomes([...done]);
    }
    setImporting(false);
    const ok = done.filter((d) => d.ok).length;
    if (ok === done.length) toast.success(`${ok} Work Order${ok === 1 ? "" : "s"} imported`);
    else if (ok === 0) toast.error("Import failed — no Work Order was created");
    else toast.warning(`${ok} of ${done.length} Work Orders imported — see the list`);
    if (ok > 0) onImported();
  };

  const issues = result?.issues ?? [];
  const plans = result?.plans ?? [];
  const finished = outcomes != null && !importing;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4" onClick={importing ? undefined : onClose}>
      <div className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-xl border border-border bg-background shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <div className="flex items-center gap-2">
            <FileSpreadsheet size={16} className="text-primary" />
            <h2 className="text-sm font-semibold">Import Work Orders from Excel (no BOQ)</h2>
          </div>
          <button onClick={onClose} disabled={importing} className="p-1 rounded hover:bg-muted text-muted-foreground disabled:opacity-40" aria-label="Close"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <input ref={inputRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden"
              onChange={(e) => { choose(e.target.files?.[0] ?? null); e.target.value = ""; }} />
            <button onClick={() => inputRef.current?.click()} disabled={checking || importing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted disabled:opacity-50">
              <Upload size={13} /> {file ? "Choose a different file" : "Choose Excel File"}
            </button>
            {file && <span className="text-xs text-muted-foreground truncate max-w-[360px]">{file.name}</span>}
            {checking && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Loader2 size={12} className="animate-spin" /> Checking…</span>}
          </div>

          {result && issues.length > 0 && (
            <section className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/20 dark:border-red-900 p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-red-700 dark:text-red-400 mb-2">
                <AlertCircle size={14} /> {issues.length >= 300 ? "300+" : issues.length} problem{issues.length > 1 ? "s" : ""} found — nothing was imported. Fix the file and choose it again.
              </p>
              <ul className="max-h-64 overflow-y-auto space-y-1 text-xs text-red-800 dark:text-red-300">
                {issues.map((i, k) => (
                  <li key={k}><span className="font-semibold">{i.sheet}{i.row > 0 ? ` · row ${i.row}` : ""}:</span> {i.message}</li>
                ))}
              </ul>
            </section>
          )}

          {plans.length > 0 && !outcomes && (
            <section className="rounded-lg border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-900 p-3 space-y-2">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 size={14} /> File is valid — {plans.length} Work Order{plans.length === 1 ? "" : "s"} ready to import (no BOQ link)
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground"><tr>
                    <th className="py-1 pr-3 text-left">Ref</th><th className="py-1 pr-3 text-left">Company / Project</th><th className="py-1 pr-3 text-left">Contractor</th>
                    <th className="py-1 pr-3 text-left">Date</th><th className="py-1 pr-3 text-left">Number</th><th className="py-1 pr-3 text-right">Act.</th><th className="py-1 pr-3 text-right">Mat.</th><th className="py-1 text-right">Total</th>
                  </tr></thead>
                  <tbody>
                    {plans.map((p) => (
                      <tr key={p.ref} className="border-t border-emerald-200/60 dark:border-emerald-900/60">
                        <td className="py-1.5 pr-3 font-medium">{p.ref}</td>
                        <td className="py-1.5 pr-3">{p.summary.company} / {p.summary.project}</td>
                        <td className="py-1.5 pr-3">{p.summary.contractor}</td>
                        <td className="py-1.5 pr-3">{p.summary.date}</td>
                        <td className="py-1.5 pr-3">{p.manualDocNumber ?? `auto (${p.docTypeLabel})`}</td>
                        <td className="py-1.5 pr-3 text-right">{p.summary.activities}</td>
                        <td className="py-1.5 pr-3 text-right">{p.summary.materials}</td>
                        <td className="py-1.5 text-right font-medium">{money(p.summary.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {outcomes && (
            <section className="rounded-lg border border-border p-3 space-y-1.5">
              <p className="text-xs font-semibold flex items-center gap-1.5">{importing && <Loader2 size={12} className="animate-spin" />} {importing ? "Importing…" : "Import finished"}</p>
              {outcomes.map((o) => (
                <p key={o.ref} className={`text-xs flex items-start gap-1.5 ${o.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>
                  {o.ok ? <CheckCircle2 size={13} className="mt-0.5 shrink-0" /> : <XCircle size={13} className="mt-0.5 shrink-0" />}
                  <span><b>{o.ref}</b> — {o.ok ? `created as ${o.docNo}` : o.message}</span>
                </p>
              ))}
            </section>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
          <button onClick={onClose} disabled={importing} className="px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted disabled:opacity-50">{finished ? "Close" : "Cancel"}</button>
          {!finished && (
            <button onClick={run} disabled={!plans.length || importing || checking}
              className="gradient-engineering inline-flex items-center gap-1.5 text-white text-xs font-semibold px-4 py-1.5 rounded-lg disabled:opacity-50">
              {importing ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Import Work Order{plans.length > 1 ? "s" : ""}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** The two header buttons of the Work Order page. */
export function WorkOrderImportButtons({ onImported }: { onImported: () => void }) {
  const { finYears } = useFinYear();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const fy: FinYears = finYears.map((f) => ({ year: f.year, startDate: f.startDate, endDate: f.endDate, status: f.status, locked: f.locked }));

  const template = async () => {
    setBusy(true);
    try {
      await downloadWoTemplate(await loadMasters(fy));
    } catch (e: any) {
      toast.error(e?.message ?? "Could not create the template");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button onClick={template} disabled={busy} title="Download the Excel template for importing Work Orders without a BOQ"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm font-medium hover:bg-muted disabled:opacity-50">
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
        <span className="hidden sm:inline">Download Template</span>
      </button>
      <button onClick={() => setOpen(true)} title="Import Work Orders from the filled Excel template"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm font-medium hover:bg-muted">
        <Upload size={13} />
        <span className="hidden sm:inline">Import Work Order</span>
      </button>
      {open && <ImportDialog finYears={fy} onClose={() => setOpen(false)} onImported={onImported} />}
    </>
  );
}
